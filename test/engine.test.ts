import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, resolveRound, standings, sanitizeDecisions, companyValues, sharePrices, renameCompany, INDUSTRIES, type GameState, type Decisions } from "../src/engine";
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
  // Cutthroat: unlocked from round 1, no cooldown, up to 35 shares a round.
  g.companies[0].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
  assert.equal(g.companies[1].shares.holders.a, 35);
  assert.equal(g.companies[1].controlledBy, null);
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
  assert.equal(g.companies[1].shares.holders.a, 70);
  assert.equal(g.companies[1].controlledBy, "a");
  assert.equal(shareTotal(g, "b"), 100);
  assert.ok(g.feed.some((f) => f.headline.includes("friendly takeover")));
});

test("Standard: takeover cooldown stops the buyer for two rounds", () => {
  let g = newGame(9);
  g.companies[0].cash = 80_000_000;
  for (let r = 1; r <= 2; r++) g = resolveRound(g, {});
  // Rounds 3, 4, 5: 25 shares each -> control after round 5.
  for (let r = 3; r <= 5; r++) g = resolveRound(g, { a: { buyShares: { b: 25 } } });
  assert.equal(g.companies[1].controlledBy, "a");
  const heldC = () => g.companies[2].shares.holders.a ?? 0;
  g = resolveRound(g, { a: { buyShares: { c: 10 } } });
  assert.equal(heldC(), 0, "blocked during cooldown");
});

test("buybacks protect a company from losing control", () => {
  let g = newGame(11, "cutthroat");
  g.companies[0].cash = 50_000_000;
  g.companies[1].cash = 50_000_000;
  g = resolveRound(g, { a: { buyShares: { b: 35 } }, b: { buyback: 35 } });
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
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
          - h.brandCost - h.researchCost - h.interest - h.capacityInvest - h.storeOpenCost - h.storeUpkeep - h.sharePurchases - h.buybackCost - h.dividendsPaid + h.dividendsReceived
          + h.emergencyLoan - h.emergencyFee - h.wildcardCost - h.legalCost - h.staffCost - h.auctionPaid - h.showdownPaid + h.shareSales;
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
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
  g = resolveRound(g, { a: { buyShares: { b: 35 }, takeoverStake: 200_000 }, b: { defenseStake: 400_000 } });
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
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
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
  for (let r = 0; r < 2 && !g.finished; r++) g = resolveRound(g, { a: { buyShares: { b: 35, c: 35, d: 35 } } });
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
  g = resolveRound(g, { a: { buyShares: { b: 25 } } });
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
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
  assert.equal(renameCompany(g, "a", "b", "Nope"), g, "no control yet");
  g = resolveRound(g, { a: { buyShares: { b: 35 } } });
  g = renameCompany(g, "a", "b", "ChocoLoco's Little Helper");
  assert.equal(g.companies[1].companyName, "ChocoLoco's Little Helper");
  assert.equal(g.companies[1].originalName, "Bar None");
});
