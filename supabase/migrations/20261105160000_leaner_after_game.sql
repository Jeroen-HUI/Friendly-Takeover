-- Keep only what is still used once a game is over.
-- 1. Round results: only the latest round is ever read (TV, season table, cleanup), so each new round replaces the older
--    ones of that game, like the round reports already do.
-- 2. One day after a game finishes (time to look at the final screen), everything game-only goes: the engine state,
--    decisions, live market, round reports, chat and deals. What stays is tiny: the game row, its seats and the final
--    results, which the season table and rematches need. Career stats live on the profile and are not touched.
-- 3. Lobbies nobody started are removed after 30 days (unchanged).

create or replace function public._keep_latest_result() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.round_results where game_id = new.game_id and round < new.round;
  return null;
end $$;
revoke execute on function public._keep_latest_result() from public, anon, authenticated;
drop trigger if exists round_results_keep_latest on public.round_results;
create trigger round_results_keep_latest after insert or update on public.round_results
  for each row execute function public._keep_latest_result();

create or replace function public.cleanup_finished_games()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_states int; v_decisions int; v_live int; v_reports int; v_msgs int; v_deals int; v_lobbies int;
begin
  create temporary table _done on commit drop as
    select g.id from public.games g
    where g.status = 'finished'
      and coalesce((select max(r.resolved_at) from public.round_results r where r.game_id = g.id), g.created_at) < now() - interval '1 day';
  delete from public.game_states s using _done d where s.game_id = d.id; get diagnostics v_states = row_count;
  delete from public.decisions x using _done d where x.game_id = d.id; get diagnostics v_decisions = row_count;
  delete from public.market_live m using _done d where m.game_id = d.id; get diagnostics v_live = row_count;
  delete from public.player_reports p using _done d where p.game_id = d.id; get diagnostics v_reports = row_count;
  delete from public.messages m using _done d where m.game_id = d.id; get diagnostics v_msgs = row_count;
  delete from public.deals x using _done d where x.game_id = d.id; get diagnostics v_deals = row_count;
  delete from public.games where status = 'lobby' and created_at < now() - interval '30 days'; get diagnostics v_lobbies = row_count;
  return jsonb_build_object('states', v_states, 'decisions', v_decisions, 'live', v_live, 'reports', v_reports,
                            'messages', v_msgs, 'deals', v_deals, 'lobbies', v_lobbies);
end $$;
revoke execute on function public.cleanup_finished_games() from public, anon, authenticated;

-- One-off: drop the older round results that are already there, then run the cleanup once.
delete from public.round_results r
using (select game_id, max(round) as latest from public.round_results group by game_id) k
where r.game_id = k.game_id and r.round < k.latest;
select public.cleanup_finished_games();
