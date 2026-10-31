// Server-side game logic for online matches, shared by the Supabase edge function and the tests.
// The full engine state never leaves the server: each player gets a "view" with rivals' secrets removed.

import {
  createGame, resolveRound, standings, publicInfo, companyValues, sharePrices, renameCompany,
  type CeoTrait, type Company, type DealOrder, type Decisions, type DifficultyId, type GameState, type IndustryId, type RoundReport,
} from "../engine";
import { Rng } from "../engine/rng";
import { botDecisions, type BotStrategy } from "../sim/bots";

export interface LobbyPlayer { id: string; name: string; company: string; trait: CeoTrait }
export interface OnlineSettings { industry: IndustryId; difficulty: DifficultyId; rounds: number; botCount: number; botSkill: "normal" | "hard"; seed: number }

const BOT_NAMES = ["Barbara", "Kees", "Ingrid", "Mo", "Fenna", "Sem"];
const BOT_COMPANIES: Record<IndustryId, string[]> = {
  chocolate: ["Bar None", "Truffle Shuffle", "Meltdown Inc.", "Nibs & Co", "Cocoa Nuts", "Choc Norris"],
  ai: ["Hallucinate Labs", "GPU Rich", "Token Burners", "Overfit AI", "Promptly", "Neural Nonsense"],
  weed: ["High Street", "Mellow Fellows", "Higher Ground", "Kush Capital", "Green Rush", "Bud Light-Year"],
};
const TRAITS: CeoTrait[] = ["ruthless", "visionary", "influencer", "pennyPincher"];

export function funnyNames(buyer: string, target: string): string[] {
  const b = buyer.replace(/ (Inc\.|Co|& Co|Labs|AI)$/, "");
  return [`${b}'s Little Helper`, `${target} (Owned)`, `Formerly ${target}`, `${b} Junior`, `${b} Mini`, `Property of ${b}`].filter((n) => n.length <= 28);
}

/** Builds the starting state: the players plus bots to fill the table. */
export function startOnlineGame(settings: OnlineSettings, players: LobbyPlayer[]): GameState {
  const rng = new Rng((settings.seed ^ 0x2545f491) | 0);
  const taken = new Set(players.map((p) => p.company.toLowerCase()));
  const companies = rng.shuffle(BOT_COMPANIES[settings.industry].filter((n) => !taken.has(n.toLowerCase())));
  const names = rng.shuffle(BOT_NAMES);
  const kinds = rng.shuffle(["budget", "mainstream", "premium", "hype", "raider", "mainstream"]);
  const lvl = settings.botSkill === "hard" ? "pro-" : "smart-";
  const bots: Record<string, string> = {};
  const setup = players.map((p) => ({ id: p.id, playerName: p.name, companyName: p.company, trait: p.trait }));
  for (let k = 0; k < Math.min(settings.botCount, 6, 8 - players.length); k++) {
    const id = `bot-${k + 1}`;
    bots[id] = kinds[k] === "raider" ? "smart-raider" : lvl + kinds[k];
    setup.push({ id, playerName: names[k] + " (bot)", companyName: companies[k], trait: rng.pick(TRAITS) });
  }
  const state = createGame({ industry: settings.industry, difficulty: settings.difficulty, rounds: settings.rounds, seed: settings.seed }, setup);
  state.bots = bots;
  return state;
}

/** Resolves a round: human decisions as submitted (missing = repeat last round), bots decide for themselves. */
export function resolveOnlineRound(state: GameState, human: Record<string, Partial<Decisions>>, deals: DealOrder[] = []): GameState {
  const decisions: Record<string, Partial<Decisions>> = { ...human };
  const rng = new Rng((state.rngState ^ (state.round * 7919)) | 0);
  const values = companyValues(state);
  for (const [id, strategy] of Object.entries(state.bots ?? {})) {
    const c = state.companies.find((x) => x.id === id);
    if (!c) continue;
    if (c.bankrupt) {
      const leader = state.companies.filter((o) => !o.bankrupt).sort((a, b) => values[b.id] - values[a.id])[0];
      if (leader) decisions[id] = { journalistTarget: leader.id };
      continue;
    }
    let d = botDecisions(strategy as BotStrategy, state, c, rng);
    const threat = Math.max(0, ...Object.values(c.shares.holders));
    if (threat >= 25 && c.cash > 1_200_000) d = { ...d, buyback: 10 };
    decisions[id] = d;
  }
  const before = Object.fromEntries(state.companies.map((c) => [c.id, c.controlledBy]));
  let next = resolveRound(state, decisions, deals);
  // Bots rename the companies they take over.
  for (const c of next.companies) {
    const by = c.controlledBy;
    if (!by || by === before[c.id] || !(state.bots ?? {})[by]) continue;
    const buyer = next.companies.find((x) => x.id === by)!;
    const names = funnyNames(buyer.companyName, c.companyName);
    next = renameCompany(next, by, c.id, names[rng.int(names.length)]);
  }
  return next;
}

