-- House rules per game, friendly mergers as a deal type, and CEO career XP.

-- ---------------------------------------------------------------- house rules
alter table public.games add column if not exists rules jsonb not null default '{}'::jsonb;

-- Host only, lobby only. Unknown keys and values are dropped, so the engine always gets clean rules.
create or replace function public.set_house_rules(p_game_id uuid, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_rules) <> 'object' then raise exception 'Rules must be an object'; end if;
  if (p_rules->>'startCash') in ('500000', '1000000', '2000000') then v := v || jsonb_build_object('startCash', (p_rules->>'startCash')::int); end if;
  if jsonb_typeof(p_rules->'takeovers') = 'boolean' then v := v || jsonb_build_object('takeovers', p_rules->'takeovers'); end if;
  if jsonb_typeof(p_rules->'wildcards') = 'boolean' then v := v || jsonb_build_object('wildcards', p_rules->'wildcards'); end if;
  if (p_rules->>'news') in ('calm', 'normal', 'wild') then v := v || jsonb_build_object('news', p_rules->>'news'); end if;
  update public.games set rules = v where id = p_game_id and host_user_id = (select auth.uid()) and status = 'lobby';
  if not found then raise exception 'Only the host can change the rules before the game starts'; end if;
  return v;
end $$;
revoke execute on function public.set_house_rules(uuid, jsonb) from public, anon;
grant execute on function public.set_house_rules(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- mergers
alter table public.deals drop constraint if exists deals_kind_check;
alter table public.deals add constraint deals_kind_check check (kind in ('shares', 'loan', 'pact', 'merger'));

-- ---------------------------------------------------------------- career XP
-- XP earned in a game is added to the profile (at most 600 per game, so a tampered client can't jump levels).
drop function if exists public.record_result(text, boolean, text, text, boolean, text[]);
create or replace function public.record_result(p_mode text, p_won boolean, p_industry text, p_difficulty text, p_mission boolean, p_achievements text[] default '{}', p_xp integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); s jsonb;
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
  s := jsonb_set(s, '{xp}', to_jsonb(coalesce((s->>'xp')::int, 0) + greatest(0, least(coalesce(p_xp, 0), 600))));
  update public.profiles set stats = s, last_seen = now() where user_id = v_uid;
  insert into public.achievements (user_id, id)
  select v_uid, a from unnest(coalesce(p_achievements, '{}')) a where a ~ '^[a-z0-9_]{1,32}$' and cardinality(p_achievements) <= 40
  on conflict do nothing;
  return s;
end $$;
revoke execute on function public.record_result(text, boolean, text, text, boolean, text[], integer) from public, anon;
grant execute on function public.record_result(text, boolean, text, text, boolean, text[], integer) to authenticated;
