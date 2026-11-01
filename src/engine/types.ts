// Friendly Takeover — core engine types.
// The engine is pure: (state, decisions) -> new state. No I/O, no clocks, no Math.random.

export type SegmentId = "budget" | "mainstream" | "premium" | "hype";
export const SEGMENTS: SegmentId[] = ["budget", "mainstream", "premium", "hype"];

export type CampaignType = "discount" | "tv" | "luxury" | "viral";
export type CeoTrait = "ruthless" | "visionary" | "influencer" | "pennyPincher";
export type IndustryId = "chocolate" | "ai" | "weed";
export type DifficultyId = "standard" | "tycoon" | "cutthroat";
export type WildcardId = "crazy" | "poach" | "spy" | "lobby" | "scandal" | "lawsuit";
export type MissionId = "stake" | "stores" | "premiumLead" | "budgetLead" | "debtFree" | "quality5" | "volume" | "brand";
export type AuctionItemId = "endorsement" | "patent" | "factory" | "location";
export type RegulationId = "luxuryTax" | "bargainBan" | "influencerLaw" | "middleClassCut" | "cheapCredit" | "greenRules";
export interface Mission { id: MissionId; targetId?: string }
/** Market research a player can buy for a round (like TOPSIM's market research reports). */
export type ResearchId = "competitors" | "survey" | "forecast" | "marketStudy" | "buyerPanel";

/** One player's choices for one round. Every field is optional: missing fields keep last round's value. */
export interface Decisions {
  /** Price per unit in euros. */
  price: number;
  /** Units to produce this round (capped by capacity). */
  production: number;
  /** Quality level 1..5 (capped by the company's quality cap). */
  quality: number;
  /** Marketing spend in euros. */
  marketingBudget: number;
  campaign: CampaignType;
  /** Investment split, euros each. */
  investRnd: number;
  investCapacity: number;
  investBrand: number;
  /** Positive = take a loan, negative = repay. Euros. */
  loanChange: number;
  /** Share purchases in other companies: targetId -> number of shares to buy from the public float. */
  buyShares: Record<string, number>;
  /** Own shares to buy back from the public float (takeover defense). */
  buyback: number;
  /** Market research reports to buy this round. */
  research: ResearchId[];
  /** Retail (unlocks in a later round): stores to open and close, and the price in your own stores. */
  storesOpen: number;
  storesClose: number;
  retailPrice: number;
  /** Shares in rivals to sell back to the market (dumping them scares investors). */
  sellShares: Record<string, number>;
  /** One wildcard per round; each card can be used a limited number of times per match. */
  wildcard: { card: WildcardId; target?: string } | null;
  /** Sealed stake for a boardroom showdown when one of your share purchases would take control. */
  takeoverStake: number;
  /** Sealed defense fund, paid only if someone tries to take control of you this round. */
  defenseStake: number;
  /** Sealed bid in this round's auction. */
  auctionBid: number;
  /** Sealed bids on bankrupt companies' assets, per bankrupt company. */
  bankruptBids: Record<string, number>;
  /** Vote at this round's industry summit. */
  vote: "a" | "b" | null;
  /** Bankrupt players only: the company your exposé targets. */
  journalistTarget: string | null;
  /** Tycoon only: production teams to hire (positive) or lay off (negative). */
  hire: number;
  /** Investor call (optional): what you tell investors you'll sell and earn this round. */
  guidance: { units: number; profit: number } | null;
  /** Raw materials to buy now (at this round's price) for next round's production, in units of product at your quality. */
  materialOrder: number;
  /** Leftover stock to sell to the bulk buyer after the market, at the bulk price (max units). */
  bulkSell: number;
  /** Name of your product line (shown in reviews and to everyone). Optional; empty keeps the current name. */
  productName?: string;
  /** Building style in the skyline (cosmetic, unlocked by CEO level). */
  style?: number;
}

export type GuidanceResult = "hit" | "close" | "miss";

/** Live play during a round: stock exchange prices and trades, and the live auctions. */
export interface LiveTrade { t: number; trader: string; target: string; qty: number; price: number; cash: number }
export interface LiveBid { bidder: string; amount: number; t: number }
export interface LiveLot { high: LiveBid | null; endsAt: number | null; bids: number }
export interface LiveState {
  round: number;
  prices: Record<string, number>;
  trades: LiveTrade[];
  /** The round's auction (key "auction") and bankruptcy sales (key = the bankrupt company's id). */
  lots: Record<string, LiveLot>;
}

