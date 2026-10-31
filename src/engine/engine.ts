// Friendly Takeover — round resolution.
// resolveRound(state, decisions) is pure: it never mutates its input and always gives the same
// result for the same input, so the server can re-run or audit any round.

import {
  AUCTION, BALANCE, BANKRUPTCY_SALE, BOARD_SEAT_SHARES, CAMPAIGNS, COSTS, ECONOMY, GUIDANCE, EVENTS, DIFFICULTIES, INDUSTRIES, JOURNALIST, MISSION_BONUS, MISSIONS, RESEARCH, RETAIL, SHOWDOWN, SUMMIT, TRAIT_EFFECTS, TYCOON,
  WILDCARD_EFFECTS, WILDCARDS, type IndustryConfig,
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
} from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const deepClone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

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
  const companies: Company[] = players.map((p) => ({
    id: p.id,
    playerName: p.playerName,
    companyName: p.companyName,
    trait: p.trait,
    cash: industry.start.cash,
    debt: 0,
    capacity: industry.start.capacity,
    qualityCap: industry.start.qualityCap,
    rndProgress: 0,
    brand: industry.start.brand,
    hype: industry.start.hype,
    inventory: 0,
    stores: 0,
    originalName: p.companyName,
    wildcardsUsed: {},
    sentiment: 0,
    mission: { id: "volume" },
    workers: config.difficulty === "tycoon" ? Math.ceil((industry.start.capacity * 0.8) / teamOutput(industry)) : 0,
    journalistPoints: 0,
    cumProduced: 0,
    credibility: 0,
    inventoryUnitCost: 0,
    shares: { founder: BALANCE.startShares.founder, float: BALANCE.startShares.float, treasury: 0, holders: {} },
    controlledBy: null,
    takeoverCooldown: 0,
    bankrupt: false,
    lastDecisions: defaultDecisions(industry),
    history: [],
  }));
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
  const lastPlayable = Math.max(3, config.rounds - 1);
  const pickRound = (from: number) => from + mrng.int(Math.max(1, lastPlayable - from + 1));
  const bf = pickRound(3);
  let inv = pickRound(3);
  if (inv === bf) inv = bf > 3 ? bf - 1 : bf + 1;
  const specialEvents = [{ round: bf, id: "blackFriday" as const }, { round: inv, id: "investorDay" as const }].filter((e) => e.round <= config.rounds);
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
    market: { materialIndex: 1, trend, sensitivity },
  };
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

/** Raw material price index → cost multiplier (only the material part of a unit follows it). */
export function materialFactor(index: number): number {
  return 1 + COSTS.materialShare * (index - 1);
}

/** Company value excluding stakes in other companies. */
function baseValue(c: Company, industry: IndustryConfig): number {
  if (c.bankrupt) return 0;
  const last = c.history.slice(-2).map((h) => h.profit);
  const avgProfit = last.length ? last.reduce((a, b) => a + b, 0) / last.length : 0;
  const value = (
    c.cash -
    c.debt +
    c.capacity * BALANCE.capacityBookValue * industry.baseUnitCost +
    (c.stores ?? 0) * RETAIL.bookValue +
    c.inventory * c.inventoryUnitCost * BALANCE.inventoryValueRate +
    c.brand * BALANCE.brandValuePerPoint +
    Math.max(0, avgProfit) * BALANCE.earningsMultiple
  );
  // Investor panic after someone dumped shares; investor trust from the investor call.
  return value > 0 ? value * (1 - (c.sentiment ?? 0)) * (1 + GUIDANCE.valuePerPoint * (c.credibility ?? 0)) : value;
}

/** Full company values including stakes held in others (one level of cross-holdings). */
export function companyValues(state: GameState): Record<string, number> {
  const industry = INDUSTRIES[state.config.industry];
  const base: Record<string, number> = {};
  for (const c of state.companies) base[c.id] = baseValue(c, industry);
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
    guidance: d.guidance && typeof d.guidance === "object" && Number.isFinite(d.guidance.units) && Number.isFinite(d.guidance.profit) ? { units: Math.max(0, Math.round(d.guidance.units)), profit: Math.round(d.guidance.profit) } : null,
  };
}

