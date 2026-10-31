-- Friendly Takeover — initial schema.
-- Players sign in anonymously (Supabase anonymous auth), so nobody needs an account to join a friend's game.
-- The full engine state holds everyone's secret numbers, so it lives in game_states, which no client can read:
-- only the round-resolving edge function (service role) touches it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  industry text not null default 'chocolate' check (industry in ('chocolate', 'ai', 'weed')),
  difficulty text not null default 'standard' check (difficulty in ('standard', 'tycoon', 'cutthroat')),
  mode text not null default 'live' check (mode in ('live', 'daily')),
  rounds int not null default 8 check (rounds between 4 and 12),
  round_seconds int not null default 600 check (round_seconds between 60 and 86400),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  current_round int not null default 0,
  round_deadline timestamptz,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  player_name text not null check (char_length(player_name) between 1 and 24),
  company_name text not null check (char_length(company_name) between 1 and 32),
  trait text not null check (trait in ('ruthless', 'visionary', 'influencer', 'pennyPincher')),
  is_host boolean not null default false,
  -- Last round this player submitted decisions for: lets everyone see who is ready without seeing what they chose.
  submitted_round int not null default 0,
  joined_at timestamptz not null default now(),
  unique (game_id, user_id),
  unique (game_id, company_name)
);
create index players_user_id_idx on public.players (user_id);

