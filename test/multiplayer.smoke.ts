// Plays an online match in the game page against an in-memory copy of the Supabase backend.
// The fake backend runs the same server code as the edge function (src/server/core.ts), so this
// checks the whole loop: create → lobby → join → settings → start → submit → wait → host skips → results.
// Run: npx tsx test/multiplayer.smoke.ts
// @ts-expect-error jsdom ships without types
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { startOnlineGame, resolveOnlineRound, viewFor, publicData, renameCompany } from "../src/server/core";

// ---------------------------------------------------------------- fake backend
type Row = Record<string, any>;
const db = { games: [] as Row[], players: [] as Row[], states: new Map<string, any>(), decisions: [] as Row[], reports: [] as Row[] };
const listeners = new Map<string, Set<() => void>>();
const notify = (gameId: string) => setTimeout(() => listeners.get(gameId)?.forEach((f) => f()), 1);
let joined = 0;
const newCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");

function publish(gameId: string, round: number, state: any) {
  db.states.set(gameId, state);
  for (const p of db.players.filter((x) => x.game_id === gameId)) {
    db.reports = db.reports.filter((r) => !(r.game_id === gameId && r.round === round && r.player_id === p.id));
    db.reports.push({ game_id: gameId, round, player_id: p.id, report: JSON.parse(JSON.stringify({ view: viewFor(state, p.id) })) });
  }
  publicData(state, round);
}

const server = {
  createGame(userId: string, name: string, company: string, trait: string) {
    const g = { id: randomUUID(), code: newCode(), host_user_id: userId, industry: "chocolate", difficulty: "standard", mode: "live", rounds: 8, round_seconds: 300, status: "lobby", current_round: 0, round_deadline: null, bot_count: 0, bot_skill: "normal" };
    db.games.push(g);
    const p = { id: randomUUID(), game_id: g.id, user_id: userId, player_name: name, company_name: company, trait, is_host: true, submitted_round: 0, joined_at: new Date(Date.now() + joined++).toISOString() };
    db.players.push(p);
    return { game_id: g.id, code: g.code, player_id: p.id };
  },
  join(userId: string, code: string, name: string, company: string, trait: string) {
    const g = db.games.find((x) => x.code === code);
    if (!g || g.status !== "lobby") throw new Error("Game not found or already started");
    const p = { id: randomUUID(), game_id: g.id, user_id: userId, player_name: name, company_name: company, trait, is_host: false, submitted_round: 0, joined_at: new Date(Date.now() + joined++).toISOString() };
    db.players.push(p);
    notify(g.id);
    return { game_id: g.id, code: g.code, player_id: p.id };
  },
  submit(gameId: string, round: number, playerId: string, decisions: any) {
    const g = db.games.find((x) => x.id === gameId)!;
    if (g.status !== "playing" || g.current_round !== round) throw new Error("new row violates row-level security policy");
    db.decisions = db.decisions.filter((d) => !(d.game_id === gameId && d.round === round && d.player_id === playerId));
    db.decisions.push({ game_id: gameId, round, player_id: playerId, decisions: JSON.parse(JSON.stringify(decisions)) });
    db.players.find((p) => p.id === playerId)!.submitted_round = round;
    notify(gameId);
  },
  call(userId: string, action: string, body: any) {
    const g = db.games.find((x) => x.id === body.game_id)!;
    const players = db.players.filter((p) => p.game_id === g.id);
    const me = players.find((p) => p.user_id === userId)!;
    const fail = (status: number, msg: string) => { throw Object.assign(new Error(msg), { status }); };
    if (action === "start") {
      if (g.host_user_id !== userId) fail(403, "Only the host can start the game");
      if (g.status !== "lobby") fail(409, "The game has already started");
      const state = startOnlineGame({ industry: g.industry, difficulty: g.difficulty, rounds: g.rounds, botCount: g.bot_count, botSkill: g.bot_skill, seed: 1234 },
        players.map((p) => ({ id: p.id, name: p.player_name, company: p.company_name, trait: p.trait })));
      Object.assign(g, { status: "playing", current_round: 1, round_deadline: new Date(Date.now() + g.round_seconds * 1000).toISOString() });
      publish(g.id, 0, state);
      notify(g.id);
      return { ok: true };
    }
    if (action === "resolve") {
      if (g.status !== "playing") fail(409, "The game is not running");
      const round = g.current_round, state = db.states.get(g.id);
      const decisions: Record<string, any> = {};
      for (const d of db.decisions.filter((x) => x.game_id === g.id && x.round === round)) decisions[d.player_id] = d.decisions;
      const allReady = state.companies.filter((c: any) => !c.bankrupt && players.some((p) => p.id === c.id)).every((c: any) => decisions[c.id]);
      const deadlinePassed = Date.now() >= new Date(g.round_deadline).getTime();
      if (!deadlinePassed && !(allReady && g.host_user_id === userId)) fail(409, allReady ? "Only the host can skip the timer" : "Waiting for everyone to submit");
      const next = resolveOnlineRound(state, decisions);
      Object.assign(g, { current_round: next.finished ? round : round + 1, status: next.finished ? "finished" : "playing", round_deadline: next.finished ? null : new Date(Date.now() + g.round_seconds * 1000).toISOString() });
      publish(g.id, round, next);
      notify(g.id);
      return { ok: true, resolved: round };
    }
    if (action === "rename") {
      const state = db.states.get(g.id);
      const next = renameCompany(state, me.id, body.target_id, body.name);
      if (next === state) fail(403, "Only the company that controls it can rename it");
      publish(g.id, Math.max(0, state.round - 1), next);
      return { ok: true };
    }
    fail(400, "Unknown action");
  },
};

