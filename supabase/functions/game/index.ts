// Friendly Takeover — game server.
// POST { action: "start", game_id }    host only, lobby only: creates the engine state and opens round 1.
// POST { action: "resolve", game_id }  resolves the open round when everyone has submitted (host presses
//                                      "skip timer") or when the deadline has passed (any player).
// The full engine state never leaves the server; players get public results and their own report only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createGame, resolveRound, standings, publicInfo, INDUSTRIES } from "./engine.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type State = any;

function publicData(state: State, round: number) {
  const names = new Map(state.companies.map((c: State) => [c.id, c.companyName]));
  return {
    round,
    finished: state.finished,
    headlines: state.feed.filter((f: State) => f.round === round).map((f: State) => f.headline),
    nextNews: state.finished
      ? []
      : state.news.map((n: State) => ({
          headline: n.event.headline + (n.targetCompanyId ? ` (it's ${names.get(n.targetCompanyId)})` : ""),
          effect: n.event.effect,
          roundsLeft: n.roundsLeft,
        })),
    companies: publicInfo(state),
    // Secret missions stay secret until the game is over.
    standings: standings(state).map((r: State) => (state.finished ? r : { ...r, mission: undefined, missionDone: undefined, missionBonus: undefined })),
    auction: state.auction,
    summit: state.summit,
  };
}

function privateReport(state: State, companyId: string) {
  const c = state.companies.find((x: State) => x.id === companyId);
  const { history, ...company } = c;
  return { report: history.at(-1) ?? null, company };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "Sign in first" }, 401);
  const userId = auth.user.id;

  let body: { action?: string; game_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body" }, 400);
  }
  const gameId = body.game_id;
  if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) return json({ error: "Missing game_id" }, 400);

  const { data: game } = await admin.from("games").select("*").eq("id", gameId).maybeSingle();
  if (!game) return json({ error: "Game not found" }, 404);
  const { data: players } = await admin.from("players").select("*").eq("game_id", gameId).order("joined_at");
  const mePlayer = (players ?? []).find((p) => p.user_id === userId);
  if (!mePlayer) return json({ error: "You are not in this game" }, 403);

  // ------------------------------------------------------------------ start
  if (body.action === "start") {
    if (game.host_user_id !== userId) return json({ error: "Only the host can start the game" }, 403);
    if (game.status !== "lobby") return json({ error: "The game has already started" }, 409);
    if ((players ?? []).length < 2) return json({ error: "You need at least 2 players" }, 400);

    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
    const state = createGame(
      { industry: game.industry, difficulty: game.difficulty, rounds: game.rounds, seed },
      players!.map((p) => ({ id: p.id, playerName: p.player_name, companyName: p.company_name, trait: p.trait })),
    );
    const deadline = new Date(Date.now() + game.round_seconds * 1000).toISOString();
    const { data: claimed } = await admin
      .from("games")
      .update({ status: "playing", current_round: 1, round_deadline: deadline })
      .eq("id", gameId)
      .eq("status", "lobby")
      .select("id");
    if (!claimed?.length) return json({ error: "The game has already started" }, 409);

    await admin.from("game_states").upsert({ game_id: gameId, state, updated_at: new Date().toISOString() });
    await admin.from("round_results").upsert({ game_id: gameId, round: 0, public_data: publicData(state, 0) });
    await admin.from("player_reports").upsert(
      state.companies.map((c: State) => ({ game_id: gameId, round: 0, player_id: c.id, report: privateReport(state, c.id) })),
    );
    return json({ ok: true, round: 1, deadline, industry: INDUSTRIES[game.industry as keyof typeof INDUSTRIES].name });
  }

  // ---------------------------------------------------------------- resolve
  if (body.action === "resolve") {
    if (game.status !== "playing") return json({ error: "The game is not running" }, 409);
    const round = game.current_round as number;
    const { data: stateRow } = await admin.from("game_states").select("state").eq("game_id", gameId).single();
    const state = stateRow!.state as State;
    if (state.round !== round) return json({ error: "Round mismatch, try again" }, 409);

    const { data: rows } = await admin.from("decisions").select("player_id, decisions").eq("game_id", gameId).eq("round", round);
    const decisions: Record<string, unknown> = {};
    for (const r of rows ?? []) decisions[r.player_id] = r.decisions;
    const alive = state.companies.filter((c: State) => !c.bankrupt);
    const allReady = alive.every((c: State) => decisions[c.id]);
    const deadlinePassed = !game.round_deadline || Date.now() >= new Date(game.round_deadline).getTime();
    const isHost = game.host_user_id === userId;
    if (!deadlinePassed && !(allReady && isHost)) {
      return json({ error: allReady ? "Only the host can skip the timer" : "Waiting for everyone to submit", allReady }, 409);
    }

    const next = resolveRound(state, decisions);
    const nextDeadline = next.finished ? null : new Date(Date.now() + game.round_seconds * 1000).toISOString();
    // Claim the round first so two simultaneous calls can never both write results.
    const { data: claimed } = await admin
      .from("games")
      .update({ current_round: next.finished ? round : round + 1, status: next.finished ? "finished" : "playing", round_deadline: nextDeadline })
      .eq("id", gameId)
      .eq("current_round", round)
      .eq("status", "playing")
      .select("id");
    if (!claimed?.length) return json({ error: "This round was already resolved" }, 409);

    await admin.from("game_states").upsert({ game_id: gameId, state: next, updated_at: new Date().toISOString() });
    await admin.from("player_reports").upsert(
      next.companies.map((c: State) => ({ game_id: gameId, round, player_id: c.id, report: privateReport(next, c.id) })),
    );
    // Results last: clients listen for this row, so everything else is in place when it arrives.
    await admin.from("round_results").upsert({ game_id: gameId, round, public_data: publicData(next, round) });
    return json({ ok: true, resolved: round, finished: next.finished, deadline: nextDeadline });
  }

  return json({ error: "Unknown action" }, 400);
});
