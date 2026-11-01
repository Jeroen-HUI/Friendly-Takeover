// Friendly Takeover — game server.
// POST { action: "start", game_id }                     host only, lobby only: builds the match (with bots) and opens round 1.
// POST { action: "resolve", game_id }                   resolves the open round when everyone has submitted (host skips
//                                                       the timer) or when the deadline has passed (any player).
// POST { action: "rename", game_id, target_id, name }   the controller of a company renames it.
// POST { action: "tick" } + header x-tick-secret        the scheduler (pg_cron, every minute) closes every overdue round.
// POST { action: "trade", game_id, target_id, qty }      live stock exchange: buy (qty > 0) or sell (qty < 0) right now.
//                                                       A hostile bid (passing 40%) in the last 90 seconds extends the round by 90 seconds.
// POST { action: "bid", game_id, lot, amount }          live auction bid ("auction", or a bankrupt company's id).
// POST { action: "vote", game_id, proposal, yes }       a shareholder votes on a big decision (board vote) during the round.
// POST { action: "end", game_id }                       host only: this round becomes the last one (unlimited games).
// The full engine state never leaves the server: each player gets their own view (rivals' secrets removed).
// Accepted deals between players are carried out when the round resolves.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// Bundle of src/server/core.ts (supabase/functions/game/engine.js), pinned to a commit so a deploy is reproducible.
import { startOnlineGame, resolveOnlineRound, viewFor, publicData, publicLive, renameCompany, exchangeTrade, liveBid, castVote, endAfterThisRound, INDUSTRIES } from "https://cdn.jsdelivr.net/gh/Jeroen-HUI/Friendly-Takeover@c8b7e79a52c0a578512fd2ee374bde2a0b994461/supabase/functions/game/engine.js";

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
  await admin.from("market_live").upsert({ game_id: gameId, round: state.round, data: publicLive(state), updated_at: new Date().toISOString() });
  await admin.from("player_reports").upsert(humanIds.map((id) => ({ game_id: gameId, round, player_id: id, report: { view: viewFor(state, id) } })));
  // Results last: clients listen for this row, so everything else is in place when it arrives.
  await admin.from("round_results").upsert({ game_id: gameId, round, public_data: publicData(state, round), resolved_at: new Date().toISOString() });
}

