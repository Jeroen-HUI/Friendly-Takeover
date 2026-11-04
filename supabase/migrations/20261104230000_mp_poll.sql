-- One request instead of five: everything a player's phone checks every few seconds during an online game.
-- security invoker: the same row-level security applies as when the five tables were read one by one.
create or replace function public.mp_poll(p_game_id uuid, p_after bigint default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', (select to_jsonb(g) from public.games g where g.id = p_game_id),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.joined_at) from public.players p where p.game_id = p_game_id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(m order by (m->>'id')::bigint) from (
        select jsonb_build_object('id', x.id, 'from_player_id', x.from_player_id, 'to_player_id', x.to_player_id, 'body', x.body, 'kind', x.kind, 'round', x.round, 'created_at', x.created_at) as m
        from public.messages x where x.game_id = p_game_id and x.id > coalesce(p_after, 0) order by x.id limit 200) t), '[]'::jsonb),
    'market', (select jsonb_build_object('round', l.round, 'data', l.data) from public.market_live l where l.game_id = p_game_id),
    'deals', coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.deals d where d.game_id = p_game_id), '[]'::jsonb)
  );
$$;
revoke execute on function public.mp_poll(uuid, bigint) from public, anon;
grant execute on function public.mp_poll(uuid, bigint) to authenticated;
