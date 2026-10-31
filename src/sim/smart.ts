// An adaptive bot that plays like a careful human: it reads its own reports, the forecast,
// and the news, then sets price, production, capacity, stores and the special actions.
// Used to check that thinking ahead beats fixed plans (skill), and how much luck still matters.

import {
  AUCTION, BALANCE, BANKRUPTCY_SALE, DIFFICULTIES, INDUSTRIES, RETAIL, SUMMIT, WILDCARDS,
  activeNewsEffects, companyValues, creditLimit, retailRefPrice, segmentPotential, sharePrices, storeCapacity, teamOutput, unitCost,
  type Company, type Decisions, type GameState, type RegulationId, type SegmentId,
} from "../engine";
import { Rng } from "../engine/rng";

export type Position = "budget" | "mainstream" | "premium" | "hype";
const SEGS: SegmentId[] = ["budget", "mainstream", "premium", "hype"];

export interface SmartOptions {
  /** Use wildcards, auctions, votes and missions. Off = plays the market only. */
  specials?: boolean;
  /** Mix in mistakes, like a casual human (0 = perfect, 0.3 = sloppy). */
  noise?: number;
}

const PLAN: Record<Position, { priceF: number; quality: (cap: number) => number; campaign: Decisions["campaign"]; mkt: number; brand: number; rnd: number; storeF: number; maxStores: number }> = {
  budget: { priceF: 1.0, quality: () => 1, campaign: "discount", mkt: 180_000, brand: 30_000, rnd: 0, storeF: 0.85, maxStores: 6 },
  mainstream: { priceF: 1.0, quality: (cap) => Math.min(cap, 3), campaign: "tv", mkt: 200_000, brand: 120_000, rnd: 0, storeF: 1.0, maxStores: 10 },
  premium: { priceF: 1.0, quality: (cap) => cap, campaign: "luxury", mkt: 200_000, brand: 150_000, rnd: 350_000, storeF: 1.25, maxStores: 8 },
  hype: { priceF: 1.0, quality: () => 2, campaign: "viral", mkt: 280_000, brand: 60_000, rnd: 0, storeF: 1.1, maxStores: 6 },
};

/** Market potential the previous round probably had (growth and the news that was already running). */
function previousPotential(state: GameState): Record<SegmentId, number> {
  const prev = { ...state, round: state.round - 1, news: state.news.filter((a) => a.roundsLeft < a.event.duration) };
  return segmentPotential(prev);
}

