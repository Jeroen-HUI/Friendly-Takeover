// Plays an online match in the game page against an in-memory copy of the Supabase backend.
// The fake backend runs the same server code as the edge function (src/server/core.ts), so this
// checks the whole loop: create → lobby → join → settings → start → submit → wait → host skips → results.
// Run: npx tsx test/multiplayer.smoke.ts
// @ts-expect-error jsdom ships without types
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { startOnlineGame, resolveOnlineRound, viewFor, publicData, publicLive, renameCompany, exchangeTrade, liveBid, castVote, endAfterThisRound, botDealOnline } from "../src/server/core";

// ---------------------------------------------------------------- fake backend
type Row = Record<string, any>;
const live = new Map<string, any>();
const db = { invites: [] as Row[], games: [] as Row[], players: [] as Row[], states: new Map<string, any>(), decisions: [] as Row[], reports: [] as Row[], messages: [] as Row[], deals: [] as Row[], results: [] as Row[] };
let seq = 1;
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
  live.set(gameId, { round: state.round, data: JSON.parse(JSON.stringify(publicLive(state))) });
  db.results = db.results.filter((r) => !(r.game_id === gameId && r.round === round));
  db.results.push({ game_id: gameId, round, public_data: JSON.parse(JSON.stringify(publicData(state, round))) });
}

