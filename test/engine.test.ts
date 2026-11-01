import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, resolveRound, standings, sanitizeDecisions, companyValues, sharePrices, renameCompany, experienceFactor, exchangeTrade, livePrice, liveBid, liveMinBid, liveLotOpen, INDUSTRIES, type GameState, type Decisions } from "../src/engine";
import { runMatch } from "../src/sim/simulate";

const players = [
  { id: "a", playerName: "Jeroen", companyName: "ChocoLoco", trait: "ruthless" as const },
  { id: "b", playerName: "Yezda", companyName: "Bar None", trait: "visionary" as const },
  { id: "c", playerName: "Jacob", companyName: "Cocoa Nuts", trait: "influencer" as const },
  { id: "d", playerName: "Belle", companyName: "Truffle Shuffle", trait: "pennyPincher" as const },
];

function newGame(seed = 42, difficulty: "standard" | "cutthroat" = "standard"): GameState {
  return createGame({ industry: "chocolate", difficulty, rounds: 8, seed }, players);
}

function shareTotal(state: GameState, id: string) {
  const s = state.companies.find((c) => c.id === id)!.shares;
  return s.founder + s.float + s.treasury + Object.values(s.holders).reduce((a, b) => a + b, 0);
}

test("same state and decisions always give the same result", () => {
  const g = newGame();
  const d = { a: { price: 1.5 }, b: { campaign: "viral" as const, marketingBudget: 300_000 } };
  assert.deepEqual(resolveRound(g, d), resolveRound(g, d));
});

test("resolveRound does not mutate its input", () => {
  const g = newGame();
  const before = JSON.stringify(g);
  resolveRound(g, { a: { price: 3 } });
  assert.equal(JSON.stringify(g), before);
});

test("a new game starts with an identical year 0 on record", () => {
  const g = newGame();
  assert.equal(g.round, 1);
  for (const c of g.companies) {
    assert.equal(c.history.length, 1);
    assert.equal(c.history[0].round, 0);
    assert.ok(c.history[0].sold > 0);
  }
  const sold = g.companies.map((c) => c.history[0].sold);
  assert.ok(Math.max(...sold) - Math.min(...sold) <= 1, "everyone starts equal");
});

test("empty decisions keep last round's plan and still resolve", () => {
  let g = newGame();
  g = resolveRound(g, {});
  assert.equal(g.round, 2);
  for (const c of g.companies) assert.equal(c.history.length, 2);
});

test("input is clamped to what the company can do", () => {
  const g = newGame();
  const c = g.companies[0];
  const ind = INDUSTRIES.chocolate;
  const d = sanitizeDecisions(g, c, { price: -5, quality: 9, marketingBudget: -100, loanChange: 1e12, buyShares: { a: 10, b: -3 } } as Partial<Decisions>);
  assert.equal(d.price, ind.priceRange[0]);
  assert.equal(d.quality, c.qualityCap);
  assert.equal(d.marketingBudget, 0);
  assert.ok(d.loanChange <= 6_000_000);
  assert.deepEqual(d.buyShares, {}); // cannot buy own shares, negative ignored
});

test("production never exceeds capacity and sales never exceed stock", () => {
  let g = newGame();
  g = resolveRound(g, { a: { production: 99_000_000, price: 0.3 } });
  const h = g.companies[0].history.at(-1)!;
  assert.ok(h.produced <= 900_000);
  assert.ok(h.sold <= h.produced + h.inventoryStart);
});

test("share purchases are blocked before the unlock round in Standard", () => {
  let g = newGame();
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  assert.equal(g.companies[1].shares.holders.a ?? 0, 0);
});

test("buying more than 50 shares gives control, then a cooldown", () => {
  let g = newGame(7, "cutthroat");
  // Cutthroat: unlocked from round 1, no cooldown, up to 20 shares a round.
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
  assert.equal(g.companies[1].shares.holders.a, 20, "capped at 20 a round");
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  assert.equal(g.companies[1].controlledBy, null);
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  assert.equal(g.companies[1].shares.holders.a, 60);
  assert.equal(g.companies[1].controlledBy, "a");
  assert.equal(shareTotal(g, "b"), 100);
  assert.ok(g.feed.some((f) => f.headline.includes("friendly takeover")));
});

test("Standard: takeover cooldown stops the buyer for two rounds", () => {
  let g = newGame(9);
  g.companies[0].cash = 80_000_000;
  for (let r = 1; r <= 2; r++) g = resolveRound(g, {});
  // Rounds 3-6: 15 shares each (the most per round) -> control only after round 6.
  for (let r = 3; r <= 5; r++) g = resolveRound(g, { a: { buyShares: { b: 25 } } });
  assert.equal(g.companies[1].shares.holders.a, 45, "capped at 15 a round");
  assert.equal(g.companies[1].controlledBy, null);
  g = resolveRound(g, { a: { buyShares: { b: 15 } } });
  assert.equal(g.companies[1].controlledBy, "a");
  const heldC = () => g.companies[2].shares.holders.a ?? 0;
  g = resolveRound(g, { a: { buyShares: { c: 10 } } });
  assert.equal(heldC(), 0, "blocked during cooldown");
});