/** Slow trend of a buyer group: multiplier on its size in a given round. */
function trendFactor(state: GameState, s: SegmentId, round: number): number {
  const t = state.market?.trend?.[s] ?? 0;
  return Math.pow(1 + t, Math.max(0, round - 1));
}

/** Market potential per segment for the state's current round, including active news. */
export function segmentPotential(state: GameState): Record<SegmentId, number> {
  const industry = INDUSTRIES[state.config.industry];
  const fx = activeNewsEffects(state);
  const size = industry.potentialPerCompany * state.companies.length * Math.pow(1 + industry.growth, state.round - 1) * fx.demandMultiplier;
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
  const [lo, hi] = ECONOMY.perRound;
  const kinds = rng.shuffle([0, 1, 2, 3, 4]).slice(0, lo + rng.int(hi - lo + 1));
  const items = kinds.map((k) => economyItem(state, rng, k));
  const story = pickNews(state, rng, industry);
  return story ? [story, ...items] : items;
}

function pickNews(state: GameState, rng: Rng, industry: IndustryConfig): ActiveNews | null {
  const difficulty = DIFFICULTIES[state.config.difficulty];
  if (!rng.chance(difficulty.newsChance)) return null;
  const usedIds = new Set(state.news.map((n) => n.event.id));
  const recentHeadlines = new Set(state.feed.map((f) => f.headline));
  let pool = industry.news.filter((e) => !usedIds.has(e.id) && !recentHeadlines.has(e.headline));
  if (pool.length === 0) pool = industry.news.filter((e) => !usedIds.has(e.id));
  if (pool.length === 0) return null;
  const event = rng.pick(pool);
  const active: ActiveNews = { event, roundsLeft: event.duration };
  if (event.effect.randomCompanyBoost) {
    const alive = state.companies.filter((c) => !c.bankrupt);
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
    if (next.targetCompanyId && state.companies.find((c) => c.id === next.targetCompanyId)?.bankrupt) {
      const alive = state.companies.filter((c) => !c.bankrupt);
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

export function resolveRound(input: GameState, decisionsByCompany: Record<string, Partial<Decisions>>): GameState {
  if (input.finished) throw new Error("Game is finished");
  const state = deepClone(input);
  const industry = INDUSTRIES[state.config.industry];
  const difficulty = DIFFICULTIES[state.config.difficulty];
  const rng = new Rng(state.rngState);
  const fx = activeNewsEffects(state);
  const round = state.round;
  const alive = state.companies.filter((c) => !c.bankrupt);
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
  const cashAtStart: Record<string, number> = Object.fromEntries(alive.map((c) => [c.id, c.cash]));
  const byIdAll = new Map(state.companies.map((c) => [c.id, c]));
  const special: Record<string, { wildcard: number; legal: number; staff: number; auction: number; events: string[] }> = {};
  for (const c of alive) special[c.id] = { wildcard: 0, legal: 0, staff: 0, auction: 0, events: [] };
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
    if (!wc) continue;
    const card = WILDCARDS[wc.card];
    const used = c.wildcardsUsed[wc.card] ?? 0;
    const target = wc.target ? byIdAll.get(wc.target) : undefined;
    if (used >= card.maxUses || (card.needsTarget && (!target || target.bankrupt || target.id === c.id))) continue;
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
    if (!t || t.bankrupt) continue;
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
    const capMult = shield ? Math.max(1, fx.capacityMultiplier) : fx.capacityMultiplier;
    const staffCap = tycoon ? c.workers * teamOutput(industry) : Infinity;
    const factoryCap = Math.floor(c.capacity * capMult);
    const cap = Math.floor(Math.min(factoryCap, staffCap));
    const produced = Math.min(d.production, cap);
    // Unit cost: quality, news, raw material prices and the experience curve.
    const expF = experienceFactor(industry, c.cumProduced ?? 0);
    // Experience makes the process cheaper, not the materials: it saves the same amount per unit at every quality.
    const ucBase = unitCost(industry, d.quality, (shield ? Math.min(1, fx.costMultiplier) : fx.costMultiplier) * materialFactor(state.market?.materialIndex ?? 1), c.trait, tycoon)
      - (1 - expF) * unitCost(industry, 1, 1, c.trait, tycoon);
    // Factory load: overtime above 90% of capacity, idle machines below 60%.
    const overtimeUnits = Math.max(0, produced - Math.floor(factoryCap * COSTS.overtimeFrom));
    const overtimeCost = overtimeUnits * ucBase * COSTS.overtimePremium;
    const idleUnits = Math.max(0, Math.floor(factoryCap * COSTS.idleBelow) - produced);
    const idleCost = idleUnits * COSTS.idleCostRate * industry.baseUnitCost;
    const uc = produced > 0 ? (produced * ucBase + overtimeCost) / produced : ucBase;
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
  const marketSize = industry.potentialPerCompany * n * Math.pow(1 + industry.growth, round - 1) * fx.demandMultiplier;
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
    const revenue = w.sold * d.price + retailRevenue;
    const cogs = totalSold * w.avgCost;
    const inventoryEnd = w.available - totalSold;
    const storeOpenCost = w.storesOpened * RETAIL.openCost;
    const storeUpkeep = c.stores * RETAIL.upkeep;
    const holdingCost = inventoryEnd * w.avgCost * BALANCE.holdingCostRate;
    const fixedCost = c.capacity * BALANCE.fixedCostPerCapacity * industry.baseUnitCost;
    const productionCost = w.produced * w.ucBase + w.overtimeCost;
    const researchCost = d.research.reduce((a, r) => a + RESEARCH[r].cost, 0);
    const sp = special[c.id];
    // Same array as w.events, so share trades and takeovers added later still show up in the report.
    w.events.unshift(...sp.events);
    const profit = revenue - cogs - holdingCost - fixedCost - w.idleCost - d.marketingBudget - d.investRnd - d.investBrand - researchCost - storeUpkeep - w.interest - sp.wildcard - sp.legal - sp.staff - sp.auction;
    c.cash += revenue - productionCost - holdingCost - fixedCost - w.idleCost - d.marketingBudget - d.investRnd - d.investBrand - researchCost - d.investCapacity - storeOpenCost - storeUpkeep - w.interest;
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
    c.lastDecisions = { ...d, sellShares: {}, loanChange: 0, buyShares: {}, buyback: 0, research: [], storesOpen: 0, storesClose: 0, wildcard: null, takeoverStake: 0, auctionBid: 0, bankruptBids: {}, vote: null, hire: 0, guidance: null };
  }

  // 5. Share trading: sales first, then buybacks (defense), then purchases in random order. ------
  const byId = new Map(state.companies.map((c) => [c.id, c]));
  for (const w of rng.shuffle(work)) {
    const seller = w.c;
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
  if (round >= difficulty.takeoverUnlockRound) {
    for (const w of rng.shuffle(work)) {
      const buyer = w.c;
      if (buyer.takeoverCooldown > 0) {
        if (Object.keys(w.d.buyShares).length) w.events.push("Couldn't buy shares: your board is resting after a takeover");
        continue;
      }
      for (const [targetId, requested] of Object.entries(w.d.buyShares)) {
        const target = byId.get(targetId);
        if (!target || target.bankrupt || target.id === buyer.id) continue;
        if (target.controlledBy && target.controlledBy !== buyer.id) { w.events.push(`Couldn't buy shares of ${target.companyName}: it's controlled by someone else`); continue; }
        const held = target.shares.holders[buyer.id] ?? 0;
        const ruthless = buyer.trait === "ruthless" ? TRAIT_EFFECTS.ruthlessPremiumFactor : 1;
        const investorDay = (state.specialEvents ?? []).some((e) => e.round === round && e.id === "investorDay") ? EVENTS.investorDay.premiumFactor : 1;
        const premium = (BALANCE.takeoverPremium + BALANCE.premiumPerHeldShare * held) * ruthless * investorDay;
        const price = startPrices[target.id] * (1 + premium);
        if (price <= 0) continue;
        const afford = Math.floor(Math.max(0, buyer.cash) / price);
        let qty = Math.min(requested, target.shares.float, difficulty.maxSharesPerRound, afford);
        if (qty < requested) {
          // Tell the buyer why they got fewer shares than they asked for.
          const why = qty === afford && afford < Math.min(target.shares.float, difficulty.maxSharesPerRound)
            ? `not enough cash left after this round's other costs (shares cost €${Math.round(price).toLocaleString("en")} each)`
            : qty === target.shares.float ? `only ${target.shares.float} were for sale` : `you can buy at most ${difficulty.maxSharesPerRound} per company per round`;
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
        if (held < 20 && nowHeld >= 20 && nowHeld <= BALANCE.controlThreshold) {
          state.feed.push({ round, headline: `Rumours: ${buyer.companyName} is circling ${target.companyName} and now owns ${nowHeld}%` });
        }
        if (nowHeld > BALANCE.controlThreshold && target.controlledBy !== buyer.id) {
          target.controlledBy = buyer.id;
          buyer.takeoverCooldown = difficulty.takeoverCooldown;
          state.feed.push({ round, headline: `${buyer.playerName} now owns ${nowHeld}% of ${target.companyName}. A very friendly takeover.` });
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
    if (c.bankrupt) continue;
    if (c.cash < 0 && c.debt >= BALANCE.maxDebt) goBankrupt(state, c, round, byId);
  }

  // 8. Valuation and reports. ---------------------------------------------------------------
  for (const w of work) w.c.history.push(reports[w.c.id]);
  const values = companyValues(state);
  for (const c of state.companies) {
    if (!c.bankrupt && values[c.id] < 0) goBankrupt(state, c, round, byId);
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
  const stillAlive = state.companies.filter((c) => !c.bankrupt);
  const boss = stillAlive.find((c) => !c.controlledBy && stillAlive.length > 1 && stillAlive.every((o) => o.id === c.id || o.controlledBy === c.id));
  if (boss) {
    state.monopolyBy = boss.id;
    state.feed.push({ round, headline: `MONOPOLY! ${boss.playerName} controls every company in the industry. Game over.` });
  }
  state.round = round + 1;
  state.auction = null;
  state.summit = null;
  if (state.monopolyBy || state.round > state.config.rounds || state.companies.filter((c) => !c.bankrupt).length <= 1) {
    state.finished = true;
  } else {
    // Raw material prices move a little every round (pulled back toward normal). It shows in the market report.
    if (state.market) {
      const shock = (rng.next() + rng.next() + rng.next() - 1.5) * 2 * COSTS.materialVol;
      const idx = state.market.materialIndex;
      state.market.materialIndex = Math.round(clamp(idx + COSTS.materialPull * (1 - idx) + shock, COSTS.materialRange[0], COSTS.materialRange[1]) * 1000) / 1000;
    }
    drawNews(state, rng, industry);
    if (AUCTION.rounds.includes(state.round)) {
      const item = rng.pick(Object.keys(AUCTION.items) as AuctionItemId[]);
      state.auction = { round: state.round, item };
      state.feed.push({ round: state.round, headline: `Auction this round: ${AUCTION.items[item].name}. Sealed bids only.` });
    }
    if (SUMMIT.rounds.includes(state.round)) {
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
      result.survey = state.companies.filter((c) => !c.bankrupt).map((c) => ({ companyId: c.id, companyName: c.companyName, brand: c.brand, hype: c.hype }));
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
    };
  });
}
