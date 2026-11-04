-- Keep the database lean.
-- 1. Each player's round report is a full copy of the game from their side (~180 KB). The game only ever reads the
--    latest one, so a new report replaces the older rounds of that player in that game.
-- 2. A week after a game finishes, the server-only data goes: the full engine state, the submitted decisions and the
--    live market. The game, its players, chat, deals and results stay (career stats, league tables, rematches, the
--    final screen).
-- 3. Lobbies nobody started within 30 days are removed.

create or replace function public._keep_latest_report() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.player_reports where game_id = new.game_id and player_id = new.player_id and round < new.round;
  return null;
end $$;
revoke execute on function public._keep_latest_report() from public, anon, authenticated;
drop trigger if exists player_reports_keep_latest on public.player_reports;
create trigger player_reports_keep_latest after insert or update on public.player_reports
  for each row execute function public._keep_latest_report();

create or replace function public.cleanup_finished_games()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_states int; v_decisions int; v_live int; v_lobbies int;
begin
  create temporary table _done on commit drop as
    select g.id from public.games g
    where g.status = 'finished'
      and coalesce((select max(r.resolved_at) from public.round_results r where r.game_id = g.id), g.created_at) < now() - interval '7 days';
  delete from public.game_states s using _done d where s.game_id = d.id; get diagnostics v_states = row_count;
  delete from public.decisions x using _done d where x.game_id = d.id; get diagnostics v_decisions = row_count;
  delete from public.market_live m using _done d where m.game_id = d.id; get diagnostics v_live = row_count;
  delete from public.games where status = 'lobby' and created_at < now() - interval '30 days'; get diagnostics v_lobbies = row_count;
  return jsonb_build_object('states', v_states, 'decisions', v_decisions, 'live', v_live, 'lobbies', v_lobbies);
end $$;
revoke execute on function public.cleanup_finished_games() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ft-cleanup-finished-games';
select cron.schedule('ft-cleanup-finished-games', '41 4 * * *', 'select public.cleanup_finished_games()');

-- One-off: drop the older round reports that are already there.
delete from public.player_reports p
using (select game_id, player_id, max(round) as latest from public.player_reports group by game_id, player_id) k
where p.game_id = k.game_id and p.player_id = k.player_id and p.round < k.latest;
