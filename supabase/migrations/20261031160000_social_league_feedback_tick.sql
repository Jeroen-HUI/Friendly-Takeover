-- Social layer, league, feedback and automatic round closing.

-- ---------------------------------------------------------------- chat
-- Messages to everyone (to_player_id null) and emoji reactions next to private messages.
alter table public.messages alter column to_player_id drop not null;
alter table public.messages add column if not exists kind text not null default 'chat';
alter table public.messages add column if not exists round integer not null default 0;
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('chat', 'reaction'));
create index if not exists messages_game_id_id on public.messages (game_id, id);

drop policy if exists "read own messages" on public.messages;
create policy "read own and group messages" on public.messages for select to authenticated
  using (
    from_player_id = public.my_player_id(game_id)
    or to_player_id = public.my_player_id(game_id)
    or (to_player_id is null and public.my_player_id(game_id) is not null)
  );
drop policy if exists "send messages as yourself" on public.messages;
create policy "send messages as yourself" on public.messages for insert to authenticated
  with check (
    from_player_id = public.my_player_id(game_id)
    and (to_player_id is null or exists (select 1 from public.players p where p.id = to_player_id and p.game_id = messages.game_id))
  );

-- ---------------------------------------------------------------- deals
-- Private deals between players: share sales, loans and non-attack pacts. The engine carries them out
-- when the round resolves (status accepted -> done or failed, with the reason in note).
create table if not exists public.deals (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  round integer not null,
  from_player_id uuid not null references public.players (id) on delete cascade,
  to_player_id uuid not null references public.players (id) on delete cascade,
  kind text not null check (kind in ('shares', 'loan', 'pact')),
  terms jsonb not null check (jsonb_typeof(terms) = 'object' and pg_column_size(terms) < 2048),
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'cancelled', 'done', 'failed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_player_id <> to_player_id)
);
create index if not exists deals_game_round on public.deals (game_id, round);
create index if not exists deals_from on public.deals (from_player_id);
create index if not exists deals_to on public.deals (to_player_id);
alter table public.deals enable row level security;

create policy "deal parties read" on public.deals for select to authenticated
  using (from_player_id = public.my_player_id(game_id) or to_player_id = public.my_player_id(game_id));
create policy "offer deals as yourself" on public.deals for insert to authenticated
  with check (
    from_player_id = public.my_player_id(game_id)
    and status = 'offered'
    and exists (select 1 from public.players p where p.id = to_player_id and p.game_id = deals.game_id)
    and exists (select 1 from public.games g where g.id = deals.game_id and g.status = 'playing' and g.current_round = deals.round)
  );