export function smartDecisions(pos: Position, state: GameState, c: Company, rng: Rng, opts: SmartOptions = {}): Partial<Decisions> {
  const ind = INDUSTRIES[state.config.industry];
  const diff = DIFFICULTIES[state.config.difficulty];
  const plan = PLAN[pos];
  const k = (e: number) => Math.round(e * ((ind.baseUnitCost * ind.potentialPerCompany) / 500_000));
  const noise = opts.noise ?? 0;
  const jitter = () => 1 + (rng.next() * 2 - 1) * noise;
  const last = c.history.at(-1)!;
  const final = state.round === state.config.rounds;
  const roundsLeft = state.config.rounds - state.round + 1;
  const tycoon = state.config.difficulty === "tycoon";
  const fx = activeNewsEffects(state);
  const quality = plan.quality(c.qualityCap);
  const uc = unitCost(ind, quality, fx.costMultiplier, c.trait, tycoon);
  const ref = ind.segments[pos].refPrice;

  // --- Price: steer by last round's sell-through, never below a healthy margin.
  let price = last.round >= 1 && c.lastDecisions.quality === quality ? c.lastDecisions.price : ref * plan.priceF;
  const stockLast = last.produced + last.inventoryStart;
  if (last.unmetDemand > last.sold * 0.08) price *= 1.06;
  else if (last.inventoryEnd > stockLast * 0.12) price *= 0.95;
  price = Math.min(ref * 1.4, Math.max(ref * 0.8, price, uc * 1.35)) * jitter();

  // --- Demand estimate: last round's demand, scaled by how the market moves (forecast is bought).
  const pot = segmentPotential(state), prevPot = previousPotential(state);
  const soldBySeg = SEGS.map((s) => last.segments[s].sold + 1);
  const totalSeg = soldBySeg.reduce((a, b) => a + b, 0);
  const ratio = SEGS.reduce((a, s, i) => a + (soldBySeg[i] / totalSeg) * (pot[s] / Math.max(1, prevPot[s])), 0);
  const priceEffect = Math.pow(c.lastDecisions.price / price, 1.2);
  const wholesaleDemand = (last.wholesaleSold + last.unmetDemand * 0.6) * ratio * priceEffect;

  // --- Retail.
  const unlocked = state.round >= diff.retailUnlockRound;
  const sCap = storeCapacity(ind);
  let storesOpen = 0, storesClose = 0;
  const retailPrice = retailRefPrice(ind) * plan.storeF * jitter();
  const wantStores = c.mission.id === "stores" ? Math.max(8, plan.maxStores) : plan.maxStores;
  if (unlocked && !final) {
    const fill = c.stores ? last.retailSold / (c.stores * sCap) : 1;
    if (c.stores && fill < 0.45) storesClose = Math.ceil(c.stores * 0.3);
    else if (fill > 0.8 && c.stores < wantStores && c.cash > 1_000_000 && roundsLeft >= 2) storesOpen = Math.min(RETAIL.maxOpenPerRound, wantStores - c.stores, c.stores === 0 ? 2 : 3);
    if (c.mission.id === "stores" && c.stores + storesOpen < 8 && roundsLeft <= 3) storesOpen = Math.min(RETAIL.maxOpenPerRound, 8 - c.stores);
  }
  const stores = c.stores + storesOpen - storesClose;
  const retailDemand = stores ? Math.min(stores * sCap, (last.retailDemand || stores * sCap * 0.8) * (c.stores ? stores / c.stores : 1)) : 0;

  // --- Production: cover expected demand, use up stock, keep a small buffer (none in the last round).
  const expected = wholesaleDemand + retailDemand;
  const buffer = final ? 0.98 : 1.06;
  const production = Math.max(0, Math.min(c.capacity, Math.round(expected * buffer * jitter() - c.inventory)));

  // --- Capacity: grow when demand outruns the factory and there is time to earn it back.
  let investCapacity = 0;
  const margin = price - uc - BALANCE.fixedCostPerCapacity * ind.baseUnitCost;
  if (expected > c.capacity * 0.97 && roundsLeft >= 3 && margin > 0.25 * ind.baseUnitCost) {
    const gap = Math.min(expected * 1.15 - c.capacity, c.capacity * 0.3);
    investCapacity = Math.max(0, Math.min(gap * BALANCE.capacityCostPerUnit * ind.baseUnitCost, Math.max(0, c.cash - 700_000)));
  }

  // --- Marketing, brand, R&D. In the final round only what pays off this round.
  let marketingBudget = k(plan.mkt) * jitter();
  let investBrand = final ? 0 : k(plan.brand) * (c.mission.id === "brand" ? 1.8 : 1);
  const wantQ5 = pos === "premium" || (c.mission.id === "quality5" && roundsLeft >= 3);
  let investRnd = c.qualityCap < 5 && wantQ5 ? k(plan.rnd || 300_000) : 0;
  if (final) investRnd = 0;
  if (pos === "hype" && c.hype > 70) marketingBudget *= 0.7;

  // --- Loans: keep a cash cushion, repay when flush, be debt-free for that mission.
  const spend = production * uc + marketingBudget + investBrand + investRnd + investCapacity + storesOpen * RETAIL.openCost + stores * RETAIL.upkeep;
  const cushion = 400_000;
  let loanChange = 0;
  if (c.cash - spend < cushion) loanChange = Math.min(creditLimit(state, c) - c.debt, cushion - (c.cash - spend));
  else if (c.debt > 0 && c.cash - spend > cushion * 3) loanChange = -Math.min(c.debt, c.cash - spend - cushion * 2);
  if (final && c.mission.id === "debtFree" && c.debt > 0) loanChange = -Math.min(c.debt, Math.max(0, c.cash - spend));

  const d: Partial<Decisions> = {
    price, quality, production, campaign: plan.campaign, marketingBudget, investBrand, investRnd, investCapacity, loanChange,
    research: [], storesOpen, storesClose, retailPrice,
  };

  if (tycoon) {
    const need = Math.ceil(production / teamOutput(ind));
    d.hire = Math.max(-10, Math.min(10, need - c.workers));
  }

  // --- Defense: a standing fund once someone owns 30% or more.
  const threat = Math.max(0, ...Object.values(c.shares.holders));
  d.defenseStake = threat >= 30 ? Math.min(k(800_000), Math.max(0, c.cash * 0.25)) : 0;

  // Stuck stakes: if someone else controls a company we hold shares in, cash out.
  const sells: Record<string, number> = {};
  for (const o of state.companies) {
    const held = o.shares.holders[c.id] ?? 0;
    if (held > 0 && o.controlledBy && o.controlledBy !== c.id && c.mission.targetId !== o.id) sells[o.id] = held;
  }
  if (Object.keys(sells).length) d.sellShares = sells;

  if (opts.specials === false) return d;

  // --- Mission: Silent partner builds a 30% stake over time.
  if (c.mission.id === "stake" && state.round >= diff.takeoverUnlockRound && c.takeoverCooldown === 0) {
    const t = state.companies.find((o) => o.id === c.mission.targetId);
    const held = t ? t.shares.holders[c.id] ?? 0 : 0;
    if (t && !t.bankrupt && held < 30 && c.cash > 1_500_000) {
      d.buyShares = { [t.id]: Math.min(diff.maxSharesPerRound, 30 - held) };
    }
  }

  // --- Wildcards.
  const used = (w: keyof typeof WILDCARDS) => c.wildcardsUsed[w] ?? 0;
  const values = companyValues(state);
  const rivals = state.companies.filter((o) => o.id !== c.id && !o.bankrupt);
  const leader = rivals.sort((a, b) => values[b.id] - values[a.id])[0];
  const badNews = fx.costMultiplier > 1.05 || fx.capacityMultiplier < 0.95 || (fx.interestDelta > 0 && c.debt > 1_500_000);
  if (badNews && used("lobby") < 2) d.wildcard = { card: "lobby" };
  else if (leader && values[leader.id] > values[c.id] && values[leader.id] - values[c.id] < 1_500_000 && roundsLeft <= 3 && used("lawsuit") < 2) d.wildcard = { card: "lawsuit", target: leader.id };
  else if (pos === "hype" && state.round >= 3 && used("crazy") < 1 && rng.chance(0.4)) d.wildcard = { card: "crazy" };
  else if (pos === "premium" && c.qualityCap < 5 && state.round >= 2 && used("poach") < 1) {
    const rich = rivals.sort((a, b) => b.rndProgress - a.rndProgress)[0];
    if (rich && rich.rndProgress > 400_000) d.wildcard = { card: "poach", target: rich.id };
  }

  // --- Auction: bid a share of what the item is worth to this company.
  if (state.auction?.round === state.round) {
    const item = state.auction.item;
    const worth =
      item === "endorsement" ? 15 * BALANCE.brandValuePerPoint * (pos === "budget" ? 0.8 : 1.3)
      : item === "patent" ? (pos === "premium" || c.mission.id === "quality5" ? 700_000 : 120_000)
      : item === "factory" ? ind.start.capacity * 0.25 * BALANCE.capacityBookValue * ind.baseUnitCost * (expected > c.capacity * 0.9 ? 1.4 : 0.8)
      : unlocked ? 2 * (RETAIL.bookValue + RETAIL.openCost * 0.6) : 0;
    const bid = Math.min(worth * (0.45 + rng.next() * 0.3), Math.max(0, c.cash - 800_000));
    d.auctionBid = bid >= AUCTION.minBid ? Math.round(bid / 1000) * 1000 : 0;
  }

  // --- Bankruptcy sales: bid for a dead rival's factory and stores when it's a bargain.
  for (const lot of (state.bankruptcySales ?? []).filter((l) => l.round === state.round)) {
    const dead = state.companies.find((o) => o.id === lot.companyId);
    if (!dead) continue;
    const capWorth = dead.capacity * BANKRUPTCY_SALE.capacityShare * BALANCE.capacityBookValue * ind.baseUnitCost * (expected > c.capacity * 0.9 ? 1.1 : 0.7);
    const worth = capWorth + dead.stores * RETAIL.bookValue;
    const bid = Math.min(worth * (0.4 + rng.next() * 0.3), Math.max(0, c.cash + (creditLimit(state, c) - c.debt) * 0.5 - 600_000));
    if (bid >= BANKRUPTCY_SALE.minBid) d.bankruptBids = { ...(d.bankruptBids ?? {}), [dead.id]: Math.round(bid / 1000) * 1000 };
  }

  // --- Summit: vote for the rule that helps my segment most.
  if (state.summit?.round === state.round) {
    const score = (r: RegulationId) => {
      const e = SUMMIT.regulations[r].effect;
      let s = 0;
      for (const seg of SEGS) {
        const m = e.segmentMultiplier?.[seg] ?? 1;
        const mine = soldBySeg[SEGS.indexOf(seg)] / totalSeg;
        s += (m - 1) * (mine - 0.25) * 4;
      }
      if (e.interestDelta) s += -e.interestDelta * (c.debt / 1_000_000) * 5;
      if (e.costMultiplier) s -= (e.costMultiplier - 1) * 2;
      return s;
    };
    const [a, b] = state.summit.options;
    d.vote = score(a) >= score(b) ? "a" : "b";
  }
  return d;
}

/** A smart raider: plays mainstream, then buys the weakest rival it can afford, with showdown stakes. */
export function smartRaider(state: GameState, c: Company, rng: Rng): Partial<Decisions> {
  const base = smartDecisions("mainstream", state, c, rng);
  const diff = DIFFICULTIES[state.config.difficulty];
  if (state.round < diff.takeoverUnlockRound || c.takeoverCooldown > 0 || state.round === state.config.rounds) return base;
  const prices = sharePrices(state);
  const rivals = state.companies.filter((o) => o.id !== c.id && !o.bankrupt && !o.controlledBy && o.shares.float > 0);
  if (!rivals.length) return base;
  const held = (o: Company) => o.shares.holders[c.id] ?? 0;
  const target = rivals.sort((a, b) => held(b) - held(a) || prices[a.id] - prices[b.id])[0];
  const budget = Math.max(0, c.cash - 900_000);
  const qty = Math.floor(budget / Math.max(1, prices[target.id] * 1.35));
  if (qty <= 0) return base;
  return { ...base, buyShares: { [target.id]: qty }, takeoverStake: held(target) + qty > 50 ? Math.min(budget * 0.2, 600_000) : 0, investCapacity: 0, loanChange: Math.max(base.loanChange ?? 0, 0) };
}
