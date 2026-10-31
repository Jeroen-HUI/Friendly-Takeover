// Bot strategies used to test balance, and later for the tutorial match against bots.

import { INDUSTRIES, DIFFICULTIES, companyValues, sharePrices, type Company, type Decisions, type GameState } from "../engine";
import { Rng } from "../engine/rng";
import { smartDecisions, smartRaider, type Position } from "./smart";
import { oracleDecisions } from "./oracle";

export type NaiveStrategy = "budget" | "mainstream" | "premium" | "hype" | "raider" | "dumper" | "random";
export type SmartStrategy = "smart-budget" | "smart-mainstream" | "smart-premium" | "smart-hype" | "smart-raider"
  | "pro-budget" | "pro-mainstream" | "pro-premium" | "pro-hype";
/** Smart bots with one bad habit, to look for exploits. */
export type ExploitStrategy = "shortseller" | "spammer" | "hoarder" | "loanshark" | "nomarketing" | "overbidder" | "plain-mainstream" | "sloppy-mainstream";
export type BotStrategy = NaiveStrategy | SmartStrategy | ExploitStrategy;
export const BOT_STRATEGIES: BotStrategy[] = ["budget", "mainstream", "premium", "hype", "raider", "dumper", "random"];
export const SMART_STRATEGIES: SmartStrategy[] = ["smart-budget", "smart-mainstream", "smart-premium", "smart-hype", "smart-raider"];

/** Production planning shared by all bots: last round's demand plus a margin, minus stock on hand. */
function planProduction(c: Company, margin = 1.1): number {
  const last = c.history.at(-1);
  const expected = last ? (last.sold + last.unmetDemand * 0.7) * margin : c.capacity * 0.75;
  return Math.max(0, Math.min(c.capacity, Math.round(expected - c.inventory)));
}

function growCapacity(c: Company, budget: number): number {
  const last = c.history.at(-1);
  if (!last) return 0;
  return last.unmetDemand > c.capacity * 0.1 || last.produced >= c.capacity * 0.97 ? budget : 0;
}

/** Cash a bot is willing to spend this round without borrowing much. */
function spendable(c: Company): number {
  return Math.max(0, c.cash - 600_000);
}

/** Retail plan: open stores two at a time up to a target, priced relative to the normal store price. */
function retail(state: GameState, c: Company, target: number, priceFactor: number): Partial<Decisions> {
  const ind = INDUSTRIES[state.config.industry];
  if (state.round < DIFFICULTIES[state.config.difficulty].retailUnlockRound) return {};
  const ref = ind.segments.mainstream.refPrice * 1.45;
  return { storesOpen: c.stores < target && c.cash > 1_000_000 ? 2 : 0, retailPrice: ref * priceFactor };
}

function baseDecisions(strategy: NaiveStrategy, state: GameState, c: Company, rng: Rng): Partial<Decisions> {
  const ind = INDUSTRIES[state.config.industry];
  const seg = ind.segments;
  const scale = (ind.baseUnitCost * ind.potentialPerCompany) / 500_000;
  const k = (euros: number) => Math.round(euros * scale);
  switch (strategy) {
    case "budget":
      return {
        price: seg.budget.refPrice * 1.0,
        quality: 1,
        production: planProduction(c),
        campaign: "discount",
        marketingBudget: k(200_000),
        investRnd: 0,
        investBrand: k(30_000),
        investCapacity: Math.min(spendable(c), growCapacity(c, k(600_000))),
      };
    case "mainstream":
      return {
        price: seg.mainstream.refPrice,
        quality: 3,
        production: planProduction(c),
        campaign: "tv",
        marketingBudget: k(200_000),
        investRnd: 0,
        investBrand: k(120_000),
        investCapacity: Math.min(spendable(c), growCapacity(c, k(400_000))),
      };
    case "premium":
      return {
        price: seg.premium.refPrice * (c.qualityCap >= 5 ? 1.1 : 0.95),
        quality: c.qualityCap,
        production: planProduction(c),
        campaign: "luxury",
        marketingBudget: k(200_000),
        investRnd: c.qualityCap < 5 ? k(350_000) : 0,
        investBrand: k(150_000),
        investCapacity: 0,
      };
    case "hype":
      return {
        price: seg.hype.refPrice,
        quality: 2,
        production: planProduction(c, 1.15),
        campaign: "viral",
        marketingBudget: k(300_000),
        investRnd: 0,
        investBrand: k(60_000),
        investCapacity: Math.min(spendable(c), growCapacity(c, k(300_000))),
      };
    case "dumper":
      // Sells far below the budget reference price to grab volume.
      return {
        price: seg.budget.refPrice * 0.7,
        quality: 1,
        production: planProduction(c, 1.2),
        campaign: "discount",
        marketingBudget: k(300_000),
        investRnd: 0,
        investBrand: 0,
        investCapacity: Math.min(spendable(c), growCapacity(c, k(800_000))),
      };
    case "raider": {
      const base = { ...baseDecisions("mainstream", state, c, rng), ...retail(state, c, 4, 1.0) };
      const difficulty = DIFFICULTIES[state.config.difficulty];
      if (state.round < difficulty.takeoverUnlockRound || c.takeoverCooldown > 0) return base;
      const prices = sharePrices(state);
      // Keep going after the target it already holds most of; otherwise pick the cheapest rival.
      const rivals = state.companies.filter((o) => o.id !== c.id && !o.bankrupt && !o.controlledBy && o.shares.float > 0);
      if (!rivals.length) return base;
      const held = (o: Company) => o.shares.holders[c.id] ?? 0;
      const target = rivals.sort((a, b) => held(b) - held(a) || prices[a.id] - prices[b.id])[0];
      const budget = Math.max(0, c.cash - 900_000);
      const qty = Math.floor(budget / Math.max(1, prices[target.id] * 1.3));
      return { ...base, buyShares: qty > 0 ? { [target.id]: qty } : {}, marketingBudget: k(150_000), investBrand: k(50_000) };
    }
    case "random": {
      const segs = [seg.budget, seg.mainstream, seg.premium, seg.hype];
      const ref = rng.pick(segs).refPrice;
      return {
        price: ref * (0.8 + rng.next() * 0.5),
        quality: 1 + rng.int(c.qualityCap),
        production: planProduction(c, 0.9 + rng.next() * 0.4),
        campaign: rng.pick(["discount", "tv", "luxury", "viral"] as const),
        marketingBudget: k(rng.next() * 300_000),
        investRnd: k(rng.next() * 250_000),
        investBrand: k(rng.next() * 150_000),
        investCapacity: 0,
      };
    }
  }
}