test("buybacks protect a company from losing control", () => {
  let g = newGame(11, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g.companies[1].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 20 } }, b: { buyback: 35 } });
  for (let r = 0; r < 3; r++) g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  const b = g.companies[1];
  assert.equal(b.shares.treasury, 35);
  assert.ok((b.shares.holders.a ?? 0) <= 35);
  assert.equal(b.controlledBy, null);
  assert.equal(shareTotal(g, "b"), 100);
});

test("a company that cannot pay goes bankrupt and its player becomes a journalist", () => {
  let g = newGame(3);
  const c = g.companies[3];
  c.cash = -20_000_000;
  c.debt = 6_000_000;
  g = resolveRound(g, {});
  assert.equal(g.companies[3].bankrupt, true);
  assert.ok(g.feed.some((f) => f.headline.includes("press badge")));
  const before = g.companies[3].history.length;
  g = resolveRound(g, { d: { price: 2 } });
  assert.equal(g.companies[3].history.length, before, "bankrupt companies stop playing");
});

test("a full 8-round match finishes with sane numbers in every industry", () => {
  for (const industry of ["chocolate", "ai", "weed"] as const) {
    const res = runMatch(["budget", "mainstream", "premium", "hype", "raider"], 123, industry);
    assert.equal(res.state.finished, true);
    for (const c of res.state.companies) {
      for (const h of c.history) {
        for (const v of [h.revenue, h.profit, h.cashEnd, h.value]) assert.ok(Number.isFinite(v), `${industry} ${c.id} r${h.round}`);
        assert.ok(h.sold >= 0 && h.sold <= h.produced + 5_000_000);
      }
      assert.equal(shareTotal(res.state, c.id), 100);
    }
    const table = standings(res.state);
    assert.equal(table.length, 5);
    assert.ok(table[0].score >= table[4].score);
  }
});

test("bought research costs money and delivers the reports", () => {
  let g = newGame(5);
  g = resolveRound(g, { a: { research: ["competitors", "survey", "forecast", "bogus" as never] } });
  const h = g.companies[0].history.at(-1)!;
  assert.equal(h.researchCost, 140_000);
  assert.equal(h.research?.competitors?.length, 3);
  assert.ok(h.research?.competitors?.every((r) => r.companyId !== "a"));
  assert.equal(h.research?.survey?.length, 4);
  assert.equal(h.research?.forecast?.round, 3, "the tip is about the round after next");
  assert.ok(Array.isArray(h.research?.forecast?.news) && h.research!.forecast!.news.length >= 2, "at least the market report");
  assert.equal(g.companies[1].history.at(-1)!.research, undefined, "only buyers get research");
  assert.deepEqual(g.companies[0].lastDecisions.research, [], "research is not repeated automatically");
});

test("every euro is accounted for: the cash flow adds up each round", () => {
  for (const industry of ["chocolate", "ai"] as const) {
    const res = runMatch(["budget", "mainstream", "premium", "hype", "raider", "dumper"], 77, industry, "cutthroat");
    for (const c of res.state.companies) {
      for (const h of c.history) {
        const flow = h.cashStart + h.loanChange + h.revenue - h.productionCost - h.holdingCost - h.fixedCost - h.marketingCost - h.rndCost
          - h.brandCost - h.researchCost - h.interest - (h.idleCost ?? 0) - (h.materialOrderCost ?? 0) + (h.exchangeCash ?? 0) - h.capacityInvest - h.storeOpenCost - h.storeUpkeep - h.sharePurchases - h.buybackCost - h.dividendsPaid + h.dividendsReceived
          + h.emergencyLoan - h.emergencyFee + (h.dealCash ?? 0) - h.wildcardCost - h.legalCost - h.staffCost - h.auctionPaid - h.showdownPaid + h.shareSales;
        assert.ok(Math.abs(flow - h.cashEnd) < 0.01, `${industry} ${c.id} round ${h.round}: ${flow} vs ${h.cashEnd}`);
      }
    }
  }
});

test("retail unlocks in round 3: stores cost money, sell from the same stock, and are capped", () => {
  let g = newGame(21);
  g = resolveRound(g, { a: { storesOpen: 3 } });
  assert.equal(g.companies[0].stores, 0, "locked in round 1");
  g = resolveRound(g, {});
  g = resolveRound(g, { a: { storesOpen: 99, retailPrice: 3.0 } });
  const a = g.companies[0], h = a.history.at(-1)!;
  assert.equal(a.stores, 4, "max 4 openings per round");
  assert.equal(h.storeOpenCost, 4 * 150_000);
  assert.equal(h.storeUpkeep, 4 * 35_000);
  assert.ok(h.retailSold > 0 && h.retailSold <= 4 * 30_000);
  assert.equal(h.sold, h.wholesaleSold + h.retailSold);
  assert.ok(Math.abs(h.revenue - (h.wholesaleSold * h.price + h.retailSold * 3.0)) < 0.01);
  g = resolveRound(g, { a: { storesClose: 2 } });
  assert.equal(g.companies[0].stores, 2);
});