// What the page uses instead of Supabase (same shape as realApi in game.html). User "host".
const HOST = "user-host";
const fakeApi = {
  async signIn() {},
  async rpc(name: string, a: any) {
    if (name === "create_game") return server.createGame(HOST, a.p_player_name, a.p_company_name, a.p_trait);
    if (name === "join_game") return server.join(HOST, a.p_code, a.p_player_name, a.p_company_name, a.p_trait);
    if (name === "update_game_settings") {
      const g = db.games.find((x) => x.id === a.p_game_id)!;
      Object.assign(g, { industry: a.p_industry, difficulty: a.p_difficulty, mode: a.p_mode, rounds: a.p_rounds, round_seconds: a.p_round_seconds, bot_count: a.p_bot_count, bot_skill: a.p_bot_skill });
      notify(g.id);
      return null;
    }
    if (name === "leave_game") return null;
    throw new Error("unknown rpc " + name);
  },
  async game(id: string) { return JSON.parse(JSON.stringify(db.games.find((g) => g.id === id) ?? null)); },
  async players(id: string) { return JSON.parse(JSON.stringify(db.players.filter((p) => p.game_id === id))); },
  async latestReport(gameId: string, playerId: string) {
    const r = db.reports.filter((x) => x.game_id === gameId && x.player_id === playerId).sort((a, b) => b.round - a.round)[0];
    return r ? JSON.parse(JSON.stringify(r)) : null;
  },
  async submit(gameId: string, round: number, playerId: string, d: any) { server.submit(gameId, round, playerId, d); },
  async call(action: string, body: any) { return server.call(HOST, action, body); },
  async subscribe(gameId: string, onChange: () => void) {
    if (!listeners.has(gameId)) listeners.set(gameId, new Set());
    listeners.get(gameId)!.add(onChange);
    return () => listeners.get(gameId)!.delete(onChange);
  },
};

// ---------------------------------------------------------------- the page
const html = readFileSync("dist/friendly-takeover.html", "utf8");
const errors: string[] = [];
const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/?join=",
  beforeParse(w: any) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.__ftFast = true;
    w.__ftApi = fakeApi;
    w.scrollTo = () => {};
    const ctx: any = new Proxy({}, { get: (t: any, k) => (k === "createLinearGradient" ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}), set: (t: any, k, v) => { t[k] = v; return true; } });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.addEventListener("error", (e: any) => errors.push(e.message));
  },
});
const { window } = dom as any;
const doc = window.document as any;
const $ = (sel: string) => doc.querySelector(sel) as any;
const click = (sel: string) => { const el = $(sel); if (!el) throw new Error("missing " + sel + " | " + (doc.querySelector(".overlay")?.textContent || doc.body.textContent || "").replace(/\s+/g, " ").slice(0, 300)); el.click(); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, fn: () => unknown, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(10); }
  throw new Error("timed out waiting for " + what + " | " + (doc.querySelector(".overlay")?.textContent || doc.body.textContent || "").replace(/\s+/g, " ").slice(0, 400));
}
const type = (sel: string, v: string) => { const el = $(sel) as any; el.value = v; el.dispatchEvent(new window.Event("input")); };
const closeIntro = () => {
  if (/How to play/.test($(".overlay")?.textContent || "")) click("#btn-close");
  while ($("#btn-tv-next")) click("#btn-tv-next");
  if ($("#btn-tv-done")) click("#btn-tv-done");
  if (!/Your secret mission/.test($(".overlay")?.textContent || "")) throw new Error("mission briefing should follow the intro");
  click("#btn-mission-ok");
};
const closeResults = () => {
  if ($("#btn-show-done")) click("#btn-show-done");
  if ($("#btn-board-next") && !$("#btn-continue")) while ($("#btn-board-next")) click("#btn-board-next");
  if ($("#btn-continue")) click("#btn-continue");
  while ($("#btn-board-next")) click("#btn-board-next");
  while ($("#btn-tv-next")) click("#btn-tv-next");
  if ($("#btn-tv-done")) click("#btn-tv-done");
  if ($("[data-vote]")) click("#btn-close");
};
const D = () => window.__ftDebug.S;