-- Accept or decline an offer made to you (open round only).
create or replace function public.respond_deal(p_deal_id bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_deal public.deals;
begin
  select d.* into v_deal from public.deals d join public.games g on g.id = d.game_id
  where d.id = p_deal_id and d.status = 'offered' and g.status = 'playing' and g.current_round = d.round
    and d.to_player_id = public.my_player_id(d.game_id)
  for update of d;
  if not found then raise exception 'That offer is no longer open'; end if;
  update public.deals set status = case when p_accept then 'accepted' else 'declined' end, updated_at = now() where id = p_deal_id;
end $$;

-- Withdraw your own offer (before it is accepted).
create or replace function public.cancel_deal(p_deal_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.deals set status = 'cancelled', updated_at = now()
  where id = p_deal_id and status = 'offered' and from_player_id = public.my_player_id(game_id);
  if not found then raise exception 'That offer can''t be withdrawn any more'; end if;
end $$;

-- ---------------------------------------------------------------- league
-- A league is a chain of rematches: every game points at the first game of the chain.
alter table public.games add column if not exists league_id uuid;
create index if not exists games_league on public.games (league_id);

create or replace function public.in_league(p_league_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.players p join public.games g on g.id = p.game_id
    where p.user_id = (select auth.uid()) and (g.id = p_league_id or g.league_id = p_league_id)
  );
$$;

drop function if exists public.create_game(text, text, text, text, text, text, integer);
create or replace function public.create_game(
  p_player_name text, p_company_name text, p_trait text,
  p_industry text default 'chocolate', p_difficulty text default 'standard', p_mode text default 'live', p_rounds integer default 8,
  p_league_id uuid default null, p_round_seconds integer default null, p_bot_count integer default 0, p_bot_skill text default 'normal'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.games;
  v_player_id uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_league_id is not null and not public.in_league(p_league_id) then raise exception 'You are not in that league'; end if;
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

-- The rematch lobby of a league, if one is open (for the "Join the rematch" button).
create or replace function public.league_lobby(p_league_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.in_league(p_league_id) then (
    select jsonb_build_object('game_id', g.id, 'code', g.code)
    from public.games g where g.league_id = p_league_id and g.status = 'lobby'
    order by g.created_at desc limit 1
  ) end;
$$;

-- Season table: points per finished game (10, 7, 5, 3, 2, 1 for places 1-6), by person.
create or replace function public.league_table(p_league_id uuid)
returns table (user_id uuid, player_name text, games integer, wins integer, points integer, best_score numeric, me boolean)
language sql stable security definer set search_path = '' as $$
  with lg as (
    select g.id from public.games g
    where public.in_league(p_league_id) and g.status = 'finished' and (g.id = p_league_id or g.league_id = p_league_id)
  ), last as (
    select distinct on (r.game_id) r.game_id, r.public_data from public.round_results r join lg on lg.id = r.game_id
    order by r.game_id, r.round desc
  ), ranked as (
    select l.game_id, s.value->>'companyId' as company_id, (s.value->>'score')::numeric as score,
      row_number() over (partition by l.game_id order by (s.value->>'score')::numeric desc) as place
    from last l cross join lateral jsonb_array_elements(l.public_data->'standings') s
  )
  select p.user_id, (array_agg(p.player_name order by p.joined_at desc))[1], count(*)::int,
    count(*) filter (where r.place = 1)::int,
    sum(case r.place when 1 then 10 when 2 then 7 when 3 then 5 when 4 then 3 when 5 then 2 when 6 then 1 else 0 end)::int,
    max(r.score), p.user_id = (select auth.uid())
  from ranked r join public.players p on p.id::text = r.company_id
  group by p.user_id
  order by 5 desc, 4 desc, 6 desc;
$$;

-- ---------------------------------------------------------------- feedback
-- Playtest feedback from the final screen. Anyone may send; nobody can read it through the API.
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  mode text check (mode in ('single', 'online')),
  industry text, difficulty text, rounds smallint, place smallint, players smallint,
  game_id uuid references public.games (id) on delete set null
);
alter table public.feedback enable row level security;
create policy "anyone can send feedback" on public.feedback for insert to anon, authenticated with check (true);

-- ---------------------------------------------------------------- grants
grant select, insert on public.deals to authenticated;
grant insert on public.feedback to anon, authenticated;
grant execute on function public.respond_deal(bigint, boolean), public.cancel_deal(bigint), public.in_league(uuid),
  public.create_game(text, text, text, text, text, text, integer, uuid, integer, integer, text),
  public.league_lobby(uuid), public.league_table(uuid) to authenticated;
revoke execute on function public.respond_deal(bigint, boolean), public.cancel_deal(bigint), public.in_league(uuid),
  public.create_game(text, text, text, text, text, text, integer, uuid, integer, integer, text),
  public.league_lobby(uuid), public.league_table(uuid) from anon, public;

-- ---------------------------------------------------------------- automatic round closing
-- Every minute: if a round's deadline has passed, ask the game server to close it (no one needs to be online).
-- The server checks the shared secret stored in Vault as 'ft_tick_secret'.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'ft-close-overdue-rounds';
select cron.schedule('ft-close-overdue-rounds', '* * * * *', $cron$
  select net.http_post(
    url := 'https://jdtoluouqkaughquyjqx.supabase.co/functions/v1/game',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ft_tick_secret')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from public.games where status = 'playing' and round_deadline < now() - interval '5 seconds');
$cron$);

-- The game server checks the job's secret against Vault (the value itself is created by hand, never committed):
--   select vault.create_secret('<random>', 'ft_tick_secret');
create or replace function public.tick_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'ft_tick_secret'), false);
$$;
revoke execute on function public.tick_secret_ok(text) from public, anon, authenticated;
grant execute on function public.tick_secret_ok(text) to service_role;

-- in_league is only used inside the other functions.
revoke execute on function public.in_league(uuid) from authenticated, anon, public;