/** Private deals between players, agreed outside the decisions and carried out when the round resolves. */
export type DealKind = "shares" | "loan" | "pact" | "merger";
export interface ShareDealTerms { company: string; qty: number; price: number; direction: "sell" | "buy" }
export interface LoanDealTerms { amount: number; repay: number; rounds: number; direction: "lend" | "borrow" }
export interface PactDealTerms { rounds: number; penalty: number }
/** Friendly merger: the two companies become one. `survivor` (one of the two) keeps running; the other becomes a holding company with shares in it, split by value. */
export interface MergerDealTerms { survivor: string }
export interface DealOrder { id: string; from: string; to: string; kind: DealKind; terms: ShareDealTerms | LoanDealTerms | PactDealTerms | MergerDealTerms }

/** What a bought research report reveals, delivered with the round report. */
export interface ResearchResult {
  /** Each rival's spending and plan for the round just played. */
  competitors?: {
    companyId: string;
    companyName: string;
    produced: number;
    quality: number;
    marketingBudget: number;
    campaign: CampaignType;
    investRnd: number;
    investBrand: number;
    investCapacity: number;
    capacity: number;
    stores: number;
    retailPrice: number;
  }[];
  /** How customers see every company after the round. */
  survey?: { companyId: string; companyName: string; brand: number; hype: number }[];
  /** Expected market potential per segment for the next round, including announced news. */
  /** Insider tip: the news that will break in the round after next (null = nothing big coming). */
  forecast?: { round: number; news: { headline: string; effect: NewsEffect; duration: number; kind: "story" | "economy" }[] };
  /** Board seats: owning 25% or more of a company gives you a copy of its round report. */
  boardSeats?: { companyId: string; companyName: string; held: number; report: Pick<RoundReport, "price" | "quality" | "produced" | "sold" | "revenue" | "profit" | "cashEnd" | "debtEnd" | "marketingCost" | "rndCost" | "capacityInvest" | "stores"> }[];
  /** Market study: what every buyer group was worth in the round just played, and the outlook for the next one (news included). */
  marketStudy?: { round: number; potential: Record<SegmentId, number>; next: { round: number; potential: Record<SegmentId, number> } | null };
  /** Buyer panel: how price-sensitive each buyer group is in this game, relative to usual (1 = usual, 1.1 = 10% more sensitive). */
  buyerPanel?: Record<SegmentId, number>;
  /** Spy wildcard: one rival's full plan for the round. */
  spy?: { companyId: string; companyName: string; decisions: Omit<Decisions, "wildcard" | "journalistTarget"> };
}

export interface ShareRegister {
  /** Founder (the player) holding. */
  founder: number;
  /** Shares held by the public, buyable by anyone. */
  float: number;
  /** Shares the company bought back. They cannot be bought by others. */
  treasury: number;
  /** Shares held by other companies: holderCompanyId -> shares. */
  holders: Record<string, number>;
}

export interface Company {
  id: string;
  playerName: string;
  companyName: string;
  trait: CeoTrait;
  cash: number;
  debt: number;
  /** Units per round the factory can make. */
  capacity: number;
  /** Maximum quality the company can produce (raised by R&D). */
  qualityCap: number;
  /** Accumulated R&D progress towards the next quality cap. */
  rndProgress: number;
  /** Long-term reputation, 0..100. */
  brand: number;
  /** Short-term buzz, 0..100, decays fast. */
  hype: number;
  inventory: number;
  /** Own retail stores. */
  stores: number;
  /** The name the company started with (it can be renamed by whoever takes it over). */
  originalName?: string;
  /** Investor panic after share dumps: knocks this fraction off the company's value, fades every round. */
  sentiment: number;
  /** Times each wildcard has been used. */
  wildcardsUsed: Partial<Record<WildcardId, number>>;
  /** Secret mission, revealed at the end. */
  mission: Mission;
  /** Tycoon only: production teams. */
  workers: number;
  /** Bankrupt players: exposés that hit. */
  journalistPoints: number;
  /** Raw materials in stock, at list value (index 1.00), and the average index paid for them. */
  materials?: number;
  materialPaid?: number;
  /** Total units ever produced (year 0 included): drives the experience curve. */
  cumProduced?: number;
  /** Investor trust from the investor call, -2..3: moves company value and the interest rate. */
  credibility?: number;
  /** Average production cost of the units in inventory. */
  inventoryUnitCost: number;
  shares: ShareRegister;
  /** Id of the company that controls this one (owns more than 50 shares), if any. */
  controlledBy: string | null;
  /** Rounds left before this company may buy shares in others again (set after a takeover). */
  takeoverCooldown: number;
  bankrupt: boolean;
  /** Merged into another company: this one no longer operates and only holds shares (its player is an investor now). */
  merged?: { into: string; round: number } | null;
  /** Product line name (cosmetic) and skyline building style (cosmetic). */
  productName?: string;
  style?: number;
  /** Last decisions, used as defaults. */
  lastDecisions: Decisions;
  history: RoundReport[];
}

