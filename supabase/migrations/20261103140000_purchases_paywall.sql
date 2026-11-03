-- Buying the full game (Stripe), and the paywall for online games: your first online game is free,
-- after that you need the full game to host or join. Single-player and the daily challenge stay free.

-- ---------------------------------------------------------------- settings
-- One switch for the paywall, so it can go live the moment payments do.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings are public" on public.app_settings;
create policy "settings are public" on public.app_settings for select using (true);
insert into public.app_settings (key, value) values
  ('paywall', jsonb_build_object('enabled', false, 'price', '€8.99', 'payment_link', null))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- purchases
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product text not null default 'full_game' check (product in ('full_game')),
  source text not null check (source in ('stripe', 'grant')),
  stripe_session text unique,
  amount integer,
  currency text,
  created_at timestamptz not null default now(),
  unique (user_id, product)
);
alter table public.purchases enable row level security;
drop policy if exists "read own purchases" on public.purchases;
create policy "read own purchases" on public.purchases for select using (user_id = (select auth.uid()));
create index if not exists purchases_user_idx on public.purchases (user_id);

-- Players who were here before payments existed keep playing for free.
insert into public.purchases (user_id, source) select id, 'grant' from auth.users on conflict do nothing;

-- ---------------------------------------------------------------- access
create or replace function public.paywall_on() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value->>'enabled')::boolean from public.app_settings where key = 'paywall'), false);
$$;

/** What the signed-in player may do: own the full game, or still have their free online game. */
create or replace function public.my_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_owned boolean; v_used int; s jsonb;
begin
  select value into s from public.app_settings where key = 'paywall';
  if v_uid is null then return jsonb_build_object('signed_in', false, 'owned', false, 'free_left', 1, 'paywall', coalesce(s, '{}'::jsonb)); end if;
  select exists (select 1 from public.purchases where user_id = v_uid and product = 'full_game') into v_owned;
  select count(distinct p.game_id) into v_used from public.players p join public.games g on g.id = p.game_id where p.user_id = v_uid and g.mode = 'live';
  return jsonb_build_object('signed_in', true, 'owned', v_owned, 'free_left', greatest(0, 1 - v_used), 'paywall', coalesce(s, '{}'::jsonb));
end $$;
revoke execute on function public.my_access() from public;
grant execute on function public.my_access() to anon, authenticated;

-- Raises when someone without the full game tries to take part in a second online game.
create or replace function public._check_online_access(p_uid uuid, p_game_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.paywall_on() then return; end if;
  if exists (select 1 from public.purchases where user_id = p_uid and product = 'full_game') then return; end if;
  if exists (select 1 from public.players p join public.games g on g.id = p.game_id
             where p.user_id = p_uid and g.mode = 'live' and g.id is distinct from p_game_id) then
    raise exception 'PAYWALL: Your free online game is used up. Get the full game to keep playing online.';
  end if;
end $$;
revoke execute on function public._check_online_access(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- gate create and join
create or replace function public.create_game(p_player_name text, p_company_name text, p_trait text, p_industry text default 'chocolate', p_difficulty text default 'standard', p_mode text default 'live', p_rounds integer default 8, p_league_id uuid default null, p_round_seconds integer default null, p_bot_count integer default 0, p_bot_skill text default 'normal')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.games;
  v_player_id uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_league_id is not null and not public.in_league(p_league_id) then raise exception 'You are not in that league'; end if;
  if coalesce(p_mode, 'live') = 'live' then perform public._check_online_access(v_uid, null); end if;
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
  if v_game.mode = 'live' then perform public._check_online_access(v_uid, v_game.id); end if;
  insert into public.players (game_id, user_id, player_name, company_name, trait)
  values (v_game.id, v_uid, trim(p_player_name), trim(p_company_name), p_trait)
  returning id into v_player_id;
  return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
end $$;
