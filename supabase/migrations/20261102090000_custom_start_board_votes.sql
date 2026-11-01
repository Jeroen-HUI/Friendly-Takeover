-- Fully custom start (3-99 rounds or unlimited, starting position, toggles, handicaps, scenarios) and Blitz timers.

-- 999 rounds = unlimited (the host ends the game).
alter table public.games drop constraint if exists games_rounds_check;
alter table public.games add constraint games_rounds_check check (rounds between 3 and 99 or rounds = 999);

-- Host only, lobby only. Unknown keys and values are dropped, numbers are clamped, so the engine always gets clean rules.
-- Optionally also sets the number of rounds (999 = unlimited) and the round timer (Blitz).
drop function if exists public.set_house_rules(uuid, jsonb);
create or replace function public.set_house_rules(p_game_id uuid, p_rules jsonb, p_rounds integer default null, p_round_seconds integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
  h jsonb := '{}'::jsonb;
  n numeric;
  nums jsonb := '{"startCash":[250000,5000000],"startDebt":[0,5000000],"startCapacity":[0.5,2],"startQuality":[3,5],"startBrand":[0,80],"startStores":[0,5],"founderShares":[10,60],"marketSize":[0.5,2],"growth":[-0.05,0.15],"takeoverRound":[1,10],"sharesPerRound":[5,50]}';
  flags text[] := array['unlimited','takeovers','wildcards','auctions','summits','retail','mergers','dividends','votes','runnerUp','mega'];
begin
  if jsonb_typeof(p_rules) <> 'object' then raise exception 'Rules must be an object'; end if;
  for k in select jsonb_object_keys(nums) loop
    if jsonb_typeof(p_rules->k) = 'number' then
      n := greatest((nums->k->>0)::numeric, least((nums->k->>1)::numeric, (p_rules->>k)::numeric));
      v := v || jsonb_build_object(k, n);
    end if;
  end loop;
  foreach k in array flags loop
    if jsonb_typeof(p_rules->k) = 'boolean' then v := v || jsonb_build_object(k, p_rules->k); end if;
  end loop;
  if (p_rules->>'news') in ('calm', 'normal', 'wild') then v := v || jsonb_build_object('news', p_rules->>'news'); end if;
  if (p_rules->>'scenario') in ('none', 'recession', 'debt', 'giant', 'goldrush') then v := v || jsonb_build_object('scenario', p_rules->>'scenario'); end if;
  if jsonb_typeof(p_rules->'handicaps') = 'object' then
    for k in select key from jsonb_each_text(p_rules->'handicaps') where value in ('weak', 'strong', 'giant') and key ~ '^[A-Za-z0-9-]{1,40}$' limit 8 loop
      h := h || jsonb_build_object(k, p_rules->'handicaps'->>k);
    end loop;
    if h <> '{}'::jsonb then v := v || jsonb_build_object('handicaps', h); end if;
  end if;
  update public.games set
    rules = v,
    rounds = case when p_rounds is null then rounds when p_rounds = 999 or (v->>'unlimited')::boolean is true then 999 else greatest(3, least(99, p_rounds)) end,
    round_seconds = case when p_round_seconds is null then round_seconds else greatest(60, least(86400, p_round_seconds)) end
  where id = p_game_id and host_user_id = (select auth.uid()) and status = 'lobby';
  if not found then raise exception 'Only the host can change the rules before the game starts'; end if;
  return v;
end $$;
revoke execute on function public.set_house_rules(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.set_house_rules(uuid, jsonb, integer, integer) to authenticated;