/** Resolves the open round of a game. `who` is the caller (null = the scheduler, which only acts after the deadline). */
async function resolveGame(admin: Admin, game: State, who: { userId: string } | null): Promise<{ status: number; body: unknown }> {
  if (game.status !== "playing") return { status: 409, body: { error: "The game is not running" } };
  const gameId = game.id;
  const { data: players } = await admin.from("players").select("*").eq("game_id", gameId).order("joined_at");
  const humanIds: string[] = (players ?? []).map((p: State) => p.id);
  const round = game.current_round as number;
  const { data: stateRow } = await admin.from("game_states").select("state, updated_at").eq("game_id", gameId).single();
  const state = stateRow!.state as State;
  if (state.round !== round) return { status: 409, body: { error: "Round mismatch, try again" } };

  const { data: rows } = await admin.from("decisions").select("player_id, decisions").eq("game_id", gameId).eq("round", round);
  const decisions: Record<string, unknown> = {};
  for (const r of rows ?? []) decisions[r.player_id] = r.decisions;
  const aliveHumans = state.companies.filter((c: State) => !c.bankrupt && !c.merged && humanIds.includes(c.id));
  const allReady = aliveHumans.every((c: State) => decisions[c.id]);
  const deadlinePassed = !game.round_deadline || Date.now() >= new Date(game.round_deadline).getTime();
  const isHost = !!who && game.host_user_id === who.userId;
  if (!deadlinePassed && !(allReady && isHost)) {
    return { status: 409, body: { error: allReady ? "Only the host can skip the timer" : "Waiting for everyone to submit", allReady } };
  }

  const { data: dealRows } = await admin.from("deals").select("*").eq("game_id", gameId).eq("round", round).eq("status", "accepted").order("id");
  const deals = (dealRows ?? []).map((d: State) => ({ id: String(d.id), from: d.from_player_id, to: d.to_player_id, kind: d.kind, terms: d.terms }));
  const next = resolveOnlineRound(state, decisions, deals);
  // A live trade or bid that landed while we computed: start over with the newest state.
  const { data: fresh } = await admin.from("game_states").select("updated_at").eq("game_id", gameId).single();
  if (fresh && fresh.updated_at !== stateRow!.updated_at) return resolveGame(admin, game, who);
  const nextDeadline = next.finished ? null : new Date(Date.now() + game.round_seconds * 1000).toISOString();
  // Claim the round first so two simultaneous calls can never both write results.
  const { data: claimed } = await admin
    .from("games")
    .update({ current_round: next.finished ? round : round + 1, status: next.finished ? "finished" : "playing", round_deadline: nextDeadline })
    .eq("id", gameId).eq("current_round", round).eq("status", "playing")
    .select("id");
  if (!claimed?.length) return { status: 409, body: { error: "This round was already resolved" } };
  await publish(admin, gameId, round, next, humanIds);
  // Deal outcomes, and offers nobody answered in time.
  const now = new Date().toISOString();
  for (const d of next.dealLog ?? []) {
    await admin.from("deals").update({ status: d.ok ? "done" : "failed", note: d.reason, updated_at: now }).eq("id", Number(d.id)).eq("status", "accepted");
  }
  await admin.from("deals").update({ status: "cancelled", note: "The round ended before anyone answered", updated_at: now }).eq("game_id", gameId).eq("round", round).eq("status", "offered");
  return { status: 200, body: { ok: true, resolved: round, finished: next.finished, deadline: nextDeadline } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: { action?: string; game_id?: string; target_id?: string; name?: string; qty?: number; lot?: string; amount?: number; proposal?: string; yes?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body" }, 400);
  }

  // ------------------------------------------------------------------- tick
  if (body.action === "tick") {
    const secret = req.headers.get("x-tick-secret") ?? "";
    const { data: ok } = await admin.rpc("tick_secret_ok", { p_secret: secret });
    if (!secret || ok !== true) return json({ error: "Not allowed" }, 403);
    const { data: overdue } = await admin.from("games").select("*").eq("status", "playing").lt("round_deadline", new Date().toISOString()).order("round_deadline").limit(20);
    const results = [];
    for (const g of overdue ?? []) {
      try { results.push({ game: g.code, ...(await resolveGame(admin, g, null)) }); } catch (e) { results.push({ game: g.code, status: 500, body: String(e) }); }
    }
    return json({ ok: true, closed: results.filter((r) => r.status === 200).length, results });
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "Sign in first" }, 401);
  const userId = auth.user.id;

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
      { industry: game.industry, difficulty: game.difficulty, rounds: game.rounds, botCount: game.bot_count ?? 0, botSkill: game.bot_skill ?? "normal", seed, rules: game.rules ?? null },
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
    const r = await resolveGame(admin, game, { userId });
    return json(r.body, r.status);
  }

  // ------------------------------------------------- live exchange and auctions
  if (body.action === "trade" || body.action === "bid" || body.action === "vote" || body.action === "end") {
    if (body.action === "end" && game.host_user_id !== userId) return json({ error: "Only the host can end the game" }, 403);
    if (game.status !== "playing") return json({ error: "The game is not running" }, 409);
    if (game.round_deadline && Date.now() >= new Date(game.round_deadline).getTime()) return json({ error: "Time's up: this round is closing" }, 409);
    // Optimistic update: retry if someone else traded at the same moment.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: row } = await admin.from("game_states").select("state, updated_at").eq("game_id", gameId).single();
      const state = row!.state as State;
      if (state.round !== game.current_round) return json({ error: "This round is closing" }, 409);
      let next: State, trade: unknown = null;
      try {
        if (body.action === "trade") ({ state: next, trade } = exchangeTrade(state, mePlayer.id, String((body as State).target_id ?? ""), Math.trunc(Number((body as State).qty) || 0)));
        else if (body.action === "bid") next = liveBid(state, mePlayer.id, String((body as State).lot ?? ""), Math.round(Number((body as State).amount) || 0));
        else if (body.action === "vote") next = castVote(state, mePlayer.id, String(body.proposal ?? ""), body.yes === true);
        else next = endAfterThisRound(state);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      const stamp = new Date().toISOString();
      const { data: saved } = await admin.from("game_states").update({ state: next, updated_at: stamp }).eq("game_id", gameId).eq("updated_at", row!.updated_at).select("game_id");
      if (!saved?.length) continue;
      await admin.from("market_live").upsert({ game_id: gameId, round: next.round, data: publicLive(next), updated_at: stamp });
      // Hostile bid in the closing seconds: the target gets 90 seconds to respond.
      let extended = null;
      if (body.action === "trade" && trade && game.round_deadline) {
        const t = trade as State, target = next.companies.find((c: State) => c.id === t.target);
        const heldNow = target?.shares?.holders?.[mePlayer.id] ?? 0;
        const left = new Date(game.round_deadline).getTime() - Date.now();
        if (t.qty > 0 && heldNow >= 40 && heldNow - t.qty < 40 && left < 90_000) {
          extended = new Date(Date.now() + 90_000).toISOString();
          await admin.from("games").update({ round_deadline: extended }).eq("id", gameId).eq("current_round", game.current_round).eq("status", "playing");
        }
      }
      return json({ ok: true, trade, live: publicLive(next), extended });
    }
    return json({ error: "The market is busy, try again" }, 409);
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
