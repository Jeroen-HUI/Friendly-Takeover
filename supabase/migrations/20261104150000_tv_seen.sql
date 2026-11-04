-- Party mode: the TV checks in when it polls, so phones know a TV is showing the results and news.
alter table public.games add column if not exists tv_seen_at timestamptz;

create or replace function public.tv_snapshot(p_game_id uuid, p_tv text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  -- Mark the TV as on (at most every 10 seconds, so polling stays cheap).
  update public.games set tv_seen_at = now()
   where id = p_game_id and tv_code = p_tv and (tv_seen_at is null or tv_seen_at < now() - interval '10 seconds');
  select case when g.id is null then null else jsonb_build_object(
    'game', jsonb_build_object('code', g.code, 'status', g.status, 'current_round', g.current_round, 'rounds', g.rounds, 'round_deadline', g.round_deadline, 'industry', g.industry, 'difficulty', g.difficulty, 'bot_count', g.bot_count),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.player_name, 'company', p.company_name, 'trait', p.trait, 'submitted_round', p.submitted_round, 'is_host', p.is_host) order by p.joined_at), '[]'::jsonb) from public.players p where p.game_id = g.id),
    'results', (select jsonb_build_object('round', r.round, 'data', r.public_data) from public.round_results r where r.game_id = g.id order by r.round desc limit 1),
    'live', (select m.data from public.market_live m where m.game_id = g.id and m.round = g.current_round),
    'chat', (select coalesce(jsonb_agg(x order by x->>'id'), '[]'::jsonb) from (select jsonb_build_object('id', lpad(m.id::text, 12, '0'), 'from', m.from_player_id, 'body', m.body, 'kind', m.kind, 'at', m.created_at) as x from public.messages m where m.game_id = g.id and m.to_player_id is null order by m.id desc limit 30) t),
    'now', now()
  ) end into v
  from (select * from public.games where id = p_game_id and tv_code = p_tv) g
  right join (select 1) one on true;
  return v;
end $$;
revoke execute on function public.tv_snapshot(uuid, text) from public;
grant execute on function public.tv_snapshot(uuid, text) to anon, authenticated;