export interface SegmentSales {
  demand: number;
  sold: number;
  share: number;
}

export interface RoundReport {
  round: number;
  cashStart: number;
  loanChange: number;
  capacity: number;
  inventoryStart: number;
  capacityInvest: number;
  researchCost: number;
  sharePurchases: number;
  buybackCost: number;
  emergencyLoan: number;
  emergencyFee: number;
  /** Special costs: wildcards, lawsuits, Tycoon staff, auctions, showdowns. */
  wildcardCost: number;
  /** Money received from selling shares in rivals. */
  shareSales: number;
  legalCost: number;
  staffCost: number;
  workers: number;
  auctionPaid: number;
  showdownPaid: number;
  /** Net cash from deals with other players: share deals, loans and repayments, pact penalties. */
  dealCash?: number;
  /** Retail channel. `sold` and `revenue` include retail; these split it out. */
  wholesaleSold: number;
  retailPrice: number;
  retailDemand: number;
  retailSold: number;
  retailRevenue: number;
  stores: number;
  storesOpened: number;
  storesClosed: number;
  storeOpenCost: number;
  storeUpkeep: number;
  research?: ResearchResult;
  price: number;
  quality: number;
  produced: number;
  sold: number;
  unmetDemand: number;
  inventoryEnd: number;
  revenue: number;
  productionCost: number;
  holdingCost: number;
  fixedCost: number;
  marketingCost: number;
  rndCost: number;
  brandCost: number;
  interest: number;
  dividendsPaid: number;
  dividendsReceived: number;
  profit: number;
  cashEnd: number;
  debtEnd: number;
  value: number;
  sharePrice: number;
  segments: Record<SegmentId, SegmentSales>;
  events: string[];
  /** Raw materials: ordered for next round, used from stock, bought on the spot market (list values and cost). */
  materialOrderUnits?: number;
  materialOrderCost?: number;
  materialFromStock?: number;
  materialSpot?: number;
  materialSpotCost?: number;
  materialStockEnd?: number;
  /** Bulk buyer: leftover units sold at the bulk price. */
  bulkSold?: number;
  bulkRevenue?: number;
  bulkPrice?: number;
  /** Net cash from live stock exchange trades this round. */
  exchangeCash?: number;
  /** Cost sheet details (optional for older saves). */
  materialIndex?: number;
  experienceFactor?: number;
  /** Cost per unit before overtime (material, labour and quality, after the experience curve). */
  unitCostBase?: number;
  utilization?: number;
  overtimeUnits?: number;
  overtimeCost?: number;
  idleUnits?: number;
  idleCost?: number;
  /** Investor call: what was promised, how it went, and the trust level after. */
  guidance?: { units: number; profit: number; result: GuidanceResult; unitsErr: number; profitErr: number };
  credibility?: number;
  /** What critics and customers said about the product this round (public). */
  reviews?: { stars: number; quotes: string[] };
}

export interface NewsEffect {
  /** Multiplies unit production cost. */
  costMultiplier?: number;
  /** Multiplies total market demand. */
  demandMultiplier?: number;
  /** Multiplies demand in specific segments. */
  segmentMultiplier?: Partial<Record<SegmentId, number>>;
  /** Added to the loan interest rate (e.g. 0.02 = +2 points). */
  interestDelta?: number;
  /** Multiplies everybody's capacity this round. */
  capacityMultiplier?: number;
  /** Demand boost for one random company. */
  randomCompanyBoost?: number;
  /** Extra sales attraction for the cheapest company. */
  cheapestBoost?: number;
}

