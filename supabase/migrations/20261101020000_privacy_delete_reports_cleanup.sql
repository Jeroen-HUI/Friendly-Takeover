-- Privacy: delete your own account and data, report chat or names, and automatic cleanup of old data.

-- ---------------------------------------------------------------- helpers
-- Replace a player's name with "Deleted player" inside a jsonb array of companies or standings
-- (elements are matched on "id" or "companyId").
create or replace function public._anon_companies(arr jsonb, cid text)
returns jsonb language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(arr) <> 'array' then arr else coalesce((
    select jsonb_agg(case when e->>'id' = cid or e->>'companyId' = cid
      then jsonb_set(e, '{playerName}', '"Deleted player"') else e end order by ord)
    from jsonb_array_elements(arr) with ordinality as t(e, ord)
  ), arr) end;
$$;

-- Erase one user. Friends' games keep running: hosting moves to another human player, and the user's
-- name is replaced with "Deleted player" in game histories. Then the login is deleted, which removes
-- the profile, friends, invites, achievements, daily scores, their seats in games and their messages.
create or replace function public._erase_user(p_uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_player record; v_game record; v_heir uuid;
begin
  if p_uid is null then return; end if;
  -- 1. Hand over hosting where other people are still in the game.
  for v_game in select g.id from public.games g where g.host_user_id = p_uid loop
    select p.user_id into v_heir from public.players p
      where p.game_id = v_game.id and p.user_id <> p_uid order by p.joined_at limit 1;
    if v_heir is not null then
      update public.games set host_user_id = v_heir where id = v_game.id;
      update public.players set is_host = (user_id = v_heir) where game_id = v_game.id;
    end if;
  end loop;
  -- 2. Anonymise the name in game states, public results and other players' reports.
  for v_player in select p.id, p.game_id from public.players p where p.user_id = p_uid loop
    update public.game_states set state = jsonb_set(state, '{companies}', public._anon_companies(state->'companies', v_player.id::text))
      where game_id = v_player.game_id and state ? 'companies';
    update public.round_results set public_data = jsonb_set(jsonb_set(public_data,
        '{companies}', public._anon_companies(public_data->'companies', v_player.id::text)),
        '{standings}', public._anon_companies(coalesce(public_data->'standings', '[]'::jsonb), v_player.id::text))
      where game_id = v_player.game_id and public_data ? 'companies';
    update public.player_reports set report = jsonb_set(report, '{view,companies}', public._anon_companies(report->'view'->'companies', v_player.id::text))
      where game_id = v_player.game_id and report->'view' ? 'companies';
  end loop;
  -- 3. Delete the login; everything personal hangs off it and is removed with it.
  delete from auth.users where id = p_uid;
end $$;
revoke execute on function public._erase_user(uuid) from public, anon, authenticated;
revoke execute on function public._anon_companies(jsonb, text) from public, anon, authenticated;

-- Called from Profile -> "Delete my account".
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  perform public._erase_user(v_uid);
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- reports
-- Players report a chat message or an offensive player/company name. Only the developer reads these
-- (dashboard); the text is copied so the report still makes sense if the message is deleted later.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  reporter uuid references auth.users (id) on delete set null,
  game_id uuid references public.games (id) on delete set null,
  reported_player uuid,
  reported_name text,
  message_id bigint,
  message_text text,
  reason text not null check (reason in ('harassment', 'hate', 'sexual', 'spam', 'name', 'other')),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed'))
);
alter table public.reports enable row level security;   -- no policies: not readable or writable through the API

create or replace function public.report_content(p_game_id uuid, p_player_id uuid, p_reason text, p_message_id bigint default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.my_player_id(p_game_id); v_p public.players; v_m public.messages;
begin
  if v_me is null then raise exception 'You are not in this game'; end if;
  select * into v_p from public.players where id = p_player_id and game_id = p_game_id;
  if not found then raise exception 'That player is not in this game'; end if;
  if p_message_id is not null then
    select * into v_m from public.messages where id = p_message_id and game_id = p_game_id and from_player_id = p_player_id
      and (to_player_id is null or to_player_id = v_me);
    if not found then raise exception 'That message can''t be reported'; end if;
  end if;
  if (select count(*) from public.reports where reporter = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports in a short time';
  end if;
  insert into public.reports (reporter, game_id, reported_player, reported_name, message_id, message_text, reason, note)
  values ((select auth.uid()), p_game_id, p_player_id, v_p.player_name || ' / ' || v_p.company_name, p_message_id, v_m.body, p_reason, left(p_note, 500));
end $$;
revoke execute on function public.report_content(uuid, uuid, text, bigint, text) from public, anon;
grant execute on function public.report_content(uuid, uuid, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------- retention
-- Monthly: games older than 12 months go, and guest (anonymous) accounts nobody has used for 12 months.
-- Accounts saved with an email stay until their owner deletes them.
create or replace function public.cleanup_old_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_games int; v_users int := 0; v_uid uuid;
begin
  delete from public.games where created_at < now() - interval '12 months';
  get diagnostics v_games = row_count;
  for v_uid in
    select u.id from auth.users u left join public.profiles pr on pr.user_id = u.id
    where u.is_anonymous and greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at), coalesce(pr.last_seen, u.created_at)) < now() - interval '12 months'
    limit 1000
  loop
    perform public._erase_user(v_uid); v_users := v_users + 1;
  end loop;
  delete from public.reports where created_at < now() - interval '12 months' and status <> 'open';
  delete from public.feedback where created_at < now() - interval '24 months';
  return jsonb_build_object('games', v_games, 'guests', v_users);
end $$;
revoke execute on function public.cleanup_old_data() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ft-cleanup-old-data';
select cron.schedule('ft-cleanup-old-data', '17 3 1 * *', 'select public.cleanup_old_data()');