-- Server-only: the complete engine state. RLS on, no policies = invisible to clients.
create table public.game_states (
  game_id uuid primary key references public.games (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.decisions (
  game_id uuid not null references public.games (id) on delete cascade,
  round int not null check (round >= 1),
  player_id uuid not null references public.players (id) on delete cascade,
  decisions jsonb not null check (jsonb_typeof(decisions) = 'object' and pg_column_size(decisions) < 8192),
  submitted_at timestamptz not null default now(),
  primary key (game_id, round, player_id)
);
create index decisions_player_id_idx on public.decisions (player_id);

-- What everyone may see after a round: news, public company info, standings.
create table public.round_results (
  game_id uuid not null references public.games (id) on delete cascade,
  round int not null,
  public_data jsonb not null,
  resolved_at timestamptz not null default now(),
  primary key (game_id, round)
);

-- Each player's own detailed report for a round.
create table public.player_reports (
  game_id uuid not null references public.games (id) on delete cascade,
  round int not null,
  player_id uuid not null references public.players (id) on delete cascade,
  report jsonb not null,
  primary key (game_id, round, player_id)
);
create index player_reports_player_id_idx on public.player_reports (player_id);

-- Private deal-making between players.
create table public.messages (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  from_player_id uuid not null references public.players (id) on delete cascade,
  to_player_id uuid not null references public.players (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  check (from_player_id <> to_player_id)
);
create index messages_game_id_idx on public.messages (game_id, created_at);
create index messages_from_idx on public.messages (from_player_id);
create index messages_to_idx on public.messages (to_player_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can check membership without recursion)
-- ---------------------------------------------------------------------------

create or replace function public.is_game_member(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players p
    where p.game_id = p_game_id and p.user_id = (select auth.uid())
  );
$$;

create or replace function public.my_player_id(p_game_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.players p
  where p.game_id = p_game_id and p.user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.game_states enable row level security;
alter table public.decisions enable row level security;
alter table public.round_results enable row level security;
alter table public.player_reports enable row level security;
alter table public.messages enable row level security;

-- Games: members can read. Creating, joining and starting go through the functions below.
create policy "members read their games" on public.games
  for select to authenticated using (public.is_game_member(id));

-- Players: members see everyone in their game.
create policy "members read players" on public.players
  for select to authenticated using (public.is_game_member(game_id));

-- Decisions: you only ever see and write your own, and only for the current round while it is open.
create policy "read own decisions" on public.decisions
  for select to authenticated using (player_id = public.my_player_id(game_id));

create policy "submit own decisions for the open round" on public.decisions
  for insert to authenticated with check (
    player_id = public.my_player_id(game_id)
    and exists (
      select 1 from public.games g
      where g.id = decisions.game_id and g.status = 'playing' and g.current_round = decisions.round
        and (g.round_deadline is null or now() <= g.round_deadline)
    )
  );

create policy "change own decisions for the open round" on public.decisions
  for update to authenticated
  using (player_id = public.my_player_id(game_id))
  with check (
    player_id = public.my_player_id(game_id)
    and exists (
      select 1 from public.games g
      where g.id = decisions.game_id and g.status = 'playing' and g.current_round = decisions.round
        and (g.round_deadline is null or now() <= g.round_deadline)
    )
  );

-- Results and reports.
create policy "members read round results" on public.round_results
  for select to authenticated using (public.is_game_member(game_id));

create policy "read own reports" on public.player_reports
  for select to authenticated using (player_id = public.my_player_id(game_id));

-- Messages: send as yourself to someone in the same game; read what you sent or received.
create policy "send messages as yourself" on public.messages
  for insert to authenticated with check (
    from_player_id = public.my_player_id(game_id)
    and exists (select 1 from public.players p where p.id = messages.to_player_id and p.game_id = messages.game_id)
  );

create policy "read own messages" on public.messages
  for select to authenticated using (
    from_player_id = public.my_player_id(game_id) or to_player_id = public.my_player_id(game_id)
  );

-- ---------------------------------------------------------------------------
-- Ready status: a submitted decision marks the player as ready (without exposing the decision).
-- ---------------------------------------------------------------------------

create or replace function public.mark_player_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.players set submitted_round = greatest(submitted_round, new.round) where id = new.player_id;
  return new;
end;
$$;

create trigger decisions_mark_submitted
  after insert or update on public.decisions
  for each row execute function public.mark_player_submitted();

-- ---------------------------------------------------------------------------
-- Lobby functions
-- ---------------------------------------------------------------------------

create or replace function public.new_game_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O or 1/I confusion
  result text;
begin
  loop
    result := '';
    for i in 1..6 loop
      result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.games where code = result);
  end loop;
  return result;
end;
$$;

create or replace function public.create_game(
  p_player_name text,
  p_company_name text,
  p_trait text,
  p_industry text default 'chocolate',
  p_difficulty text default 'standard',
  p_mode text default 'live',
  p_rounds int default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.games;
  v_player_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first';
  end if;
  insert into public.games (code, host_user_id, industry, difficulty, mode, rounds, round_seconds)
  values (
    public.new_game_code(), v_uid, p_industry, p_difficulty, p_mode, p_rounds,
    case when p_mode = 'daily' then 86400 else 600 end
  )
  returning * into v_game;
  insert into public.players (game_id, user_id, player_name, company_name, trait, is_host)
  values (v_game.id, v_uid, trim(p_player_name), trim(p_company_name), p_trait, true)
  returning id into v_player_id;
  return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
end;
$$;

create or replace function public.join_game(
  p_code text,
  p_player_name text,
  p_company_name text,
  p_trait text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.games;
  v_player_id uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Sign in first';
  end if;
  select * into v_game from public.games where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'No game with that code';
  end if;
  select id into v_player_id from public.players where game_id = v_game.id and user_id = v_uid;
  if v_player_id is not null then
    return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'This game has already started';
  end if;
  select count(*) into v_count from public.players where game_id = v_game.id;
  if v_count >= 8 then
    raise exception 'This game is full (8 players)';
  end if;
  insert into public.players (game_id, user_id, player_name, company_name, trait)
  values (v_game.id, v_uid, trim(p_player_name), trim(p_company_name), p_trait)
  returning id into v_player_id;
  return jsonb_build_object('game_id', v_game.id, 'code', v_game.code, 'player_id', v_player_id);
end;
$$;

-- Only the host may change settings, and only in the lobby.
create or replace function public.update_game_settings(
  p_game_id uuid,
  p_industry text,
  p_difficulty text,
  p_mode text,
  p_rounds int,
  p_round_seconds int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.games
  set industry = p_industry, difficulty = p_difficulty, mode = p_mode, rounds = p_rounds, round_seconds = p_round_seconds
  where id = p_game_id and host_user_id = (select auth.uid()) and status = 'lobby';
  if not found then
    raise exception 'Only the host can change settings before the game starts';
  end if;
end;
$$;

-- Lock down function access: only signed-in users may call these functions.
revoke execute on function public.is_game_member(uuid) from public, anon;
revoke execute on function public.my_player_id(uuid) from public, anon;
grant execute on function public.is_game_member(uuid) to authenticated;
grant execute on function public.my_player_id(uuid) to authenticated;
revoke execute on function public.create_game(text, text, text, text, text, text, int) from public, anon;
revoke execute on function public.join_game(text, text, text, text) from public, anon;
revoke execute on function public.update_game_settings(uuid, text, text, text, int, int) from public, anon;
revoke execute on function public.new_game_code() from public, anon, authenticated;
revoke execute on function public.mark_player_submitted() from public, anon, authenticated;
grant execute on function public.create_game(text, text, text, text, text, text, int) to authenticated;
grant execute on function public.join_game(text, text, text, text) to authenticated;
grant execute on function public.update_game_settings(uuid, text, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: lobby, ready status, results and messages push to every screen.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.games, public.players, public.round_results, public.messages;
