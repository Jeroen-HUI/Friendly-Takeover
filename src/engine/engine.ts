// Friendly Takeover — round resolution.
// resolveRound(state, decisions) is pure: it never mutates its input and always gives the same
// result for the same input, so the server can re-run or audit any round.

import {
  AUCTION, BALANCE, BANKRUPTCY_SALE, BOARD_SEAT_SHARES, BULK, CAMPAIGNS, COSTS, DEALS, ECONOMY, EXCHANGE, GUIDANCE, LIVE_AUCTION, EVENTS, DIFFICULTIES, INDUSTRIES, JOURNALIST, MISSION_BONUS, MISSIONS, RESEARCH, RETAIL, SHOWDOWN, SUMMIT, TRAIT_EFFECTS, TYCOON,
  WILDCARD_EFFECTS, WILDCARDS, HOUSE_RULES, MERGER, HOSTILE_BID_SHARES, REVIEWS, UNLIMITED_ROUNDS, START_LEVELS, SCENARIOS, DIVIDENDS, BOARD, RUNNER_UP, MEGA, type IndustryConfig, type DifficultyConfig,
} from "./config";
import { Rng } from "./rng";
import {
  SEGMENTS,
  type ActiveNews,
  type NewsEffect,
  type AuctionItemId,
  type MissionId,
  type RegulationId,
  type WildcardId,
  type Company,
  type Decisions,
  type GameConfig,
  type GameState,
  type PlayerSetup,
  type ResearchId,
  type ResearchResult,
  type RoundReport,
  type SegmentId,
  type SegmentSales,
  type Standing,
  type GuidanceResult,
  type LiveState,
  type LiveTrade,
  type DealOrder,
  type ShareDealTerms,
  type LoanDealTerms,
  type PactDealTerms,
  type MergerDealTerms,
  type HouseRules,
  type ScenarioId,
  type StartLevel,
  type BoardProposal,
} from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const deepClone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
/** Still running a business: not bankrupt and not merged into another company. */
export const operating = (c: Company) => !c.bankrupt && !c.merged;
/** House rules with every setting filled in (null = use the industry's or difficulty's own value). */
export interface Rules {
  startCash: number; startDebt: number; startCapacity: number; startQuality: number; startBrand: number | null; startStores: number;
  founderShares: number; marketSize: number; growth: number | null; takeoverRound: number | null; sharesPerRound: number | null;
  unlimited: boolean; takeovers: boolean; wildcards: boolean; auctions: boolean; summits: boolean; retail: boolean; mergers: boolean;
  dividends: boolean; votes: boolean; runnerUp: boolean; mega: boolean;
  news: "calm" | "normal" | "wild"; scenario: ScenarioId; handicaps: Record<string, StartLevel>;
}
/** The house rules of a game, with the normal rules filled in. A scenario's settings fill in what the host didn't set. */
export function rulesOf(state: { config: GameConfig }): Rules {
  const own = state.config.rules ?? {};
  const scenario: ScenarioId = own.scenario && own.scenario in SCENARIOS ? own.scenario : "none";
  const r: HouseRules = { ...(SCENARIOS[scenario].rules as HouseRules), ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined && v !== null)) };
  const H = HOUSE_RULES;
  const range = (v: unknown, [lo, hi]: [number, number], fb: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fb);
  const opt = (v: unknown, rg: [number, number]) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, rg[0], rg[1]) : null);
  const handicaps: Record<string, StartLevel> = {};
  for (const [id, lv] of Object.entries(r.handicaps ?? {})) if (lv in START_LEVELS && lv !== "normal") handicaps[id] = lv as StartLevel;
  return {
    startCash: clamp(num(r.startCash, 0) || 0, 0, H.startCashRange[1]),
    startDebt: range(r.startDebt, H.startDebtRange, 0),
    startCapacity: range(r.startCapacity, H.startCapacityRange, 1),
    startQuality: Math.round(range(r.startQuality, H.startQualityRange, 3)),
    startBrand: opt(r.startBrand, H.startBrandRange),
    startStores: Math.round(range(r.startStores, H.startStoresRange, 0)),
    founderShares: Math.round(range(r.founderShares, H.founderSharesRange, BALANCE.startShares.founder)),
    marketSize: range(r.marketSize, H.marketSizeRange, 1),
    growth: opt(r.growth, H.growthRange),
    takeoverRound: opt(r.takeoverRound, H.takeoverRoundRange) === null ? null : Math.round(r.takeoverRound as number),
    sharesPerRound: opt(r.sharesPerRound, H.sharesPerRoundRange) === null ? null : Math.round(r.sharesPerRound as number),
    unlimited: r.unlimited === true,
    takeovers: r.takeovers !== false,
    wildcards: r.wildcards !== false,
    auctions: r.auctions !== false,
    summits: r.summits !== false,
    retail: r.retail !== false,
    mergers: r.mergers !== false && r.takeovers !== false,
    dividends: r.dividends !== false,
    votes: r.votes !== false,
    runnerUp: r.runnerUp !== false,
    mega: r.mega !== false,
    news: r.news === "calm" || r.news === "wild" ? r.news : "normal",
    scenario,
    handicaps,
  };
}
/** The difficulty's settings with the house rules applied (when shares open, how many per round, when retail opens). */
export function difficultyOf(state: { config: GameConfig }): DifficultyConfig {
  const d = DIFFICULTIES[state.config.difficulty];
  const r = rulesOf(state);
  return {
    ...d,
    takeoverUnlockRound: r.takeoverRound ?? d.takeoverUnlockRound,
    maxSharesPerRound: r.sharesPerRound ?? d.maxSharesPerRound,
    retailUnlockRound: r.retail ? d.retailUnlockRound : Infinity,
  };
}
/** Market growth per round for this game. */
export function growthOf(state: { config: GameConfig }): number {
  return rulesOf(state).growth ?? INDUSTRIES[state.config.industry].growth;
}
/** Total market size multiplier for a round: house-rule size times growth (kept within sane bounds in long games). */
function marketScale(state: { config: GameConfig }, round: number): number {
  return rulesOf(state).marketSize * clamp(Math.pow(1 + growthOf(state), Math.max(0, round - 1)), 0.25, 40);
}
/** Ends an unlimited (or any) game after the round being played: that round becomes the last one. */
export function endAfterThisRound(input: GameState): GameState {
  if (input.finished) return input;
  const state = deepClone(input);
  state.config = { ...state.config, rounds: Math.max(1, state.round) };
  state.upcomingNews = [];
  state.feed.push({ round: state.round, headline: "The host calls it: this is the final round!" });
  return state;
}
/** A small stable hash, for picking review lines without touching the game's random numbers. */
function hash(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function defaultDecisions(industry: IndustryConfig): Decisions {
  const s = industry.start;
  return {
    price: s.price,
    production: Math.round(s.capacity * 0.8),
    quality: s.quality,
    marketingBudget: 150_000,
    campaign: "tv",
    investRnd: 0,
    investCapacity: 0,
    investBrand: 0,
    loanChange: 0,
    buyShares: {},
    buyback: 0,
    research: [],
    storesOpen: 0,
    storesClose: 0,
    retailPrice: retailRefPrice(industry),
    sellShares: {},
    wildcard: null,
    takeoverStake: 0,
    defenseStake: 0,
    auctionBid: 0,
    bankruptBids: {},
    vote: null,
    journalistTarget: null,
    hire: 0,
    guidance: null,
    materialOrder: Math.round(s.capacity * 0.8),
    bulkSell: 0,
  };
}

/** Tycoon: units one production team makes per round, and what a team costs. */
export function teamOutput(industry: IndustryConfig): number {
  return Math.round(industry.potentialPerCompany * TYCOON.teamOutputShare);
}
export function teamWage(industry: IndustryConfig): number {
  return TYCOON.laborShare * industry.baseUnitCost * teamOutput(industry);
}

/** The price customers consider normal in a company's own store. */
export function retailRefPrice(industry: IndustryConfig): number {
  return Math.round(industry.segments.mainstream.refPrice * RETAIL.refFactor * 100) / 100;
}

/** Units one store can sell per round. */
export function storeCapacity(industry: IndustryConfig): number {
  return Math.round(industry.potentialPerCompany * RETAIL.storeCapacityShare);
}

export function createGame(config: GameConfig, players: PlayerSetup[]): GameState {
  if (players.length < 2 || players.length > 8) throw new Error("A game needs 2 to 8 players");
  const industry = INDUSTRIES[config.industry];
  if (config.rules?.unlimited) config = { ...config, rounds: UNLIMITED_ROUNDS };
  else config = { ...config, rounds: clamp(Math.round(num(config.rounds, 8)), 1, HOUSE_RULES.roundsRange[1]) };
  const rules = rulesOf({ config });
  const startCash = rules.startCash > 0 ? clamp(rules.startCash, HOUSE_RULES.startCashRange[0], HOUSE_RULES.startCashRange[1]) : industry.start.cash;
  const startCap = Math.round(industry.start.capacity * rules.startCapacity);
  // Giant vs startups: one company (drawn from the seed) starts as the giant.
  let scenarioCompany: string | null = null;
  const handicaps = { ...rules.handicaps };
  if (rules.scenario === "giant") {
    scenarioCompany = players[(Math.abs(config.seed) >>> 0) % players.length].id;
    handicaps[scenarioCompany] = "giant";
  }
  const companies: Company[] = players.map((p) => {
    const lv = START_LEVELS[handicaps[p.id] ?? "normal"];
    const cap = Math.round(startCap * lv.capacity);
    return {
      id: p.id,
      playerName: p.playerName,
      companyName: p.companyName,
      trait: p.trait,
      cash: Math.round(startCash * lv.cash),
      debt: rules.startDebt,
      capacity: cap,
      qualityCap: Math.max(industry.start.qualityCap, rules.startQuality),
      rndProgress: rules.startQuality >= 5 ? BALANCE.rndThresholds[5] : rules.startQuality >= 4 ? BALANCE.rndThresholds[4] : 0,
      brand: clamp((rules.startBrand ?? industry.start.brand) + lv.brand, 0, 100),
      hype: industry.start.hype,
      inventory: 0,
      stores: rules.retail ? rules.startStores : 0,
      originalName: p.companyName,
      wildcardsUsed: {},
      sentiment: 0,
      mission: { id: "volume" },
      workers: config.difficulty === "tycoon" ? Math.ceil((cap * 0.8) / teamOutput(industry)) : 0,
      journalistPoints: 0,
      cumProduced: 0,
      credibility: 0,
      materials: Math.round(cap * 0.8) * materialList(industry, industry.start.quality, p.trait),
      materialPaid: 1,
      inventoryUnitCost: 0,
      shares: { founder: rules.founderShares, float: 100 - rules.founderShares, treasury: 0, holders: {} },
      controlledBy: null,
      takeoverCooldown: 0,
      bankrupt: false,
      dividendPolicy: 0,
      lastDividend: null,
      lastDecisions: { ...defaultDecisions(industry), production: Math.round(cap * 0.8), materialOrder: Math.round(cap * 0.8) },
      history: [],
    };
  });
  // Year 0: every company plays one identical year with the default plan, so round 1 starts with
  // last year's reports to plan from (like TOPSIM's starting position). Resolving it also draws round 1's news.
  // Secret missions, drawn from the seed so the server can reproduce them.
  const mrng = new Rng((config.seed ^ 0x5bd1e995) | 0);
  const missionIds = Object.keys(MISSIONS) as MissionId[];
  for (const c of companies) {
    const id = mrng.pick(missionIds);
    c.mission = id === "stake" ? { id, targetId: mrng.pick(companies.filter((o) => o.id !== c.id)).id } : { id };
  }
  // Two special rounds per game, at fixed but unknown-in-advance moments (announced a round ahead).
  // Long games get a Black Friday and an Investor Day in every block of 12 rounds.
  const specialEvents: { round: number; id: "blackFriday" | "investorDay" }[] = [];
  for (let block = 0; block === 0 || block + 3 <= Math.min(config.rounds, 120); block += 12) {
    const lastPlayable = block === 0 ? Math.max(3, Math.min(config.rounds, 12) - 1) : Math.min(config.rounds - 1, block + 11);
    const from = block === 0 ? 3 : block + 1;
    const pickRound = (f: number) => f + mrng.int(Math.max(1, lastPlayable - f + 1));
    const bf = pickRound(from);
    let inv = pickRound(from);
    if (inv === bf) inv = bf > from ? bf - 1 : bf + 1;
    specialEvents.push(...[{ round: bf, id: "blackFriday" as const }, { round: inv, id: "investorDay" as const }].filter((e) => e.round <= config.rounds));
  }
  // Hidden market drivers: one buyer group slowly grows, one shrinks, the rest drift; price sensitivity differs per game.
  const between = ([lo, hi]: [number, number]) => lo + mrng.next() * (hi - lo);
  const order = mrng.shuffle([...SEGMENTS]);
  const trend = {} as Record<SegmentId, number>;
  order.forEach((sg, i) => (trend[sg] = i === 0 ? between(COSTS.trendGrow) : i === 1 ? between(COSTS.trendShrink) : (mrng.next() * 2 - 1) * COSTS.trendDrift));
  const sensitivity = {} as Record<SegmentId, number>;
  for (const sg of SEGMENTS) sensitivity[sg] = between(COSTS.sensitivityRange);
  const yearZero: GameState = {
    config,
    round: 0,
    companies,
    news: [],
    feed: [],
    rngState: config.seed | 0,
    finished: false,
    auction: null,
    summit: null,
    specialEvents,
    scenarioCompany,
    market: { materialIndex: 1, materialNext: 1, materialOutlook: "flat", bulkPrice: Math.round(industry.start.price * 0.5 * 100) / 100, trend, sensitivity },
  };
  // Scenario extras: a recession that lasts the first three rounds, or cheap materials in a gold rush.
  if (rules.scenario === "recession") yearZero.news.push({ event: { id: "scenario-recession", headline: "Recession: bargain hunters rule, luxury buyers hide", effect: { segmentMultiplier: { budget: 1.3, premium: 0.75, hype: 0.85 } }, duration: 4, kind: "economy" }, roundsLeft: 4 });
  if (rules.scenario === "goldrush") { yearZero.market!.materialIndex = 0.85; yearZero.market!.materialNext = 0.85; }
  return resolveRound(yearZero, {});
}

// ---------------------------------------------------------------------------
// Helpers shared with the UI
// ---------------------------------------------------------------------------

export function unitCost(industry: IndustryConfig, quality: number, costMultiplier = 1, trait?: Company["trait"], tycoon = false): number {
  const traitFactor = trait === "pennyPincher" ? TRAIT_EFFECTS.pennyPincherCostFactor : 1;
  // Tycoon: the labour part of a unit (the same at every quality) is paid as team wages instead.
  const labor = tycoon ? TYCOON.laborShare : 0;
  const q = quality - 1;
  return industry.baseUnitCost * (1 + industry.qualityCostStep * q + industry.qualityCostCurve * q * q - labor) * costMultiplier * traitFactor;
}

/** Experience curve: cost multiplier after producing `cum` units in total (8% cheaper per doubling). */
export function experienceFactor(industry: IndustryConfig, cum: number): number {
  const prior = industry.start.capacity * 0.8 * COSTS.priorYears;
  return Math.max(COSTS.learningFloor, Math.pow((prior + Math.max(0, cum)) / prior, Math.log2(1 - COSTS.learningRate)));
}

/** Raw materials needed for one unit at this quality, at list price (material index 1.00). */
export function materialList(industry: IndustryConfig, quality: number, trait?: Company["trait"]): number {
  return COSTS.materialShare * unitCost(industry, quality, 1, trait, false);
}

/** Raw material price index → cost multiplier (only the material part of a unit follows it). */
export function materialFactor(index: number): number {
  return 1 + COSTS.materialShare * (index - 1);
}

/** Company value excluding stakes in other companies. */
function baseValue(c: Company, industry: IndustryConfig, dividendRound = 0): number {
  if (c.bankrupt) return 0;
  // A merged company is only a holding company now: its own cash plus its stakes (added in companyValues).
  if (c.merged) return c.cash - c.debt;
  const last = c.history.slice(-2).map((h) => h.profit);
  const avgProfit = last.length ? last.reduce((a, b) => a + b, 0) / last.length : 0;
  const value = (
    c.cash -
    c.debt +
    c.capacity * BALANCE.capacityBookValue * industry.baseUnitCost +
    (c.stores ?? 0) * RETAIL.bookValue +
    c.inventory * c.inventoryUnitCost * BALANCE.inventoryValueRate +
    c.brand * BALANCE.brandValuePerPoint +
    (c.materials ?? 0) * (c.materialPaid ?? 1) * COSTS.materialBookValue +
    Math.max(0, avgProfit) * BALANCE.earningsMultiple
  );
  // Investor panic after someone dumped shares; investor trust from the investor call.
  // Investors pay more for a company that pays dividends (while the last one is recent).
  const div = dividendRound && c.lastDividend && c.lastDividend.amount > 0 && dividendRound - c.lastDividend.round <= DIVIDENDS.every ? DIVIDENDS.valuePremium[c.dividendPolicy ?? 0] ?? 0 : 0;
  return value > 0 ? value * (1 - (c.sentiment ?? 0)) * (1 + GUIDANCE.valuePerPoint * (c.credibility ?? 0)) * (1 + div) : value;
}

/** Full company values including stakes held in others (one level of cross-holdings). */
export function companyValues(state: GameState): Record<string, number> {
  const industry = INDUSTRIES[state.config.industry];
  const base: Record<string, number> = {};
  const divRound = rulesOf(state).dividends ? Math.max(1, state.round) : 0;
  for (const c of state.companies) base[c.id] = baseValue(c, industry, divRound);
  // Loans between players: money owed to you counts, money you owe doesn't belong to you.
  for (const l of state.playerLoans ?? []) {
    if (base[l.lender] !== undefined) base[l.lender] += l.repay;
    if (base[l.borrower] !== undefined) base[l.borrower] -= l.repay;
  }
  const out: Record<string, number> = {};
  for (const c of state.companies) {
    if (c.bankrupt) {
      out[c.id] = 0;
      continue;
    }
    let stakes = 0;
    for (const t of state.companies) {
      const held = t.shares.holders[c.id] ?? 0;
      if (held > 0) stakes += (held / 100) * Math.max(0, base[t.id]);
    }
    out[c.id] = base[c.id] + stakes;
  }
  return out;
}

export function sharePrices(state: GameState): Record<string, number> {
  const v = companyValues(state);
  const out: Record<string, number> = {};
  for (const id of Object.keys(v)) out[id] = Math.max(0, v[id]) / 100;
  return out;
}

export function activeNewsEffects(state: GameState) {
  let costMultiplier = 1;
  let demandMultiplier = 1;
  let interestDelta = 0;
  let capacityMultiplier = 1;
  const segmentMultiplier: Record<SegmentId, number> = { budget: 1, mainstream: 1, premium: 1, hype: 1 };
  const companyBoost: Record<string, number> = {};
  let cheapestBoost = 0;
  for (const n of state.news) {
    const e = n.event.effect;
    if (e.costMultiplier) costMultiplier *= e.costMultiplier;
    if (e.demandMultiplier) demandMultiplier *= e.demandMultiplier;
    if (e.interestDelta) interestDelta += e.interestDelta;
    if (e.capacityMultiplier) capacityMultiplier *= e.capacityMultiplier;
    if (e.segmentMultiplier) for (const s of SEGMENTS) segmentMultiplier[s] *= e.segmentMultiplier[s] ?? 1;
    if (e.randomCompanyBoost && n.targetCompanyId) companyBoost[n.targetCompanyId] = (companyBoost[n.targetCompanyId] ?? 0) + e.randomCompanyBoost;
    if (e.cheapestBoost) cheapestBoost += e.cheapestBoost;
  }
  return { costMultiplier, demandMultiplier, interestDelta, capacityMultiplier, segmentMultiplier, companyBoost, cheapestBoost };
}

/** Clean up player input: fill defaults, clamp to what the company can actually do. */
/** How much a company may borrow in total by choice: half its value, at least €2M, never above the hard ceiling. */
export function creditLimit(state: GameState, c: Company): number {
  const value = companyValues(state)[c.id] ?? 0;
  return Math.min(BALANCE.maxDebt, Math.max(BALANCE.minCreditLimit, BALANCE.creditLimitShare * Math.max(0, value)));
}

export function sanitizeDecisions(state: GameState, c: Company, input: Partial<Decisions> | undefined): Decisions {
  const industry = INDUSTRIES[state.config.industry];
  const prev = c.lastDecisions;
  const d: Partial<Decisions> = input ?? {};
  const campaign = d.campaign && d.campaign in CAMPAIGNS ? d.campaign : prev.campaign;
  const price = clamp(num(d.price, prev.price), industry.priceRange[0], industry.priceRange[1]);
  // Round 1 sets your positioning; after that quality can only go up (like TOPSIM, no flip-flopping).
  const floor = state.round > 1 ? Math.min(c.qualityCap, c.history.at(-1)?.quality ?? 1) : 1;
  const quality = clamp(Math.round(num(d.quality, prev.quality)), floor, c.qualityCap);
  const production = Math.max(0, Math.round(num(d.production, prev.production)));
  const nonNeg = (v: unknown, fb: number) => Math.max(0, num(v, fb));
  // Investments and marketing default to last round's values, so an untouched screen repeats the plan.
  const loanRaw = num(d.loanChange, 0);
  const loanChange = loanRaw >= 0 ? Math.min(loanRaw, Math.max(0, creditLimit(state, c) - c.debt)) : -Math.min(-loanRaw, c.debt);
  const buyShares: Record<string, number> = {};
  for (const [target, qty] of Object.entries(d.buyShares ?? {})) {
    const q = Math.max(0, Math.floor(num(qty, 0)));
    if (q > 0 && target !== c.id && state.companies.some((o) => o.id === target)) buyShares[target] = q;
  }
  const sellShares: Record<string, number> = {};
  for (const [target, qty] of Object.entries(d.sellShares ?? {})) {
    const t = state.companies.find((o) => o.id === target);
    const held = t ? t.shares.holders[c.id] ?? 0 : 0;
    const q = Math.min(held, Math.max(0, Math.floor(num(qty, 0))));
    if (q > 0) sellShares[target] = q;
  }
  return {
    price,
    production,
    quality,
    sellShares,
    marketingBudget: nonNeg(d.marketingBudget, prev.marketingBudget),
    campaign,
    investRnd: nonNeg(d.investRnd, prev.investRnd),
    investCapacity: nonNeg(d.investCapacity, prev.investCapacity),
    investBrand: nonNeg(d.investBrand, prev.investBrand),
    loanChange,
    buyShares,
    buyback: Math.max(0, Math.floor(num(d.buyback, 0))),
    research: Array.isArray(d.research) ? [...new Set(d.research.filter((r): r is ResearchId => typeof r === "string" && r in RESEARCH))] : [],
    wildcard: d.wildcard && typeof d.wildcard === "object" && d.wildcard.card in WILDCARDS ? { card: d.wildcard.card, target: typeof d.wildcard.target === "string" ? d.wildcard.target : undefined } : null,
    takeoverStake: Math.max(0, num(d.takeoverStake, 0)),
    defenseStake: Math.max(0, num(d.defenseStake, prev.defenseStake ?? 0)),
    auctionBid: Math.max(0, num(d.auctionBid, 0)),
    bankruptBids: Object.fromEntries(Object.entries(d.bankruptBids ?? {}).map(([k, v]) => [k, Math.max(0, num(v, 0))]).filter(([k, v]) => (v as number) > 0 && state.companies.some((o) => o.id === k && o.bankrupt))),
    vote: d.vote === "a" || d.vote === "b" ? d.vote : null,
    journalistTarget: null,
    hire: clamp(Math.round(num(d.hire, 0)), -TYCOON.maxHirePerRound, TYCOON.maxHirePerRound),
    storesOpen: clamp(Math.floor(num(d.storesOpen, 0)), 0, RETAIL.maxOpenPerRound),
    storesClose: Math.max(0, Math.floor(num(d.storesClose, 0))),
    retailPrice: clamp(num(d.retailPrice, prev.retailPrice ?? retailRefPrice(industry)), industry.priceRange[0], industry.priceRange[1]),
    materialOrder: Math.min(Math.round(c.capacity * 3), Math.max(0, Math.round(num(d.materialOrder, prev.materialOrder ?? Math.round(c.capacity * 0.8))))),
    bulkSell: Math.max(0, Math.round(num(d.bulkSell, 0))),
    guidance: d.guidance && typeof d.guidance === "object" && Number.isFinite(d.guidance.units) && Number.isFinite(d.guidance.profit) ? { units: Math.max(0, Math.round(d.guidance.units)), profit: Math.round(d.guidance.profit) } : null,
    productName: typeof d.productName === "string" ? cleanName(d.productName) : undefined,
    style: Number.isInteger(d.style) && (d.style as number) >= 0 && (d.style as number) <= 11 ? d.style : undefined,
    dividendPolicy: d.dividendPolicy === 0 || d.dividendPolicy === 25 || d.dividendPolicy === 50 ? d.dividendPolicy : c.dividendPolicy ?? 0,
    boardLoan: Math.max(0, Math.min(BALANCE.maxDebt, Math.round(num(d.boardLoan, 0)))),
  };
}
/** Names typed by players: no control characters or angle brackets, at most 28 characters. */
export function cleanName(name: string): string { return String(name ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 28); }

/** Slow trend of a buyer group: multiplier on its size in a given round. */
function trendFactor(state: GameState, s: SegmentId, round: number): number {
  const t = state.market?.trend?.[s] ?? 0;
  return Math.pow(1 + t, Math.max(0, round - 1));
}

/** Market potential per segment for the state's current round, including active news. */
export function segmentPotential(state: GameState): Record<SegmentId, number> {
  const industry = INDUSTRIES[state.config.industry];
  const fx = activeNewsEffects(state);
  const size = industry.potentialPerCompany * state.companies.length * marketScale(state, state.round) * fx.demandMultiplier;
  const out = {} as Record<SegmentId, number>;
  for (const s of SEGMENTS) out[s] = Math.round(size * industry.segments[s].weight * fx.segmentMultiplier[s] * trendFactor(state, s, state.round));
  return out;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/** A small market-report item, like the economic indicators in TOPSIM. */
function economyItem(state: GameState, rng: Rng, kind: number): ActiveNews {
  const pct = (lo: number, hi: number) => Math.round((lo + rng.next() * (hi - lo)) * 10) / 10;
  const up = rng.chance(0.5);
  const material = ECONOMY.material[state.config.industry];
  const seg = rng.pick(["budget", "mainstream", "premium", "hype"] as const);
  const segName = { budget: "Bargain hunters", mainstream: "Regular shoppers", premium: "Luxury buyers", hype: "Trend chasers" }[seg];
  let headline: string, effect: NewsEffect;
  switch (kind) {
    case 0: { const x = pct(1, 5); headline = up ? `Economy grows ${x}%: people spend a bit more` : `Economy shrinks ${x}%: people spend a bit less`; effect = { demandMultiplier: up ? 1 + x / 100 : 1 - x / 100 }; break; }
    case 1: { const x = pct(2, 7); headline = `${material} prices ${up ? "up" : "down"} ${x}%`; effect = { costMultiplier: up ? 1 + x / 100 : 1 - x / 100 }; break; }
    case 2: { const x = pct(3, 8); headline = `${segName} ${up ? "buy more" : "hold back"}: ${up ? "+" : "-"}${x}% in that group`; effect = { segmentMultiplier: { [seg]: up ? 1 + x / 100 : 1 - x / 100 } }; break; }
    case 3: { headline = up ? "Central bank raises interest by half a point" : "Central bank cuts interest by half a point"; effect = { interestDelta: up ? 0.005 : -0.005 }; break; }
    default: { const x = pct(1, 4); headline = up ? `Consumer confidence up: demand +${x}%` : `Consumer confidence down: demand -${x}%`; effect = { demandMultiplier: up ? 1 + x / 100 : 1 - x / 100 }; break; }
  }
  return { event: { id: `eco-${kind}-${state.round}`, headline, effect, duration: 1, kind: "economy" }, roundsLeft: 1 };
}

/** Picks the news for one round: a few small market-report items plus maybe a story. It breaks one round later, so an insider tip can reveal it early. */
function pickRoundNews(state: GameState, rng: Rng, industry: IndustryConfig): ActiveNews[] {
  const level = HOUSE_RULES.news[rulesOf(state).news];
  const [lo, hi] = level.strength === 1 ? ECONOMY.perRound : level.ecoPerRound;
  const kinds = rng.shuffle([0, 1, 2, 3, 4]).slice(0, lo + rng.int(hi - lo + 1));
  const items = kinds.map((k) => economyItem(state, rng, k));
  const story = pickNews(state, rng, industry);
  const all = story ? [story, ...items] : items;
  // Mega events: rare, hit every industry hard, never twice in a row.
  if (rulesOf(state).mega && state.round + 1 >= MEGA.fromRound && rng.chance(MEGA.chance)) {
    const recent = new Set([...state.news, ...(state.upcomingNews ?? [])].map((n) => n.event.id));
    const pool = MEGA.events.filter((e) => !recent.has(e.id) && !state.feed.some((f) => f.headline === e.headline));
    if (pool.length && !state.news.some((n) => n.event.kind === "mega")) {
      const e = rng.pick(pool);
      all.unshift({ event: { ...e, effect: e.effect as NewsEffect, kind: "mega" }, roundsLeft: e.duration });
    }
  }
  return level.strength === 1 ? all : all.map((n) => ({ ...n, event: { ...n.event, effect: scaleEffect(n.event.effect, level.strength) } }));
}
/** Calm or wild news: every multiplier's distance from 1 (and interest moves) scaled by k. */
function scaleEffect(e: NewsEffect, k: number): NewsEffect {
  const m = (x: number | undefined) => (x === undefined ? undefined : Math.max(0.05, 1 + (x - 1) * k));
  const out: NewsEffect = { ...e };
  if (e.costMultiplier !== undefined) out.costMultiplier = m(e.costMultiplier);
  if (e.demandMultiplier !== undefined) out.demandMultiplier = m(e.demandMultiplier);
  if (e.capacityMultiplier !== undefined) out.capacityMultiplier = m(e.capacityMultiplier);
  if (e.interestDelta !== undefined) out.interestDelta = e.interestDelta * k;
  if (e.randomCompanyBoost !== undefined) out.randomCompanyBoost = e.randomCompanyBoost * k;
  if (e.cheapestBoost !== undefined) out.cheapestBoost = e.cheapestBoost * k;
  if (e.segmentMultiplier) out.segmentMultiplier = Object.fromEntries(Object.entries(e.segmentMultiplier).map(([s, v]) => [s, m(v)]));
  return out;
}

function pickNews(state: GameState, rng: Rng, industry: IndustryConfig): ActiveNews | null {
  const difficulty = DIFFICULTIES[state.config.difficulty];
  if (!rng.chance(Math.min(1, difficulty.newsChance * HOUSE_RULES.news[rulesOf(state).news].storyChanceFactor))) return null;
  const usedIds = new Set(state.news.map((n) => n.event.id));
  const recentHeadlines = new Set(state.feed.map((f) => f.headline));
  let pool = industry.news.filter((e) => !usedIds.has(e.id) && !recentHeadlines.has(e.headline));
  if (pool.length === 0) pool = industry.news.filter((e) => !usedIds.has(e.id));
  if (pool.length === 0) return null;
  const event = rng.pick(pool);
  const active: ActiveNews = { event, roundsLeft: event.duration };
  if (event.effect.randomCompanyBoost) {
    const alive = state.companies.filter(operating);
    if (alive.length === 0) return null;
    active.targetCompanyId = rng.pick(alive).id;
  }
  return active;
}

export function newsHeadline(state: GameState, n: ActiveNews): string {
  const t = n.targetCompanyId ? state.companies.find((c) => c.id === n.targetCompanyId) : undefined;
  return t ? `${n.event.headline} (it's ${t.companyName})` : n.event.headline;
}

function drawNews(state: GameState, rng: Rng, industry: IndustryConfig) {
  // Special rounds: announced the round before, active in their round.
  for (const ev of state.specialEvents ?? []) {
    const def = EVENTS[ev.id];
    if (ev.round === state.round + 1) state.feed.push({ round: state.round, headline: `Coming next round: ${def.name}! ${def.description}.` });
    if (ev.round === state.round) {
      state.feed.push({ round: state.round, headline: `${def.name} is here: ${def.description.toLowerCase()}.` });
      if ("effect" in def) state.news.push({ event: { id: "event-" + ev.id, headline: def.name + ": " + def.description, effect: def.effect, duration: 1, kind: "economy" }, roundsLeft: 1 });
    }
  }
  if (!Array.isArray(state.upcomingNews)) state.upcomingNews = pickRoundNews(state, rng, industry);
  for (const next of state.upcomingNews) {
    const tgt = next.targetCompanyId ? state.companies.find((c) => c.id === next.targetCompanyId) : undefined;
    if (tgt && !operating(tgt)) {
      const alive = state.companies.filter(operating);
      next.targetCompanyId = alive.length ? rng.pick(alive).id : undefined;
    }
    state.news.push(next);
    state.feed.push({ round: state.round, headline: newsHeadline(state, next) });
  }
  state.upcomingNews = pickRoundNews(state, rng, industry);
}

const FLOP_LINES = [
  "{c}'s viral stunt flops: the video gets 12 views, 11 of them from {p}'s mum",
  "{c}'s viral stunt backfires: the internet decides the mascot is \"deeply unsettling\"",
  "{c} tried to go viral. Instead it went to court",
  "{c}'s influencer campaign collapses after the influencer is revealed to be three kids in a trench coat",
];

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

export function resolveRound(input: GameState, decisionsByCompany: Record<string, Partial<Decisions>>, deals: DealOrder[] = []): GameState {
  if (input.finished) throw new Error("Game is finished");
  const state = deepClone(input);
  const industry = INDUSTRIES[state.config.industry];
  const difficulty = difficultyOf(state);
  const rng = new Rng(state.rngState);
  const fx = activeNewsEffects(state);
  const round = state.round;
  const rules = rulesOf(state);
  let alive = state.companies.filter(operating);
  const n = state.companies.length;
  // Investor panic from earlier share dumps fades a bit every round.
  for (const c of state.companies) c.sentiment = (c.sentiment ?? 0) * BALANCE.sentimentRecovery;
  const startPrices = sharePrices(state);

  // 1. Decisions -------------------------------------------------------------
  const dec: Record<string, Decisions> = {};
  for (const c of alive) {
    if (c.takeoverCooldown > 0) c.takeoverCooldown--;
    dec[c.id] = sanitizeDecisions(state, c, decisionsByCompany[c.id]);
  }

  // Per-company working data.
  interface Work {
    c: Company;
    d: Decisions;
    produced: number;
    unitCost: number;
    available: number;
    avgCost: number;
    demandBySeg: Record<SegmentId, number>;
    demand: number;
    sold: number;
    viralFlop: boolean;
    events: string[];
    interest: number;
    debtStart: number;
    cashStart: number;
    inventoryStart: number;
    capacityStart: number;
    ucBase: number;
    expF: number;
    productionCash: number;
    matFromStock: number;
    matSpot: number;
    matSpotCost: number;
    overtimeUnits: number;
    overtimeCost: number;
    idleUnits: number;
    idleCost: number;
    retailDemand: number;
    retailSold: number;
    storesOpened: number;
    storesClosed: number;
  }
  // 2. Specials before the market: staff, wildcards, auction, summit vote, journalists. ------------
  const tycoon = state.config.difficulty === "tycoon";
  // Live exchange trades already moved cash and shares during the round: report them separately.
  const live = state.live && state.live.round === round ? state.live : null;
  const exNet: Record<string, number> = {};
  for (const t of live?.trades ?? []) exNet[t.trader] = (exNet[t.trader] ?? 0) + t.cash;
  for (const t of live?.trades ?? []) {
    if (t.qty >= 0) continue;
    const target = state.companies.find((c) => c.id === t.target);
    if (target && !target.bankrupt) target.sentiment = Math.min(BALANCE.sentimentMax, target.sentiment + Math.min(BALANCE.dumpImpactCapPerRound, -t.qty * BALANCE.dumpImpactPerShare));
  }
  // Live auction bids count as bids (the highest live bid against any sealed bid).
  for (const [lot, l] of Object.entries(live?.lots ?? {})) {
    if (!l.high || !dec[l.high.bidder]) continue;
    const d = dec[l.high.bidder];
    if (lot === "auction") d.auctionBid = Math.max(d.auctionBid, l.high.amount);
    else d.bankruptBids = { ...d.bankruptBids, [lot]: Math.max(d.bankruptBids[lot] ?? 0, l.high.amount) };
  }
  const cashAtStart: Record<string, number> = Object.fromEntries(alive.map((c) => [c.id, c.cash - (exNet[c.id] ?? 0)]));
  const byIdAll = new Map(state.companies.map((c) => [c.id, c]));
  const special: Record<string, { wildcard: number; legal: number; staff: number; auction: number; events: string[] }> = {};
  for (const c of alive) special[c.id] = { wildcard: 0, legal: 0, staff: 0, auction: 0, events: [] };

  // Deals between players: loan repayments that fall due, then this round's agreed deals. ----------
  const dealCash: Record<string, number> = {};
  const addDealCash = (id: string, x: number) => { dealCash[id] = (dealCash[id] ?? 0) + x; };
  const note = (id: string, text: string) => { if (special[id]) special[id].events.push(text); };
  const eur0 = (x: number) => "€" + Math.round(x).toLocaleString("en");
  state.dealLog = [];
  const dueLoans = (state.playerLoans ?? []).filter((l) => l.due <= round);
  state.playerLoans = (state.playerLoans ?? []).filter((l) => l.due > round);
  for (const l of dueLoans) {
    const borrower = byIdAll.get(l.borrower), lender = byIdAll.get(l.lender);
    if (!borrower || !lender || borrower.bankrupt) { if (lender) note(lender.id, `A loan to ${borrower?.companyName ?? "a bankrupt company"} won't be repaid: they went bust`); continue; }
    borrower.cash -= l.repay; addDealCash(borrower.id, -l.repay);
    if (!lender.bankrupt) { lender.cash += l.repay; addDealCash(lender.id, l.repay); }
    note(borrower.id, `Repaid ${eur0(l.repay)} to ${lender.companyName}`);
    note(lender.id, `${borrower.companyName} repaid ${eur0(l.repay)}`);
  }
  const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const reportsRef: { r?: Record<string, RoundReport> } = {};
  // Cash moved by deals, pact penalties and runner-up bonuses: shown in the report as deal cash.
  const moveCash = (payer: Company, payee: Company, amount: number, payerText: string, payeeText: string) => {
    payer.cash -= amount; payee.cash += amount;
    if (reportsRef.r) {
      const ra = reportsRef.r[payer.id], rv = reportsRef.r[payee.id];
      if (ra) { ra.dealCash = (ra.dealCash ?? 0) - amount; ra.events.push(payerText); }
      if (rv) { rv.dealCash = (rv.dealCash ?? 0) + amount; rv.events.push(payeeText); }
    } else {
      addDealCash(payer.id, -amount); addDealCash(payee.id, amount);
      note(payer.id, payerText); note(payee.id, payeeText);
    }
  };
  // Runner-up bonus: whoever takes control pays the largest other shareholder a share of the company's value.
  const payRunnerUp = (buyer: Company, target: Company) => {
    if (!rules.runnerUp) return;
    let best: Company | null = null, bestHeld = 0;
    for (const [hid, held] of Object.entries(target.shares.holders)) {
      const h = byIdAll.get(hid);
      if (!h || h.id === buyer.id || h.id === target.id || h.bankrupt || held <= bestHeld) continue;
      best = h; bestHeld = held;
    }
    if (!best || bestHeld < RUNNER_UP.minShares) return;
    const amount = Math.round(Math.max(0, startPrices[target.id] * 100) * RUNNER_UP.share);
    if (amount <= 0) return;
    moveCash(buyer, best, amount, `Paid ${best.companyName} a runner-up bonus of ${eur0(amount)} for taking over ${target.companyName}`, `Runner-up bonus: ${buyer.companyName} paid you ${eur0(amount)} for your ${bestHeld}% of ${target.companyName}`);
    state.feed.push({ round, headline: `${best.companyName} cashes a ${eur0(amount)} runner-up bonus from ${buyer.companyName} for its stake in ${target.companyName}` });
  };
  for (const deal of deals) {
    const from = byIdAll.get(deal.from), to = byIdAll.get(deal.to);
    const done = (ok: boolean, reason: string) => {
      state.dealLog!.push({ id: deal.id, round, ok, reason, from: deal.from, to: deal.to });
      if (!ok && from && to) { note(from.id, `Deal with ${to.companyName} fell through: ${reason}`); note(to.id, `Deal with ${from.companyName} fell through: ${reason}`); }
    };
    if (!from || !to || from.id === to.id || !operating(from) || !operating(to)) { done(false, "one of the companies is out of the game"); continue; }
    if ((deal.kind === "shares" || deal.kind === "merger") && !rules.takeovers) { done(false, "share deals and mergers are off in this game (house rules)"); continue; }
    if (deal.kind === "merger") {
      const t = deal.terms as MergerDealTerms;
      const survivor = t.survivor === from.id ? from : t.survivor === to.id ? to : null;
      if (!survivor) { done(false, "the terms don't add up"); continue; }
      const absorbed = survivor === from ? to : from;
      if (!rules.mergers) { done(false, "mergers are off in this game (house rules)"); continue; }
      if (round < difficulty.takeoverUnlockRound) { done(false, `mergers open in round ${difficulty.takeoverUnlockRound}`); continue; }
      const ruled = [survivor, absorbed].find((c) => c.controlledBy && c.controlledBy !== survivor.id && c.controlledBy !== absorbed.id);
      if (ruled) { done(false, `${ruled.companyName} is controlled by someone else`); continue; }
      // Big decision: if either company has other shareholders, its board votes on it next round.
      const boards = [survivor, absorbed].filter((c) => outsideVoters(state, c, c === survivor ? absorbed : survivor).length > 0);
      if (rules.votes && boards.length && round < state.config.rounds) {
        const group = `m${round}-${survivor.id}-${absorbed.id}`;
        state.board = state.board ?? [];
        for (const b of boards) state.board.push({ id: `${group}-${b.id}`, round: round + 1, company: b.id, kind: "merger", partner: b === survivor ? absorbed.id : survivor.id, survivor: survivor.id, group, votes: {} });
        state.feed.push({ round, headline: `${survivor.companyName} and ${absorbed.companyName} want to merge. Their shareholders vote next round` });
        for (const b of boards) for (const v of outsideVoters(state, b, b === survivor ? absorbed : survivor)) note(v, `Board vote next round: ${survivor.companyName} and ${absorbed.companyName} want to merge. You own ${b.shares.holders[v]}% of ${b.companyName}`);
        note(survivor.id, `Merger with ${absorbed.companyName} agreed: the shareholders vote on it next round`);
        note(absorbed.id, `Merger with ${survivor.companyName} agreed: the shareholders vote on it next round`);
        done(true, "agreed: the shareholders vote on it next round");
        continue;
      }
      const ok = mergeCompanies(state, survivor, absorbed, round);
      if (!ok) { done(false, "one of the companies has no value left to merge"); continue; }
      survivor.takeoverCooldown = Math.max(survivor.takeoverCooldown, MERGER.cooldown);
      note(survivor.id, `Merged with ${absorbed.originalName ?? absorbed.companyName}: you run the combined company`);
      note(absorbed.id, `Merged into ${survivor.companyName}: you now hold ${survivor.shares.holders[absorbed.id] ?? 0}% of it`);
      done(true, `${absorbed.originalName ?? absorbed.companyName} merged into ${survivor.companyName}`);
      continue;
    }
    if (deal.kind === "shares") {
      const t = deal.terms as ShareDealTerms;
      const target = byIdAll.get(t.company);
      const qty = Math.floor(Number(t.qty)), price = Number(t.price);
      if (!target || target.bankrupt) { done(false, "that company is gone"); continue; }
      if (!finite(price) || price < 0 || price > DEALS.maxPrice || !(qty >= 1 && qty <= 100)) { done(false, "the terms don't add up"); continue; }
      if (round < difficulty.takeoverUnlockRound) { done(false, `share trading opens in round ${difficulty.takeoverUnlockRound}`); continue; }
      const seller = t.direction === "buy" ? to : from, buyer = t.direction === "buy" ? from : to;
      const held = target.id === seller.id ? target.shares.founder : target.shares.holders[seller.id] ?? 0;
      if (held < qty) { done(false, `${seller.companyName} only had ${held} shares of ${target.companyName}`); continue; }
      if (target.controlledBy && target.controlledBy !== seller.id && target.controlledBy !== buyer.id) { done(false, `${target.companyName} is controlled by someone else`); continue; }
      if (buyer.cash < price) { done(false, `${buyer.companyName} couldn't pay ${eur0(price)}`); continue; }
      if (target.id === seller.id) target.shares.founder -= qty; else { const left = held - qty; if (left > 0) target.shares.holders[seller.id] = left; else delete target.shares.holders[seller.id]; }
      if (target.id === buyer.id) target.shares.founder += qty; else target.shares.holders[buyer.id] = (target.shares.holders[buyer.id] ?? 0) + qty;
      buyer.cash -= price; seller.cash += price; addDealCash(buyer.id, -price); addDealCash(seller.id, price);
      const nowHeld = target.id === buyer.id ? 0 : target.shares.holders[buyer.id];
      note(buyer.id, `Deal: bought ${qty} shares of ${target.companyName} from ${seller.companyName} for ${eur0(price)}`);
      note(seller.id, `Deal: sold ${qty} shares of ${target.companyName} to ${buyer.companyName} for ${eur0(price)}`);
      state.feed.push({ round, headline: `Backroom deal: ${buyer.companyName} buys ${qty}% of ${target.companyName} from ${seller.companyName}` });
      if (target.controlledBy === seller.id && (target.shares.holders[seller.id] ?? 0) <= BALANCE.controlThreshold) target.controlledBy = null;
      if (nowHeld > BALANCE.controlThreshold && target.controlledBy !== buyer.id) {
        target.controlledBy = buyer.id;
        buyer.takeoverCooldown = difficulty.takeoverCooldown;
        state.feed.push({ round, headline: `${buyer.playerName} now controls ${target.companyName}, sealed with a handshake. A truly friendly takeover.` });
        payRunnerUp(buyer, target);
        note(buyer.id, `Took control of ${target.companyName}`);
        if (target.id !== seller.id) note(target.id, `Taken over by ${buyer.companyName} in a backroom deal`);
      }
      done(true, `${qty} shares of ${target.companyName} for ${eur0(price)}`);
    } else if (deal.kind === "loan") {
      const t = deal.terms as LoanDealTerms;
      const amount = Number(t.amount), repay = Number(t.repay), rounds = Math.floor(Number(t.rounds));
      if (!finite(amount) || !finite(repay) || amount <= 0 || repay < 0 || amount > DEALS.maxLoan || repay > DEALS.maxLoan * 3 || !(rounds >= 1 && rounds <= DEALS.maxLoanRounds)) { done(false, "the terms don't add up"); continue; }
      const lender = t.direction === "borrow" ? to : from, borrower = t.direction === "borrow" ? from : to;
      if (lender.cash < amount) { done(false, `${lender.companyName} didn't have ${eur0(amount)} to lend`); continue; }
      lender.cash -= amount; borrower.cash += amount; addDealCash(lender.id, -amount); addDealCash(borrower.id, amount);
      const due = Math.min(state.config.rounds, round + rounds);
      state.playerLoans.push({ lender: lender.id, borrower: borrower.id, repay, due });
      note(lender.id, `Deal: lent ${eur0(amount)} to ${borrower.companyName}, ${eur0(repay)} comes back at the start of round ${due}`);
      note(borrower.id, `Deal: borrowed ${eur0(amount)} from ${lender.companyName}, repay ${eur0(repay)} at the start of round ${due}`);
      done(true, `${eur0(amount)} now, ${eur0(repay)} back in round ${due}`);
    } else if (deal.kind === "pact") {
      const t = deal.terms as PactDealTerms;
      const rounds = Math.floor(Number(t.rounds)), penalty = Number(t.penalty);
      if (!finite(penalty) || penalty < 0 || penalty > DEALS.maxPenalty || !(rounds >= 1 && rounds <= DEALS.maxPactRounds)) { done(false, "the terms don't add up"); continue; }
      state.pacts = (state.pacts ?? []).filter((p) => !((p.a === from.id && p.b === to.id) || (p.a === to.id && p.b === from.id)));
      state.pacts.push({ a: from.id, b: to.id, until: round + rounds - 1, penalty });
      note(from.id, `Pact with ${to.companyName}: no attacks through round ${round + rounds - 1} (breaking it costs ${eur0(penalty)})`);
      note(to.id, `Pact with ${from.companyName}: no attacks through round ${round + rounds - 1} (breaking it costs ${eur0(penalty)})`);
      state.feed.push({ round, headline: `${from.companyName} and ${to.companyName} sign a non-attack pact. Nobody believes it will last` });
      done(true, `no attacks through round ${round + rounds - 1}`);
    } else done(false, "unknown deal");
  }
  // Board votes due this round: mergers waiting for their shareholders, and extra loans above the credit line.
  const due = (state.board ?? []).filter((p) => p.round === round);
  state.board = (state.board ?? []).filter((p) => p.round > round);
  const tallies = new Map(due.map((p) => [p.id, boardTally(state, p)]));
  const groups = new Map<string, BoardProposal[]>();
  for (const p of due) if (p.kind === "merger" && p.group) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  for (const ps of groups.values()) {
    const first = ps[0];
    const survivor = byIdAll.get(first.survivor ?? ""), absorbed = byIdAll.get(first.company === first.survivor ? first.partner ?? "" : first.company);
    if (!survivor || !absorbed || !operating(survivor) || !operating(absorbed)) continue;
    const blocked = ps.find((p) => !tallies.get(p.id)!.passed);
    if (blocked) {
      const t = tallies.get(blocked.id)!, b = byIdAll.get(blocked.company)!;
      state.feed.push({ round, headline: `Shareholders of ${b.companyName} vote ${t.no}% to ${t.yes}% against the merger of ${survivor.companyName} and ${absorbed.companyName}. Blocked!` });
      note(survivor.id, `The merger with ${absorbed.companyName} was voted down by ${b.companyName}'s shareholders`);
      note(absorbed.id, `The merger with ${survivor.companyName} was voted down by ${b.companyName}'s shareholders`);
      continue;
    }
    const ruled = [survivor, absorbed].find((c) => c.controlledBy && c.controlledBy !== survivor.id && c.controlledBy !== absorbed.id);
    if (ruled || !rules.mergers || !mergeCompanies(state, survivor, absorbed, round)) { note(survivor.id, `The merger with ${absorbed.companyName} couldn't go ahead`); continue; }
    survivor.takeoverCooldown = Math.max(survivor.takeoverCooldown, MERGER.cooldown);
    state.feed.push({ round, headline: `The shareholders approve: ${absorbed.originalName ?? absorbed.companyName} merges into ${survivor.companyName}` });
    note(survivor.id, `Shareholders approved: merged with ${absorbed.originalName ?? absorbed.companyName}, you run the combined company`);
    note(absorbed.id, `Shareholders approved: merged into ${survivor.companyName}, you now hold ${survivor.shares.holders[absorbed.id] ?? 0}% of it`);
  }
  const approvedLoans: Record<string, number> = {};
  for (const p of due.filter((x) => x.kind === "loan")) {
    const c = byIdAll.get(p.company), t = tallies.get(p.id)!;
    if (!c || !operating(c)) continue;
    if (t.passed) {
      approvedLoans[c.id] = (approvedLoans[c.id] ?? 0) + (p.amount ?? 0);
      note(c.id, `Your shareholders approved the extra loan of ${eur0(p.amount ?? 0)} (${t.yes}% to ${t.no}%)`);
    } else {
      note(c.id, `Your shareholders voted down the extra loan of ${eur0(p.amount ?? 0)} (${t.no}% against)`);
      state.feed.push({ round, headline: `${c.companyName}'s shareholders refuse its request for an extra loan. Awkward board meeting` });
    }
  }
  // Companies merged away this round stop operating right now.
  alive = alive.filter(operating);
  // A pact is broken by buying the other's shares or aiming a wildcard at them: the attacker pays the penalty.
  const breakPact = (attacker: Company, victim: Company, how: string) => {
    const p = (state.pacts ?? []).find((x) => x.until >= round && ((x.a === attacker.id && x.b === victim.id) || (x.a === victim.id && x.b === attacker.id)));
    if (!p) return;
    state.pacts = (state.pacts ?? []).filter((x) => x !== p);
    moveCash(attacker, victim, p.penalty, `You broke your pact with ${victim.companyName} (${how}) and paid ${eur0(p.penalty)}`, `${attacker.companyName} broke your pact (${how}) and paid you ${eur0(p.penalty)}`);
    state.feed.push({ round, headline: `Betrayal! ${attacker.companyName} breaks its pact with ${victim.companyName} and pays ${eur0(p.penalty)}` });
  };
  const shielded = new Set<string>();
  const crazyBoost: Record<string, number> = {};
  const spyReports: Record<string, NonNullable<ResearchResult["spy"]>> = {};
  if (tycoon) {
    const wage = teamWage(industry);
    for (const c of alive) {
      const h = dec[c.id].hire;
      const fired = h < 0 ? Math.min(-h, c.workers) : 0;
      const hired = h > 0 ? h : 0;
      c.workers += hired - fired;
      const cost = c.workers * wage + hired * wage * TYCOON.hireCostFactor + fired * wage * TYCOON.severanceFactor;
      c.cash -= cost;
      special[c.id].staff = cost;
    }
  }
  for (const c of rng.shuffle(alive)) {
    const wc = dec[c.id].wildcard;
    if (!wc || !rules.wildcards) continue;
    const card = WILDCARDS[wc.card];
    const used = c.wildcardsUsed[wc.card] ?? 0;
    const target = wc.target ? byIdAll.get(wc.target) : undefined;
    if (used >= card.maxUses || (card.needsTarget && (!target || !operating(target) || target.id === c.id))) continue;
    if (card.needsTarget && target) breakPact(c, target, "a " + card.name.toLowerCase());
    c.wildcardsUsed[wc.card] = used + 1;
    c.cash -= card.cost;
    special[c.id].wildcard += card.cost;
    const exposed = card.exposeChance > 0 && rng.chance(card.exposeChance);
    const E = WILDCARD_EFFECTS;
    const crazy = INDUSTRIES[state.config.industry].crazyProducts;
    switch (wc.card as WildcardId) {
      case "crazy": {
        const product = rng.pick(crazy);
        if (rng.chance(E.crazySuccess)) {
          crazyBoost[c.id] = E.crazyUtility;
          c.hype = clamp(c.hype + E.crazyHype, 0, 100);
          state.feed.push({ round, headline: `${c.companyName} launches the ${product}. People are queueing around the block.` });
          special[c.id].events.push(`Crazy launch hit: ${product}`);
        } else {
          crazyBoost[c.id] = -0.3;
          c.brand = clamp(c.brand - E.crazyFlopBrand, 0, 100);
          c.hype = clamp(c.hype - E.crazyFlopHype, 0, 100);
          state.feed.push({ round, headline: `${c.companyName}'s ${product} is a disaster. Even the bins refuse it.` });
          special[c.id].events.push(`Crazy launch flopped: ${product}`);
        }
        break;
      }
      case "poach": {
        const stolen = target!.rndProgress * E.poachShare;
        target!.rndProgress -= stolen;
        c.rndProgress += stolen;
        special[c.id].events.push(`Poached €${Math.round(stolen).toLocaleString("en")} of R&D from ${target!.companyName}`);
        if (exposed) state.feed.push({ round, headline: `${target!.companyName}'s top scientists spotted carrying boxes into ${c.companyName}` });
        break;
      }
      case "spy": {
        const { wildcard: _w, journalistTarget: _j, ...plan } = dec[target!.id];
        spyReports[c.id] = { companyId: target!.id, companyName: target!.companyName, decisions: plan };
        if (exposed) state.feed.push({ round, headline: `Fake plumber caught in ${target!.companyName}'s boardroom. He works for ${c.companyName}.` });
        break;
      }
      case "lobby":
        shielded.add(c.id);
        special[c.id].events.push("Lobbied: shielded from bad news this round");
        break;
      case "scandal":
        target!.brand = clamp(target!.brand - E.scandalBrand, 0, 100);
        target!.hype = clamp(target!.hype - E.scandalHype, 0, 100);
        state.feed.push({ round, headline: exposed ? `Leaked memo shows ${c.companyName} spread the dirt on ${target!.companyName}` : `Scandal! Anonymous leak rocks ${target!.companyName}` });
        if (exposed) c.brand = clamp(c.brand - E.exposedBrand, 0, 100);
        break;
      case "lawsuit": {
        const backfire = rng.chance(E.lawsuitBackfire);
        const payer = backfire ? c : target!;
        payer.cash -= E.lawsuitCost;
        if (special[payer.id]) special[payer.id].legal += E.lawsuitCost;
        state.feed.push({ round, headline: backfire ? `Judge throws out ${c.companyName}'s lawsuit against ${target!.companyName} and makes them pay` : `${target!.companyName} loses a lawsuit filed by ${c.companyName}` });
        break;
      }
    }
  }
  if (state.auction && state.auction.round === round) {
    const bids = alive.map((c) => ({ c, bid: Math.min(dec[c.id].auctionBid, Math.max(0, c.cash)) })).filter((b) => b.bid >= AUCTION.minBid);
    if (bids.length) {
      const top = Math.max(...bids.map((b) => b.bid));
      const winner = rng.pick(bids.filter((b) => b.bid === top));
      const c = winner.c, item = state.auction.item;
      c.cash -= top;
      special[c.id].auction = top;
      if (item === "endorsement") c.brand = clamp(c.brand + 15, 0, 100);
      if (item === "patent") { c.qualityCap = Math.min(5, c.qualityCap + 1); c.rndProgress = Math.max(c.rndProgress, BALANCE.rndThresholds[c.qualityCap] ?? c.rndProgress); }
      if (item === "factory") c.capacity = Math.round(c.capacity + industry.start.capacity * 0.25);
      if (item === "location") c.stores = Math.min(RETAIL.maxStores, c.stores + 2);
      state.feed.push({ round, headline: `${c.companyName} wins the ${AUCTION.items[item].name.toLowerCase()} auction for €${Math.round(top).toLocaleString("en")}` });
      special[c.id].events.push(`Won the auction: ${AUCTION.items[item].name}`);
    } else {
      state.feed.push({ round, headline: `Nobody bids on the ${AUCTION.items[state.auction.item].name.toLowerCase()}. Awkward.` });
    }
  }
  // Bankruptcy sales: the highest sealed bid takes over a bankrupt company's factory and stores.
  for (const lot of (state.bankruptcySales ?? []).filter((l) => l.round === round)) {
    const dead = byIdAll.get(lot.companyId);
    if (!dead) continue;
    const bids = alive.map((c) => ({ c, bid: Math.min(dec[c.id].bankruptBids[dead.id] ?? 0, Math.max(0, c.cash)) })).filter((b) => b.bid >= BANKRUPTCY_SALE.minBid);
    const cap = Math.round(dead.capacity * BANKRUPTCY_SALE.capacityShare);
    if (bids.length) {
      const top = Math.max(...bids.map((b) => b.bid));
      const winner = rng.pick(bids.filter((b) => b.bid === top)).c;
      winner.cash -= top;
      special[winner.id].auction += top;
      winner.capacity += cap;
      const stores = Math.min(dead.stores, RETAIL.maxStores - winner.stores);
      winner.stores += stores;
      winner.brand = clamp(winner.brand + dead.brand * BANKRUPTCY_SALE.brandShare, 0, 100);
      state.feed.push({ round, headline: `${winner.companyName} buys what's left of ${dead.companyName} for €${Math.round(top).toLocaleString("en")}` });
      special[winner.id].events.push(`Bought ${dead.companyName}'s assets: +${cap.toLocaleString("en")} capacity${stores ? `, +${stores} stores` : ""}`);
    } else {
      state.feed.push({ round, headline: `Nobody bids on ${dead.companyName}'s old factory. It becomes a trampoline park.` });
    }
    dead.capacity = 0;
    dead.stores = 0;
  }
  if (state.bankruptcySales) state.bankruptcySales = state.bankruptcySales.filter((l) => l.round !== round);

  let passedRegulation: RegulationId | null = null;
  if (state.summit && state.summit.round === round) {
    const votes = { a: 0, b: 0 };
    for (const c of alive) { const v = dec[c.id].vote; if (v) votes[v]++; }
    const pick = votes.a === votes.b ? (rng.chance(0.5) ? "a" : "b") : votes.a > votes.b ? "a" : "b";
    passedRegulation = state.summit.options[pick === "a" ? 0 : 1];
    const reg = SUMMIT.regulations[passedRegulation];
    state.feed.push({ round, headline: `Industry summit votes ${Math.max(votes.a, votes.b)} to ${Math.min(votes.a, votes.b)} for the ${reg.name.toLowerCase()}` });
  }
  const journalistHits: { journalist: Company; target: Company; before: number }[] = [];
  for (const j of state.companies.filter((c) => c.bankrupt)) {
    const tid = decisionsByCompany[j.id]?.journalistTarget;
    const t = typeof tid === "string" ? byIdAll.get(tid) : undefined;
    if (!t || !operating(t)) continue;
    t.brand = clamp(t.brand - JOURNALIST.brand, 0, 100);
    t.hype = clamp(t.hype - JOURNALIST.hype, 0, 100);
    journalistHits.push({ journalist: j, target: t, before: startPrices[t.id] * 100 });
    state.feed.push({ round, headline: `Exclusive by reporter ${j.playerName}: what really goes on inside ${t.companyName}` });
  }

  const work: Work[] = alive.map((c) => {
    const d = dec[c.id];
    const shield = shielded.has(c.id);
    const debtStart = c.debt;
    const cashStart = cashAtStart[c.id];
    const inventoryStart = c.inventory;
    const capacityStart = c.capacity;
    const rate = BALANCE.baseInterest + (shield ? Math.min(0, fx.interestDelta) : fx.interestDelta) - GUIDANCE.interestPerPoint * (c.credibility ?? 0);
    const interest = debtStart * Math.max(0.01, rate);
    // Loans first, so a new loan can pay for this round.
    c.debt += d.loanChange;
    c.cash += d.loanChange;
    // Extra loans above the credit line: approved by the board this round, or straight away if nobody else owns shares.
    let extra = approvedLoans[c.id] ?? 0;
    if (rules.votes && d.boardLoan && d.boardLoan > 0) {
      const room = Math.max(0, BALANCE.maxDebt * BOARD.maxBoardDebtShare - c.debt - extra);
      const amount = Math.min(d.boardLoan, room);
      if (amount >= 10_000) {
        if (outsideVoters(state, c).length === 0) { extra += amount; special[c.id].events.push(`Extra loan of ${eur0(amount)} above the credit line (you own the whole board)`); }
        else if (round < state.config.rounds) {
          state.board = state.board ?? [];
          state.board.push({ id: `l${round}-${c.id}`, round: round + 1, company: c.id, kind: "loan", amount, votes: {} });
          special[c.id].events.push(`Asked your shareholders for an extra loan of ${eur0(amount)}: they vote next round`);
          state.feed.push({ round, headline: `${c.companyName} asks its shareholders for an extra ${eur0(amount)} loan. Vote next round` });
        }
      }
    }
    if (extra > 0) {
      extra = Math.min(extra, Math.max(0, BALANCE.maxDebt - c.debt));
      c.debt += extra; c.cash += extra;
      d.loanChange += extra;
    }
    const capMult = shield ? Math.max(1, fx.capacityMultiplier) : fx.capacityMultiplier;
    const staffCap = tycoon ? c.workers * teamOutput(industry) : Infinity;
    const factoryCap = Math.floor(c.capacity * capMult);
    const cap = Math.floor(Math.min(factoryCap, staffCap));
    const produced = Math.min(d.production, cap);
    // Unit cost: quality, news, raw material prices and the experience curve.
    const expF = experienceFactor(industry, c.cumProduced ?? 0);
    // Process cost (labour, energy, packaging): moved by the news; experience saves the same amount per unit at every quality.
    const newsCost = shield ? Math.min(1, fx.costMultiplier) : fx.costMultiplier;
    const mList = materialList(industry, d.quality, c.trait);
    const process = (unitCost(industry, d.quality, 1, c.trait, tycoon) - mList) * newsCost - (1 - expF) * unitCost(industry, 1, 1, c.trait, tycoon);
    // Materials: from stock (bought a round earlier at that round's price), the rest on the spot market at a premium.
    const idxNow = state.market?.materialIndex ?? 1;
    const need = produced * mList;
    const matFromStock = Math.min(need, c.materials ?? need);
    const matSpot = need - matFromStock;
    const matSpotCost = matSpot * idxNow * (1 + COSTS.spotPremium);
    const materialCost = matFromStock * (c.materialPaid ?? 1) + matSpotCost;
    c.materials = (c.materials ?? need) - matFromStock;
    const ucBase = produced > 0 ? process + materialCost / produced : process + mList * idxNow;
    // Factory load: overtime above 90% of capacity, idle machines below 60%.
    const overtimeUnits = Math.max(0, produced - Math.floor(factoryCap * COSTS.overtimeFrom));
    const overtimeCost = overtimeUnits * ucBase * COSTS.overtimePremium;
    const idleUnits = Math.max(0, Math.floor(factoryCap * COSTS.idleBelow) - produced);
    const idleCost = idleUnits * COSTS.idleCostRate * industry.baseUnitCost;
    const uc = produced > 0 ? (produced * ucBase + overtimeCost) / produced : ucBase;
    // Cash now: the process, spot materials and overtime (stock materials were paid when ordered).
    const productionCash = produced * process + matSpotCost + overtimeCost;
    const available = c.inventory + produced;
    const avgCost = available > 0 ? (c.inventory * c.inventoryUnitCost + produced * uc) / available : uc;
    const viralFlop = d.campaign === "viral" && d.marketingBudget > 0 && rng.chance(CAMPAIGNS.viral.flopChance);
    let storesOpened = 0, storesClosed = 0;
    if (round >= difficulty.retailUnlockRound) {
      storesClosed = Math.min(d.storesClose, c.stores);
      c.stores -= storesClosed;
      storesOpened = Math.min(d.storesOpen, RETAIL.maxStores - c.stores);
      c.stores += storesOpened;
    }
    return {
      c,
      d,
      produced,
      unitCost: uc,
      available,
      avgCost,
      demandBySeg: { budget: 0, mainstream: 0, premium: 0, hype: 0 },
      demand: 0,
      sold: 0,
      viralFlop,
      events: [],
      interest,
      debtStart,
      cashStart,
      inventoryStart,
      capacityStart,
      ucBase,
      expF,
      productionCash,
      matFromStock,
      matSpot,
      matSpotCost,
      overtimeUnits,
      overtimeCost,
      idleUnits,
      idleCost,
      retailDemand: 0,
      retailSold: 0,
      storesOpened,
      storesClosed,
    };
  });

  // 2. Market -----------------------------------------------------------------
  const cheapest = work.length ? work.reduce((a, b) => (b.d.price < a.d.price ? b : a)) : null;
  const marketSize = industry.potentialPerCompany * n * marketScale(state, round) * fx.demandMultiplier;
  // Buyers judge every offer against what the others offer: quality, brand and hype count relative to
  // the market average, and their sense of a normal price drifts toward what companies actually charge.
  const offers = work.filter((w) => w.available > 0);
  const avg = (f: (w: Work) => number) => (offers.length ? offers.reduce((a, w) => a + f(w), 0) / offers.length : 0);
  const avgQ = offers.length ? avg((w) => w.d.quality) : 3;
  const avgBrand = offers.length ? avg((w) => w.c.brand) : 30;
  const avgHype = offers.length ? avg((w) => w.c.hype) : 10;
  const avgPrice = offers.length ? avg((w) => w.d.price) : 0;
  const refAvg = SEGMENTS.reduce((a, s) => a + industry.segments[s].weight * industry.segments[s].refPrice, 0);
  const potentials = { budget: 0, mainstream: 0, premium: 0, hype: 0 } as Record<SegmentId, number>;
  const drift = avgPrice > 0 ? Math.max(0.6, Math.min(1.6, 1 + BALANCE.priceAnchorDrift * (avgPrice / refAvg - 1))) : 1;
  for (const s of SEGMENTS) {
    const seg = industry.segments[s];
    const ref = seg.refPrice * drift;
    const potential = marketSize * seg.weight * fx.segmentMultiplier[s] * trendFactor(state, s, round);
    const sensitivity = seg.priceSensitivity * (state.market?.sensitivity?.[s] ?? 1);
    potentials[s] = Math.round(potential);
    const attraction = work.map((w) => {
      if (w.available <= 0) return 0;
      const { c, d } = w;
      let u = -sensitivity * (d.price / ref - 1);
      u += seg.qualityWeight * (d.quality - avgQ);
      u += seg.brandWeight * ((c.brand - avgBrand) / 25);
      u += seg.hypeWeight * ((c.hype - avgHype) / 25);
      if (seg.cheapPenaltyBelow && d.price < seg.cheapPenaltyBelow * ref) u -= seg.cheapPenalty ?? 0;
      if (d.marketingBudget > 0) {
        const camp = CAMPAIGNS[d.campaign];
        const weight = w.viralFlop ? -0.2 : camp.segment[s];
        u += weight * Math.log(1 + d.marketingBudget / BALANCE.marketingScale);
      }
      const boost = fx.companyBoost[c.id] ?? 0;
      if (boost) u += Math.log(1 + boost);
      if (fx.cheapestBoost && cheapest === w) u += Math.log(1 + fx.cheapestBoost);
      if (crazyBoost[c.id]) u += crazyBoost[c.id] * (s === "hype" ? 1 : s === "mainstream" ? 0.3 : 0);
      return Math.exp(Math.min(u, 30));
    });
    const denom = BALANCE.outsideOptionWeight * n + attraction.reduce((a, b) => a + b, 0);
    work.forEach((w, i) => {
      const q = (potential * attraction[i]) / denom;
      w.demandBySeg[s] = q;
      w.demand += q;
    });
  }
  // Own stores: a separate retail market. Only companies with stores compete; each store can sell a fixed amount.
  const retailRef = retailRefPrice(industry);
  const retailPotential = marketSize * RETAIL.potentialShare;
  const storeCap = storeCapacity(industry);
  const retailAttraction = work.map((w) => {
    if (w.c.stores <= 0 || w.available <= 0) return 0;
    let u = -RETAIL.priceSensitivity * (w.d.retailPrice / retailRef - 1);
    u += RETAIL.qualityWeight * (w.d.quality - 3);
    u += RETAIL.brandWeight * ((w.c.brand - 30) / 25);
    u += RETAIL.hypeWeight * ((w.c.hype - 10) / 25);
    u += RETAIL.reachWeight * Math.log(w.c.stores);
    return Math.exp(Math.min(u, 30));
  });
  const retailDenom = BALANCE.outsideOptionWeight * n + retailAttraction.reduce((a, b) => a + b, 0);
  work.forEach((w, i) => {
    w.retailDemand = Math.min((retailPotential * retailAttraction[i]) / retailDenom, w.c.stores * storeCap);
    // Own stores are served first from stock.
    w.retailSold = Math.floor(Math.min(w.retailDemand, w.available));
  });

  // Cap shop sales by the stock left, then let part of the unmet demand switch to rivals with stock left.
  let unmetPool = 0;
  for (const w of work) {
    w.sold = Math.min(w.demand, w.available - w.retailSold);
    unmetPool += w.demand - w.sold;
  }
  const switching = unmetPool * BALANCE.switchRate;
  const withStock = work.filter((w) => w.available - w.retailSold - w.sold > 0.5);
  const stockWeight = withStock.reduce((a, w) => a + w.demand, 0);
  if (switching > 0 && stockWeight > 0) {
    for (const w of withStock) {
      const extra = Math.min(w.available - w.retailSold - w.sold, (switching * w.demand) / stockWeight);
      w.sold += extra;
    }
  }
  for (const w of work) w.sold = Math.floor(w.sold);

  // Segment shares for the report.
  const segSold: Record<SegmentId, number> = { budget: 0, mainstream: 0, premium: 0, hype: 0 };
  const segOf = (w: Work, s: SegmentId) => (w.demand > 0 ? (w.sold * w.demandBySeg[s]) / w.demand : 0);
  for (const w of work) for (const s of SEGMENTS) segSold[s] += segOf(w, s);
  state.marketLog = [...(state.marketLog ?? []), { round, potential: potentials, sold: Object.fromEntries(SEGMENTS.map((s) => [s, Math.round(segSold[s])])) as Record<SegmentId, number>, materialIndex: state.market?.materialIndex ?? 1, avgPrice: Math.round(avgPrice * 100) / 100 }];

  // 3. Accounting ---------------------------------------------------------------
  const profitById: Record<string, number> = {};
  const reports: Record<string, RoundReport> = {};
  for (const w of work) {
    const { c, d } = w;
    const totalSold = w.sold + w.retailSold;
    const retailRevenue = w.retailSold * d.retailPrice;
    const revenue = w.sold * d.price + retailRevenue + (state.market?.bulkPrice ?? 0) * Math.max(0, Math.min(d.bulkSell, w.available - (w.sold + w.retailSold), Math.round(c.capacity * BULK.maxShareOfCapacity)));
    // Bulk buyer: takes leftover stock after the market at a low price.
    const bulkPrice = state.market?.bulkPrice ?? 0;
    const bulkSold = bulkPrice > 0 ? Math.max(0, Math.min(d.bulkSell, w.available - totalSold, Math.round(c.capacity * BULK.maxShareOfCapacity))) : 0;
    const bulkRevenue = bulkSold * bulkPrice;
    const cogs = (totalSold + bulkSold) * w.avgCost;
    const inventoryEnd = w.available - totalSold - bulkSold;
    const storeOpenCost = w.storesOpened * RETAIL.openCost;
    const storeUpkeep = c.stores * RETAIL.upkeep;
    // Order materials for next round at today's price.
    const orderList = d.materialOrder * materialList(industry, d.quality, c.trait);
    const idxNow = state.market?.materialIndex ?? 1;
    const materialOrderCost = orderList * idxNow;
    if (orderList > 0) {
      c.materialPaid = ((c.materials ?? 0) * (c.materialPaid ?? 1) + orderList * idxNow) / ((c.materials ?? 0) + orderList);
      c.materials = (c.materials ?? 0) + orderList;
    }
    const holdingCost = inventoryEnd * w.avgCost * BALANCE.holdingCostRate + (c.materials ?? 0) * (c.materialPaid ?? 1) * COSTS.materialHolding;
    const fixedCost = c.capacity * BALANCE.fixedCostPerCapacity * industry.baseUnitCost;
    const productionCost = w.productionCash;
    const researchCost = d.research.reduce((a, r) => a + RESEARCH[r].cost, 0);
    const sp = special[c.id];
    // Same array as w.events, so share trades and takeovers added later still show up in the report.
    w.events.unshift(...sp.events);
    const profit = revenue - cogs - holdingCost - fixedCost - w.idleCost - d.marketingBudget - d.investRnd - d.investBrand - researchCost - storeUpkeep - w.interest - sp.wildcard - sp.legal - sp.staff - sp.auction;
    c.cash += revenue - productionCost - materialOrderCost - holdingCost - fixedCost - w.idleCost - d.marketingBudget - d.investRnd - d.investBrand - researchCost - d.investCapacity - storeOpenCost - storeUpkeep - w.interest;
    c.cumProduced = (c.cumProduced ?? 0) + w.produced;
    // Investor call: compare the guidance with what actually happened.
    let guidance: RoundReport["guidance"];
    if (d.guidance && round >= 1) {
      const unitsErr = Math.abs(d.guidance.units - totalSold) / Math.max(1, totalSold);
      const profitErr = Math.abs(d.guidance.profit - profit) / Math.max(1, Math.abs(profit), 0.1 * revenue);
      const result: GuidanceResult = unitsErr <= GUIDANCE.hit[0] && profitErr <= GUIDANCE.hit[1] ? "hit" : unitsErr > GUIDANCE.miss[0] || profitErr > GUIDANCE.miss[1] ? "miss" : "close";
      const [lo, hi] = GUIDANCE.credibilityRange;
      c.credibility = clamp((c.credibility ?? 0) + (result === "hit" ? 1 : result === "miss" ? -1 : 0), lo, hi);
      guidance = { ...d.guidance, result, unitsErr, profitErr };
      w.events.push(result === "hit" ? "Investor call: spot on. Investors trust you more" : result === "miss" ? "Investor call: way off. Investors trust you less" : "Investor call: close, but not close enough to impress");
      if (result === "hit" && c.credibility === hi) state.feed.push({ round, headline: `Analysts call ${c.companyName} "boringly accurate". The share price loves it` });
      else if (result === "miss" && Math.abs(profit - d.guidance.profit) > 0.5 * Math.max(Math.abs(profit), 0.1 * revenue)) state.feed.push({ round, headline: `${c.companyName} misses its own forecast by a mile. Investors ask if anyone owns a calculator` });
    }
    c.inventory = inventoryEnd;
    c.inventoryUnitCost = inventoryEnd > 0 ? w.avgCost : 0;
    profitById[c.id] = profit;
    const segments = {} as Record<SegmentId, SegmentSales>;
    for (const s of SEGMENTS) {
      const sold = segOf(w, s);
      segments[s] = { demand: Math.round(w.demandBySeg[s]), sold: Math.round(sold), share: segSold[s] > 0 ? sold / segSold[s] : 0 };
    }
    reports[c.id] = {
      round,
      cashStart: w.cashStart,
      loanChange: d.loanChange,
      capacity: w.capacityStart,
      inventoryStart: w.inventoryStart,
      capacityInvest: d.investCapacity,
      researchCost,
      sharePurchases: 0,
      buybackCost: 0,
      emergencyLoan: 0,
      emergencyFee: 0,
      wildcardCost: sp.wildcard,
      shareSales: 0,
      legalCost: sp.legal,
      staffCost: sp.staff,
      workers: c.workers,
      auctionPaid: sp.auction,
      showdownPaid: 0,
      dealCash: dealCash[c.id] ?? 0,
      wholesaleSold: w.sold,
      retailPrice: d.retailPrice,
      retailDemand: Math.round(w.retailDemand),
      retailSold: w.retailSold,
      retailRevenue,
      stores: c.stores,
      storesOpened: w.storesOpened,
      storesClosed: w.storesClosed,
      storeOpenCost,
      storeUpkeep,
      price: d.price,
      quality: d.quality,
      produced: w.produced,
      sold: totalSold,
      unmetDemand: Math.max(0, Math.round(w.demand - w.sold + w.retailDemand - w.retailSold)),
      inventoryEnd,
      revenue,
      productionCost,
      holdingCost,
      fixedCost,
      marketingCost: d.marketingBudget,
      rndCost: d.investRnd,
      brandCost: d.investBrand,
      interest: w.interest,
      dividendsPaid: 0,
      dividendsReceived: 0,
      profit,
      cashEnd: 0,
      debtEnd: 0,
      value: 0,
      sharePrice: 0,
      segments,
      events: w.events,
      materialIndex: state.market?.materialIndex ?? 1,
      materialOrderUnits: d.materialOrder,
      materialOrderCost,
      materialFromStock: w.matFromStock,
      materialSpot: w.matSpot,
      materialSpotCost: w.matSpotCost,
      materialStockEnd: c.materials ?? 0,
      bulkSold,
      bulkRevenue,
      bulkPrice,
      exchangeCash: exNet[c.id] ?? 0,
      experienceFactor: w.expF,
      unitCostBase: w.ucBase,
      utilization: w.capacityStart > 0 ? w.produced / Math.max(1, Math.floor(w.capacityStart * (shielded.has(c.id) ? Math.max(1, fx.capacityMultiplier) : fx.capacityMultiplier))) : 0,
      overtimeUnits: w.overtimeUnits,
      overtimeCost: w.overtimeCost,
      idleUnits: w.idleUnits,
      idleCost: w.idleCost,
      guidance,
      credibility: c.credibility ?? 0,
    };
  }

  reportsRef.r = reports;

  // 4. Brand, hype, R&D, capacity -------------------------------------------------
  for (const w of work) {
    const { c, d } = w;
    const camp = CAMPAIGNS[d.campaign];
    const mStep = Math.log(1 + d.marketingBudget / BALANCE.marketingScale);
    const influencer = c.trait === "influencer" ? TRAIT_EFFECTS.influencerHypeFactor : 1;
    c.brand = c.brand * BALANCE.brandDecay + BALANCE.brandGainPerStep * Math.log(1 + d.investBrand / BALANCE.brandScale);
    c.hype = c.hype * BALANCE.hypeDecay;
    if (w.viralFlop) {
      c.hype -= 8;
      c.brand -= 3;
      const line = rng.pick(FLOP_LINES).replace("{c}", c.companyName).replace("{p}", c.playerName);
      state.feed.push({ round, headline: line });
      w.events.push("Viral stunt flopped");
    } else {
      c.hype += camp.hypeGain * mStep * influencer;
      c.brand += camp.brandGain * mStep;
    }
    c.brand = clamp(c.brand, 0, 100);
    c.hype = clamp(c.hype, 0, 100);
    const visionary = c.trait === "visionary" ? TRAIT_EFFECTS.visionaryRndFactor : 1;
    c.rndProgress += d.investRnd * visionary;
    let cap = 3;
    if (c.rndProgress >= BALANCE.rndThresholds[4]) cap = 4;
    if (c.rndProgress >= BALANCE.rndThresholds[5]) cap = 5;
    if (cap > c.qualityCap) w.events.push(`R&D breakthrough: quality ${cap} unlocked`);
    c.qualityCap = Math.max(c.qualityCap, cap);
    c.capacity = Math.round(c.capacity * (1 - BALANCE.capacityDepreciation) + d.investCapacity / (BALANCE.capacityCostPerUnit * industry.baseUnitCost));
    if (d.productName) c.productName = d.productName;
    if (d.style !== undefined) c.style = d.style;
    c.dividendPolicy = d.dividendPolicy ?? 0;
    c.lastDecisions = { ...d, sellShares: {}, loanChange: 0, buyShares: {}, buyback: 0, research: [], storesOpen: 0, storesClose: 0, wildcard: null, takeoverStake: 0, auctionBid: 0, bankruptBids: {}, vote: null, hire: 0, guidance: null, bulkSell: 0, productName: undefined, style: undefined, boardLoan: 0 };
  }
  // Reviews: what critics and customers say about each product (public, just for fun; no effect on the numbers).
  for (const w of work) {
    const r = reports[w.c.id], c = w.c;
    const score = 0.7 * (w.d.quality - avgQ) - 3 * (avgPrice > 0 ? w.d.price / avgPrice - 1 : 0) + (c.brand - avgBrand) / 40 + (crazyBoost[c.id] ?? 0) * 0.8;
    const stars = clamp(Math.round(3 + score), 1, 5);
    const h = hash(`${state.config.seed}:${round}:${c.id}`);
    const pick = (list: string[], k: number) => list[(h >>> k) % list.length];
    const fill = (t: string) => t.replace(/\{p\}/g, c.productName || c.companyName).replace(/\{u\}/g, industry.labels.product).replace(/\{c\}/g, c.companyName);
    const quotes = [fill(pick(REVIEWS.critic[stars], 0))];
    const soldOut = r.unmetDemand > 0 && r.inventoryEnd === 0;
    const extra = w.viralFlop ? REVIEWS.flop : (crazyBoost[c.id] ?? 0) > 0 ? REVIEWS.launch : soldOut ? REVIEWS.soldOut : r.inventoryEnd > 0.3 * Math.max(1, w.available) ? REVIEWS.leftover
      : avgPrice > 0 && w.d.price < avgPrice * 0.8 ? REVIEWS.cheap : avgPrice > 0 && w.d.price > avgPrice * 1.3 ? REVIEWS.luxury : c.hype > avgHype + 15 ? REVIEWS.hype : null;
    if (extra) quotes.push(fill(pick(extra, 7)));
    r.reviews = { stars, quotes };
  }

  // 5. Share trading: sales first, then buybacks (defense), then purchases in random order. ------
  const byId = new Map(state.companies.map((c) => [c.id, c]));
  for (const w of rng.shuffle(work)) {
    const seller = w.c;
    if (!rules.takeovers) break;
    for (const [targetId, requested] of Object.entries(w.d.sellShares)) {
      const target = byId.get(targetId);
      if (!target) continue;
      const held = target.shares.holders[seller.id] ?? 0;
      const qty = Math.min(requested, held);
      if (qty <= 0) continue;
      // Dumping shares scares investors: the price drops before your own sale goes through.
      const impact = target.bankrupt ? 0 : Math.min(BALANCE.dumpImpactCapPerRound, qty * BALANCE.dumpImpactPerShare, BALANCE.sentimentMax - target.sentiment);
      target.sentiment += Math.max(0, impact);
      const price = startPrices[target.id] * (1 - Math.max(0, impact)) * (1 - BALANCE.sellDiscount);
      seller.cash += qty * price;
      reports[seller.id].shareSales += qty * price;
      const left = held - qty;
      if (left > 0) target.shares.holders[seller.id] = left; else delete target.shares.holders[seller.id];
      target.shares.float += qty;
      w.events.push(`Sold ${qty} shares of ${target.companyName} (now ${left}%)`);
      reports[target.id]?.events.push(`${seller.companyName} dumped ${qty} of your shares`);
      if (target.controlledBy === seller.id && left <= BALANCE.controlThreshold) {
        target.controlledBy = null;
        state.feed.push({ round, headline: `${seller.companyName} lets go of ${target.companyName}: no longer in control` });
      }
      if (qty >= 10 && impact > 0) {
        state.feed.push({ round, headline: `${seller.companyName} dumps ${qty} shares of ${target.companyName}. Investors panic: share price down ${Math.round(impact * 100)}%` });
      }
    }
  }
  for (const w of work) {
    const { c, d } = w;
    if (d.buyback <= 0) continue;
    const price = startPrices[c.id] * (1 + BALANCE.buybackPremium);
    const qty = Math.min(d.buyback, c.shares.float, price > 0 ? Math.floor(Math.max(0, c.cash) / price) : 0);
    if (qty > 0) {
      c.cash -= qty * price;
      reports[c.id].buybackCost += qty * price;
      c.shares.float -= qty;
      c.shares.treasury += qty;
      w.events.push(`Bought back ${qty} own shares`);
    }
  }
  const showdownDone = new Set<string>();
  if (round >= difficulty.takeoverUnlockRound && rules.takeovers) {
    for (const w of rng.shuffle(work)) {
      const buyer = w.c;
      if (buyer.takeoverCooldown > 0) {
        if (Object.keys(w.d.buyShares).length) w.events.push("Couldn't buy shares: your board is resting after a takeover");
        continue;
      }
      for (const [targetId, requested] of Object.entries(w.d.buyShares)) {
        const target = byId.get(targetId);
        if (!target || !operating(target) || target.id === buyer.id) continue;
        if (target.controlledBy && target.controlledBy !== buyer.id) { w.events.push(`Couldn't buy shares of ${target.companyName}: it's controlled by someone else`); continue; }
        breakPact(buyer, target, "bought its shares");
        const held = target.shares.holders[buyer.id] ?? 0;
        const ruthless = buyer.trait === "ruthless" ? TRAIT_EFFECTS.ruthlessPremiumFactor : 1;
        const investorDay = (state.specialEvents ?? []).some((e) => e.round === round && e.id === "investorDay") ? EVENTS.investorDay.premiumFactor : 1;
        const premium = (BALANCE.takeoverPremium + BALANCE.premiumPerHeldShare * held) * ruthless * investorDay;
        const price = startPrices[target.id] * (1 + premium);
        if (price <= 0) continue;
        const afford = Math.floor(Math.max(0, buyer.cash) / price);
        // One limit per company per round, shared with what was bought on the live exchange.
        const already = (live?.trades ?? []).filter((t) => t.trader === buyer.id && t.target === target.id && t.qty > 0).reduce((a, t) => a + t.qty, 0);
        const room = Math.max(0, difficulty.maxSharesPerRound - already);
        let qty = Math.min(requested, target.shares.float, room, afford);
        if (qty < requested) {
          // Tell the buyer why they got fewer shares than they asked for.
          const why = qty === afford && afford < Math.min(target.shares.float, room)
            ? `not enough cash left after this round's other costs (shares cost €${Math.round(price).toLocaleString("en")} each)`
            : qty === target.shares.float ? `only ${target.shares.float} were for sale` : `you can buy at most ${difficulty.maxSharesPerRound} per company per round${already ? ` and already bought ${already} on the exchange` : ""}`;
          w.events.push(qty > 0 ? `Wanted ${requested} shares of ${target.companyName}, got ${qty}: ${why}` : `Couldn't buy shares of ${target.companyName}: ${why}`);
        }
        if (qty <= 0) continue;
        // Boardroom showdown: a bid for control meets the target's sealed defense fund.
        if (held + qty > BALANCE.controlThreshold && !target.controlledBy && !showdownDone.has(target.id) && !target.bankrupt) {
          const defense = Math.min(dec[target.id]?.defenseStake ?? 0, Math.max(0, target.cash));
          if (defense >= SHOWDOWN.minStake) {
            showdownDone.add(target.id);
            const attack = Math.min(w.d.takeoverStake, Math.max(0, buyer.cash - qty * price));
            buyer.cash -= attack; target.cash -= defense;
            reports[buyer.id].showdownPaid += attack;
            if (reports[target.id]) reports[target.id].showdownPaid += defense;
            if (attack > defense) {
              state.feed.push({ round, headline: `Boardroom showdown! ${buyer.companyName} outbids ${target.companyName}'s defense` });
            } else {
              qty = Math.max(0, BALANCE.controlThreshold - held);
              w.events.push(`Your purchase was stopped at 50% of ${target.companyName}: their defense fund beat your attack stake`);
              state.feed.push({ round, headline: `Boardroom showdown! ${target.companyName} fights off ${buyer.companyName}'s takeover` });
              reports[target.id]?.events.push(`Won a boardroom showdown against ${buyer.companyName}`);
              w.events.push(`Lost a boardroom showdown against ${target.companyName}`);
              if (qty <= 0) continue;
            }
          }
        }
        buyer.cash -= qty * price;
        reports[buyer.id].sharePurchases += qty * price;
        target.shares.float -= qty;
        const nowHeld = held + qty;
        target.shares.holders[buyer.id] = nowHeld;
        w.events.push(`Bought ${qty} shares of ${target.companyName} (now ${nowHeld}%)`);
        reports[target.id]?.events.push(`${buyer.companyName} bought ${qty} of your shares (now holds ${nowHeld}%)`);
        if (held < HOSTILE_BID_SHARES && nowHeld >= HOSTILE_BID_SHARES && nowHeld <= BALANCE.controlThreshold) {
          state.feed.push({ round, headline: `Hostile bid! ${buyer.companyName} now owns ${nowHeld}% of ${target.companyName}. ${target.companyName} has one round to defend itself` });
          reports[target.id]?.events.push(`HOSTILE BID: ${buyer.companyName} owns ${nowHeld}% of you. Defend now: buy back shares, set a defense fund, or find a friendly buyer`);
        } else if (held < 20 && nowHeld >= 20 && nowHeld <= BALANCE.controlThreshold) {
          state.feed.push({ round, headline: `Rumours: ${buyer.companyName} is circling ${target.companyName} and now owns ${nowHeld}%` });
        }
        if (nowHeld > BALANCE.controlThreshold && target.controlledBy !== buyer.id) {
          target.controlledBy = buyer.id;
          buyer.takeoverCooldown = difficulty.takeoverCooldown;
          state.feed.push({ round, headline: `${buyer.playerName} now owns ${nowHeld}% of ${target.companyName}. A very friendly takeover.` });
          payRunnerUp(buyer, target);
          w.events.push(`Took control of ${target.companyName}`);
          reports[target.id]?.events.push(`Taken over by ${buyer.companyName}`);
        }
      }
    }
  }

  // 6. Subsidiaries pay dividends to their shareholders. ------------------------------------
  for (const w of work) {
    const c = w.c;
    if (!c.controlledBy) continue;
    const profit = profitById[c.id];
    if (profit <= 0) continue;
    const payout = Math.min(profit * BALANCE.subsidiaryPayout, Math.max(0, c.cash));
    if (payout <= 0) continue;
    c.cash -= payout;
    reports[c.id].dividendsPaid = payout;
    for (const [holderId, held] of Object.entries(c.shares.holders)) {
      const holder = byId.get(holderId);
      if (!holder || holder.bankrupt) continue;
      const part = (payout * held) / 100;
      holder.cash += part;
      if (reports[holderId]) reports[holderId].dividendsReceived += part;
    }
  }

  // Quarterly dividends (every 3 rounds): independent companies pay their policy share of the quarter's profit.
  // The founder's part stays in the company; other shareholders get cash; the float's part goes to outside investors.
  if (rules.dividends && round >= DIVIDENDS.every && round % DIVIDENDS.every === 0) {
    for (const w of work) {
      const c = w.c, policy = c.dividendPolicy ?? 0;
      if (!policy || c.controlledBy || !operating(c)) continue;
      const quarter = c.history.filter((h) => h.round > round - DIVIDENDS.every && h.round < round).reduce((a, h) => a + h.profit, 0) + profitById[c.id];
      const declared = Math.round((Math.max(0, quarter) * policy) / 100);
      const outside = 100 - c.shares.founder - c.shares.treasury;
      const cashOut = Math.min(Math.round((declared * outside) / 100), Math.max(0, c.cash));
      if (declared <= 0 || cashOut <= 0) { w.events.push(`No quarterly dividend: no profit to share this quarter`); continue; }
      const scale = cashOut / ((declared * outside) / 100);
      c.cash -= cashOut;
      reports[c.id].dividendsPaid += cashOut;
      c.lastDividend = { round, amount: declared };
      w.events.push(`Quarterly dividend: ${policy}% of the quarter's profit, ${eur0(cashOut)} paid to shareholders`);
      for (const [holderId, held] of Object.entries(c.shares.holders)) {
        const holder = byId.get(holderId);
        if (!holder || holder.bankrupt) continue;
        const part = Math.round((declared * held * scale) / 100);
        holder.cash += part;
        if (reports[holderId]) { reports[holderId].dividendsReceived += part; reports[holderId].events.push(`Dividend from ${c.companyName}: ${eur0(part)} for your ${held}%`); }
      }
      state.feed.push({ round, headline: `${c.companyName} pays a quarterly dividend of ${eur0(cashOut)}. Shareholders cheer` });
    }
  }

  // 7. Emergency loans and bankruptcy. ---------------------------------------------------
  for (const w of work) {
    const c = w.c;
    if (c.cash >= 0) continue;
    const need = -c.cash;
    const room = Math.max(0, BALANCE.maxDebt - c.debt);
    const loan = Math.min(need, room);
    if (loan > 0) {
      c.debt += loan;
      c.cash += loan;
      const fee = loan * BALANCE.emergencyInterestPremium;
      c.cash -= fee;
      reports[c.id].emergencyLoan = loan;
      reports[c.id].emergencyFee = fee;
      w.events.push(`Emergency loan of €${Math.round(loan).toLocaleString("en")} (fee €${Math.round(fee).toLocaleString("en")})`);
    }
  }
  for (const c of state.companies) {
    if (!operating(c)) continue;
    if (c.cash < 0 && c.debt >= BALANCE.maxDebt) goBankrupt(state, c, round, byId);
  }

  // 8. Valuation and reports. ---------------------------------------------------------------
  for (const w of work) w.c.history.push(reports[w.c.id]);
  const values = companyValues(state);
  for (const c of state.companies) {
    if (operating(c) && values[c.id] < 0) goBankrupt(state, c, round, byId);
  }
  const finalValues = companyValues(state);
  for (const w of work) {
    const r = reports[w.c.id];
    r.cashEnd = w.c.cash;
    r.debtEnd = w.c.debt;
    r.value = finalValues[w.c.id];
    r.sharePrice = Math.max(0, finalValues[w.c.id]) / 100;
  }

  // 9. Next round's news. -------------------------------------------------------------------
  // Journalists score when the company they exposed lost value this round.
  for (const h of journalistHits) if (finalValues[h.target.id] < h.before) h.journalist.journalistPoints++;

  state.news = state.news.map((a) => ({ ...a, roundsLeft: a.roundsLeft - 1 })).filter((a) => a.roundsLeft > 0);
  if (passedRegulation) {
    const reg = SUMMIT.regulations[passedRegulation];
    state.news.push({ event: { id: "reg-" + passedRegulation, headline: "New rule: " + reg.name, effect: reg.effect, duration: SUMMIT.duration }, roundsLeft: SUMMIT.duration });
  }
  // Monopoly: one company controls every other company still in business. Game over, they win.
  const stillAlive = state.companies.filter(operating);
  const boss = stillAlive.find((c) => !c.controlledBy && stillAlive.length > 1 && stillAlive.every((o) => o.id === c.id || o.controlledBy === c.id));
  if (boss) {
    state.monopolyBy = boss.id;
    state.feed.push({ round, headline: `MONOPOLY! ${boss.playerName} controls every company in the industry. Game over.` });
  }
  state.pacts = (state.pacts ?? []).filter((p) => p.until > round);
  delete state.live;
  state.round = round + 1;
  state.auction = null;
  state.summit = null;
  if (state.monopolyBy || state.round > state.config.rounds || state.companies.filter(operating).length <= 1) {
    state.finished = true;
  } else {
    // Raw material prices move a little every round (pulled back toward normal). It shows in the market report.
    if (state.market) {
      // The index drawn last round becomes today's; the next one is drawn now and hinted at in the outlook.
      const M = state.market;
      M.materialIndex = M.materialNext ?? M.materialIndex;
      const idx = M.materialIndex;
      const dir = rng.pick([-1, 0, 1] as const);
      const noise = (rng.next() + rng.next() + rng.next() - 1.5) * 2 * COSTS.materialVol;
      M.materialNext = Math.round(clamp(idx + COSTS.materialPull * (1 - idx) + dir * COSTS.materialMove + noise, COSTS.materialRange[0], COSTS.materialRange[1]) * 1000) / 1000;
      const truth: "up" | "down" | "flat" = M.materialNext > idx * 1.025 ? "up" : M.materialNext < idx * 0.975 ? "down" : "flat";
      M.materialOutlook = rng.chance(COSTS.outlookAccuracy) ? truth : rng.pick((["up", "down", "flat"] as const).filter((x) => x !== truth));
      const material = ECONOMY.material[state.config.industry];
      state.feed.push({ round: state.round, headline: M.materialOutlook === "up" ? `${material} outlook: analysts expect prices to RISE next round. Stock up now?` : M.materialOutlook === "down" ? `${material} outlook: analysts expect prices to FALL next round. Maybe buy less now` : `${material} outlook: analysts expect prices to stay about the same next round` });
      // The bulk buyer's offer for the new round: a share of the average price just paid.
      const avg = state.marketLog?.at(-1)?.avgPrice || industry.start.price;
      M.bulkPrice = Math.round(avg * (BULK.priceShare[0] + rng.next() * (BULK.priceShare[1] - BULK.priceShare[0])) * 100) / 100;
    }
    drawNews(state, rng, industry);
    if (rules.auctions && state.round >= 3 && state.round % 3 === 0) {
      const item = rng.pick(Object.keys(AUCTION.items) as AuctionItemId[]);
      state.auction = { round: state.round, item };
      state.feed.push({ round: state.round, headline: `Auction this round: ${AUCTION.items[item].name}. Live bidding in the Boardroom.` });
    }
    if (rules.summits && state.round >= 4 && state.round % 3 === 1) {
      const regs = rng.shuffle(Object.keys(SUMMIT.regulations) as RegulationId[]);
      state.summit = { round: state.round, options: [regs[0], regs[1]] };
      state.feed.push({ round: state.round, headline: `Industry summit: vote on the ${SUMMIT.regulations[regs[0]].name.toLowerCase()} or the ${SUMMIT.regulations[regs[1]].name.toLowerCase()}` });
    }
  }

  // 10. Deliver bought market research. ------------------------------------------------------
  const tip = state.finished || state.round >= state.config.rounds ? [] : state.upcomingNews ?? [];
  for (const w of work) {
    const bought = w.d.research;
    if (!bought.length) continue;
    const result: ResearchResult = {};
    if (bought.includes("competitors")) {
      result.competitors = work
        .filter((o) => o.c.id !== w.c.id)
        .map((o) => ({
          companyId: o.c.id,
          companyName: o.c.companyName,
          produced: o.produced,
          quality: o.d.quality,
          marketingBudget: o.d.marketingBudget,
          campaign: o.d.campaign,
          investRnd: o.d.investRnd,
          investBrand: o.d.investBrand,
          investCapacity: o.d.investCapacity,
          capacity: o.capacityStart,
          stores: o.c.stores,
          retailPrice: o.d.retailPrice,
        }));
    }
    if (bought.includes("survey")) {
      result.survey = state.companies.filter(operating).map((c) => ({ companyId: c.id, companyName: c.companyName, brand: c.brand, hype: c.hype }));
    }
    if (bought.includes("marketStudy")) {
      result.marketStudy = { round, potential: potentials, next: state.finished ? null : { round: state.round, potential: segmentPotential(state) } };
    }
    if (bought.includes("buyerPanel") && state.market?.sensitivity) {
      result.buyerPanel = { ...state.market.sensitivity };
    }
    if (bought.includes("forecast") && !state.finished) {
      result.forecast = { round: state.round + 1, news: tip.map((t) => ({ headline: newsHeadline(state, t), effect: t.event.effect, duration: t.event.duration, kind: t.event.kind ?? "story" })) };
    }
    reports[w.c.id].research = result;
  }
  // Board seats: 25% or more of a company gets you a copy of its round report.
  for (const w of work) {
    const seats = work.filter((o) => o.c.id !== w.c.id && (o.c.shares.holders[w.c.id] ?? 0) >= BOARD_SEAT_SHARES).map((o) => {
      const r = reports[o.c.id];
      return { companyId: o.c.id, companyName: o.c.companyName, held: o.c.shares.holders[w.c.id] ?? 0, report: { price: r.price, quality: r.quality, produced: r.produced, sold: r.sold, revenue: r.revenue, profit: r.profit, cashEnd: r.cashEnd, debtEnd: r.debtEnd, marketingCost: r.marketingCost, rndCost: r.rndCost, capacityInvest: r.capacityInvest, stores: r.stores } };
    });
    if (seats.length) reports[w.c.id].research = { ...(reports[w.c.id].research ?? {}), boardSeats: seats };
  }
  for (const [id, spy] of Object.entries(spyReports)) {
    if (!reports[id]) continue;
    reports[id].research = { ...(reports[id].research ?? {}), spy };
  }
  state.rngState = rng.state;
  return state;
}

/** Rounds with an auction / an industry summit in this game (every third round, if the house rules allow them). */
export function auctionRounds(state: { config: GameConfig }): number[] {
  if (!rulesOf(state).auctions) return [];
  const out: number[] = []; for (let r = 3; r <= Math.min(state.config.rounds, 99); r += 3) out.push(r); return out;
}
export function summitRounds(state: { config: GameConfig }): number[] {
  if (!rulesOf(state).summits) return [];
  const out: number[] = []; for (let r = 4; r <= Math.min(state.config.rounds, 99); r += 3) out.push(r); return out;
}

// ---------------------------------------------------------------------------
// Board votes: big decisions need the shareholders (weighted by shares)
// ---------------------------------------------------------------------------

/** Shareholders of `c` who get a vote: every other company holding its shares (not the partner in a merger, not the float). */
export function outsideVoters(state: GameState, c: Company, partner?: Company | string): string[] {
  const pid = typeof partner === "string" ? partner : partner?.id;
  return Object.entries(c.shares.holders)
    .filter(([id, held]) => held > 0 && id !== c.id && id !== pid && state.companies.some((o) => o.id === id && !o.bankrupt))
    .map(([id]) => id);
}

/** Current count of a board vote. The founder's shares (and a merger partner's) vote yes; not voting counts as yes; ties pass. */
export function boardTally(state: GameState, p: BoardProposal) {
  const c = state.companies.find((o) => o.id === p.company);
  if (!c) return { yes: 0, no: 0, open: 0, passed: false, voters: [] as { id: string; held: number; vote: boolean | null }[] };
  let yes = c.shares.founder + (p.partner ? c.shares.holders[p.partner] ?? 0 : 0), no = 0, open = 0;
  const voters = outsideVoters(state, c, p.partner).map((id) => {
    const held = c.shares.holders[id] ?? 0, vote = p.votes[id] ?? null;
    if (vote === false) no += held; else { yes += held; if (vote === null) open += held; }
    return { id, held, vote };
  });
  return { yes, no, open, passed: yes >= no, voters };
}

/** A shareholder votes (live, during the round). Can change their vote until the round closes. */
export function castVote(input: GameState, voterId: string, proposalId: string, yes: boolean): GameState {
  if (input.finished) throw new Error("The game is over");
  const p = (input.board ?? []).find((x) => x.id === proposalId);
  if (!p || p.round !== input.round) throw new Error("That vote is closed");
  const c = input.companies.find((o) => o.id === p.company);
  if (!c || !outsideVoters(input, c, p.partner).includes(voterId)) throw new Error("Only shareholders can vote on this");
  const state = deepClone(input);
  const q = state.board!.find((x) => x.id === proposalId)!;
  q.votes = { ...q.votes, [voterId]: !!yes };
  return state;
}

/** Bots vote on every open proposal where they own shares: no when a rival would get stronger or they're circling the company, otherwise yes. */
export function castBotVotes(input: GameState, botIds: string[]): GameState {
  const open = (input.board ?? []).filter((p) => p.round === input.round);
  if (!open.length || !botIds.length) return input;
  const state = deepClone(input);
  const values = companyValues(state);
  for (const p of state.board!.filter((x) => x.round === state.round)) {
    const c = state.companies.find((o) => o.id === p.company);
    if (!c) continue;
    for (const id of outsideVoters(state, c, p.partner)) {
      if (!botIds.includes(id) || id in p.votes) continue;
      const held = c.shares.holders[id] ?? 0;
      const roll = hash(`${state.config.seed}:${p.id}:${id}`) % 100;
      let yes: boolean;
      if (p.kind === "loan") yes = c.debt + (p.amount ?? 0) < BALANCE.maxDebt * 0.8 ? roll < 75 : roll < 30;
      else {
        // A merger makes the survivor bigger: a bot circling the company (25%+) or bigger than the survivor says no.
        const sv = values[p.survivor ?? ""] ?? 0, me = values[id] ?? 0;
        yes = held >= 25 ? roll < 25 : me > sv ? roll < 40 : roll < 70;
      }
      p.votes[id] = yes;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Live play during a round: the stock exchange and live auctions
// ---------------------------------------------------------------------------

function liveFor(state: GameState): LiveState {
  if (!state.live || state.live.round !== state.round) state.live = { round: state.round, prices: sharePrices(state), trades: [], lots: {} };
  return state.live;
}

/** Live share price of a company right now (moves with every trade during the round). */
export function livePrice(state: GameState, id: string): number {
  return state.live && state.live.round === state.round && state.live.prices[id] !== undefined ? state.live.prices[id] : sharePrices(state)[id] ?? 0;
}

/**
 * Buy (qty > 0) or sell (qty < 0) shares on the live exchange. Each share moves the price by EXCHANGE.impactPerShare.
 * Holdings and cash change immediately; you can't pass 50% this way (that takes a takeover bid at the end of the round).
 * Returns a new state, or throws an Error with a reason the player can read.
 */
export function exchangeTrade(input: GameState, traderId: string, targetId: string, qty: number, now = Date.now()): { state: GameState; trade: LiveTrade } {
  const state = deepClone(input);
  const diff = difficultyOf(state);
  const n = Math.trunc(qty);
  const trader = state.companies.find((c) => c.id === traderId), target = state.companies.find((c) => c.id === targetId);
  if (state.finished) throw new Error("The game is over");
  if (!trader || !target || trader.bankrupt || !operating(target)) throw new Error(target?.merged ? `${target.companyName} has merged and isn't listed any more` : "That company isn't trading");
  if (!rulesOf(state).takeovers) throw new Error("The stock exchange is off in this game (house rules)");
  if (trader.id === target.id) throw new Error("Buy back your own shares in the Takeovers tab");
  if (state.round < diff.takeoverUnlockRound) throw new Error(`The stock exchange opens in round ${diff.takeoverUnlockRound}`);
  if (!n) throw new Error("Choose how many shares");
  const live = liveFor(state);
  const p0 = live.prices[target.id] ?? sharePrices(state)[target.id];
  const held = target.shares.holders[trader.id] ?? 0;
  const k = 1 + (n > 0 ? EXCHANGE.impactPerShare : -EXCHANGE.impactPerShare), m = Math.abs(n);
  const gross = k === 1 ? p0 * m : (p0 * (Math.pow(k, m) - 1)) / (k - 1);
  if (n > 0) {
    if (trader.takeoverCooldown > 0) throw new Error("Your board is resting after a takeover: no buying this round");
    if (target.controlledBy && target.controlledBy !== trader.id) throw new Error(`${target.companyName} is controlled by someone else`);
    if (n > target.shares.float) throw new Error(`Only ${target.shares.float} shares of ${target.companyName} are for sale`);
    if (held + n > EXCHANGE.maxHolding) throw new Error(`On the exchange you can own up to ${EXCHANGE.maxHolding}%. Control takes a takeover bid (Takeovers tab)`);
    const boughtThisRound = liveBought(state, trader.id, target.id);
    if (boughtThisRound + n > diff.maxSharesPerRound) throw new Error(`You can buy at most ${diff.maxSharesPerRound} shares of one company per round${boughtThisRound ? ` (${boughtThisRound} bought already)` : ""}`);
    const cost = gross * (1 + EXCHANGE.fee);
    if (trader.cash < cost) throw new Error(`Not enough cash: ${n} shares cost €${Math.round(cost).toLocaleString("en")}`);
    trader.cash -= cost;
    target.shares.float -= n;
    target.shares.holders[trader.id] = held + n;
    live.prices[target.id] = p0 * Math.pow(k, m);
    const trade = { t: now, trader: trader.id, target: target.id, qty: n, price: gross / m, cash: -cost };
    live.trades.push(trade);
    return { state, trade };
  }
  if (held < m) throw new Error(`You only own ${held} shares of ${target.companyName}`);
  const proceeds = gross * (1 - EXCHANGE.fee);
  trader.cash += proceeds;
  if (held - m > 0) target.shares.holders[trader.id] = held - m; else delete target.shares.holders[trader.id];
  target.shares.float += m;
  if (target.controlledBy === trader.id && held - m <= BALANCE.controlThreshold) target.controlledBy = null;
  live.prices[target.id] = Math.max(0.01, p0 * Math.pow(k, m));
  const trade = { t: now, trader: trader.id, target: target.id, qty: n, price: gross / m, cash: proceeds };
  live.trades.push(trade);
  return { state, trade };
}

/** Shares of `targetId` that `traderId` bought on the live exchange this round (sales don't free up room). */
export function liveBought(state: GameState, traderId: string, targetId: string): number {
  const live = state.live && state.live.round === state.round ? state.live : null;
  return (live?.trades ?? []).filter((t) => t.trader === traderId && t.target === targetId && t.qty > 0).reduce((a, t) => a + t.qty, 0);
}

/** Minimum next bid on a live lot. */
export function liveMinBid(state: GameState, lot: string): number {
  const l = state.live && state.live.round === state.round ? state.live.lots[lot] : undefined;
  const floor = lot === "auction" ? AUCTION.minBid : BANKRUPTCY_SALE.minBid;
  if (!l || !l.high) return floor;
  return Math.ceil(Math.max(l.high.amount + LIVE_AUCTION.minRaise, l.high.amount * (1 + LIVE_AUCTION.raiseShare)) / 1000) * 1000;
}

/** Is a live lot still open? (It closes "going once, going twice" after the last bid, or when the round ends.) */
export function liveLotOpen(state: GameState, lot: string, now = Date.now()): boolean {
  const l = state.live && state.live.round === state.round ? state.live.lots[lot] : undefined;
  const exists = lot === "auction" ? state.auction?.round === state.round : (state.bankruptcySales ?? []).some((s) => s.round === state.round && s.companyId === lot);
  return exists && !state.finished && (!l || !l.endsAt || now < l.endsAt);
}

/** Place a live bid on the round's auction ("auction") or a bankruptcy sale (the bankrupt company's id). */
export function liveBid(input: GameState, bidderId: string, lot: string, amount: number, now = Date.now()): GameState {
  const state = deepClone(input);
  const bidder = state.companies.find((c) => c.id === bidderId);
  if (!bidder || !operating(bidder)) throw new Error("You can't bid");
  if (!liveLotOpen(state, lot, now)) throw new Error("Sold! This auction is closed");
  const min = liveMinBid(state, lot);
  if (!(amount >= min)) throw new Error(`The next bid must be at least €${min.toLocaleString("en")}`);
  if (bidder.cash < amount) throw new Error("You don't have that much cash");
  const live = liveFor(state);
  const l = (live.lots[lot] ??= { high: null, endsAt: null, bids: 0 });
  if (l.high && l.high.bidder === bidderId) throw new Error("You already have the highest bid");
  l.high = { bidder: bidderId, amount: Math.round(amount), t: now };
  l.endsAt = now + LIVE_AUCTION.goingMs;
  l.bids++;
  return state;
}

/**
 * Friendly merger: `absorbed` folds into `survivor`. Everything it runs (cash, debt, factory, stock, stores, brand)
 * moves over; the shares of the combined company are split by value, so the absorbed company becomes a holding
 * company that owns its part of the survivor (and keeps its other stakes). Its player plays on as an investor.
 */
export function mergeCompanies(state: GameState, survivor: Company, absorbed: Company, round: number): boolean {
  const industry = INDUSTRIES[state.config.industry];
  const vS = baseValue(survivor, industry), vA = baseValue(absorbed, industry);
  if (!(vS > 0) || !(vA > 0)) return false;
  const rS = vS / (vS + vA), rA = 1 - rS;
  const S = survivor, A = absorbed;
  // Operations.
  const wSum = (a: number, b: number) => (a * vS + b * vA) / (vS + vA);
  const inv = S.inventory + A.inventory;
  S.inventoryUnitCost = inv > 0 ? (S.inventory * S.inventoryUnitCost + A.inventory * A.inventoryUnitCost) / inv : 0;
  S.inventory = inv;
  const mat = (S.materials ?? 0) + (A.materials ?? 0);
  S.materialPaid = mat > 0 ? ((S.materials ?? 0) * (S.materialPaid ?? 1) + (A.materials ?? 0) * (A.materialPaid ?? 1)) / mat : 1;
  S.materials = mat;
  S.cash += A.cash; S.debt += A.debt;
  S.capacity += A.capacity;
  S.stores = Math.min(RETAIL.maxStores, S.stores + A.stores);
  S.brand = clamp(wSum(S.brand, A.brand), 0, 100);
  S.hype = clamp(wSum(S.hype, A.hype), 0, 100);
  S.rndProgress = Math.max(S.rndProgress, A.rndProgress);
  S.qualityCap = Math.max(S.qualityCap, A.qualityCap);
  S.workers += A.workers;
  S.cumProduced = (S.cumProduced ?? 0) + (A.cumProduced ?? 0);
  S.credibility = Math.round(wSum(S.credibility ?? 0, A.credibility ?? 0));
  S.sentiment = Math.max(S.sentiment, A.sentiment);
  // Shares: survivor's holders keep rS of their stake, the absorbed company's holders get rA of theirs, in survivor shares.
  const parts: { key: string; x: number }[] = [];
  parts.push({ key: "founder", x: S.shares.founder * rS }, { key: "float", x: S.shares.float * rS }, { key: "treasury", x: S.shares.treasury * rS });
  for (const [h, q] of Object.entries(S.shares.holders)) parts.push({ key: "h:" + h, x: q * rS });
  parts.push({ key: "h:" + A.id, x: A.shares.founder * rA }, { key: "float", x: A.shares.float * rA }, { key: "treasury", x: A.shares.treasury * rA });
  for (const [h, q] of Object.entries(A.shares.holders)) parts.push({ key: h === S.id ? "treasury" : "h:" + h, x: q * rA });
  const merged = new Map<string, number>();
  for (const p of parts) merged.set(p.key, (merged.get(p.key) ?? 0) + p.x);
  // Whole shares adding up to 100 (largest remainders get the leftovers).
  const entries = [...merged.entries()].map(([key, x]) => ({ key, x, n: Math.floor(x) }));
  let left = 100 - entries.reduce((a, e) => a + e.n, 0);
  for (const e of [...entries].sort((a, b) => (b.x - b.n) - (a.x - a.n))) { if (left <= 0) break; e.n++; left--; }
  S.shares = { founder: 0, float: 0, treasury: 0, holders: {} };
  for (const e of entries) {
    if (e.key === "founder" || e.key === "float" || e.key === "treasury") S.shares[e.key] += e.n;
    else if (e.n > 0) S.shares.holders[e.key.slice(2)] = (S.shares.holders[e.key.slice(2)] ?? 0) + e.n;
  }
  // Control of the combined company: whoever now holds more than half (usually nobody).
  const top = Object.entries(S.shares.holders).sort((a, b) => b[1] - a[1])[0];
  S.controlledBy = top && top[1] > BALANCE.controlThreshold ? top[0] : null;
  // The absorbed company becomes an empty holding company, owned by its player.
  A.cash = 0; A.debt = 0; A.capacity = 0; A.inventory = 0; A.inventoryUnitCost = 0; A.materials = 0; A.stores = 0;
  A.brand = 0; A.hype = 0; A.workers = 0; A.sentiment = 0;
  A.shares = { founder: 100, float: 0, treasury: 0, holders: {} };
  A.controlledBy = null;
  A.merged = { into: S.id, round };
  for (const c of state.companies) if (c.controlledBy === A.id && c.id === S.id) c.controlledBy = null;
  // Loans between players and pacts follow the business.
  for (const l of state.playerLoans ?? []) { if (l.lender === A.id) l.lender = S.id; if (l.borrower === A.id) l.borrower = S.id; }
  state.playerLoans = (state.playerLoans ?? []).filter((l) => l.lender !== l.borrower);
  state.pacts = (state.pacts ?? []).filter((p) => p.a !== A.id && p.b !== A.id);
  state.feed.push({ round, headline: `MERGER! ${A.companyName} and ${S.companyName} join forces. ${S.playerName} runs the show; ${A.playerName} keeps ${S.shares.holders[A.id] ?? 0}% and a very nice office chair` });
  return true;
}

function goBankrupt(state: GameState, c: Company, round: number, byId: Map<string, Company>) {
  c.bankrupt = true;
  c.inventory = 0;
  // Its factory and stores go up for auction next round.
  if (round + 1 <= state.config.rounds && (c.capacity > 0 || c.stores > 0)) {
    (state.bankruptcySales ??= []).push({ round: round + 1, companyId: c.id });
    state.feed.push({ round: round + 1, headline: `Bankruptcy sale this round: ${c.companyName}'s factory${c.stores ? " and stores" : ""} go to the highest bidder` });
  }
  state.feed.push({ round, headline: `${c.companyName} goes bankrupt. ${c.playerName} trades the corner office for a press badge.` });
  // Control over others ends; the shares stay registered but carry no control.
  for (const other of byId.values()) {
    if (other.controlledBy === c.id) other.controlledBy = null;
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The controller of a company may rename it (up to 28 characters). Returns a new state; invalid requests change nothing. */
export function renameCompany(input: GameState, byCompanyId: string, targetId: string, name: string): GameState {
  const clean = String(name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 28);
  const target = input.companies.find((c) => c.id === targetId);
  if (!clean || !target || target.controlledBy !== byCompanyId) return input;
  const state = deepClone(input);
  const t = state.companies.find((c) => c.id === targetId)!;
  const by = state.companies.find((c) => c.id === byCompanyId)!;
  t.originalName = t.originalName ?? t.companyName;
  const old = t.companyName;
  t.companyName = clean;
  state.feed.push({ round: Math.max(1, state.round - 1), headline: `${by.playerName} renames ${old} to "${clean}"` });
  return state;
}

/** Whether a company has completed its secret mission (checked at the end of the game). */
export function missionDone(state: GameState, c: Company): boolean {
  if (c.bankrupt || !c.mission) return false;
  const alive = state.companies.filter((o) => !o.bankrupt);
  const lastSeg = (o: Company, s: SegmentId) => o.history.at(-1)?.segments[s].sold ?? 0;
  const totalSold = (o: Company) => o.history.filter((h) => h.round >= 1).reduce((a, h) => a + h.sold, 0);
  const isTop = (f: (o: Company) => number) => alive.every((o) => o.id === c.id || f(c) > f(o));
  switch (c.mission.id) {
    case "stake": { const t = state.companies.find((o) => o.id === c.mission.targetId); return !!t && (t.shares.holders[c.id] ?? 0) >= 30; }
    case "stores": return c.stores >= 8;
    case "premiumLead": return isTop((o) => lastSeg(o, "premium"));
    case "budgetLead": return isTop((o) => lastSeg(o, "budget"));
    case "debtFree": return c.debt <= 0 && c.cash >= 2_000_000;
    case "quality5": return c.qualityCap >= 5;
    case "volume": return isTop(totalSold);
    case "brand": return isTop((o) => o.brand);
  }
}

export function standings(state: GameState): Standing[] {
  const values = companyValues(state);
  const rows: Standing[] = state.companies.map((c) => {
    const controls = state.companies.filter((o) => o.controlledBy === c.id).map((o) => o.id);
    let score = c.bankrupt ? 0 : values[c.id];
    if (c.controlledBy) score *= BALANCE.controlledScoreMultiplier;
    for (const id of controls) score += BALANCE.controllerBonusRate * Math.max(0, values[id]);
    const done = state.finished && missionDone(state, c);
    if (done) score += MISSION_BONUS;
    return {
      companyId: c.id,
      playerName: c.playerName,
      companyName: c.companyName,
      value: values[c.id],
      score,
      controlledBy: c.controlledBy,
      controls,
      bankrupt: c.bankrupt,
      mission: c.mission,
      monopoly: state.monopolyBy === c.id,
      missionDone: done,
      missionBonus: done ? MISSION_BONUS : 0,
      journalistPoints: c.journalistPoints ?? 0,
      merged: c.merged ? c.merged.into : null,
    };
  });
  return rows.sort((a, b) => Number(b.monopoly) - Number(a.monopoly) || b.score - a.score);
}

/** What every player may see about a rival: no full decisions. */
export function publicInfo(state: GameState) {
  const prices = sharePrices(state);
  return state.companies.map((c) => {
    const last = c.history.at(-1);
    return {
      companyId: c.id,
      companyName: c.companyName,
      playerName: c.playerName,
      price: last?.price ?? c.lastDecisions.price,
      unitsSold: last?.sold ?? 0,
      sharePrice: prices[c.id],
      floatShares: c.shares.float,
      stores: c.stores,
      controlledBy: c.controlledBy,
      bankrupt: c.bankrupt,
      merged: c.merged ? c.merged.into : null,
      productName: c.productName ?? null,
      style: c.style ?? null,
      reviews: last?.reviews ?? null,
    };
  });
}