await wait(30);
// Title → Multiplayer → create a game.
click("#t-online");
if (!/Host a game/.test($(".overlay")!.textContent!)) throw new Error("online modal missing");
click("#btn-mp-create");
if (!/Fill in your name/.test($(".overlay")!.textContent!)) throw new Error("empty name should be refused");
type("#mp-name", "Jeroen"); type("#mp-company", "Cocoa Loco");
click("#btn-mp-create");
await until("lobby", () => $(".lobby"));
const code = $(".bigcode")!.textContent!;
if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("bad code " + code);
if (!($("#invite-link") as any).value.includes("?join=" + code)) throw new Error("invite link wrong");
if (!($("#btn-mp-start") as any).disabled) throw new Error("start should wait for a second company");

// A friend joins from another device.
const friend = server.join("user-friend", code, "Sanne", "Bar None", "ruthless");
await until("friend in lobby", () => /Sanne/.test($(".lobby")!.textContent!));
// Host settings: 6 rounds, one hard bot.
click('[data-set="rounds"][data-val="6"]');
await until("rounds saved", () => db.games[0].rounds === 6 && $('[data-set="rounds"][data-val="6"]')?.getAttribute("aria-checked") === "true");
click('[data-set="bot_count"][data-val="1"]');
await until("bot saved", () => db.games[0].bot_count === 1 && /Bot 1/.test($(".lobby")!.textContent!));
click('[data-set="bot_skill"][data-val="hard"]');
await until("bot skill saved", () => db.games[0].bot_skill === "hard");

click("#btn-mp-start");
await until("game screen", () => $("#btn-submit"));
closeIntro();
{
  const S = D();
  if (!S.mp || S.game.companies.length !== 3) throw new Error("expected 3 companies online, got " + S.game.companies.length);
  if (S.game.companies[0].id !== "you" || S.game.companies[0].companyName !== "Cocoa Loco") throw new Error("my company should be 'you'");
  if (S.game.rngState !== 0 || S.game.upcomingNews || S.game.bots) throw new Error("server secrets leaked into the view");
  if (!$(".mpchip") || !$(".mpchip")!.textContent!.includes(code)) throw new Error("online chip missing");
}

for (let r = 1; r <= 6; r++) {
  const S = D();
  if (S.game.round !== r) throw new Error(`expected round ${r}, page is on ${S.game.round}`);
  // The friend's company: secrets must be hidden from me.
  const rival = S.game.companies.find((c: any) => c.id === friend.player_id);
  if (!rival || rival.inventory !== 0 || rival.rndProgress !== 0) throw new Error("rival secrets visible in round " + r);
  if (r === 2) { click('[data-tab="takeovers"]'); const plus = $('[data-buy-step][data-dir="1"]:not([disabled])'); if (plus) plus.click(); }
  click("#btn-submit");
  if ($("[data-vote]")) click('[data-vote="a"]');
  click("#btn-confirm");
  await until("waiting screen", () => /waiting for the others/.test($(".overlay")?.textContent || ""));
  const mine = db.decisions.find((d) => d.round === r && d.player_id !== friend.player_id);
  if (!mine) throw new Error("my decisions were not sent in round " + r);
  if (JSON.stringify(mine.decisions).includes('"you"')) throw new Error("the 'you' alias leaked to the server");
  if (!($("#btn-skip") as any).disabled) throw new Error("host should not skip before everyone is ready");
  if (r === 1) {
    // Changing my mind and resubmitting works.
    click("#btn-change");
    if (!/Submit/.test($("#btn-submit")!.textContent!)) throw new Error("submit button should be back");
    click("#btn-submit"); if ($("[data-vote]")) click('[data-vote="a"]'); click("#btn-confirm");
    await until("waiting again", () => /waiting for the others/.test($(".overlay")?.textContent || ""));
  }
  // The friend submits (an empty plan = repeat last round).
  server.submit(db.games[0].id, r, friend.player_id, {});
  await until("everyone ready", () => $("#btn-skip") && !($("#btn-skip") as any).disabled);
  click("#btn-skip");
  await until("results of round " + r, () => D().game.round === r + 1 || D().game.finished);
  closeResults();
}
await until("final screen", () => /Final results/.test(doc.body.textContent || ""));
if (db.games[0].status !== "finished") throw new Error("server game should be finished");
// The final view is the full state: everyone's secrets are revealed.
if (!D().game.companies.every((c: any) => c.mission && c.mission.id)) throw new Error("final view should show missions");
// Back to the title stops polling; the game can be rejoined.
click("#btn-menu-final");
await until("title", () => $(".title-screen"));
if (errors.length) throw new Error("script errors: " + errors.join(" | "));
console.log(`multiplayer smoke ok: lobby code ${code}, 6 online rounds with a friend and a bot, ${db.reports.length} reports written`);
process.exit(0);
