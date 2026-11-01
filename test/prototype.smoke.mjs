// Plays a full match in the game page inside jsdom and fails on any script error.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
const html = readFileSync("dist/friendly-takeover.html", "utf8");
const errors = [];
const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.__ftFast = true; w.__ftLiveBotMs = 1e9; // live bots only tick when the test asks (deterministic)
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
// Menu screens open (offline here: they explain instead of crashing).
for (const m of ["friends", "achievements", "daily", "leaderboard"]) {
  click(`[data-title="${m}"]`);
  if (!doc.querySelector(".overlay .win")) throw new Error(m + " screen missing");
  click("#btn-close");
}
click("#t-account"); if (!/Profile/.test(doc.querySelector(".overlay").textContent)) throw new Error("profile missing"); click("#btn-close");
if (doc.querySelectorAll(".overlay .achcard").length) throw new Error("modal should be closed");
click('[data-title="achievements"]');
if (doc.querySelectorAll(".achcard").length < 20) throw new Error("achievement cards missing");
click("#btn-close");
// Privacy, terms and credits from the title footer; the delete flow asks for confirmation first.
click('.title-foot [data-legal="privacy"]');
if (!/Privacy statement/.test(doc.querySelector(".overlay").textContent) || !/no ads, no tracking/.test(doc.querySelector(".overlay").textContent)) throw new Error("privacy page missing");
click('.overlay [data-legal="terms"]');
if (!/No real money/.test(doc.querySelector(".overlay").textContent)) throw new Error("terms page missing");
click('.overlay [data-legal="credits"]');
if (!/Open Font License/.test(doc.querySelector(".overlay").textContent)) throw new Error("credits page missing");
click('.overlay [data-legal="privacy"]'); click("#lg-delete");
if (!doc.getElementById("lg-confirm")) throw new Error("delete should ask to type DELETE");
click("#lg-delete-go");
if (!/Type DELETE/.test(doc.querySelector(".overlay").textContent)) throw new Error("delete without confirmation should be refused");
click("#btn-close");
if (doc.querySelector('link[href*="fonts.googleapis"]')) throw new Error("fonts should be self-hosted");
// The daily challenge is the same game for everyone: same seed, same rivals.
click('[data-title="daily"]'); click("#d-start");
const d1 = window.__ftDebug.S;
if (!d1.daily || d1.game.config.rounds !== 6 || d1.game.companies.length !== 5) throw new Error("daily setup wrong");
const rivals1 = d1.game.companies.map((c) => c.companyName).join();
click("#btn-menu");
click('[data-title="daily"]');
if (!doc.getElementById("d-continue")) throw new Error("daily should offer to continue the try in progress");
window.localStorage.removeItem("ft-daily");
click("#btn-close"); click('[data-title="daily"]'); click("#d-start");
if (window.__ftDebug.S.game.companies.map((c) => c.companyName).join() !== rivals1) throw new Error("daily should be identical each start");
click("#btn-menu"); window.localStorage.removeItem("ft-daily"); window.localStorage.removeItem("ft-save");
click("#t-new");
click("#btn-start");
if (!doc.querySelector("#btn-submit")) throw new Error("game screen did not render");
// First game shows How to play, then the news.
if (!/How to play/.test(doc.querySelector(".overlay")?.textContent || "")) throw new Error("help not shown on first launch");
click("#btn-close");
// The news TV sits inside its window (party-mode styles must not make it fill the screen).
if (doc.querySelector(".tv") && window.getComputedStyle(doc.querySelector(".tv")).position === "fixed") throw new Error("news TV took over the whole screen (party-mode CSS leaking)");
while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done");
// Then the secret mission briefing, once.
if (!/Your secret mission/.test(doc.querySelector(".overlay")?.textContent || "")) throw new Error("mission briefing missing at the start");
click("#btn-mission-ok");
if (doc.querySelector("#btn-mission-ok")) throw new Error("briefing should close");
if (!doc.querySelector(".agenda .mchip")) throw new Error("mission chip missing from the round strip");
await wait(450);
if (!doc.querySelector(".coach:not([hidden])") || !/step 1 of/.test(doc.querySelector(".coach").textContent)) throw new Error("first-round tutorial missing");
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
await wait(450);
if (!/step 2 of/.test(doc.querySelector(".coach").textContent)) throw new Error("tutorial should advance after opening Market: " + doc.querySelector(".coach").textContent);
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
// Talk & deals: message a bot and offer it a pact.
{
  const S0 = window.__ftDebug.S, bot = S0.game.companies.find((c) => c.id !== "you" && !String(S0.strat[c.id]).includes("raider"));
  click("#btn-chat");
  if (!doc.querySelector("#talkwin:not([hidden])")) throw new Error("chat did not open");
  click(`[data-thread="${bot.id}"]`);
  const inp = doc.getElementById("t-input"); inp.value = "Want to be friends?"; doc.getElementById("tsend").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  if (!/Want to be friends/.test(doc.getElementById("tlog").textContent)) throw new Error("chat message not shown");
  click("#t-newdeal"); click('[data-dkind="pact"]');
  doc.getElementById("d-penalty").value = "300k";
  click("#d-send");
  await wait(1000);
  const deal = S0.deals.find((d) => d.kind === "pact");
  if (!deal || deal.status !== "accepted") throw new Error("bot should accept a 300k pact: " + JSON.stringify(deal));
  if (!/Agreed/.test(doc.getElementById("tlog").textContent)) throw new Error("deal card missing");
  click("#talk-close");
  window.__pactBot = bot.id;
}
click('input[name="research"][value="competitors"]');
click('input[name="research"][value="forecast"]');
click('input[name="research"][value="marketStudy"]');
click('input[name="research"][value="buyerPanel"]');
// The desk: calculator with keyboard and click-to-paste, and notes.
click("#btn-calc");
if (!doc.querySelector("#calcwin:not([hidden]) .lcd")) throw new Error("calculator did not open");
for (const k of ["1", "2", "+", "3", "0", "="]) window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
if (doc.querySelector(".lcd-num").textContent !== "42") throw new Error("calculator maths: " + doc.querySelector(".lcd-num").textContent);
click('#calcwin [data-k="×"]'); click('#calcwin [data-k="2"]'); click('#calcwin [data-k="="]');
if (doc.querySelector(".lcd-num").textContent !== "84") throw new Error("calculator keys: " + doc.querySelector(".lcd-num").textContent);
// Huge results stay readable (no "e+19"), and 1 ÷ 3 doesn't spill out of the display.
for (const k of ["C", "C", ..."987654321987".split(""), "×", ..."99999999".split(""), "="]) click(`#calcwin [data-k="${k}"]`);
if (/e\+|NaN/.test(doc.querySelector(".lcd-num").textContent) || !doc.querySelector(".lcd-num sup")) throw new Error("big calculator result: " + doc.querySelector(".lcd-num").textContent);
for (const k of ["C", "C", "1", "÷", "3", "="]) click(`#calcwin [data-k="${k}"]`);
if (doc.querySelector(".lcd-num").textContent.replace(/[^0-9]/g, "").length > 12) throw new Error("1/3 too long: " + doc.querySelector(".lcd-num").textContent);
click('#calcwin [data-k="C"]'); click('#calcwin [data-k="C"]');
click('[data-tab="reports"]');
doc.querySelector(".tbl td.num[data-tip]").click();
if (!/pasted/.test(doc.querySelector(".lcd-top").textContent)) throw new Error("click-to-paste did not work");
click('#calcwin [data-ctab="notes"]');
{ const ta = doc.getElementById("notes-ta"); ta.value = "Premium is shrinking?"; ta.dispatchEvent(new window.Event("input", { bubbles: true })); }
click('#calcwin [data-ctab="calc"]'); click("#calc-close");
if (!doc.querySelector("#calcwin[hidden]")) throw new Error("calculator did not close");
// Investor call: promise numbers in Finance.
click('[data-tab="finance"]');
if (!/Investor call/.test(doc.body.textContent)) throw new Error("investor call missing");
click("#g-on");
{ const u = doc.getElementById("g-units"), p = doc.getElementById("g-profit"); u.value = "700k"; u.dispatchEvent(new window.Event("input")); p.value = "-50k"; p.dispatchEvent(new window.Event("input")); }
if (!window.__ftDebug.S.draft.guidance || window.__ftDebug.S.draft.guidance.units !== 700000 || window.__ftDebug.S.draft.guidance.profit !== -50000) throw new Error("guidance not parsed: " + JSON.stringify(window.__ftDebug.S.draft.guidance));
click('[data-tab="market"]');
const tvTags = new Set();
let auctionSeen = false, summitSeen = false, votePopups = 0, sellTried = false;
for (let r = 1; r <= 8; r++) {
  click('[data-tab="boardroom"]');
  if (!/Secret mission/.test(doc.body.textContent)) throw new Error("mission missing");
  if (r === 1 || r === 2) {
    click('input[name="wildcard"][value="' + (r === 1 ? "spy" : "scandal") + '"]');
    if (doc.getElementById("wc-target-wrap").hidden) throw new Error("wildcard target should show");
  }
  if (doc.querySelector("[data-bid]:not([disabled])")) {
    // Live auction: bid, and the lot shows us as the highest bidder.
    auctionSeen = true;
    doc.querySelector("[data-bid]:not([disabled])").click();
    const L = window.__ftDebug.S.game.live;
    if (!L || !Object.values(L.lots).some((l) => l.high && l.high.bidder === "you")) throw new Error("live bid not placed: " + [...doc.querySelectorAll("[data-lot-msg]")].map((x) => x.textContent).join(" | ") + " btn=" + doc.querySelector("[data-bid]").outerHTML.slice(0, 200) + " cash=" + window.__ftDebug.S.game.companies[0].cash + " live=" + String(JSON.stringify(L)).slice(0, 300) + " tab=" + window.__ftDebug.S.tab + " round=" + window.__ftDebug.S.game.round);
    // Bots join in: they raise the auction or trade on the exchange.
    for (let k = 0; k < 40; k++) window.__ftDebug.liveBotTick();
    const L2 = window.__ftDebug.S.game.live;
    if (!(Object.values(L2.lots).some((l) => l.high && l.high.bidder !== "you") || L2.trades.some((t) => t.trader !== "you"))) throw new Error("live bots did nothing");
    if (!doc.querySelector("#ticker")) throw new Error("ticker should show during a live auction");
  }
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
    if (/Planning data/.test(doc.body.textContent)) throw new Error("planning answers should be gone");
    if (!/Your factory/.test(doc.body.textContent) || !/Overtime above/.test(doc.body.textContent)) throw new Error("factory card missing");
    const q1 = doc.querySelector('input[name="quality"][value="1"]');
    if (!q1.disabled) throw new Error("quality should not go down after round 1");
    click('[data-tab="reports"]'); click('[data-report="groups"]');
    if (!/Sales by customer group/.test(doc.body.textContent)) throw new Error("sales by group report missing");
    click('[data-tab="market"]');
    if (!/Market history/.test(doc.body.textContent) || !/Rivals per round/.test(doc.body.textContent)) throw new Error("market history missing");
  }
  if (r >= 3) {
    // Live stock exchange: buy 5 of a rival right now; the price moves and the ticker shows it.
    click('[data-tab="takeovers"]');
    if (!doc.querySelector("#live-exchange")) throw new Error("stock exchange missing");
    // One price chart per rival on the exchange; cash and debt sit in the top bar.
    const rivals = window.__ftDebug.S.game.companies.filter((c) => c.id !== "you" && !c.bankrupt).length;
    if (doc.querySelectorAll("#live-exchange svg.stockchart").length !== rivals) throw new Error("exchange should show a chart per company");
    if (!doc.querySelector(".wallet #top-cash") || !/Debt/.test(doc.querySelector(".wallet").textContent)) throw new Error("cash and debt panel missing");
    const buy = doc.querySelector('[data-trade][data-qty="5"]:not([disabled])');
    if (buy) {
      const id = buy.dataset.trade, before = window.__ftDebug.S.game.companies.find((c) => c.id === id).shares.holders.you || 0;
      buy.click();
      const after = window.__ftDebug.S.game.companies.find((c) => c.id === id).shares.holders.you || 0;
      if (r === 3 && after !== before + 5 && !/Not enough cash|up to 50%|At most/.test(doc.getElementById("ex-msg").textContent)) throw new Error("live buy failed: " + doc.getElementById("ex-msg").textContent);
      if (after > before && !/bought 5% of/.test(doc.getElementById("ticker").textContent)) throw new Error("ticker should show the trade");
    }
  }
  if (r === 5) {
    const sell = doc.querySelector('[data-trade][data-qty="-1"]:not([disabled])');
    if (!sell) throw new Error("sell button missing after buying shares");
    const id = sell.dataset.trade, before = window.__ftDebug.S.game.companies.find((c) => c.id === id).shares.holders.you;
    sell.click();
    if (window.__ftDebug.S.game.companies.find((c) => c.id === id).shares.holders.you !== before - 1) throw new Error("live sell failed");
    sellTried = true;
  }
  if (r === 3) {
    // Production is never filled in for you: it stays at what you chose last round.
    const D3 = window.__ftDebug.S, me3 = D3.game.companies.find((c) => c.id === "you");
    if (D3.draft.production !== Math.min(me3.capacity, me3.lastDecisions.production)) throw new Error("production should carry over from last round: " + D3.draft.production + " vs " + me3.lastDecisions.production);
    click('[data-tab="retail"]');
    click('[data-step="f-sopen"][data-dir="1"]');
    click('[data-step="f-sopen"][data-dir="1"]');
  }
  if (r === 4) {
    click('[data-tab="retail"]');
    // (2 opened; the live auction can add 2 more when its lot is "2 stores")
    if (!(Number((doc.body.textContent.match(/Your stores: (\d+)/) || [])[1]) >= 2)) throw new Error("stores not opened: " + (doc.body.textContent.match(/Your stores[^.]{0,80}/) || [""])[0]);
    if (!/Sold in your stores/.test(doc.body.textContent)) throw new Error("store sales missing");
    click('[data-tab="market"]');
    if (!/Market report for round/.test(doc.body.textContent) || !/Material index/.test(doc.body.textContent) || /Market outlook/.test(doc.body.textContent)) throw new Error("market tab wrong");
    if (!/Your market studies/.test(doc.body.textContent) || !/Buyer panel/.test(doc.body.textContent)) throw new Error("bought market study / buyer panel missing");
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
  if (r === 1 && !/Investor call/.test(doc.querySelector(".overlay").textContent)) throw new Error("investor call result missing");
  if (r === 1 && window.__ftDebug.S.notes !== "Premium is shrinking?") throw new Error("notes not kept");
  if (r === 1) {
    const S1 = window.__ftDebug.S;
    if (!(S1.game.pacts || []).some((p) => [p.a, p.b].includes(window.__pactBot)) && !S1.game.feed.some((f) => f.headline.startsWith("Betrayal"))) throw new Error("pact not in the game state: " + JSON.stringify([S1.game.pacts, S1.game.feed.filter((f) => f.round === 1).map((f) => f.headline)]));
    if (S1.deals.find((d) => d.kind === "pact").status !== "done") throw new Error("pact deal should be done");
    const rb = doc.querySelector(".overlay [data-react]");
    if (!rb) throw new Error("emoji reactions missing on results");
    rb.click();
    if (!doc.querySelector(".floatemoji")) throw new Error("reaction did not float");
  }
  if (r === 5 && sellTried && !(window.__ftDebug.S.game.companies[0].history.at(-1).exchangeCash !== 0)) throw new Error("exchange cash missing from the report");
  if (r < 8) {
    if (!doc.querySelector("#btn-continue")) throw new Error("no results after round " + r);
    if (!doc.querySelector(".overlay .dossier") && !window.__ftDebug.S.game.companies[0].bankrupt) throw new Error("mission progress missing from results in round " + r + ": " + doc.querySelector(".overlay").textContent.replace(/\s+/g, " ").slice(0, 300));
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
if (!/Your story/.test(doc.body.textContent) || !doc.querySelector("#btn-recap")) throw new Error("recap missing");
await wait(50);
const earned = JSON.parse(window.localStorage.getItem("ft-ach") || "[]");
if (!earned.includes("first_game")) throw new Error("first_game achievement not earned: " + JSON.stringify(earned));
if (!(JSON.parse(window.localStorage.getItem("ft-stats") || "{}").games >= 1)) throw new Error("stats not recorded");
// CEO career: the game earned XP, shown on the final screen.
if (!(JSON.parse(window.localStorage.getItem("ft-stats") || "{}").xp >= 140)) throw new Error("XP not recorded");
if (!/\+\d+ XP/.test(doc.querySelector(".overlay").textContent) || !doc.querySelector(".xpcard .car-title")) throw new Error("XP card missing on the final screen");
click('[data-star="4"]');
if (doc.getElementById("fb-send").disabled) throw new Error("feedback send should enable after a rating");
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
  const lot = doc.querySelector('.livelot:not([data-lot="auction"])');
  if (!lot) throw new Error("live bankruptcy sale missing");
  const custom = lot.querySelector("[data-bid-custom]"); custom.value = "500k"; lot.querySelector("[data-bid-go]").click();
  if (!(D.S.game.live && D.S.game.live.lots[lot.dataset.lot] && D.S.game.live.lots[lot.dataset.lot].high.amount === 500000)) throw new Error("bankruptcy live bid not placed");
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
    // Keep the bots out of this one purchase so the takeover is certain.
    for (const o of S0.game.companies) if (o.id !== "you") o.takeoverCooldown = 3;
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
// House rules, a merger with a bot, product names and reviews, on a short Cutthroat game.
{
  click("#btn-again");
  click('input[name="difficulty"][value="cutthroat"]'); click('input[name="rounds"][value="6"]');
  click(`[data-srule="news"][data-val='"wild"']`);
  if (!/wild news/.test(doc.querySelector(".rules-box summary").textContent)) throw new Error("rules summary should update");
  click("#btn-start");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next");
  if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
  const D = window.__ftDebug;
  if (D.S.game.config.rules.news !== "wild") throw new Error("house rules not applied: " + JSON.stringify(D.S.game.config.rules));
  // Name the product; after the round it has a review in the News tab.
  click('[data-tab="marketing"]');
  const pn = doc.getElementById("f-pname"); pn.value = "Midnight Crunch"; pn.dispatchEvent(new window.Event("input", { bubbles: true }));
  click("#btn-submit"); if (doc.querySelector("[data-vote]")) click('[data-vote="a"]'); click("#btn-confirm");
  if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  if (doc.querySelector("#btn-continue")) click("#btn-continue"); while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next"); if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done");
  if (D.S.game.companies[0].productName !== "Midnight Crunch") throw new Error("product name not saved");
  click('[data-tab="news"]');
  if (!/What people say/.test(doc.body.textContent) || !/Midnight Crunch/.test(doc.querySelector(".reviews").textContent) || !doc.querySelector(".rv-stars")) throw new Error("reviews card missing");
  // Merge into a bot that runs the combined company: you become an investor.
  const bot = D.S.game.companies.find((c) => c.id !== "you" && !String(D.S.strat[c.id]).includes("raider"));
  bot.cash += 3_000_000; // a big partner, so the bot says yes to running it
  click("#btn-chat"); click(`[data-thread="${bot.id}"]`); click("#t-newdeal"); click('[data-dkind="merger"]'); click('[data-dlead="them"]');
  if (!/They run it/.test(doc.querySelector(".dealform").textContent) || !/Your part/.test(doc.querySelector(".dealform").textContent)) throw new Error("merger form missing");
  click("#d-send");
  await wait(1000);
  const md = D.S.deals.find((x) => x.kind === "merger");
  if (!md || md.status !== "accepted") throw new Error("bot should accept running a merger: " + JSON.stringify(md));
  click("#talk-close");
  click("#btn-submit"); if (doc.querySelector("[data-vote]")) click('[data-vote="a"]'); click("#btn-confirm");
  if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  if (doc.querySelector("#btn-continue")) click("#btn-continue"); while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next"); if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done");
  const meNow = D.S.game.companies.find((c) => c.id === "you");
  if (!meNow.merged || meNow.merged.into !== bot.id) throw new Error("merger did not happen: " + JSON.stringify(D.S.game.dealLog));
  click('[data-tab="production"]');
  if (!/You merged into/.test(doc.body.textContent)) throw new Error("investor panel missing after merging");
  // An investor can still play rounds.
  click("#btn-submit"); click("#btn-confirm");
  if (doc.querySelector("#btn-show-done")) click("#btn-show-done"); if (doc.querySelector("#btn-board-next") && !doc.querySelector("#btn-continue")) while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  if (!doc.querySelector("#btn-continue")) throw new Error("round as an investor did not resolve");
  click("#btn-continue"); while (doc.querySelector("#btn-board-next")) click("#btn-board-next");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next"); if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done");
  click("#btn-menu"); window.localStorage.removeItem("ft-save");
  // Takeovers off: the tab says so.
  click("#t-new"); click('[data-srule="takeovers"][data-val="false"]'); click("#btn-start");
  while (doc.querySelector("#btn-tv-next")) click("#btn-tv-next"); if (doc.querySelector("#btn-tv-done")) click("#btn-tv-done"); if (doc.querySelector("#btn-mission-ok")) click("#btn-mission-ok");
  click('[data-tab="takeovers"]');
  if (!/Takeovers are off/.test(doc.body.textContent)) throw new Error("takeovers-off house rule not shown");
  click("#btn-menu"); window.localStorage.removeItem("ft-save");
  click("#t-new"); click('[data-srule="takeovers"][data-val="true"]'); click(`[data-srule="news"][data-val='"normal"']`);
}
// Weed is 18+: the game asks once; "No" goes back to the menu, "Yes" is remembered.
click('input[name="industry"][value="weed"]'); click("#btn-start");
if (!doc.getElementById("age-yes")) throw new Error("weed game should ask for 18+");
click("#age-no");
if (!doc.querySelector(".title-screen")) throw new Error("saying no should return to the menu");
click("#t-continue");
if (!doc.getElementById("age-yes")) throw new Error("continuing a weed game should still ask");
click("#age-yes");
if (doc.getElementById("age-yes") || !doc.querySelector("#btn-submit")) throw new Error("18+ confirmation should open the game");
if (window.localStorage.getItem("ft-18") !== "1") throw new Error("18+ should be remembered");
click("#btn-menu"); window.localStorage.removeItem("ft-save");
click("#t-new");
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
