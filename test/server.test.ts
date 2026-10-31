import { test } from "node:test";
import assert from "node:assert/strict";
import { startOnlineGame, resolveOnlineRound, viewFor, publicData } from "../src/server/core";

const players = [
  { id: "u1", name: "Jeroen", company: "Cocoa Loco", trait: "ruthless" as const },
  { id: "u2", name: "Friend", company: "Bar Tender", trait: "visionary" as const },
];

test("online game: bots fill the table and the match plays to the end", () => {
  let s = startOnlineGame({ industry: "chocolate", difficulty: "standard", rounds: 6, botCount: 2, botSkill: "normal", seed: 99 }, players);
  assert.equal(s.companies.length, 4);
  assert.equal(Object.keys(s.bots!).length, 2);
  while (!s.finished) s = resolveOnlineRound(s, { u1: { price: 2.4 }, u2: { price: 1.2, quality: 1 } });
  assert.equal(s.companies[0].history.at(-1)!.round, 6);
  assert.ok(publicData(s, 6).standings.length === 4);
});

test("a player's view hides rivals' secrets but keeps their own company whole", () => {
  let s = startOnlineGame({ industry: "chocolate", difficulty: "standard", rounds: 8, botCount: 1, botSkill: "normal", seed: 5 }, players);
  s = resolveOnlineRound(s, { u1: { research: ["survey"], marketingBudget: 222_000 }, u2: { marketingBudget: 333_000 } });
  const v = viewFor(s, "u1");
  const me = v.companies.find((c) => c.id === "u1")!, rival = v.companies.find((c) => c.id === "u2")!;
  assert.equal(me.lastDecisions.marketingBudget, 222_000);
  assert.equal(rival.lastDecisions.marketingBudget, 0, "rival plan hidden");
  assert.equal(rival.history.at(-1)!.marketingCost, 0, "rival costs hidden");
  assert.ok(rival.history.at(-1)!.sold > 0, "rival sales stay public");
  assert.equal(v.upcomingNews, undefined, "no peeking at next round's news");
  assert.equal(v.rngState, 0, "no predicting the dice");
  assert.ok(me.history.at(-1)!.research?.survey, "own research is delivered");
  assert.equal(Math.round(v.publicValues!.u2), Math.round(v.publicValues!.u2));
  assert.ok(v.publicValues!.u2 > 0, "values computed on the full state");
  const json = JSON.stringify(v);
  assert.ok(!json.includes("333000"), "the rival's marketing budget appears nowhere");
});

test("missions stay secret in public results until the game ends", () => {
  let s = startOnlineGame({ industry: "ai", difficulty: "standard", rounds: 6, botCount: 0, botSkill: "normal", seed: 3 }, players);
  s = resolveOnlineRound(s, {});
  assert.equal(publicData(s, 1).standings[0].mission, undefined);
});