function exploitDecisions(strategy: ExploitStrategy, state: GameState, c: Company, rng: Rng): Partial<Decisions> {
  const base = smartDecisions("mainstream", state, c, rng);
  const rivals = state.companies.filter((o) => o.id !== c.id && !o.bankrupt);
  const target = rivals.length ? rng.pick(rivals).id : undefined;
  switch (strategy) {
    case "shortseller": {
      // Builds a big stake in the leader, then dumps it all in the final round.
      const v = companyValues(state);
      const leader = state.companies.filter((o) => o.id !== c.id && !o.bankrupt).sort((a, b) => v[b.id] - v[a.id])[0];
      if (!leader) return base;
      const held = (o: Company) => o.shares.holders[c.id] ?? 0;
      if (state.round === state.config.rounds) {
        const sells: Record<string, number> = {};
        for (const o of state.companies) if (held(o)) sells[o.id] = held(o);
        return { ...base, sellShares: sells };
      }
      const diff = DIFFICULTIES[state.config.difficulty];
      if (state.round < diff.takeoverUnlockRound || c.takeoverCooldown > 0) return base;
      const room = Math.min(diff.maxSharesPerRound, 50 - held(leader));
      const price = sharePrices(state)[leader.id] * 1.4;
      const qty = Math.max(0, Math.min(room, Math.floor(Math.max(0, c.cash - 900_000) / Math.max(1, price))));
      return qty > 0 ? { ...base, buyShares: { [leader.id]: qty }, investCapacity: 0 } : base;
    }
    case "plain-mainstream": return smartDecisions("mainstream", state, c, rng, { specials: false });
    case "sloppy-mainstream": return smartDecisions("mainstream", state, c, rng, { noise: 0.25 });
    case "spammer": {
      // Sabotage every round with whatever is left.
      const card = (["scandal", "lawsuit", "poach"] as const).find((w) => (c.wildcardsUsed[w] ?? 0) < 2);
      return { ...base, wildcard: card && target ? { card, target } : null };
    }
    case "hoarder": return { ...base, production: c.capacity, price: (base.price ?? 2) * 1.1 };
    case "loanshark": return { ...base, loanChange: 6_000_000 - c.debt, investCapacity: Math.max(0, c.cash * 0.6) };
    case "nomarketing": return { ...base, marketingBudget: 0, investBrand: 0 };
    case "overbidder": return { ...base, auctionBid: state.auction?.round === state.round ? Math.max(0, c.cash - 300_000) : 0 };
  }
}

export function botDecisions(strategy: BotStrategy, state: GameState, c: Company, rng: Rng): Partial<Decisions> {
  if (strategy === "smart-raider") return smartRaider(state, c, rng);
  if (strategy.startsWith("pro-")) return oracleDecisions(strategy.slice(4) as Position, state, c, rng);
  if (strategy.startsWith("smart-")) return smartDecisions(strategy.slice(6) as Position, state, c, rng);
  if (!(BOT_STRATEGIES as string[]).includes(strategy)) return exploitDecisions(strategy as ExploitStrategy, state, c, rng);
  const base = baseDecisions(strategy as NaiveStrategy, state, c, rng);
  if (strategy === "mainstream") return { ...base, ...retail(state, c, 6, 1.0) };
  if (strategy === "premium") return { ...base, ...retail(state, c, 6, 1.25) };
  if (strategy === "hype") return { ...base, ...retail(state, c, 4, 1.1) };
  return base;
}
