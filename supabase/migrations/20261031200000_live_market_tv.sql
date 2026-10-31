-- Live stock exchange and auctions during a round (written by the game server), and the party-mode TV screen.

create table if not exists public.market_live (
  game_id uuid primary key references public.games (id) on delete cascade,
  round integer not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.market_live enable row level security;
create policy "members read the live market" on public.market_live for select to authenticated using (public.is_game_member(game_id));
grant select on public.market_live to authenticated;

-- The TV screen gets a secret link per game; anyone with the link can watch (no account needed).
alter table public.games add column if not exists tv_code text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 12);

create or replace function public.tv_snapshot(p_game_id uuid, p_tv text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when g.id is null then null else jsonb_build_object(
    'game', jsonb_build_object('code', g.code, 'status', g.status, 'current_round', g.current_round, 'rounds', g.rounds, 'round_deadline', g.round_deadline, 'industry', g.industry, 'difficulty', g.difficulty, 'bot_count', g.bot_count),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.player_name, 'company', p.company_name, 'trait', p.trait, 'submitted_round', p.submitted_round, 'is_host', p.is_host) order by p.joined_at), '[]'::jsonb) from public.players p where p.game_id = g.id),
    'results', (select jsonb_build_object('round', r.round, 'data', r.public_data) from public.round_results r where r.game_id = g.id order by r.round desc limit 1),
    'live', (select m.data from public.market_live m where m.game_id = g.id and m.round = g.current_round),
    'chat', (select coalesce(jsonb_agg(x order by x->>'id'), '[]'::jsonb) from (select jsonb_build_object('id', lpad(m.id::text, 12, '0'), 'from', m.from_player_id, 'body', m.body, 'kind', m.kind, 'at', m.created_at) as x from public.messages m where m.game_id = g.id and m.to_player_id is null order by m.id desc limit 30) t),
    'now', now()
  ) end
  from (select * from public.games where id = p_game_id and tv_code = p_tv) g
  right join (select 1) one on true;
$$;
revoke execute on function public.tv_snapshot(uuid, text) from public;
grant execute on function public.tv_snapshot(uuid, text) to anon, authenticated;