test("wildcards cost money, are limited to two uses, and hit their target", () => {
  let g = newGame(31);
  const brandB = g.companies[1].brand;
  g = resolveRound(g, { a: { wildcard: { card: "scandal", target: "b" } } });
  assert.equal(g.companies[0].history.at(-1)!.wildcardCost, 100_000);
  assert.ok(g.companies[1].brand < brandB, "scandal lowers the target's brand");
  g = resolveRound(g, { a: { wildcard: { card: "scandal", target: "b" } } });
  g = resolveRound(g, { a: { wildcard: { card: "scandal", target: "b" } } });
  assert.equal(g.companies[0].history.at(-1)!.wildcardCost, 0, "third use is refused");
  g = resolveRound(g, { a: { wildcard: { card: "spy", target: "c" } }, c: { price: 2.77 } });
  assert.equal(g.companies[0].history.at(-1)!.research?.spy?.decisions.price, 2.77);
  g = resolveRound(g, { a: { wildcard: { card: "lawsuit", target: "a" } } });
  assert.equal(g.companies[0].history.at(-1)!.wildcardCost, 0, "cannot target yourself");
});

test("a sealed defense fund can stop a takeover in a boardroom showdown", () => {
  let g = newGame(7, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g.companies[1].cash = 5_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = resolveRound(g, { a: { buyShares: { b: 20 }, takeoverStake: 200_000 }, b: { defenseStake: 400_000 } });
  const b = g.companies[1];
  assert.equal(b.controlledBy, null);
  assert.equal(b.shares.holders.a, 50, "defender's win caps the attacker at 50%");
  assert.equal(b.history.at(-1)!.showdownPaid, 400_000);
  assert.equal(g.companies[0].history.at(-1)!.showdownPaid, 200_000);
  assert.equal(shareTotal(g, "b"), 100);
  // A bigger stake wins next time.
  g = resolveRound(g, { a: { buyShares: { b: 5 }, takeoverStake: 900_000 } });
  assert.equal(g.companies[1].controlledBy, "a");
});

test("auctions and summits happen in their rounds and pay out", () => {
  let g = newGame(13);
  while (g.round < 3) g = resolveRound(g, {});
  assert.ok(g.auction && g.auction.round === 3);
  const item = g.auction!.item;
  const before = { ...g.companies[2] };
  g = resolveRound(g, { a: { auctionBid: 100_000 }, c: { auctionBid: 300_000 } });
  const c = g.companies[2];
  assert.equal(c.history.at(-1)!.auctionPaid, 300_000);
  assert.equal(g.companies[0].history.at(-1)!.auctionPaid, 0, "losers pay nothing");
  if (item === "endorsement") assert.ok(c.brand > before.brand);
  if (item === "patent") assert.equal(c.qualityCap, before.qualityCap + 1);
  assert.ok(g.summit && g.summit.round === 4);
  const [optA] = g.summit!.options;
  g = resolveRound(g, { a: { vote: "a" }, b: { vote: "a" }, c: { vote: "b" } });
  assert.ok(g.news.some((n) => n.event.id === "reg-" + optA));
});

test("secret missions are assigned and pay a bonus when completed", () => {
  const res = runMatch(["budget", "mainstream", "premium", "hype"], 99, "chocolate");
  const table = standings(res.state);
  for (const r of table) {
    assert.ok(r.mission);
    assert.equal(r.missionBonus, r.missionDone ? 600_000 : 0);
  }
});

test("Tycoon: production is limited by staff, and wages are paid", () => {
  let g = createGame({ industry: "chocolate", difficulty: "tycoon", rounds: 8, seed: 5 }, players);
  const a = g.companies[0];
  assert.equal(a.workers, 15);
  g = resolveRound(g, { a: { production: 900_000, hire: -5 } });
  const h = g.companies[0].history.at(-1)!;
  assert.equal(h.workers, 10);
  assert.ok(h.produced <= 10 * 50_000);
  assert.ok(h.staffCost > 10 * 7_500, "wages plus severance");
});

test("bankrupt players become journalists who can hurt a rival", () => {
  let g = newGame(3);
  g.companies[3].cash = -20_000_000;
  g.companies[3].debt = 6_000_000;
  g = resolveRound(g, {});
  const brand = g.companies[0].brand;
  g = resolveRound(g, { d: { journalistTarget: "a" } });
  assert.ok(g.companies[0].brand < brand + 1);
  assert.ok(g.feed.some((f) => f.headline.includes("Exclusive by reporter")));
});

test("quality can't go down after round 1", () => {
  let g = newGame(17);
  g = resolveRound(g, { a: { quality: 2 } });
  assert.equal(g.companies[0].history.at(-1)!.quality, 2, "round 1 picks the positioning freely");
  g = resolveRound(g, { a: { quality: 1 } });
  assert.equal(g.companies[0].history.at(-1)!.quality, 2, "no downgrade later");
  g = resolveRound(g, { a: { quality: 3 } });
  assert.equal(g.companies[0].history.at(-1)!.quality, 3, "upgrades are fine");
});

test("dumping shares pays out at a discount, hurts the target's value and fades", () => {
  let g = newGame(23, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = resolveRound(g, { a: { buyShares: { b: 15 } } });
  g = resolveRound(g, { b: { buyback: 0 } });
  const before = companyValues(g).b;
  const priceBefore = sharePrices(g).b;
  g = resolveRound(g, { a: { sellShares: { b: 35, c: 5 } } });
  const a = g.companies[0], h = a.history.at(-1)!;
  assert.equal(g.companies[1].shares.holders.a ?? 0, 0);
  assert.equal(g.companies[1].shares.float, 70);
  assert.ok(Math.abs(g.companies[1].sentiment - 0.105) < 1e-9, "35 shares x 0.3% = 10.5% panic");
  assert.ok(h.shareSales > 0 && h.shareSales < 35 * priceBefore * 0.95 * 0.9 * 1.2);
  assert.ok(g.feed.some((f) => f.headline.includes("dumps 35 shares")));
  assert.ok(companyValues(g).b < before, "target worth less after the dump");
  assert.equal(shareTotal(g, "b"), 100);
  g = resolveRound(g, {});
  assert.ok(g.companies[1].sentiment < 0.06, "panic fades");
});

test("share trades show up in the round report", () => {
  let g = newGame(29, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 10 } } });
  assert.ok(g.companies[0].history.at(-1)!.events.some((e) => e.startsWith("Bought 10 shares")));
  g = resolveRound(g, { a: { sellShares: { b: 10 } } });
  assert.ok(g.companies[0].history.at(-1)!.events.some((e) => e.startsWith("Sold 10 shares")));
});

