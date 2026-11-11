-- Audit fixes (10 November 2026).
-- 1. Reactions and deal terms come from other players and are shown on everyone's screen: only accept safe shapes.
-- 2. Online play: every mode counts for the free game (the "one round a day" mode was never checked), and the owner
--    can require a saved email account for online play (app_settings.paywall.require_account).
-- 3. Payments: every Stripe event is logged, so a payment without an account can be fixed by hand; a refund removes
--    the unlock.
-- 4. A round is saved all-or-nothing (commit_round), so a half-saved round can't leave a game stuck.

-- ---------------------------------------------------------------- 1. safe reactions and deal terms
alter table public.messages drop constraint if exists messages_reaction_check;
alter table public.messages add constraint messages_reaction_check
  check (kind <> 'reaction' or (char_length(body) <= 16 and body !~ '[<>&"''`=/\\]'));

create or replace function public._deal_terms_ok() returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  foreach k in array array['qty', 'price', 'amount', 'repay', 'rounds', 'penalty'] loop
    if new.terms ? k and jsonb_typeof(new.terms->k) <> 'number' then raise exception 'That deal is not valid'; end if;
  end loop;
  foreach k in array array['company', 'survivor', 'direction'] loop
    if new.terms ? k and (jsonb_typeof(new.terms->k) <> 'string' or (new.terms->>k) !~ '^[A-Za-z0-9-]{1,40}$') then raise exception 'That deal is not valid'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists deals_terms_ok on public.deals;
create trigger deals_terms_ok before insert or update of terms on public.deals for each row execute function public._deal_terms_ok();