const server = {
  createGame(userId: string, name: string, company: string, trait: string, a: any = {}) {
    const g = { id: randomUUID(), code: newCode(), host_user_id: userId, industry: a.p_industry ?? "chocolate", difficulty: a.p_difficulty ?? "standard", mode: "live", rounds: a.p_rounds ?? 8, round_seconds: a.p_round_seconds ?? 300, status: "lobby", current_round: 0, round_deadline: null, tv_code: "abc123def456", bot_count: a.p_bot_count ?? 0, bot_skill: a.p_bot_skill ?? "normal", league_id: a.p_league_id ?? null, created_at: new Date().toISOString() };
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
  message(gameId: string, round: number, from: string, to: string | null, body: string, kind = "chat") {
    db.messages.push({ id: seq++, game_id: gameId, round, from_player_id: from, to_player_id: to, body, kind, created_at: new Date().toISOString() });
  },
  offer(gameId: string, round: number, from: string, to: string, kind: string, terms: any) {
    const g = db.games.find((x) => x.id === gameId)!;
    if (g.status !== "playing" || g.current_round !== round) throw new Error("new row violates row-level security policy");
    const d = { id: seq++, game_id: gameId, round, from_player_id: from, to_player_id: to, kind, terms, status: "offered", note: null, created_at: new Date().toISOString() };
    db.deals.push(d); return d;
  },
  call(userId: string, action: string, body: any) {
    const g = db.games.find((x) => x.id === body.game_id)!;
    const players = db.players.filter((p) => p.game_id === g.id);
    const me = players.find((p) => p.user_id === userId)!;
    const fail = (status: number, msg: string) => { throw Object.assign(new Error(msg), { status }); };
    if (action === "start") {
      if (g.host_user_id !== userId) fail(403, "Only the host can start the game");
      if (g.status !== "lobby") fail(409, "The game has already started");
      const state = startOnlineGame({ industry: g.industry, difficulty: g.difficulty, rounds: g.rounds, botCount: g.bot_count, botSkill: g.bot_skill, seed: 1234, rules: g.rules ?? null },
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
      const deals = db.deals.filter((d) => d.game_id === g.id && d.round === round && d.status === "accepted").map((d) => ({ id: String(d.id), from: d.from_player_id, to: d.to_player_id, kind: d.kind, terms: d.terms }));
      const next = resolveOnlineRound(state, decisions, deals);
      for (const l of next.dealLog ?? []) { const d = db.deals.find((x) => String(x.id) === l.id); if (!d) continue; d.status = l.ok ? "done" : "failed"; d.note = l.reason; }
      for (const d of db.deals.filter((x) => x.game_id === g.id && x.round === round && x.status === "offered")) d.status = "cancelled";
      Object.assign(g, { current_round: next.finished ? round : round + 1, status: next.finished ? "finished" : "playing", round_deadline: next.finished ? null : new Date(Date.now() + g.round_seconds * 1000).toISOString() });
      publish(g.id, round, next);
      notify(g.id);
      return { ok: true, resolved: round };
    }
    if (action === "botdeal") {
      const state = db.states.get(g.id);
      try {
        const r = botDealOnline(state, me.id, body.bot, body.kind, body.terms);
        if (r.accept) db.states.set(g.id, r.state);
        (db as any).botDeals = [...((db as any).botDeals ?? []), { ...body, accept: r.accept }];
        return { ok: true, accept: r.accept, line: r.line, id: r.id };
      } catch (e) { fail(400, (e as Error).message); }
    }
    if (action === "trade" || action === "bid" || action === "vote" || action === "end") {
      const state = db.states.get(g.id);
      if (action === "end" && g.host_user_id !== userId) fail(403, "Only the host can end the game");
      try {
        const next = action === "trade" ? exchangeTrade(state, me.id, body.target_id, body.qty) : null;
        const st2 = next ? next.state : action === "bid" ? liveBid(state, me.id, body.lot, body.amount) : action === "vote" ? castVote(state, me.id, body.proposal, body.yes) : endAfterThisRound(state);
        db.states.set(g.id, st2);
        live.set(g.id, { round: st2.round, data: JSON.parse(JSON.stringify(publicLive(st2))) });
        return { ok: true, trade: next ? next.trade : null, live: live.get(g.id).data };
      } catch (e) { fail(400, (e as Error).message); }
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
  async linkEmail(email: string) { (db as any).linkedEmail = email; },
  async passwordLogin(email: string, pw: string) { if (pw !== "right-password") throw new Error("Wrong email or password."); },
  async setPassword() {},
  async rpc(name: string, a: any) {
    if (name === "report_content") { (db as any).reportsSent = [...((db as any).reportsSent ?? []), a]; return null; }
    if (name === "redeem_gift_code") { if (String(a.p_code).toUpperCase() !== "FT-TEST-CODE") return { ok: false, error: "That code doesn't exist or was switched off." }; (db as any).owned = true; return { ok: true, already: false }; }
    if (name === "admin_list_gift_codes") return ((db as any).gifts ?? []);
    if (name === "admin_create_gift_codes") { const made = Array.from({ length: a.p_count }, (_, i) => "FT-NEW" + i + "-ABCD"); (db as any).gifts = [...made.map((code) => ({ code, uses: 0, max_uses: a.p_uses, note: a.p_note, disabled: false, players: [] })), ...((db as any).gifts ?? [])]; return made; }
    if (name === "my_access") return { signed_in: true, owned: !!(db as any).owned, admin: true, free_left: (db as any).paywall ? 0 : 1, paywall: { enabled: !!(db as any).paywall, price: "€8.99", payment_link: "https://buy.stripe.com/test_fake" } };
    if (name === "create_game" && (db as any).paywall) throw new Error("PAYWALL: Your free online game is used up. Get the full game to keep playing online.");
    if (name === "create_game") return server.createGame(HOST, a.p_player_name, a.p_company_name, a.p_trait, a);
    if (name === "respond_deal") { const d = db.deals.find((x) => x.id === a.p_deal_id && x.status === "offered"); if (!d) throw new Error("That offer is no longer open"); d.status = a.p_accept ? "accepted" : "declined"; return null; }
    if (name === "cancel_deal") { const d = db.deals.find((x) => x.id === a.p_deal_id && x.status === "offered"); if (d) d.status = "cancelled"; return null; }
    if (name === "league_lobby") { const g = db.games.filter((x) => x.league_id === a.p_league_id && x.status === "lobby").at(-1); return g ? { game_id: g.id, code: g.code } : null; }
    if (name === "league_table") {
      const games = db.games.filter((x) => x.status === "finished" && (x.id === a.p_league_id || x.league_id === a.p_league_id));
      const pts = [10, 7, 5, 3, 2, 1], acc: Record<string, any> = {};
      for (const g of games) {
        const last = db.results.filter((r) => r.game_id === g.id).sort((x, y) => y.round - x.round)[0];
        [...last.public_data.standings].sort((x: any, y: any) => y.score - x.score).forEach((st: any, k: number) => {
          const p = db.players.find((pp) => pp.id === st.companyId); if (!p) return;
          const r = (acc[p.user_id] ??= { user_id: p.user_id, player_name: p.player_name, games: 0, wins: 0, points: 0, best_score: 0, me: p.user_id === HOST });
          r.games++; if (k === 0) r.wins++; r.points += pts[k] ?? 0; r.best_score = Math.max(r.best_score, st.score);
        });
      }
      return Object.values(acc).sort((x: any, y: any) => y.points - x.points);
    }
    if (name === "join_game") return server.join(HOST, a.p_code, a.p_player_name, a.p_company_name, a.p_trait);
    if (name === "set_house_rules") {
      const g = db.games.find((x) => x.id === a.p_game_id && x.host_user_id === HOST && x.status === "lobby");
      if (!g) throw new Error("Only the host can change the rules before the game starts");
      g.rules = { ...a.p_rules };
      if (a.p_rounds != null) g.rounds = a.p_rules.unlimited ? 999 : a.p_rounds;
      if (a.p_round_seconds != null) g.round_seconds = a.p_round_seconds;
      notify(g.id);
      return g.rules;
    }
    if (name === "update_game_settings") {
      const g = db.games.find((x) => x.id === a.p_game_id)!;
      Object.assign(g, { industry: a.p_industry, difficulty: a.p_difficulty, mode: a.p_mode, rounds: a.p_rounds, round_seconds: a.p_round_seconds, bot_count: a.p_bot_count, bot_skill: a.p_bot_skill });
      notify(g.id);
      return null;
    }
    if (name === "leave_game") return null;
    // Accounts and friends: the host has one friend, Kim, who can invite them.
    if (name === "ensure_profile") return { name: "Jeroen", friend_code: "JRN234", stats: {}, email: null, anonymous: true };
    if (name === "touch_profile" || name === "grant_achievements" || name === "set_profile_name") return null;
    if (name === "record_result") return { games: 1 };
    if (name === "my_friends") return [{ user_id: "user-kim", name: "Kim", friend_code: "KIM234", status: "friends", online: true, last_seen: new Date().toISOString() }];
    if (name === "my_invites") return db.invites.filter((i) => i.to === HOST && i.status === "pending").map((i) => { const g = db.games.find((x) => x.id === i.game_id)!; return { id: i.id, game_id: g.id, code: g.code, from_name: "Kim", industry: g.industry, players: db.players.filter((pp) => pp.game_id === g.id).length, created_at: new Date().toISOString() }; });
    if (name === "answer_invite") { const i = db.invites.find((x) => x.id === a.p_id)!; i.status = a.p_accept ? "accepted" : "declined"; return db.games.find((x) => x.id === i.game_id)!.code; }
    if (name === "invite_friend") { db.invites.push({ id: seq++, game_id: a.p_game_id, from: HOST, to: a.p_user, status: "pending" }); return null; }
    if (name === "lobby_invites") return db.invites.filter((i) => i.game_id === a.p_game_id).map((i) => ({ to_user: i.to, status: i.status }));
    throw new Error("unknown rpc " + name);
  },
  async game(id: string) { return JSON.parse(JSON.stringify(db.games.find((g) => g.id === id) ?? null)); },
  async players(id: string) { return JSON.parse(JSON.stringify(db.players.filter((p) => p.game_id === id))); },
  async latestReport(gameId: string, playerId: string) {
    const r = db.reports.filter((x) => x.game_id === gameId && x.player_id === playerId).sort((a, b) => b.round - a.round)[0];
    return r ? JSON.parse(JSON.stringify(r)) : null;
  },
  async submit(gameId: string, round: number, playerId: string, d: any) { server.submit(gameId, round, playerId, d); },
  async messagesSince(gameId: string, after: number) {
    const mine = db.players.filter((p) => p.user_id === HOST).map((p) => p.id);
    return JSON.parse(JSON.stringify(db.messages.filter((m) => m.game_id === gameId && m.id > after && (m.to_player_id === null || mine.includes(m.to_player_id) || mine.includes(m.from_player_id)))));
  },
  async sendMessage(gameId: string, round: number, from: string, to: string | null, body: string, kind: string) { server.message(gameId, round, from, to, body, kind); },
  async marketLive(gameId: string) { return JSON.parse(JSON.stringify(live.get(gameId) ?? null)); },
  async tvSnapshot(id: string, code: string) {
    const g = db.games.find((x) => x.id === id && x.tv_code === code);
    if (!g) return null;
    const last = db.results.filter((r) => r.game_id === id).sort((a, b) => b.round - a.round)[0];
    return JSON.parse(JSON.stringify({ game: g, players: db.players.filter((p) => p.game_id === id).map((p) => ({ id: p.id, name: p.player_name, company: p.company_name, trait: p.trait, submitted_round: p.submitted_round, is_host: p.is_host })),
      results: last ? { round: last.round, data: last.public_data } : null, live: live.get(id)?.round === g.current_round ? live.get(id).data : null, chat: [], now: new Date().toISOString() }));
  },
  async deals(gameId: string) {
    const mine = db.players.filter((p) => p.user_id === HOST).map((p) => p.id);
    return JSON.parse(JSON.stringify(db.deals.filter((d) => d.game_id === gameId && (mine.includes(d.from_player_id) || mine.includes(d.to_player_id)))));
  },
  async offerDeal(gameId: string, round: number, from: string, to: string, kind: string, terms: any) { server.offer(gameId, round, from, to, kind, terms); },
  async feedback(row: any) { (db as any).feedback = [...((db as any).feedback ?? []), row]; },
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
    w.addEventListener("error", (e: any) => errors.push(e.message + (process.env.FT_STACK ? " @ " + String(e.error && e.error.stack).slice(0, 900) : "")));
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
  throw new Error("timed out waiting for " + what + " [errors: " + errors.join(" / ") + "] | " + (doc.querySelector(".overlay")?.textContent || doc.body.textContent || "").replace(/\s+/g, " ").slice(0, 400));
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
// A friend's invite shows up on the main menu; one tap joins their lobby.
{
  const kim = server.createGame("user-kim", "Kim", "Kim Konfect", "influencer");
  db.invites.push({ id: seq++, game_id: kim.game_id, from: "user-kim", to: HOST, status: "pending" });
  await until("invite bar", () => /Kim/.test($(".invitebar:not([hidden])")?.textContent || ""), 12000);
  if (!/Profile|Jeroen/.test($("#t-account")!.textContent!)) throw new Error("account chip missing");
  click("[data-inv-join]");
  await until("joined Kim's lobby", () => $(".lobby") && /Kim/.test($(".lobby")!.textContent!));
  if (db.invites[0].status !== "accepted" || !db.players.some((p) => p.game_id === kim.game_id && p.user_id === HOST)) throw new Error("invite join failed");
  click("#btn-leave");
  await until("back on the title", () => $(".title-screen"));
}
// The host's own game is the second one (the first is Kim's).
const HG = () => db.games[1];
const myIdNow = () => db.players.find((p) => p.user_id === HOST && p.game_id === HG().id)!.id;
// Title → Multiplayer: the first time, the account screen. Create an account (email link), then keep playing.
click("#t-online");
await until("account screen", () => $("#a-name"));
type("#a-name", "Jeroen"); type("#a-email", "not-an-email");
($("#a-form") as any).requestSubmit ? ($("#a-form") as any).requestSubmit() : $("#a-form button[type=submit]")!.click();
await until("email check", () => /email address/.test($(".overlay")!.textContent!));
type("#a-email", "jeroen@example.com");
$("#a-form button[type=submit]")!.click();
await until("check inbox", () => /Check your inbox/.test($(".overlay")!.textContent!) && (db as any).linkedEmail === "jeroen@example.com");
click("#a-guest");
await until("online menu after account", () => /Host a game/.test($(".overlay")?.textContent || ""));
click("#btn-close");
click("#t-account");
await until("log in screen", () => $("[data-atab=login]"));
click("[data-atab=login]"); type("#a-email", "jeroen@example.com"); type("#a-pw", "nope");
$("#a-form button[type=submit]")!.click();
await until("wrong password", () => /Wrong email or password/.test($(".overlay")!.textContent!));
($(".win-title .x") as any).click();
click("#t-online");
if (!/Host a game/.test($(".overlay")!.textContent!)) throw new Error("online modal missing");
if (($("#mp-name") as any).value !== "Jeroen") throw new Error("the account name should fill in the player name");
type("#mp-name", "");
click("#btn-mp-create");
if (!/Fill in your name/.test($(".overlay")!.textContent!)) throw new Error("empty name should be refused");
type("#mp-name", "Jeroen"); type("#mp-company", "Cocoa Loco");
click("#btn-mp-create");
await until("lobby", () => $(".lobby"));
const code = $(".bigcode")!.textContent!;
if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("bad code " + code);
if (!($("#invite-link") as any).value.includes("?join=" + code)) throw new Error("invite link wrong");
if (!($("#btn-mp-start") as any).disabled) throw new Error("start should wait for a second company");
// Invite a friend from the lobby.
await until("friends in lobby", () => $("[data-invite]"), 12000);
click("[data-invite]");
await until("invite sent", () => db.invites.some((i) => i.to === "user-kim" && i.game_id === db.games.at(-1)!.id));

// A friend joins from another device.
const friend = server.join("user-friend", code, "Sanne", "Bar None", "ruthless");
await until("friend in lobby", () => /Sanne/.test($(".lobby")!.textContent!));
// Host settings: 6 rounds, one hard bot, €2M start (custom start editor).
{ const i = $("[data-cs-rounds]") as any; i.value = "6"; i.dispatchEvent(new window.Event("change", { bubbles: true })); }
await until("rounds saved", () => HG().rounds === 6 && ($("[data-cs-rounds]") as any)?.value === "6");
{ const i = $('[data-csn="startCash"]') as any; i.value = "2000000"; i.dispatchEvent(new window.Event("change", { bubbles: true })); }
await until("house rule saved", () => HG().rules && HG().rules.startCash === 2000000 && ($('[data-csn="startCash"]') as any)?.value === "2000000");
click('[data-set="bot_count"][data-val="1"]');
await until("bot saved", () => HG().bot_count === 1 && /Bot 1/.test($(".lobby")!.textContent!));
click('[data-set="bot_skill"][data-val="hard"]');
await until("bot skill saved", () => HG().bot_skill === "hard");

click("#btn-mp-start");
await until("game started", () => db.states.get(HG().id));
if (db.states.get(HG().id)!.config.rules?.startCash !== 2000000) throw new Error("house rules should reach the server game: " + JSON.stringify(db.states.get(HG().id)!.config));
await until("game screen", () => $("#btn-submit"));
closeIntro();
{
  const S = D();
  if (!S.mp || S.game.companies.length !== 3) throw new Error("expected 3 companies online, got " + S.game.companies.length);
  if (S.game.companies[0].id !== "you" || S.game.companies[0].companyName !== "Cocoa Loco") throw new Error("my company should be 'you'");
  if (S.game.rngState !== 0 || S.game.upcomingNews || S.game.bots) throw new Error("server secrets leaked into the view");
  if (!$(".mpchip") || !$(".mpchip")!.textContent!.includes(code)) throw new Error("online chip missing");
}

const dealCount = (botId: string) => { const S = D(); return [...(S.mpBotDealsDebug || [])].length || (JSON.parse(window.localStorage.getItem("ft-botdeals-" + HG().id) || "[]") as any[]).filter((d) => d.to === botId).length; };
for (let r = 1; r <= 6; r++) {
  const S = D();
  if (S.game.round !== r) throw new Error(`expected round ${r}, page is on ${S.game.round}`);
  // The friend's company: secrets must be hidden from me.
  const rival = S.game.companies.find((c: any) => c.id === friend.player_id);
  if (!rival || rival.inventory !== 0 || rival.rndProgress !== 0) throw new Error("rival secrets visible in round " + r);
  if (r === 1) {
    // Group chat both ways, and a loan offer from the friend that I accept in the chat window.
    const gid = HG().id, myId = db.players.find((p) => p.user_id === HOST && p.game_id === gid)!.id;
    click("#btn-chat");
    const inp = $("#t-input") as any; inp.value = "Good luck, you'll need it"; $("#tsend")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await until("my message on the server", () => db.messages.some((m) => m.body === "Good luck, you'll need it" && m.to_player_id === null));
    server.message(gid, 1, friend.player_id, null, "Bring it on");
    server.offer(gid, 1, friend.player_id, myId, "loan", { amount: 200000, repay: 210000, rounds: 1, direction: "lend" });
    await until("friend's chat and offer", () => /Bring it on/.test($("#talkwin")!.textContent!) || /deal offer/.test($(".agenda")!.textContent!), 6000);
    // Report the friend's message (it goes to report_content with the message id), then hide and unhide them.
    click(`[data-thread="all"]`);
    await until("report flag", () => $(`[data-report-from="${friend.player_id}"]`));
    click(`[data-report-from="${friend.player_id}"]`);
    ($("#r-reason") as any).value = "spam"; ($("#r-note") as any).value = "test";
    click("#r-send");
    await until("report sent", () => ((db as any).reportsSent || []).length === 1);
    await until("report confirmation", () => /report was sent/.test($("#talkwin")!.textContent!));
    { const rep = (db as any).reportsSent[0], msg = db.messages.find((m) => m.body === "Bring it on")!;
      if (rep.p_player_id !== friend.player_id || rep.p_reason !== "spam" || rep.p_message_id !== msg.id || rep.p_note !== "test") throw new Error("report payload: " + JSON.stringify(rep)); }
    if (!/report was sent/.test($("#talkwin")!.textContent!)) throw new Error("report confirmation missing");
    if ($(`[data-report-from="${myId}"]`)) throw new Error("my own messages should have no report flag");
    click(`[data-report-from="${friend.player_id}"]`); click("#r-mute");
    if (/Bring it on/.test($("#tlog")!.textContent!)) throw new Error("hidden player's messages still show");
    window.localStorage.removeItem("ft-muted");
    click(`[data-thread="${friend.player_id}"]`);
    await until("deal card", () => $("[data-deal-accept]"));
    click("[data-deal-accept]");
    await until("deal accepted", () => db.deals[0].status === "accepted");
    click("#talk-close");
  }
  if (r === 3) {
    // Live exchange online: my trade goes through the server; the friend's trade shows up on my ticker.
    click('[data-tab="takeovers"]');
    // Prices at the start of a round match the public price (no fake crash from the hidden rival books).
    { const txt = ($("#live-exchange")?.textContent || "") + ($("#ticker")?.textContent || "");
      if (/▼\s?[1-9]\d(\.\d)?%/.test(txt)) throw new Error("exchange shows a fake crash at round start: " + txt.slice(0, 300)); }
    const buy = $(`[data-trade="${friend.player_id}"][data-qty="5"]`);
    if (!buy) throw new Error("exchange row for the friend missing");
    buy.click();
    await until("my live trade", () => (D().game.companies.find((c: any) => c.id === friend.player_id).shares.holders.you || 0) >= 5);
    server.call("user-friend", "trade", { game_id: HG().id, target_id: myIdNow(), qty: 3 });
    await until("friend's trade on my ticker", () => /Sanne|Bar None/.test($("#ticker")?.textContent || "") && /bought 3% of/.test($("#ticker")!.textContent!), 8000);
    if ((D().game.companies[0].shares.holders[friend.player_id] || 0) !== 3) throw new Error("friend's stake in me should show live");
    // Board vote online: the friend asks its shareholders (me) for an extra loan; I vote no through the server.
    { const st = db.states.get(HG().id); st.board = [{ id: "l3-" + friend.player_id, round: 3, company: friend.player_id, kind: "loan", amount: 1000000, votes: {} }];
      live.set(HG().id, { round: st.round, data: JSON.parse(JSON.stringify(publicLive(st))) }); notify(HG().id); }
    click('[data-tab="boardroom"]');
    await until("board vote card", () => $(`[data-bvote="l3-${friend.player_id}"][data-yes="0"]`), 8000);
    click(`[data-bvote="l3-${friend.player_id}"][data-yes="0"]`);
    await until("vote on the server", () => db.states.get(HG().id).board[0].votes[myIdNow()] === false);
    await until("vote shown", () => D().game.board.find((p: any) => p.id === "l3-" + friend.player_id)?.votes.you === false);
  }
  if (r === 4) {
    // Deals with bots work online too: offer the bot a pact in its private chat; the server answers for it.
    const botId = D().game.companies.find((c: any) => /^bot-/.test(c.id) && !c.bankrupt)?.id;
    if (!botId) throw new Error("no bot left to deal with");
    click("#btn-chat");
    await until("bot thread", () => $(`[data-thread="${botId}"]`));
    click(`[data-thread="${botId}"]`); click("#t-newdeal"); click('[data-dkind="pact"]');
    ($("#d-penalty") as any).value = "300k";
    click("#d-send");
    await until("bot answered the deal", () => ((db as any).botDeals || []).length === 1 && D().game && dealCount(botId) === 1, 6000);
    (globalThis as any).__botDealAccepted = (db as any).botDeals[0].accept;
    click("#talk-close");
  }
  if (r === 5 && (globalThis as any).__botDealAccepted) {
    const st = db.states.get(HG().id);
    if (!(st.pacts || []).some((p: any) => p.a === myIdNow() || p.b === myIdNow()) && !st.feed.some((f: any) => /pact/.test(f.headline))) throw new Error("accepted bot pact was not carried out");
  }
  if (r === 2) {
    // A private message and a deal offer pop up while the chat is closed; slurs are censored, ordinary swearing stays.
    const gid2 = HG().id, me2 = db.players.find((p) => p.user_id === HOST && p.game_id === gid2)!.id;
    const slur = ["n", "1", "g", "g", "a"].join("");
    server.message(gid2, 2, friend.player_id, me2, "damn, you " + slur + ", fuck this round");
    server.offer(gid2, 2, friend.player_id, me2, "pact", { rounds: 2, penalty: 300000 });
    await until("message pop-up", () => /fuck this round/.test($(".popstack")?.textContent || ""), 8000);
    const popTxt = $(".popstack")!.textContent!;
    if (popTxt.includes(slur) || !popTxt.includes("#####") || !/damn/.test(popTxt)) throw new Error("censor in pop-up: " + popTxt);
    await until("deal pop-up", () => /Deal offer from/.test($(".popstack")?.textContent || ""), 8000);
    $(".popmsg.deal").click();
    await until("chat opened on the friend's thread", () => !$("#talkwin")!.hidden && $("[data-deal-accept]"));
    if (($("#tlog")?.textContent || "").includes(slur)) throw new Error("slur shown in the chat");
    click("#talk-close");
    const mine = D().game.companies[0].history.at(-1);
    if (db.deals[0].status !== "done" || mine.dealCash !== 200000) throw new Error("loan deal should be done with +200k: " + JSON.stringify([db.deals[0], mine.dealCash]));
  }
  if (r === 2) { click('[data-tab="takeovers"]'); const plus = $('[data-buy-step][data-dir="1"]:not([disabled])'); if (plus) plus.click(); }
  click("#btn-submit");
  if ($("[data-vote]")) click('[data-vote="a"]');
  click("#btn-confirm");
  await until("waiting screen", () => /waiting for the others/.test($(".overlay")?.textContent || ""));
  if (!$("#mg-slot .mg canvas")) throw new Error("Coin Rush missing on the waiting screen");
  if (r === 1) {
    click('[data-mg="start"]');
    await new Promise((res) => setTimeout(res, 120));
    if (!D().game || !(window as any).__ftDebug.MG.run) throw new Error("Coin Rush did not start");
  }
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
  server.submit(HG().id, r, friend.player_id, {});
  await until("everyone ready", () => $("#btn-skip") && !($("#btn-skip") as any).disabled);
  click("#btn-skip");
  await until("results of round " + r, () => D().game.round === r + 1 || D().game.finished);
  closeResults();
}
await until("final screen", () => /Final results/.test(doc.body.textContent || ""));
// Party mode: the TV link shows the final standings for the room.
{
  const tvDom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    runScripts: "dangerously", pretendToBeVisual: true, url: `http://localhost/?tv=${HG().id}.abc123def456`,
    virtualConsole: new VirtualConsole().on("error", (...a: any[]) => errors.push("tv console: " + a.map((x) => (x && x.stack) || String(x)).join(" ").slice(0, 400))).on("jsdomError", (e: any) => errors.push("tv jsdom: " + String(e && e.stack).slice(0, 400))),
    beforeParse(w: any) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.__ftFast = true; w.scrollTo = () => {};
      w.__ftApi = fakeApi;
      const ctx: any = new Proxy({}, { get: (t: any, k) => (k === "createLinearGradient" ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}), set: (t: any, k, v) => { t[k] = v; return true; } });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.addEventListener("error", (e: any) => errors.push("tv: " + e.message));
      w.addEventListener("unhandledrejection", (e: any) => errors.push("tv rejection: " + (e.reason && e.reason.message)));
    },
  });
  const tdoc = tvDom.window.document;
  const t0 = Date.now();
  // (#app, not body: the page's own script text mentions "Final results" too)
  const tvText = () => tdoc.getElementById("app")!.textContent || "";
  while (Date.now() - t0 < 4000 && !(/Final results/.test(tvText()) && tdoc.querySelector(".tv-bld"))) await wait(20);
  if (!/Final results/.test(tvText()) || !tdoc.querySelector(".tv-bld")) throw new Error("TV screen should show the skyline and final results: " + errors.join(" / ") + " :: " + (tdoc.getElementById("app") || tdoc.body).textContent!.replace(/\s+/g, " ").slice(0, 300));
  if (!tvText().includes(code)) throw new Error("TV should show the game code");
  tvDom.window.close();
}
// Season table and rematch: the rematch is a new lobby in the same league.
await until("season table", () => /Season standings/.test(doc.body.textContent || "") && $("#btn-rematch"), 8000);
if (!/Jeroen/.test($(".overlay")!.textContent!)) throw new Error("season table should list me");
if (HG().status !== "finished") throw new Error("server game should be finished");
// The final view is the full state: everyone's secrets are revealed.
if (!D().game.companies.every((c: any) => c.mission && c.mission.id)) throw new Error("final view should show missions");
click("#btn-rematch");
await until("rematch lobby", () => $(".lobby"));
if (db.games.at(-1)!.league_id !== HG().id) throw new Error("rematch should be in the same league");
if (db.games.at(-1)!.rounds !== 6 || db.games.at(-1)!.bot_count !== 1) throw new Error("rematch should keep the settings");
await until("rematch rules", () => db.games.at(-1)!.rules?.startCash === 2000000);
// Paywall: with the free game used up, hosting again opens the shop with the Stripe button.
(db as any).paywall = true;
click("#btn-leave");
await until("title screen", () => $("#t-online"));
click("#t-online");
($("#mp-name") as any).value = "Jeroen"; ($("#mp-company") as any).value = "Cocoa Loco";
click("#btn-mp-create");
await until("shop opens", () => /Get the full game/.test($(".overlay")?.textContent || "") && $("#shop-buy") && !($("#shop-buy") as any).disabled, 6000);
if (!/€8\.99/.test($(".overlay")!.textContent!)) throw new Error("shop should show the price");
// Gift codes: a wrong code shows an error, the right one unlocks the game; the owner can make codes.
($("#shop-code") as any).value = "FT-NOPE-NOPE"; click("#shop-redeem");
await until("bad code message", () => /doesn't exist/.test($(".overlay")?.textContent || ""));
($("#shop-code") as any).value = "ft-test-code"; click("#shop-redeem");
await until("code unlocks", () => /The full game is yours/.test($(".overlay")?.textContent || ""));
click("#btn-close");
await until("title again", () => $("#t-online"));
click("#t-online");
($("#mp-name") as any).value = "Jeroen"; ($("#mp-company") as any).value = "Cocoa Loco";
click("#btn-mp-create");
await until("shop again", () => $("[data-giftcodes]"));
click("[data-giftcodes]");
await until("gift codes panel", () => /No codes yet/.test($(".overlay")?.textContent || ""));
($("#gc-count") as any).value = "2"; ($("#gc-count") as any).dispatchEvent(new (doc.defaultView as any).Event("input"));
($("#gc-note") as any).value = "Tim"; ($("#gc-note") as any).dispatchEvent(new (doc.defaultView as any).Event("input"));
click("#gc-make");
await until("codes made", () => (doc.querySelectorAll(".gc-row").length === 2) && /Tim/.test($(".overlay")!.textContent!) && $("#gc-copy-new"));
if (errors.length) throw new Error("script errors: " + errors.join(" | "));
console.log(`multiplayer smoke ok: lobby code ${code}, 6 online rounds with a friend and a bot, chat, a loan deal, season table and rematch; ${db.reports.length} reports written`);
process.exit(0);