test("an insider tip's news really breaks the round after", () => {
  for (let seed = 1; seed < 40; seed++) {
    let g = newGame(seed);
    g = resolveRound(g, { a: { research: ["forecast"] } });
    const tip = g.companies[0].history.at(-1)!.research!.forecast!;
    g = resolveRound(g, {});
    const fresh = g.news.filter((n) => n.roundsLeft === n.event.duration).map((n) => n.event.headline);
    for (const t of tip.news) assert.ok(fresh.some((f) => t.headline.startsWith(f)), `seed ${seed}: ${t.headline}`);
  }
});

test("news nudges the market instead of swinging it", () => {
  for (const ind of Object.values(INDUSTRIES)) for (const n of ind.news) {
    const e = n.effect;
    for (const v of [e.costMultiplier, e.demandMultiplier, e.capacityMultiplier, ...Object.values(e.segmentMultiplier ?? {})]) if (v !== undefined) assert.ok(Math.abs(v - 1) <= 0.3, `${n.id} ${v}`);
  }
  let g = newGame(4);
  for (let r = 0; r < 4; r++) {
    const eco = g.news.filter((n) => n.event.kind === "economy" && n.roundsLeft === 1);
    assert.ok(eco.length >= 2 && eco.length <= 3, "two or three market-report items every round");
    g = resolveRound(g, {});
  }
});

test("the rounds setting decides how long a game lasts", () => {
  for (const rounds of [6, 12]) {
    let g = createGame({ industry: "chocolate", difficulty: "standard", rounds, seed: 3 }, players);
    while (!g.finished) g = resolveRound(g, {});
    assert.equal(g.companies[0].history.at(-1)!.round, rounds);
  }
});

test("owning a majority of every other company ends the game: monopoly win", () => {
  let g = newGame(41, "cutthroat");
  g.companies[0].cash = 500_000_000;
  for (const c of g.companies.slice(1)) c.cash = 0;
  for (let r = 0; r < 3 && !g.finished; r++) g = resolveRound(g, { a: { buyShares: { b: 20, c: 20, d: 20 } } });
  assert.ok(g.finished, "game ends early");
  assert.equal(g.monopolyBy, "a");
  const t = standings(g);
  assert.equal(t[0].companyId, "a");
  assert.equal(t[0].monopoly, true);
  assert.ok(g.feed.some((f) => f.headline.startsWith("MONOPOLY")));
});

test("a bankrupt company's factory and stores are auctioned to the highest bidder", () => {
  let g = newGame(3);
  g.companies[3].cash = -20_000_000;
  g.companies[3].debt = 6_000_000;
  const deadCap = g.companies[3].capacity;
  g = resolveRound(g, {});
  assert.ok(g.bankruptcySales?.some((l) => l.companyId === "d" && l.round === 2));
  const capA = g.companies[0].capacity, capB = g.companies[1].capacity;
  g = resolveRound(g, { a: { bankruptBids: { d: 300_000 } }, b: { bankruptBids: { d: 200_000 } } });
  const a = g.companies[0];
  assert.equal(a.history.at(-1)!.auctionPaid, 300_000);
  assert.ok(a.capacity > capA * 0.97 + deadCap * 0.7, "winner gets most of the factory");
  assert.ok(g.companies[1].capacity < capB, "loser pays nothing and gets nothing");
  assert.equal(g.companies[3].capacity, 0);
  assert.ok(g.feed.some((f) => f.headline.includes("buys what's left of")));
});