export interface NewsEvent {
  id: string;
  headline: string;
  effect: NewsEffect;
  /** Rounds the effect lasts, including the round it is announced. */
  duration: number;
  /** "economy" = a small market-report item (TOPSIM-style indicators); stories are the funny headlines. */
  kind?: "story" | "economy";
}

export interface ActiveNews {
  event: NewsEvent;
  roundsLeft: number;
  /** For randomCompanyBoost: the company it hits. */
  targetCompanyId?: string;
}

/** House rules a group can pick in the lobby. Missing = the normal rules. */
export interface HouseRules {
  /** Starting cash per company (euros). */
  startCash?: number;
  /** false = no share buying, takeovers, mergers or live exchange. */
  takeovers?: boolean;
  /** false = no wildcards. */
  wildcards?: boolean;
  /** How much news happens and how hard it hits. */
  news?: "calm" | "normal" | "wild";
}

export interface GameConfig {
  industry: IndustryId;
  difficulty: DifficultyId;
  rounds: number;
  seed: number;
  rules?: HouseRules;
}

export interface GameState {
  config: GameConfig;
  /** The round about to be played (1-based). After the last round, equals rounds + 1. */
  round: number;
  companies: Company[];
  /** News announced for the coming round. */
  news: ActiveNews[];
  /** Headlines generated during resolution (flops, takeovers, bankruptcies). */
  feed: { round: number; headline: string }[];
  rngState: number;
  finished: boolean;
  /** The news that breaks next round (drawn a round early so insiders can learn it). undefined = not drawn yet. */
  upcomingNews?: ActiveNews[];
  /** Online games: which companies are bots, and their strategy. */
  bots?: Record<string, string>;
  /** Online games: what each player may see (set on per-player views only). */
  publicValues?: Record<string, number>;
  publicSharePrices?: Record<string, number>;
  /** Market size and total sales per segment for every round played (year 0 included). */
  marketLog?: { round: number; potential: Record<SegmentId, number>; sold: Record<SegmentId, number>; materialIndex?: number; avgPrice?: number }[];
  /** Non-attack pacts: no share purchases or targeted wildcards between a and b up to and including round `until`. */
  pacts?: { a: string; b: string; until: number; penalty: number }[];
  /** Loans between players, repaid automatically at the start of round `due`. */
  playerLoans?: { lender: string; borrower: string; repay: number; due: number }[];
  /** What happened to each deal in the round just played. */
  dealLog?: { id: string; round: number; ok: boolean; reason: string; from: string; to: string }[];
  /** Hidden market drivers (server only online): raw material price index for the coming round, slow trends per buyer group, and this game's price sensitivity per group. */
  market?: {
    materialIndex: number;
    /** Next round's index, drawn a round early (server only online). */
    materialNext?: number;
    /** Public hint about next round's material price (right about 3 times out of 4). */
    materialOutlook?: "up" | "down" | "flat";
    /** What the bulk buyer pays per unit this round. */
    bulkPrice?: number;
    trend?: Record<SegmentId, number>;
    sensitivity?: Record<SegmentId, number>;
  };
  /** The live stock exchange and live auctions of the round being played. */
  live?: LiveState;
  /** Special rounds announced a round ahead (Black Friday, Investor Day). */
  specialEvents?: { round: number; id: "blackFriday" | "investorDay" }[];
  /** Bankrupt companies whose factory and stores are auctioned off in a given round. */
  bankruptcySales?: { round: number; companyId: string }[];
  /** Set when one player controls every other company: the game ends and they win. */
  monopolyBy?: string | null;
  /** Sealed-bid auction held this round, if any. */
  auction: { round: number; item: AuctionItemId } | null;
  /** Industry summit vote held this round, if any. */
  summit: { round: number; options: [RegulationId, RegulationId] } | null;
}

export interface PlayerSetup {
  id: string;
  playerName: string;
  companyName: string;
  trait: CeoTrait;
}

export interface Standing {
  companyId: string;
  playerName: string;
  companyName: string;
  value: number;
  score: number;
  controlledBy: string | null;
  controls: string[];
  bankrupt: boolean;
  mission: Mission;
  /** Won by controlling every other company. */
  monopoly: boolean;
  missionDone: boolean;
  missionBonus: number;
  journalistPoints: number;
  /** Merged into another company (now a holding company). */
  merged?: string | null;
}