const HIDDEN_REPORT: Partial<RoundReport> = {
  produced: 0, unmetDemand: 0, inventoryStart: 0, inventoryEnd: 0, capacity: 0, productionCost: 0, holdingCost: 0, fixedCost: 0,
  marketingCost: 0, rndCost: 0, brandCost: 0, researchCost: 0, capacityInvest: 0, interest: 0, storeOpenCost: 0, storeUpkeep: 0,
  wildcardCost: 0, legalCost: 0, staffCost: 0, workers: 0, auctionPaid: 0, sharePurchases: 0, buybackCost: 0, shareSales: 0,
  loanChange: 0, emergencyLoan: 0, emergencyFee: 0, retailDemand: 0, cashStart: 0, dividendsPaid: 0, dividendsReceived: 0,
  dealCash: 0, experienceFactor: 0, unitCostBase: 0, materialOrderUnits: 0, materialOrderCost: 0, materialFromStock: 0, materialSpot: 0, materialSpotCost: 0, materialStockEnd: 0, bulkSold: 0, bulkRevenue: 0, utilization: 0, overtimeUnits: 0, overtimeCost: 0, idleUnits: 0, idleCost: 0,
};

/** What one player may see: everything public, their own company in full, rivals without their secrets. */
export function viewFor(state: GameState, playerId: string): GameState {
  const values = companyValues(state), prices = sharePrices(state);
  // (Pacts are announced in the news, so everyone sees them.)
  const view: GameState = JSON.parse(JSON.stringify(state));
  view.publicValues = values;
  view.publicSharePrices = prices;
  if (state.finished) return view;
  view.rngState = 0;
  delete view.upcomingNews;
  view.specialEvents = (view.specialEvents ?? []).filter((e) => e.round <= state.round + 1);
  delete view.bots;
  // Loans between players are private to the two of them.
  view.playerLoans = (view.playerLoans ?? []).filter((l) => l.lender === playerId || l.borrower === playerId);
  view.dealLog = (view.dealLog ?? []).filter((d) => d.from === playerId || d.to === playerId);
  // Hidden market drivers: only the raw material index is public (it's in the market report).
  if (view.market) view.market = { materialIndex: view.market.materialIndex, materialOutlook: view.market.materialOutlook, bulkPrice: view.market.bulkPrice };
  view.companies = view.companies.map((c: Company) => {
    if (c.id === playerId) return c;
    const last = c.lastDecisions;
    const hidden: Company = {
      ...c,
      brand: c.bankrupt ? c.brand : 0,
      hype: 0,
      rndProgress: 0,
      qualityCap: last.quality,
      inventory: 0,
      inventoryUnitCost: 0,
      cumProduced: 0,
      materials: 0,
      materialPaid: 1,
      capacity: c.bankrupt ? c.capacity : 0,
      workers: 0,
      wildcardsUsed: {},
      mission: { id: "volume" },
      lastDecisions: { ...last, production: 0, marketingBudget: 0, investRnd: 0, investBrand: 0, investCapacity: 0, campaign: "tv", loanChange: 0, buyShares: {}, sellShares: {}, buyback: 0, research: [], wildcard: null, takeoverStake: 0, defenseStake: 0, auctionBid: 0, bankruptBids: {}, vote: null, journalistTarget: null, hire: 0, storesOpen: 0, storesClose: 0, guidance: null },
      // Rivals' investor calls: everyone hears whether they hit, not what they promised.
      history: c.history.map((h) => ({ ...h, ...HIDDEN_REPORT, events: [], research: undefined, guidance: h.guidance ? { units: 0, profit: 0, unitsErr: 0, profitErr: 0, result: h.guidance.result } : undefined }) as RoundReport),
    };
    (hidden as Company & { missionHidden?: boolean }).missionHidden = true;
    return hidden;
  });
  return view;
}

/** Public results for a round: news, public company info, standings (missions stay secret until the end). */
export function publicData(state: GameState, round: number) {
  const names = new Map(state.companies.map((c) => [c.id, c.companyName]));
  return {
    round,
    finished: state.finished,
    headlines: state.feed.filter((f) => f.round === round).map((f) => f.headline),
    nextNews: state.finished ? [] : state.news.map((n) => ({ headline: n.event.headline + (n.targetCompanyId ? ` (it's ${names.get(n.targetCompanyId)})` : ""), effect: n.event.effect, roundsLeft: n.roundsLeft })),
    companies: publicInfo(state),
    values: companyValues(state),
    valueHistory: Object.fromEntries(state.companies.map((c) => [c.id, c.history.map((h) => Math.round(h.value))])),
    upcoming: state.feed.filter((f) => f.round === round + 1).map((f) => f.headline),
    standings: standings(state).map((r) => (state.finished ? r : { ...r, mission: undefined, missionDone: undefined, missionBonus: undefined })),
    auction: state.auction,
    summit: state.summit,
  };
}

export { renameCompany };

/** What everyone may see of the live round: exchange prices, share registers, recent trades and live auctions. */
export function publicLive(state: GameState) {
  const live = state.live && state.live.round === state.round ? state.live : null;
  const prices = sharePrices(state);
  return {
    round: state.round,
    prices: Object.fromEntries(state.companies.map((c) => [c.id, live?.prices[c.id] ?? prices[c.id]])),
    shares: Object.fromEntries(state.companies.map((c) => [c.id, c.shares])),
    trades: (live?.trades ?? []).slice(-60),
    lots: live?.lots ?? {},
    serverNow: Date.now(),
  };
}
export { exchangeTrade, liveBid, liveMinBid, liveLotOpen } from "../engine";