test("the round report explains when you get fewer shares than you asked for", () => {
  let g = newGame(53, "cutthroat");
  g.companies[0].cash = 200_000;
  g = resolveRound(g, { a: { buyShares: { b: 35 }, production: 0, marketingBudget: 0 } });
  const ev = g.companies[0].history.at(-1)!.events.join(" | ");
  assert.match(ev, /Wanted 35 shares of .*got \d+: not enough cash left|Couldn't buy shares of .*not enough cash left/);
});

test("a board seat (25%+) delivers the company's round report", () => {
  let g = newGame(61, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = resolveRound(g, { a: { buyShares: { b: 5 } } });
  const seats = g.companies[0].history.at(-1)!.research?.boardSeats;
  assert.equal(seats?.length, 1);
  assert.equal(seats![0].companyId, "b");
  assert.equal(seats![0].report.profit, g.companies[1].history.at(-1)!.profit);
});

test("special rounds: Black Friday and Investor Day are scheduled, announced and applied", () => {
  let g = newGame(8);
  const ev = g.specialEvents!;
  assert.equal(ev.length, 2);
  assert.notEqual(ev[0].round, ev[1].round);
  const bf = ev.find((e) => e.id === "blackFriday")!;
  while (g.round < bf.round) g = resolveRound(g, {});
  assert.ok(g.feed.some((f) => f.headline.startsWith("Coming next round: Black Friday")));
  assert.ok(g.news.some((n) => n.event.id === "event-blackFriday"));
});

test("only the controller can rename a company", () => {
  let g = newGame(7, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  assert.equal(renameCompany(g, "a", "b", "Nope"), g, "no control yet");
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = renameCompany(g, "a", "b", "ChocoLoco's Little Helper");
  assert.equal(g.companies[1].companyName, "ChocoLoco's Little Helper");
  assert.equal(g.companies[1].originalName, "Bar None");
});

test("experience curve: the more you have made, the cheaper each unit", () => {
  const ind = INDUSTRIES.chocolate;
  assert.ok(experienceFactor(ind, 0) === 1);
  const a = experienceFactor(ind, 1_440_000), b = experienceFactor(ind, 4_320_000);
  assert.ok(Math.abs(a - 0.92) < 1e-9, "one doubling = 8% cheaper");
  assert.ok(b < a && b >= 0.75);
  let g = newGame(5);
  const before = g.companies[0].history.at(-1)!.unitCostBase!;
  for (let r = 0; r < 3; r++) g = resolveRound(g, { a: { production: 850_000, price: 1.8 } });
  assert.ok(g.companies[0].history.at(-1)!.experienceFactor! < g.companies[1].history.at(-1)!.experienceFactor! + 1e-9);
  assert.ok(g.companies[0].history.at(-1)!.experienceFactor! < 0.95 && before > 0);
});

test("factory load: overtime above 90% of capacity, idle cost below 60%", () => {
  let g = newGame(6);
  const cap = g.companies[0].capacity;
  g = resolveRound(g, { a: { production: cap }, b: { production: Math.round(cap * 0.4) } });
  const a = g.companies[0].history.at(-1)!, b = g.companies[1].history.at(-1)!;
  assert.equal(a.overtimeUnits, cap - Math.floor(cap * 0.9));
  assert.ok(Math.abs(a.overtimeCost! - a.overtimeUnits! * a.unitCostBase! * 0.25) < 1e-6);
  // Production cash = process + spot materials + overtime; stock materials were paid when ordered.
  assert.ok(a.productionCost > a.overtimeCost! && a.productionCost < a.produced * a.unitCostBase! + a.overtimeCost! + 1e-6);
  assert.equal(b.idleUnits, Math.floor(cap * 0.6) - Math.round(cap * 0.4));
  assert.ok(b.idleCost! > 0 && a.idleCost === 0 && b.overtimeUnits === 0);
});

test("raw material index moves within its range and is logged; trends and price sensitivity are drawn per game", () => {
  let g = newGame(7);
  const seen = new Set<number>();
  for (let r = 0; r < 7; r++) { g = resolveRound(g, {}); seen.add(g.market!.materialIndex); }
  assert.ok(seen.size > 3, "index moves");
  for (const v of seen) assert.ok(v >= 0.8 && v <= 1.3);
  assert.ok(g.marketLog!.every((m) => typeof m.materialIndex === "number"));
  const t = Object.values(g.market!.trend!);
  assert.ok(t.some((x) => x >= 0.015) && t.some((x) => x <= -0.015), "one group grows, one shrinks");
  assert.ok(Object.values(g.market!.sensitivity!).every((x) => x >= 0.85 && x <= 1.15));
  assert.deepEqual(newGame(7).market, createGame({ industry: "chocolate", difficulty: "standard", rounds: 8, seed: 7 }, players).market, "reproducible");
});

test("investor call: a spot-on forecast builds trust, a wild one costs it; trust lifts value and cuts interest", () => {
  let g = newGame(8);
  // Play one round to learn what this plan sells, then promise exactly that.
  const plan = { production: 700_000, price: 2.2, marketingBudget: 150_000 };
  const probe = resolveRound(g, { a: plan });
  const p = probe.companies[0].history.at(-1)!;
  g = resolveRound(g, { a: { ...plan, guidance: { units: p.sold, profit: p.profit } }, b: { guidance: { units: 10, profit: 99_000_000 } } });
  const a = g.companies[0], b = g.companies[1];
  assert.equal(a.history.at(-1)!.guidance!.result, "hit");
  assert.equal(a.credibility, 1);
  assert.equal(b.history.at(-1)!.guidance!.result, "miss");
  assert.equal(b.credibility, -1);
  assert.equal(g.companies[2].history.at(-1)!.guidance, undefined, "no guidance, no change");
  assert.equal(g.companies[2].credibility, 0);
  assert.equal(a.lastDecisions.guidance, null, "guidance is given fresh each round");
  // Same company, more trust: higher value.
  const v0 = companyValues(g)[a.id];
  const trusted = structuredClone(g); trusted.companies[0].credibility = 3;
  assert.ok(companyValues(trusted)[a.id] > v0 * 1.05);
});

test("market study and buyer panel research deliver their data", () => {
  let g = newGame(9);
  g = resolveRound(g, { a: { research: ["marketStudy", "buyerPanel"] } });
  const r = g.companies[0].history.at(-1)!;
  assert.equal(r.researchCost, 75_000);
  assert.ok(r.research!.marketStudy!.next!.round === 2 && r.research!.marketStudy!.potential.budget > 0);
  assert.deepEqual(r.research!.buyerPanel, g.market!.sensitivity);
  assert.equal(g.companies[1].history.at(-1)!.research, undefined);
});

test("deals: share sales, loans with repayment, pacts and their penalty", () => {
  let g = newGame(12, "cutthroat");
  g = resolveRound(g, {});
  g = resolveRound(g, {});
  const r = g.round;
  // b sells 20 of its own founder shares to a; a lends c 300k (330k back next round); a and d sign a pact.
  g = resolveRound(g, {}, [
    { id: "1", from: "b", to: "a", kind: "shares", terms: { company: "b", qty: 20, price: 500_000, direction: "sell" } },
    { id: "2", from: "a", to: "c", kind: "loan", terms: { amount: 300_000, repay: 330_000, rounds: 1, direction: "lend" } },
    { id: "3", from: "a", to: "d", kind: "pact", terms: { rounds: 2, penalty: 250_000 } },
    { id: "4", from: "c", to: "a", kind: "shares", terms: { company: "d", qty: 10, price: 1, direction: "sell" } },
  ]);
  const by = (id: string) => g.companies.find((c) => c.id === id)!;
  assert.deepEqual(g.dealLog!.map((x) => x.ok), [true, true, true, false], JSON.stringify(g.dealLog));
  assert.equal(by("b").shares.holders.a, 20);
  assert.equal(by("b").shares.founder, 10);
  assert.equal(by("a").history.at(-1)!.dealCash, -500_000 - 300_000);
  assert.equal(by("b").history.at(-1)!.dealCash, 500_000);
  assert.equal(g.playerLoans!.length, 1);
  assert.ok(g.pacts!.some((p) => p.until === r + 1));
  // Next round: the loan is repaid, and d breaks the pact by buying a's shares.
  const aCash = by("a").cash;
  g = resolveRound(g, { d: { buyShares: { a: 5 } } });
  assert.equal(g.playerLoans!.length, 0);
  assert.equal(by("c").history.at(-1)!.dealCash, -330_000);
  assert.ok(by("a").history.at(-1)!.dealCash! >= 330_000 + 250_000 - 1, "repayment + pact penalty");
  assert.ok(g.feed.some((f) => f.headline.startsWith("Betrayal!")));
  assert.equal(g.pacts!.length, 0);
  assert.ok(aCash > 0);
});

test("loans between players count in company value", () => {
  let g = newGame(13);
  g = resolveRound(g, {});
  const before = companyValues(g);
  g.playerLoans = [{ lender: "a", borrower: "b", repay: 400_000, due: 5 }];
  const after = companyValues(g);
  assert.ok(after.a - before.a > 380_000 && before.b - after.b > 380_000);
});


test("materials are bought a round ahead: stock is used first, shortfalls cost the spot price plus a premium", () => {
  let g = newGame(14);
  const a0 = g.companies[0];
  assert.ok(a0.materials! > 0, "round 1 starts with materials ordered in year 0");
  // a orders nothing for round 2 and produces a lot; b orders plenty.
  g = resolveRound(g, { a: { materialOrder: 0, production: 700_000 }, b: { materialOrder: 2_000_000, production: 700_000 } });
  const a1 = g.companies[0].history.at(-1)!, b1 = g.companies[1].history.at(-1)!;
  assert.equal(a1.materialOrderCost, 0);
  assert.ok(b1.materialOrderCost! > 0 && g.companies[1].materials! > g.companies[0].materials!);
  g = resolveRound(g, { a: { production: 700_000 }, b: { production: 700_000 } });
  const a2 = g.companies[0].history.at(-1)!, b2 = g.companies[1].history.at(-1)!;
  assert.ok(a2.materialSpot! > 0 && a2.materialSpotCost! > 0, "a had to buy on the spot market");
  assert.equal(b2.materialSpot, 0, "b had enough in stock");
  assert.ok(a2.unitCostBase! > b2.unitCostBase! * 0.98 || g.market!.materialIndex < 0.85, "spot buying costs more");
  assert.ok(["up", "down", "flat"].includes(g.market!.materialOutlook!));
  assert.ok(g.feed.some((f) => /outlook/.test(f.headline)));
});

test("bulk buyer takes leftover stock at the bulk price", () => {
  let g = newGame(15);
  const price = g.market!.bulkPrice!;
  assert.ok(price > 0 && price < 2.2);
  g = resolveRound(g, { a: { production: 850_000, price: 3.9, bulkSell: 999_999 } });
  const r = g.companies[0].history.at(-1)!;
  assert.ok(r.bulkSold! > 0 && r.bulkSold! <= Math.round(g.companies[0].capacity * 0.5) + 30_000);
  assert.ok(Math.abs(r.bulkRevenue! - r.bulkSold! * price) < 1e-6);
  assert.equal(r.inventoryEnd, r.inventoryStart + r.produced - r.sold - r.bulkSold!);
});

test("live exchange: prices move with every trade, holdings change at once, 50% needs a takeover bid", () => {
  let g = newGame(16, "cutthroat");
  g = resolveRound(g, {});
  const p0 = livePrice(g, "b");
  let r = exchangeTrade(g, "a", "b", 10, 1000);
  g = r.state;
  assert.equal(g.companies[1].shares.holders.a, 10);
  assert.ok(livePrice(g, "b") > p0 * 1.04, "price rose");
  assert.ok(r.trade.cash < -p0 * 10, "paid more than the starting price (impact + fee)");
  assert.throws(() => exchangeTrade(g, "a", "b", 45, 1001), /up to 50%/);
  r = exchangeTrade(g, "a", "b", -4, 1002); g = r.state;
  assert.equal(g.companies[1].shares.holders.a, 6);
  // c dumps nothing, d buys; the round then resolves and the cash flow adds up.
  g = exchangeTrade(g, "d", "c", 5, 1003).state;
  // One limit per round for exchange and takeover bids together (20 in Cutthroat); selling doesn't free up room.
  g = exchangeTrade(g, "a", "b", 10, 1004).state;
  assert.throws(() => exchangeTrade(g, "a", "b", 1, 1005), /at most 20 shares/);
  const heldBefore = g.companies[1].shares.holders.a!;
  const g2 = resolveRound(g, { a: { buyShares: { b: 10 } } });
  assert.equal(g2.companies[1].shares.holders.a, heldBefore, "no takeover-bid room left this round");
  assert.ok(g2.companies[0].history.at(-1)!.events.some((e) => /already bought 20 on the exchange/.test(e)));
  const before = g.companies.map((c) => c.cash);
  g = resolveRound(g, {});
  const ra = g.companies[0].history.at(-1)!;
  assert.ok(ra.exchangeCash! < 0);
  assert.equal(g.live, undefined, "live state is cleared after the round");
  assert.ok(before.length === 4);
});

test("live auction: the highest live bid wins and pays; the lot closes after the going-once timer", () => {
  let g = newGame(17);
  while (!(g.auction && g.auction.round === g.round)) g = resolveRound(g, {});
  const min = liveMinBid(g, "auction");
  g = liveBid(g, "a", "auction", min, 5000);
  assert.throws(() => liveBid(g, "b", "auction", min, 5001), /at least/);
  g = liveBid(g, "b", "auction", liveMinBid(g, "auction"), 5002);
  assert.equal(g.live!.lots.auction.high!.bidder, "b");
  assert.ok(!liveLotOpen(g, "auction", 5002 + 46_000), "closed after the timer");
  assert.throws(() => liveBid(g, "a", "auction", 9_000_000, 5002 + 46_000), /closed/);
  const cash = g.companies[1].cash;
  g = resolveRound(g, {});
  assert.ok(g.feed.some((f) => f.headline.startsWith(g.companies[1].companyName + " wins")), "b wins");
  assert.ok(g.companies[1].history.at(-1)!.auctionPaid > 0 && cash > 0);
});

// ---------------------------------------------------------------- house rules, mergers, hostile bids, reviews
test("house rules: start cash, no takeovers, no wildcards, calm or wild news", () => {
  const rich = createGame({ industry: "chocolate", difficulty: "cutthroat", rounds: 6, seed: 3, rules: { startCash: 2_000_000 } }, players);
  const normal = createGame({ industry: "chocolate", difficulty: "cutthroat", rounds: 6, seed: 3 }, players);
  assert.ok(rich.companies[0].cash > normal.companies[0].cash + 900_000, "more starting cash");
  let g = createGame({ industry: "chocolate", difficulty: "cutthroat", rounds: 6, seed: 3, rules: { takeovers: false, wildcards: false } }, players);
  g.companies[0].cash = 50_000_000;
  assert.throws(() => exchangeTrade(g, "a", "b", 5, 1), /off in this game/);
  const cashBefore = g.companies[0].cash;
  g = resolveRound(g, { a: { buyShares: { b: 20 }, wildcard: { card: "lawsuit", target: "b" } } }, [{ id: "1", from: "a", to: "b", kind: "merger", terms: { survivor: "a" } }]);
  assert.equal(g.companies[1].shares.holders.a ?? 0, 0, "no share buying");
  assert.equal(g.companies[0].wildcardsUsed.lawsuit ?? 0, 0, "no wildcards");
  assert.ok(!g.companies[1].merged && g.dealLog![0].ok === false, "no mergers");
  assert.ok(g.companies[0].cash > cashBefore - 2_000_000);
  // Wild news: a story every round and more market-report items than calm.
  const count = (news: "calm" | "wild") => { let s = createGame({ industry: "chocolate", difficulty: "standard", rounds: 8, seed: 11, rules: { news } }, players); let k = 0; for (let r = 0; r < 5; r++) { k += s.news.length; s = resolveRound(s, {}); } return k; };
  assert.ok(count("wild") > count("calm") + 5, "wild news is busier than calm");
});

test("friendly merger: one company runs on, shares split by value, the other becomes a holding company", () => {
  let g = newGame(21, "cutthroat");
  g = resolveRound(g, {});
  const v0 = companyValues(g);
  const capA = g.companies[0].capacity, capB = g.companies[1].capacity;
  g = resolveRound(g, {}, [{ id: "m1", from: "b", to: "a", kind: "merger", terms: { survivor: "a" } }]);
  const a = g.companies[0], b = g.companies[1];
  assert.equal(g.dealLog![0].ok, true, g.dealLog![0].reason);
  assert.ok(b.merged && b.merged.into === "a");
  assert.ok(a.capacity > capA * 1.5 && b.capacity === 0, "factories combined");
  assert.equal(shareTotal(g, "a"), 100);
  const bStake = a.shares.holders.b ?? 0;
  assert.ok(bStake >= 10 && bStake <= 20, "b holds its value share of the founder stake: " + bStake);
  assert.ok(a.shares.founder >= 10 && a.shares.founder <= 20);
  assert.equal(b.history.length, g.companies[2].history.length - 1, "the merged company didn't play this round");
  assert.ok(g.feed.some((f) => f.headline.startsWith("MERGER!")));
  // The holding company is worth its stake in the combined company.
  const v = companyValues(g);
  assert.ok(Math.abs(v.b - (bStake / 100) * (v.a - 0)) < v.a * 0.2, "holding value follows the stake");
  assert.ok(v.a > v0.a, "the survivor is bigger");
  assert.throws(() => exchangeTrade(g, "c", "b", 1, 5), /merged/);
  // The game goes on; the merged company keeps its score and never goes bankrupt.
  for (let r = 0; r < 3 && !g.finished; r++) g = resolveRound(g, {});
  const row = standings(g).find((s) => s.companyId === "b")!;
  assert.equal(row.merged, "a");
  assert.ok(row.score > 0 && !row.bankrupt);
});

test("hostile bid: passing 40% of a company makes headlines and warns the target", () => {
  let g = newGame(31, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  g = resolveRound(g, { a: { buyShares: { b: 20 } } });
  assert.equal(g.companies[1].shares.holders.a, 40);
  assert.ok(g.feed.some((f) => f.headline.startsWith("Hostile bid!") && f.headline.includes("40%")));
  assert.ok(g.companies[1].history.at(-1)!.events.some((e) => e.startsWith("HOSTILE BID")));
});

test("reviews: every product gets 1-5 stars and quotes with its name; cheap good products score higher", () => {
  let g = newGame(41);
  g = resolveRound(g, { a: { productName: "Midnight Crunch", price: 1.6, quality: 3 }, b: { price: 3.5, quality: 1 } });
  const ra = g.companies[0].history.at(-1)!.reviews!, rb = g.companies[1].history.at(-1)!.reviews!;
  assert.equal(g.companies[0].productName, "Midnight Crunch");
  assert.ok(ra.stars >= 1 && ra.stars <= 5 && ra.quotes.length >= 1);
  assert.ok(ra.stars > rb.stars, `cheap and decent (${ra.stars}) beats pricey and poor (${rb.stars})`);
  assert.ok(ra.quotes.join(" ").includes("Midnight Crunch") || ra.quotes.join(" ").includes("ChocoLoco"));
  // Same game, same reviews.
  const again = resolveRound(newGame(41), { a: { productName: "Midnight Crunch", price: 1.6, quality: 3 }, b: { price: 3.5, quality: 1 } });
  assert.deepEqual(again.companies[0].history.at(-1)!.reviews, ra);
});
