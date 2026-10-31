// Friendly Takeover — game server.
// POST { action: "start", game_id }                     host only, lobby only: builds the match (with bots) and opens round 1.
// POST { action: "resolve", game_id }                   resolves the open round when everyone has submitted (host skips
//                                                       the timer) or when the deadline has passed (any player).
// POST { action: "rename", game_id, target_id, name }   the controller of a company renames it.
// The full engine state never leaves the server: each player gets their own view (rivals' secrets removed).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// Bundle of src/server/core.ts (supabase/functions/game/engine.js), pinned to a commit so a deploy is reproducible.
import { startOnlineGame, resolveOnlineRound, viewFor, publicData, renameCompany, INDUSTRIES } from "__ENGINE_URL__";

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
// deno-lint-ignore no-explicit-any
type Admin = any;

/** Writes the state, every human player's own view, and the public results for a round. */
async function publish(admin: Admin, gameId: string, round: number, state: State, humanIds: string[]) {
  await admin.from("game_states").upsert({ game_id: gameId, state, updated_at: new Date().toISOString() });
  await admin.from("player_reports").upsert(humanIds.map((id) => ({ game_id: gameId, round, player_id: id, report: { view: viewFor(state, id) } })));
  // Results last: clients listen for this row, so everything else is in place when it arrives.
  await admin.from("round_results").upsert({ game_id: gameId, round, public_data: publicData(state, round), resolved_at: new Date().toISOString() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "Sign in first" }, 401);
  const userId = auth.user.id;

  let body: { action?: string; game_id?: string; target_id?: string; name?: string };
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
  const mePlayer = (players ?? []).find((p: State) => p.user_id === userId);
  if (!mePlayer) return json({ error: "You are not in this game" }, 403);
  const humanIds: string[] = (players ?? []).map((p: State) => p.id);

  // ------------------------------------------------------------------ start
  if (body.action === "start") {
    if (game.host_user_id !== userId) return json({ error: "Only the host can start the game" }, 403);
    if (game.status !== "lobby") return json({ error: "The game has already started" }, 409);
    if ((players ?? []).length + (game.bot_count ?? 0) < 2) return json({ error: "You need at least 2 companies: invite a friend or add a bot" }, 400);

    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
    const state = startOnlineGame(
      { industry: game.industry, difficulty: game.difficulty, rounds: game.rounds, botCount: game.bot_count ?? 0, botSkill: game.bot_skill ?? "normal", seed },
      players!.map((p: State) => ({ id: p.id, name: p.player_name, company: p.company_name, trait: p.trait })),
    );
    const deadline = new Date(Date.now() + game.round_seconds * 1000).toISOString();
    const { data: claimed } = await admin.from("games").update({ status: "playing", current_round: 1, round_deadline: deadline }).eq("id", gameId).eq("status", "lobby").select("id");
    if (!claimed?.length) return json({ error: "The game has already started" }, 409);
    await publish(admin, gameId, 0, state, humanIds);
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
    const aliveHumans = state.companies.filter((c: State) => !c.bankrupt && humanIds.includes(c.id));
    const allReady = aliveHumans.every((c: State) => decisions[c.id]);
    const deadlinePassed = !game.round_deadline || Date.now() >= new Date(game.round_deadline).getTime();
    const isHost = game.host_user_id === userId;
    if (!deadlinePassed && !(allReady && isHost)) {
      return json({ error: allReady ? "Only the host can skip the timer" : "Waiting for everyone to submit", allReady }, 409);
    }

    const next = resolveOnlineRound(state, decisions);
    const nextDeadline = next.finished ? null : new Date(Date.now() + game.round_seconds * 1000).toISOString();
    // Claim the round first so two simultaneous calls can never both write results.
    const { data: claimed } = await admin
      .from("games")
      .update({ current_round: next.finished ? round : round + 1, status: next.finished ? "finished" : "playing", round_deadline: nextDeadline })
      .eq("id", gameId).eq("current_round", round).eq("status", "playing")
      .select("id");
    if (!claimed?.length) return json({ error: "This round was already resolved" }, 409);
    await publish(admin, gameId, round, next, humanIds);
    return json({ ok: true, resolved: round, finished: next.finished, deadline: nextDeadline });
  }

  // ----------------------------------------------------------------- rename
  if (body.action === "rename") {
    const { data: stateRow } = await admin.from("game_states").select("state").eq("game_id", gameId).single();
    const state = stateRow!.state as State;
    const next = renameCompany(state, mePlayer.id, String(body.target_id ?? ""), String(body.name ?? ""));
    if (next === state) return json({ error: "Only the company that controls it can rename it" }, 403);
    const round = Math.max(0, Math.min(state.round - 1, state.config.rounds));
    await publish(admin, gameId, round, next, humanIds);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
