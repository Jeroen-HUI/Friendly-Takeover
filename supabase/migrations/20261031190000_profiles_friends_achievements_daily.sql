-- Accounts, friends, invites, achievements, daily challenge and leaderboards.
-- Everything goes through functions; the tables themselves have RLS on and (almost) no policies.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  friend_code text not null unique check (friend_code ~ '^[A-Z0-9]{6}$'),
  stats jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.new_friend_code() returns text language plpgsql set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result text;
begin
  loop
    result := '';
    for i in 1..6 loop result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.profiles where friend_code = result);
  end loop;
  return result;
end $$;

-- Creates your profile the first time (with a friend code), marks you online, and returns it.
create or replace function public.ensure_profile(p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v public.profiles; v_user auth.users;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  insert into public.profiles (user_id, name, friend_code)
  values (v_uid, coalesce(nullif(left(trim(p_name), 24), ''), 'Player'), public.new_friend_code())
  on conflict (user_id) do update set last_seen = now()
  returning * into v;
  select * into v_user from auth.users where id = v_uid;
  return jsonb_build_object('name', v.name, 'friend_code', v.friend_code, 'stats', v.stats,
    'email', v_user.email, 'anonymous', coalesce(v_user.is_anonymous, false));
end $$;

create or replace function public.set_profile_name(p_name text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set name = left(trim(p_name), 24) where user_id = (select auth.uid()) and char_length(trim(p_name)) > 0;
$$;

create or replace function public.touch_profile() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen = now() where user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------- friends
create table if not exists public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index if not exists friendships_addressee on public.friendships (addressee);
alter table public.friendships enable row level security;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;

-- Add someone by friend code. If they already asked you, you're friends right away.
create or replace function public.add_friend(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_other uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select user_id into v_other from public.profiles where friend_code = upper(trim(p_code));
  if v_other is null then raise exception 'No player with that friend code'; end if;
  if v_other = v_uid then raise exception 'That''s your own code'; end if;
  if public.are_friends(v_uid, v_other) then return 'friends'; end if;
  if exists (select 1 from public.friendships where requester = v_other and addressee = v_uid) then
    update public.friendships set status = 'accepted' where requester = v_other and addressee = v_uid;
    return 'friends';
  end if;
  insert into public.friendships (requester, addressee) values (v_uid, v_other) on conflict do nothing;
  return 'requested';
end $$;

create or replace function public.respond_friend(p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted' where requester = p_user and addressee = (select auth.uid()) and status = 'pending';
  else
    delete from public.friendships where requester = p_user and addressee = (select auth.uid()) and status = 'pending';
  end if;
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friendships where (requester = (select auth.uid()) and addressee = p_user) or (requester = p_user and addressee = (select auth.uid()));
$$;

-- Your friends and requests, with who is online (seen in the last 2 minutes).
create or replace function public.my_friends()
returns table (user_id uuid, name text, friend_code text, status text, online boolean, last_seen timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.name, p.friend_code,
    case when f.status = 'accepted' then 'friends' when f.requester = (select auth.uid()) then 'outgoing' else 'incoming' end,
    p.last_seen > now() - interval '2 minutes', p.last_seen
  from public.friendships f
  join public.profiles p on p.user_id = case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  where f.requester = (select auth.uid()) or f.addressee = (select auth.uid())
  order by (f.status = 'accepted') desc, (p.last_seen > now() - interval '2 minutes') desc, p.name;
$$;

-- ---------------------------------------------------------------- invites
create table if not exists public.game_invites (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (game_id, to_user)
);
create index if not exists game_invites_to on public.game_invites (to_user, status);
alter table public.game_invites enable row level security;

-- Invite a friend into the lobby you're in.
create or replace function public.invite_friend(p_game_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.players p join public.games g on g.id = p.game_id where p.game_id = p_game_id and p.user_id = v_uid and g.status = 'lobby') then
    raise exception 'You can only invite from a lobby you are in';
  end if;
  if not public.are_friends(v_uid, p_user) then raise exception 'You can only invite friends'; end if;
  if exists (select 1 from public.players where game_id = p_game_id and user_id = p_user) then return; end if;
  insert into public.game_invites (game_id, from_user, to_user) values (p_game_id, v_uid, p_user)
  on conflict (game_id, to_user) do update set status = 'pending', created_at = now(), from_user = excluded.from_user;
end $$;

-- Open invites for you (only lobbies that haven't started).
create or replace function public.my_invites()
returns table (id bigint, game_id uuid, code text, from_name text, industry text, players integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, g.id, g.code, coalesce(p.name, 'A friend'), g.industry,
    (select count(*)::int from public.players pl where pl.game_id = g.id), i.created_at
  from public.game_invites i
  join public.games g on g.id = i.game_id and g.status = 'lobby'
  left join public.profiles p on p.user_id = i.from_user
  where i.to_user = (select auth.uid()) and i.status = 'pending'
  order by i.created_at desc;
$$;

create or replace function public.answer_invite(p_id bigint, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  update public.game_invites i set status = case when p_accept then 'accepted' else 'declined' end
  from public.games g
  where i.id = p_id and i.to_user = (select auth.uid()) and g.id = i.game_id
  returning g.code into v_code;
  return v_code;
end $$;

-- Who in your friends list you already invited to this lobby.
create or replace function public.lobby_invites(p_game_id uuid)
returns table (to_user uuid, status text)
language sql stable security definer set search_path = '' as $$
  select i.to_user, i.status from public.game_invites i
  where i.game_id = p_game_id and exists (select 1 from public.players p where p.game_id = p_game_id and p.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------- achievements and stats
create table if not exists public.achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9_]{1,32}$'),
  earned_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.achievements enable row level security;
create policy "read own achievements" on public.achievements for select to authenticated using (user_id = (select auth.uid()));

-- Counts a finished game in your stats and stores newly earned achievements. Returns the new stats.
create or replace function public.record_result(
  p_mode text, p_won boolean, p_industry text, p_difficulty text, p_mission boolean, p_achievements text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s jsonb; inc int;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  insert into public.profiles (user_id, name, friend_code) values (v_uid, 'Player', public.new_friend_code()) on conflict do nothing;
  select stats into s from public.profiles where user_id = v_uid for update;
  s := coalesce(s, '{}'::jsonb);
  s := jsonb_set(s, '{games}', to_jsonb(coalesce((s->>'games')::int, 0) + 1));
  if p_won then s := jsonb_set(s, '{wins}', to_jsonb(coalesce((s->>'wins')::int, 0) + 1)); end if;
  if p_mode = 'online' then
    s := jsonb_set(s, '{online_games}', to_jsonb(coalesce((s->>'online_games')::int, 0) + 1));
    if p_won then s := jsonb_set(s, '{online_wins}', to_jsonb(coalesce((s->>'online_wins')::int, 0) + 1)); end if;
  end if;
  if p_mode = 'daily' then s := jsonb_set(s, '{dailies}', to_jsonb(coalesce((s->>'dailies')::int, 0) + 1)); end if;
  if p_mission then s := jsonb_set(s, '{missions}', to_jsonb(coalesce((s->>'missions')::int, 0) + 1)); end if;
  if p_industry in ('chocolate', 'ai', 'weed') and not coalesce(s->'industries', '[]'::jsonb) ? p_industry then
    s := jsonb_set(s, '{industries}', coalesce(s->'industries', '[]'::jsonb) || to_jsonb(p_industry));
  end if;
  update public.profiles set stats = s, last_seen = now() where user_id = v_uid;
  insert into public.achievements (user_id, id)
  select v_uid, a from unnest(coalesce(p_achievements, '{}')) a where a ~ '^[a-z0-9_]{1,32}$' and cardinality(p_achievements) <= 40
  on conflict do nothing;
  return s;
end $$;

-- Achievements earned outside a game (like making friends) or synced from this device.
create or replace function public.grant_achievements(p_achievements text[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.achievements (user_id, id)
  select (select auth.uid()), a from unnest(p_achievements) a
  where (select auth.uid()) is not null and a ~ '^[a-z0-9_]{1,32}$' and cardinality(p_achievements) <= 40
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------- daily challenge
create table if not exists public.daily_scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  score numeric not null,
  place integer not null,
  industry text not null,
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) < 4096),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_scores_day on public.daily_scores (day, score desc);
alter table public.daily_scores enable row level security;

-- One scored try per day (today or yesterday in UTC, for players in other time zones).
create or replace function public.submit_daily(p_day date, p_score numeric, p_place integer, p_industry text, p_details jsonb default '{}') returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rank int;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_day not between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1 then raise exception 'That daily challenge is closed'; end if;
  if p_score < 0 or p_score > 1e9 then raise exception 'Score out of range'; end if;
  insert into public.profiles (user_id, name, friend_code) values (v_uid, 'Player', public.new_friend_code()) on conflict do nothing;
  insert into public.daily_scores (user_id, day, score, place, industry, details) values (v_uid, p_day, p_score, p_place, p_industry, coalesce(p_details, '{}'))
  on conflict (user_id, day) do nothing;
  select count(*) + 1 into v_rank from public.daily_scores d where d.day = p_day and d.score > (select score from public.daily_scores where user_id = v_uid and day = p_day);
  return v_rank;
end $$;

create or replace function public.daily_board(p_day date, p_friends boolean default false)
returns table (rank bigint, name text, score numeric, place integer, me boolean)
language sql stable security definer set search_path = '' as $$
  select rank() over (order by d.score desc), p.name, d.score, d.place, d.user_id = (select auth.uid())
  from public.daily_scores d join public.profiles p on p.user_id = d.user_id
  where d.day = p_day and (not p_friends or d.user_id = (select auth.uid()) or public.are_friends((select auth.uid()), d.user_id))
  order by d.score desc limit 100;
$$;

-- All-time: wins first, then achievements, then best daily score.
create or replace function public.alltime_board(p_friends boolean default false)
returns table (rank bigint, name text, wins integer, games integer, online_wins integer, achievements integer, best_daily numeric, me boolean)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.user_id, p.name, coalesce((p.stats->>'wins')::int, 0) as wins, coalesce((p.stats->>'games')::int, 0) as games,
      coalesce((p.stats->>'online_wins')::int, 0) as online_wins,
      (select count(*)::int from public.achievements a where a.user_id = p.user_id) as achievements,
      (select max(score) from public.daily_scores d where d.user_id = p.user_id) as best_daily
    from public.profiles p
    where coalesce((p.stats->>'games')::int, 0) > 0
      and (not p_friends or p.user_id = (select auth.uid()) or public.are_friends((select auth.uid()), p.user_id))
  )
  select rank() over (order by wins desc, achievements desc, best_daily desc nulls last), name, wins, games, online_wins, achievements, best_daily, user_id = (select auth.uid())
  from base order by 1 limit 100;
$$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.new_friend_code(), public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ensure_profile(text), public.set_profile_name(text), public.touch_profile(), public.add_friend(text),
  public.respond_friend(uuid, boolean), public.remove_friend(uuid), public.my_friends(), public.invite_friend(uuid, uuid), public.my_invites(),
  public.answer_invite(bigint, boolean), public.lobby_invites(uuid), public.record_result(text, boolean, text, text, boolean, text[]),
  public.grant_achievements(text[]), public.submit_daily(date, numeric, integer, text, jsonb), public.daily_board(date, boolean), public.alltime_board(boolean)
  from public, anon;
grant execute on function public.ensure_profile(text), public.set_profile_name(text), public.touch_profile(), public.add_friend(text),
  public.respond_friend(uuid, boolean), public.remove_friend(uuid), public.my_friends(), public.invite_friend(uuid, uuid), public.my_invites(),
  public.answer_invite(bigint, boolean), public.lobby_invites(uuid), public.record_result(text, boolean, text, text, boolean, text[]),
  public.grant_achievements(text[]), public.submit_daily(date, numeric, integer, text, jsonb), public.daily_board(date, boolean), public.alltime_board(boolean)
  to authenticated;
grant select on public.profiles, public.achievements to authenticated;