-- ---------------------------------------------------------------- 2. online access
create or replace function public._check_online_access(p_uid uuid, p_game_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare s jsonb;
begin
  if not public.paywall_on() then return; end if;
  if exists (select 1 from public.purchases where user_id = p_uid and product = 'full_game') then return; end if;
  select value into s from public.app_settings where key = 'paywall';
  if coalesce((s->>'require_account')::boolean, false)
     and exists (select 1 from auth.users u where u.id = p_uid and u.is_anonymous) then
    raise exception 'ACCOUNT: Online games need a free account. Save yours with your email and you''re in.';
  end if;
  -- Any online game counts, whatever its round timer.
  if exists (select 1 from public.players p where p.user_id = p_uid and p.game_id is distinct from p_game_id) then
    raise exception 'PAYWALL: Your free online game is used up. Get the full game to keep playing online.';
  end if;
end $$;
revoke execute on function public._check_online_access(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_owned boolean; v_used int; v_guest boolean; s jsonb;
begin
  select value into s from public.app_settings where key = 'paywall';
  if v_uid is null then return jsonb_build_object('signed_in', false, 'owned', false, 'free_left', 1, 'admin', false, 'guest', true, 'paywall', coalesce(s, '{}'::jsonb)); end if;
  select exists (select 1 from public.purchases where user_id = v_uid and product = 'full_game') into v_owned;
  select count(distinct p.game_id) into v_used from public.players p where p.user_id = v_uid;
  select coalesce((select u.is_anonymous from auth.users u where u.id = v_uid), false) into v_guest;
  return jsonb_build_object('signed_in', true, 'owned', v_owned, 'free_left', greatest(0, 1 - v_used), 'admin', public.is_admin(), 'guest', v_guest,
                            'paywall', coalesce(s, '{}'::jsonb));
end $$;

create or replace function public.create_game(p_player_name text, p_company_name text, p_trait text, p_industry text default 'chocolate', p_difficulty text default 'standard', p_mode text default 'live', p_rounds integer default 8, p_league_id uuid default null, p_round_seconds integer default null, p_bot_count integer default 0, p_bot_skill text default 'normal')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.games;
  v_player_id uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_league_id is not null and not public.in_league(p_league_id) then raise exception 'You are not in that league'; end if;
  perform public._check_online_access(v_uid, null);
  insert into public.games (code, host_user_id, industry, difficulty, mode, rounds, round_seconds, league_id, bot_count, bot_skill)
  values (
    public.new_game_code(), v_uid, p_industry, p_difficulty, p_mode, p_rounds,
    coalesce(p_round_seconds, case when p_mode = 'daily' then 86400 else 600 end), p_league_id,
    greatest(0, least(6, coalesce(p_bot_count, 0))), coalesce(p_bot_skill, 'normal')
  ) returning * into v_game;
  insert into public.players (game_id, user_id, player_name, company_name, trait, is_host)
  values (v_game.id, v_uid, trim(p_player_name), trim(p_company_name), p_trait, true)
  returning id into v_player_id;
  return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
end $$;

create or replace function public.join_game(p_code text, p_player_name text, p_company_name text, p_trait text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.games;
  v_player_id uuid;
  v_count int;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select * into v_game from public.games where code = upper(trim(p_code)) for update;
  if not found then raise exception 'No game with that code'; end if;
  select id into v_player_id from public.players where game_id = v_game.id and user_id = v_uid;
  if v_player_id is not null then
    return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
  end if;
  if v_game.status <> 'lobby' then raise exception 'This game has already started'; end if;
  select count(*) into v_count from public.players where game_id = v_game.id;
  if v_count >= 8 then raise exception 'This game is full (8 players)'; end if;
  perform public._check_online_access(v_uid, v_game.id);
  insert into public.players (game_id, user_id, player_name, company_name, trait)
  values (v_game.id, v_uid, trim(p_player_name), trim(p_company_name), p_trait)
  returning id into v_player_id;
  return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
end $$;

-- ---------------------------------------------------------------- 3. payments
alter table public.purchases add column if not exists payment_intent text;
create index if not exists purchases_payment_intent_idx on public.purchases (payment_intent) where payment_intent is not null;

-- Every Stripe event the webhook acts on. `status`: unlocked, no_account (paid, but no account on the payment:
-- grant it by hand), refunded, refund_unmatched. Only the server writes here; the owner reads it.
create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_id text unique,
  event_type text not null,
  status text not null check (status in ('unlocked', 'no_account', 'refunded', 'refund_unmatched')),
  user_id uuid,
  stripe_session text,
  payment_intent text,
  email text check (char_length(email) <= 320),
  amount integer,
  currency text check (char_length(currency) <= 8)
);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;

create or replace function public.admin_list_payment_events()
returns setof public.payment_events language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Owner only'; end if;
  return query select * from public.payment_events order by id desc limit 200;
end $$;
revoke execute on function public.admin_list_payment_events() from public, anon;
grant execute on function public.admin_list_payment_events() to authenticated;

-- ---------------------------------------------------------------- 4. all-or-nothing round save
-- Claims the open round, then writes the new state, the live market, every player's report and the public results
-- in one transaction. Returns false when the round was already resolved; raises STALE when a live trade changed the
-- state while the round was being computed (the caller starts over with the newest state).
create or replace function public.commit_round(p_game_id uuid, p_round integer, p_expect_updated timestamptz, p_state jsonb, p_live jsonb, p_reports jsonb, p_result jsonb, p_finished boolean, p_deadline timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := now();
begin
  update public.games
     set current_round = case when p_finished then p_round else p_round + 1 end,
         status = case when p_finished then 'finished' else 'playing' end,
         round_deadline = p_deadline
   where id = p_game_id and current_round = p_round and status = 'playing';
  if not found then return false; end if;
  update public.game_states set state = p_state, updated_at = v_now
   where game_id = p_game_id and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', p_expect_updated);
  if not found then raise exception 'STALE'; end if;
  insert into public.market_live (game_id, round, data, updated_at) values (p_game_id, (p_state->>'round')::int, p_live, v_now)
    on conflict (game_id) do update set round = excluded.round, data = excluded.data, updated_at = excluded.updated_at;
  insert into public.player_reports (game_id, round, player_id, report)
    select p_game_id, p_round, (r->>'player_id')::uuid, r->'report' from jsonb_array_elements(coalesce(p_reports, '[]'::jsonb)) r
    on conflict (game_id, round, player_id) do update set report = excluded.report;
  -- Results last: clients listen for this row.
  insert into public.round_results (game_id, round, public_data, resolved_at) values (p_game_id, p_round, p_result, v_now)
    on conflict (game_id, round) do update set public_data = excluded.public_data, resolved_at = excluded.resolved_at;
  return true;
end $$;
revoke execute on function public.commit_round(uuid, integer, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.commit_round(uuid, integer, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) to service_role;
