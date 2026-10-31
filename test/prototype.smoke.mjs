// Plays a full match in the game page inside jsdom and fails on any script error.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
const html = readFileSync("dist/friendly-takeover.html", "utf8");
const errors = [];
const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.__ftFast = true;
    w.scrollTo = () => {};
    // Fake 2D context: records draw calls so the canvas code actually runs.
    w.__draws = 0;
    const ctx = new Proxy({}, { get: (t, k) => k === "createLinearGradient" ? () => ({ addColorStop() {} }) : (k in t ? t[k] : () => { w.__draws++; }), set: (t, k, v) => { t[k] = v; return true; } });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.addEventListener("error", (e) => errors.push(e.message));
  },
});
const { window } = dom;
const doc = window.document;
const click = (sel) => { const el = doc.querySelector(sel); if (!el) throw new Error("missing " + sel); el.click(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(50);
// The game opens on the title screen.
if (!doc.querySelector(".title-screen")) throw new Error("title screen did not render");
if (doc.querySelectorAll(".tcard").length !== 5) throw new Error("title cards missing");
if (!doc.getElementById("t-continue").disabled) throw new Error("continue should be disabled without a save");
click("#t-online"); if (!/Host a game/.test(doc.querySelector(".overlay").textContent)) throw new Error("online modal"); click("#btn-close");
click("#t-options"); click("#btn-close");
click("#t-new");
click("#btn-start");
if (!doc.querySelector("#btn-submit")) throw new Error("game screen did not render");
// First game shows How to play, then the news.
if (!/How to play/.test(doc.querySelector(".overlay")?.textContent || "")) throw new Error("help not shown on first launch");
click("#btn-close");
while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done");
// Then the secret mission briefing, once.
if (!/Your secret mission/.test(doc.querySelector(".overlay")?.textContent || "")) throw new Error("mission briefing missing at the start");
click("#btn-mission-ok");
if (doc.querySelector("#btn-mission-ok")) throw new Error("briefing should close");
if (!doc.querySelector(".agenda .mchip")) throw new Error("mission chip missing from the round strip");
click(".agenda .mchip");
if (!doc.querySelector(".dossier.big .mbar, .dossier.big .ds-line")) throw new Error("mission dossier missing in the boardroom");
// Menu goes back to the title, Continue resumes.
click("#btn-menu");
if (!doc.querySelector(".title-screen") || doc.getElementById("t-continue").disabled) throw new Error("menu/continue broken");
click("#t-continue");
if (!doc.querySelector("#btn-submit")) throw new Error("continue did not resume");
if (!doc.querySelector(".agenda")) throw new Error("round strip missing");
if (!/Decide:/.test(doc.querySelector(".intro").textContent)) throw new Error("tab intro missing");
// Visit every tab and use a control on each.
for (const tab of ["production", "rnd", "marketing", "finance", "takeovers", "boardroom", "market", "reports", "news"]) {
  click(`[data-tab="${tab}"]`);
  if (!doc.querySelector(".win-body")) throw new Error("tab " + tab + " empty");
}
click('[data-tab="production"]');
// Hovering a chart bar shows its exact number.
const bar = doc.querySelector(".chart rect[data-tip]");
bar.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 50 }));
const tip = doc.getElementById("tip");
if (tip.hidden || !/€/.test(tip.textContent)) throw new Error("tooltip did not show an exact number: " + tip.textContent);
click('[data-step="f-price"][data-dir="1"]');
const price = doc.getElementById("f-price"); price.value = "2.6"; price.dispatchEvent(new window.Event("input"));
click('[data-tab="marketing"]');
click('input[name="campaign"][value="viral"]');
let tvShown = 0;
// Year 0 is on record before round 1.
click('[data-tab="reports"]');
if (!/Y0/.test(doc.querySelector(".tbl thead").textContent)) throw new Error("year 0 missing from reports");
click('[data-tab="retail"]');
if (!/unlock in round 3/.test(doc.body.textContent)) throw new Error("retail should be locked in round 1");
click("#btn-options");
if (doc.querySelectorAll(".overlay .switch").length < 6) throw new Error("options switches missing");
click('[data-pref="music"]'); click('[data-pref="music"]'); click('[data-pref="sfx"]'); click('[data-pref="sfx"]');
{ const v = doc.querySelector('[data-vol="sfx"]'); v.value = "40"; v.dispatchEvent(new window.Event("input")); if (doc.getElementById("vol-sfx").textContent !== "40%") throw new Error("volume label"); }
click('[data-theme-pick="light"]'); if (doc.documentElement.dataset.theme !== "light") throw new Error("theme switch");
click('[data-theme-pick="dark"]');
click("#btn-close");
click('[data-tab="market"]');
click('input[name="research"][value="competitors"]');
click('input[name="research"][value="forecast"]');
const tvTags = new Set();
let auctionSeen = false, summitSeen = false, votePopups = 0, sellTried = false;
for (let r = 1; r <= 8; r++) {
  click('[data-tab="boardroom"]');
  if (!/Secret mission/.test(doc.body.textContent)) throw new Error("mission missing");
  if (r === 1 || r === 2) {
    click('input[name="wildcard"][value="' + (r === 1 ? "spy" : "scandal") + '"]');
    if (doc.getElementById("wc-target-wrap").hidden) throw new Error("wildcard target should show");
  }
  if (doc.getElementById("f-bid")) { auctionSeen = true; const b = doc.getElementById("f-bid"); b.value = "200000"; b.dispatchEvent(new window.Event("input")); }
  if (doc.querySelector('input[name="vote"]')) {
    summitSeen = true;
    // The vote is required: submitting first opens the vote, then the decision sheet.
    if (!/Vote, then submit/.test(doc.getElementById("btn-submit").textContent)) throw new Error("submit should ask for the vote");
    if (!doc.querySelector('.mbtn[data-tab="boardroom"] .tag.req')) throw new Error("boardroom should be flagged");
    click("#btn-submit");
    if (!doc.querySelector("[data-vote]")) throw new Error("vote modal did not open");
    click('[data-vote="a"]');
    if (!doc.querySelector("#btn-confirm")) throw new Error("decision sheet should follow the vote");
    click("#btn-close");
  }
  if (r >= 3) {
    click('[data-tab="takeovers"]');
    const plus = doc.querySelector('[data-buy-step][data-dir="1"]:not([disabled])');
    if (plus) { plus.click(); plus.click(); }
  }
  if (r === 2) {
    click('[data-tab="market"]');
    if (!/Competitor spending/.test(doc.body.textContent) || !/Insider tip for round 3/.test(doc.body.textContent)) throw new Error("bought research missing");
    click('[data-tab="reports"]');
    for (const rt of ["income", "cash", "balance", "production", "costs"]) { click(`[data-report="${rt}"]`); if (!doc.querySelector(".card")) throw new Error("report " + rt); }
    click('[data-report="cash"]');
    if (!/Cash at end/.test(doc.body.textContent)) throw new Error("cash flow missing");
  }
  if (r === 2) {
    click('[data-tab="production"]');
    if (!/Planning data/.test(doc.body.textContent)) throw new Error("planning data missing");
    const q1 = doc.querySelector('input[name="quality"][value="1"]');
    if (!q1.disabled) throw new Error("quality should not go down after round 1");
    click('[data-tab="reports"]'); click('[data-report="groups"]');
    if (!/Sales by customer group/.test(doc.body.textContent)) throw new Error("sales by group report missing");
    click('[data-tab="market"]');
    if (!/Market history/.test(doc.body.textContent) || !/Rivals per round/.test(doc.body.textContent)) throw new Error("market history missing");
  }
  if (r === 5) {
    click('[data-tab="takeovers"]');
    const sell = doc.querySelector('[data-sell-step][data-dir="1"]');
    if (!sell) throw new Error("sell control missing after buying shares");
    sell.click();
    sellTried = true;
  }
  if (r === 3) {
    click('[data-tab="retail"]');
    click('[data-step="f-sopen"][data-dir="1"]');
    click('[data-step="f-sopen"][data-dir="1"]');
  }
  if (r === 4) {
    click('[data-tab="retail"]');
    if (!/Your stores: 2/.test(doc.body.textContent)) throw new Error("stores not opened");
    if (!/Sold in your stores/.test(doc.body.textContent)) throw new Error("store sales missing");
    click('[data-tab="market"]');
    if (!/Market outlook/.test(doc.body.textContent) || /Forecast/.test(doc.body.textContent)) throw new Error("market tab wrong");
    click('[data-tab="reports"]');
    if (!doc.querySelector(".tbl td[data-tip]")) throw new Error("reports table missing");
    click('[data-tab="news"]');
    if (doc.querySelectorAll(".feed .msg").length < 3) throw new Error("news feed too empty");
  }
  click("#btn-submit");
  if (!/Decision sheet/.test(doc.querySelector(".overlay").textContent)) throw new Error("decision sheet missing in round " + r);
  click("#btn-confirm"); if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  await wait(5);
  if (r === 1 && !/Spy report/.test(doc.body.textContent)) throw new Error("spy report missing");
  if (r === 5 && sellTried && !/Sold \d+ shares of/.test(doc.body.textContent)) throw new Error("share sale missing from results: " + doc.querySelector(".overlay").textContent.slice(0, 600));
  if (r < 8) {
    if (!doc.querySelector("#btn-continue")) throw new Error("no results after round " + r);
    if (!doc.querySelector(".overlay .dossier")) throw new Error("mission progress missing from results in round " + r);
    click("#btn-continue"); while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
    // Breaking news plays on the TV before the next round.
    while (doc.querySelector("#btn-tv-next")) { tvShown++; tvTags.add(doc.querySelector(".tv-tag").textContent); click("#btn-tv-next"); }
    if (doc.querySelector(".tv-tag")) tvTags.add(doc.querySelector(".tv-tag").textContent);
    if (doc.querySelector("#btn-tv-done")) { tvShown++; if (!doc.querySelector(".tv-head").textContent.trim()) throw new Error("TV headline empty"); click("#btn-tv-done"); }
    // Summit rounds open the vote straight after the broadcasts.
    if (doc.querySelector("[data-vote]")) { votePopups++; click("#btn-close"); }
  }
}
if (!/Final results/.test(doc.body.textContent)) throw new Error("final screen missing");
// Bankruptcy sale and monopoly, driven through the test hook on a fresh game.
{
  click("#btn-again"); click("#btn-start");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
  if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
  const D = window.__ftDebug, g = D.S.game;
  const bot = g.companies[1]; bot.cash = -50_000_000; bot.debt = 6_000_000;
  D.endRound(); if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  click("#btn-continue"); while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
  if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
  if (!/Bankruptcy sale/.test(doc.querySelector(".agenda").textContent)) throw new Error("bankruptcy sale not announced");
  click('[data-tab="boardroom"]');
  const bid = doc.querySelector('input[id^="f-bk-"]');
  if (!bid) throw new Error("bankruptcy bid control missing");
  bid.value = "500000"; bid.dispatchEvent(new window.Event("input"));
  click("#btn-submit"); if (doc.querySelector("[data-vote]")) click('[data-vote="a"]'); click("#btn-confirm"); if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  if (!/buys what's left of|trampoline/.test(doc.querySelector(".overlay").textContent + D.S.game.feed.map((f) => f.headline).join(" "))) throw new Error("bankruptcy sale not resolved");
  click("#btn-continue"); while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
  if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
  // A takeover by the player: the results show, the boardroom scene and renaming.
  {
    const S0 = D.S, t = S0.game.companies.find((c) => c.id !== "you" && !c.bankrupt && !c.controlledBy);
    S0.game.companies[0].takeoverCooldown = 0; if (S0.game.round < 3) S0.game.config.difficulty = "cutthroat";
    t.shares.holders = { you: 45 }; t.shares.treasury = 0; t.shares.float = 25; t.cash = 300_000; S0.game.companies[0].cash = 50_000_000;
    S0.draft.buyShares = { [t.id]: 10 }; S0.draft.takeoverStake = 2_000_000;
    D.endRound();
    if (!/the numbers are in/.test(doc.querySelector(".overlay").textContent)) throw new Error("results show missing");
    click("#btn-show-done");
    if (!/Your board seats/.test(doc.querySelector(".overlay").textContent)) throw new Error("board seat report missing");
    doc.querySelector("#btn-continue").click();
    if (!doc.querySelector("#board-cv")) throw new Error("boardroom scene missing: " + doc.querySelector(".overlay").textContent.replace(/\s+/g, " ").slice(0, 400) + " | round " + D.S.game.round + " " + JSON.stringify(D.S.game.companies.map((c) => [c.id, c.controlledBy, c.shares, c.bankrupt])));
    while (!doc.querySelector("#rename-input") && doc.querySelector("#btn-board-next")) click("#btn-board-next");
    if (!doc.querySelector("#rename-input")) throw new Error("rename option missing after your takeover");
    click("[data-rename]"); click("#btn-rename");
    if (!/It's now called/.test(doc.querySelector(".overlay").textContent)) throw new Error("rename failed");
    while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
    while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
    if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
    if (doc.querySelector("[data-vote]")) click('[data-vote="a"]');
  }
  // Monopoly: hand the player majority control of every company still alive.
  for (const c of D.S.game.companies) if (c.id !== "you" && !c.bankrupt) { c.controlledBy = "you"; c.shares.holders.you = 51; c.shares.float = 19; }
  D.endRound(); if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  if (!/MONOPOLY/.test(doc.querySelector(".overlay").textContent)) throw new Error("monopoly win not shown");
}
if (!doc.querySelector(".overlay .chart svg polyline")) throw new Error("value chart missing");
if (!/Mission:/.test(doc.querySelector(".overlay").textContent)) throw new Error("missions not revealed");
if (!auctionSeen || !summitSeen) throw new Error("auction or summit never appeared");
if (votePopups < 2) throw new Error("vote should pop up at the start of both summit rounds, got " + votePopups);
if (!tvTags.has("Auction") || !tvTags.has("Summit")) throw new Error("special broadcasts missing: " + [...tvTags].join(","));
click("#btn-again");
click('input[name="industry"][value="ai"]');
click('input[name="difficulty"][value="tycoon"]');
click('input[name="botSkill"][value="hard"]');
click('input[name="rounds"][value="6"]');
click("#btn-start");
if (!/AI/.test(doc.querySelector(".topbar .sub").textContent)) throw new Error("new AI game did not start");
if (!/ROUND 1 \/ 6/.test(doc.querySelector(".topbar .round").textContent)) throw new Error("rounds setting ignored");
while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
click('[data-tab="production"]');
if (!doc.getElementById("f-hire") || !/teams/.test(doc.getElementById("staff-note").textContent)) throw new Error("tycoon staff control missing");
click('[data-step="f-hire"][data-dir="1"]');
const t0 = Date.now();
click("#btn-submit");
click("#btn-confirm"); if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
await wait(5);
if (!doc.querySelector("#btn-continue")) throw new Error("hard tycoon round did not resolve");
console.log("Hard bots took " + (Date.now() - t0) + " ms for one round");
if (!window.__draws) throw new Error("canvas never drew");
if (tvShown < 3) throw new Error("expected TV broadcasts during the match, got " + tvShown);
if (errors.length) throw new Error("script errors: " + errors.join(" | "));
window.close();
console.log("TV broadcasts shown: " + tvShown + " (" + [...tvTags].join(", ") + ")");
console.log("game smoke test passed: all tabs, full 8-round match, new AI game, no script errors");
