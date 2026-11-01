// Friendly Takeover — balance constants, industries, difficulties and news.
// Every number here is a starting value meant to be tuned in playtests.

import type { AuctionItemId, CampaignType, CeoTrait, DifficultyId, IndustryId, MissionId, NewsEffect, NewsEvent, RegulationId, ResearchId, SegmentId, WildcardId } from "./types";

export interface SegmentConfig {
  /** Share of total market potential in this segment. */
  weight: number;
  /** Price the segment considers "normal". */
  refPrice: number;
  /** Price sensitivity: higher = punishes expensive products harder. */
  priceSensitivity: number;
  qualityWeight: number;
  brandWeight: number;
  hypeWeight: number;
  /** Prestige penalty when the price is below this fraction of refPrice (premium buyers distrust cheap). */
  cheapPenaltyBelow?: number;
  cheapPenalty?: number;
}

export interface IndustryConfig {
  id: IndustryId;
  name: string;
  /** Labels shown in the UI, so each industry feels different. */
  labels: { product: string; products: string; capacity: string; quality: string; unit: string };
  /** Market potential per company per round, in units. */
  potentialPerCompany: number;
  /** Market growth per round. */
  growth: number;
  segments: Record<SegmentId, SegmentConfig>;
  /** Production cost per unit at quality 1. */
  baseUnitCost: number;
  /** Extra cost per quality level above 1, as a fraction of baseUnitCost. */
  qualityCostStep: number;
  /** Extra cost per squared quality level above 1: top quality gets disproportionately expensive. */
  qualityCostCurve: number;
  /** Starting values. */
  start: { cash: number; capacity: number; brand: number; hype: number; qualityCap: number; price: number; quality: number };
  /** Price slider bounds for the UI and for sanitising input. */
  priceRange: [number, number];
  /** Crazy-product names for the wildcard (used by the UI and news). */
  crazyProducts: string[];
  news: NewsEvent[];
}

export interface DifficultyConfig {
  id: DifficultyId;
  /** First round in which share purchases in rivals are allowed. */
  takeoverUnlockRound: number;
  /** Rounds a company must wait to buy shares again after taking control of another. */
  takeoverCooldown: number;
  /** Max shares one company may buy in one target per round. */
  maxSharesPerRound: number;
  /** Chance per round that a news event is drawn. */
  newsChance: number;
  /** First round in which companies may open their own stores. */
  retailUnlockRound: number;
}

export const BALANCE = {
  /** Fraction of potential buyers who skip the market entirely when all offers are "neutral". */
  outsideOptionWeight: 0.25,
  /** Share of unmet demand that switches to a rival who still has stock. */
  switchRate: 0.5,
  // Per-unit amounts below are multiples of the industry's baseUnitCost, so every industry has the same economics.
  /** Factory upkeep per unit of capacity per round. */
  fixedCostPerCapacity: 0.3,
  /** Holding cost per unsold unit per round, as a fraction of its production cost. */
  holdingCostRate: 0.1,
  /** Cost of one extra unit of capacity (available next round). */
  capacityCostPerUnit: 5,
  /** Book value per unit of capacity in the valuation. */
  capacityBookValue: 4,
  /** Capacity wears out: fraction lost per round. */
  capacityDepreciation: 0.03,
  /** Valuation per brand point. */
  brandValuePerPoint: 15000,
  /** Valuation multiple on average profit of the last two rounds. */
  earningsMultiple: 3,
  /** Inventory counts at this fraction of its cost in the valuation. */
  inventoryValueRate: 0.6,
  /** Loan interest per round (one round = one business year). */
  baseInterest: 0.06,
  /** Extra interest on automatic emergency loans. */
  emergencyInterestPremium: 0.06,
  /** Maximum debt. */
  /** How far buyers' sense of a "normal" price follows what companies actually charge (0 = fixed, 1 = fully relative). */
  priceAnchorDrift: 0.3,
  /** Hard ceiling on all debt, emergency loans included. Beyond this a company goes bankrupt. */
  maxDebt: 6_000_000,
  /** Banks lend you up to this share of your company value (but at least minCreditLimit). */
  creditLimitShare: 0.5,
  minCreditLimit: 2_000_000,
  /** Marketing: diminishing returns scale (euros). */
  marketingScale: 150_000,
  /** Brand: points per log-step of investment, and the investment scale. */
  brandGainPerStep: 6,
  brandScale: 200_000,
  brandDecay: 0.95,
  hypeDecay: 0.65,
  /** R&D needed (cumulative, euros) to unlock quality caps 4 and 5. */
  rndThresholds: { 4: 450_000, 5: 1_150_000 } as Record<number, number>,
  /** Takeovers. */
  takeoverPremium: 0.15,
  /** Extra premium per share the buyer already holds (shares get pricier as you accumulate). */
  premiumPerHeldShare: 0.008,
  buybackPremium: 0.1,
  controlThreshold: 50,
  /** Controlled companies pay this fraction of positive profit as dividend. */
  subsidiaryPayout: 0.5,
  /** Final score multiplier for controlled companies, and bonus for controllers per controlled company. */
  controlledScoreMultiplier: 0.75,
  controllerBonusRate: 0.1,
  startShares: { founder: 30, float: 70 },
  /** Selling shares: you get the share price minus this discount, after the price drop your sale causes. */
  sellDiscount: 0.05,
  /** Every share dumped knocks this much off the company's value (investor panic), capped per round and in total. */
  dumpImpactPerShare: 0.003,
  dumpImpactCapPerRound: 0.15,
  sentimentMax: 0.3,
  /** Panic fades: this share of it is left at the start of the next round. */
  sentimentRecovery: 0.5,
} as const;

/** Own retail stores: a second sales channel next to selling through shops. */
export const RETAIL = {
  /** Opening one store (an investment: it stays on the books). */
  openCost: 150_000,
  /** Rent and staff per store per round. */
  upkeep: 35_000,
  /** Book value of one store in the company valuation. */
  bookValue: 90_000,
  /** Units one store can sell per round, as a share of the market potential per company. */
  storeCapacityShare: 0.03,
  /** Retail customers, as a share of the total market size. */
  potentialShare: 0.08,
  /** Normal store price, as a multiple of the mainstream reference price. */
  refFactor: 1.45,
  priceSensitivity: 2.2,
  qualityWeight: 0.35,
  brandWeight: 0.5,
  hypeWeight: 0.25,
  /** More stores reach more customers (diminishing). */
  reachWeight: 0.5,
  maxOpenPerRound: 4,
  maxStores: 16,
} as const;

export const WILDCARDS: Record<WildcardId, { name: string; cost: number; maxUses: number; needsTarget: boolean; exposeChance: number; description: string }> = {
  crazy: { name: "Crazy product launch", cost: 150_000, maxUses: 2, needsTarget: false, exposeChance: 0, description: "A wild limited edition. 55% chance of a hype explosion this round, 45% chance it flops and hurts your brand" },
  poach: { name: "Poach talent", cost: 100_000, maxUses: 2, needsTarget: true, exposeChance: 0.5, description: "Steal 30% of a rival's R&D progress. 50% chance the news finds out" },
  spy: { name: "Spy", cost: 50_000, maxUses: 2, needsTarget: true, exposeChance: 0.25, description: "See one rival's full plan for this round in your report. 25% chance you're caught" },
  lobby: { name: "Lobby", cost: 120_000, maxUses: 2, needsTarget: false, exposeChance: 0, description: "This round, bad news can't raise your costs or interest or cut your capacity" },
  scandal: { name: "Leak a scandal", cost: 100_000, maxUses: 2, needsTarget: true, exposeChance: 0.35, description: "A rival loses brand and hype right away. 35% chance it's traced back to you" },
  lawsuit: { name: "Lawsuit", cost: 80_000, maxUses: 2, needsTarget: true, exposeChance: 0, description: "A rival pays €250k in legal costs. 30% chance it backfires and you pay instead" },
};
export const WILDCARD_EFFECTS = {
  crazySuccess: 0.55, crazyHype: 30, crazyUtility: 0.8, crazyFlopBrand: 5, crazyFlopHype: 10,
  poachShare: 0.3, scandalBrand: 6, scandalHype: 12, exposedBrand: 4, lawsuitCost: 250_000, lawsuitBackfire: 0.3,
};

export const SHOWDOWN = { minStake: 50_000 };

export const AUCTION = {
  rounds: [3, 6, 9, 12],
  minBid: 50_000,
  items: {
    endorsement: { name: "Celebrity endorsement", description: "+15 brand right away" },
    patent: { name: "Patent", description: "Your maximum quality goes up by one level" },
    factory: { name: "Bankrupt rival's factory", description: "+25% factory capacity" },
    location: { name: "Prime high-street location", description: "Two free stores (works once retail is open)" },
  } as Record<AuctionItemId, { name: string; description: string }>,
};

export const SUMMIT = {
  rounds: [4, 7, 10],
  duration: 2,
  regulations: {
    luxuryTax: { name: "Luxury tax", description: "Premium buyers -10% for 2 rounds", effect: { segmentMultiplier: { premium: 0.9 } } },
    bargainBan: { name: "Bargain ban", description: "Budget buyers -10% for 2 rounds", effect: { segmentMultiplier: { budget: 0.9 } } },
    influencerLaw: { name: "Influencer law", description: "Hype buyers -12% for 2 rounds", effect: { segmentMultiplier: { hype: 0.88 } } },
    middleClassCut: { name: "Middle-class tax cut", description: "Mainstream buyers +10% for 2 rounds", effect: { segmentMultiplier: { mainstream: 1.1 } } },
    cheapCredit: { name: "Cheap credit", description: "Interest -1 point for 2 rounds", effect: { interestDelta: -0.01 } },
    greenRules: { name: "Green production rules", description: "Production costs +5% for 2 rounds", effect: { costMultiplier: 1.05 } },
  } as Record<RegulationId, { name: string; description: string; effect: NewsEffect }>,
};

/** Owning this many shares of a company gives you a board seat: a copy of its round report. */
export const BOARD_SEAT_SHARES = 25;

/** Special rounds, announced one round ahead so players can plan for them. */
export const EVENTS = {
  blackFriday: { name: "Black Friday", description: "Everyone shops: demand +15%, bargain hunters +25% this round", effect: { demandMultiplier: 1.15, segmentMultiplier: { budget: 1.25 } } as NewsEffect },
  investorDay: { name: "Investor Day", description: "Takeover premiums are halved this round", premiumFactor: 0.5 },
};

/** When a company goes bankrupt, its factory and stores are auctioned off the next round. */
export const BANKRUPTCY_SALE = { minBid: 100_000, capacityShare: 0.75, brandShare: 0.25 };

export const MISSIONS: Record<MissionId, { name: string; description: string }> = {
  stake: { name: "Silent partner", description: "Own at least 30% of {target} at the end" },
  stores: { name: "High-street king", description: "Have at least 8 stores at the end" },
  premiumLead: { name: "Luxury leader", description: "Sell the most to premium buyers in the final round" },
  budgetLead: { name: "Discount champion", description: "Sell the most to budget buyers in the final round" },
  debtFree: { name: "Clean books", description: "Finish with no debt and more than €2M cash" },
  quality5: { name: "Perfectionist", description: "Unlock quality 5" },
  volume: { name: "Volume machine", description: "Sell the most units over the whole game" },
  brand: { name: "Household name", description: "Have the strongest brand at the end" },
};
export const MISSION_BONUS = 600_000;

/** Tycoon mode: production needs teams of workers; labour moves out of the unit cost into wages. */
export const TYCOON = {
  laborShare: 0.3,
  teamOutputShare: 0.05,
  hireCostFactor: 0.6,
  severanceFactor: 1.2,
  maxHirePerRound: 10,
};

/** Journalist: a bankrupt player's exposé hits a company's brand and hype. */
export const JOURNALIST = { brand: 4, hype: 8 };

export const RESEARCH: Record<ResearchId, { name: string; cost: number; description: string }> = {
  competitors: { name: "Competitor spending", cost: 60_000, description: "Each rival's production, quality, marketing, R&D, brand and factory spending this round" },
  survey: { name: "Customer survey", cost: 30_000, description: "How customers rate every company's brand and hype after this round" },
  forecast: { name: "Insider tip", cost: 50_000, description: "Learn the news that will hit the round after next, a full round before everyone else" },
  marketStudy: { name: "Market study", cost: 40_000, description: "What each buyer group was worth this round, and next round's outlook with the news included" },
  buyerPanel: { name: "Buyer panel", cost: 35_000, description: "How price-sensitive each buyer group is in this game compared with usual" },
};

/** Costs that move: the experience curve, factory load and raw material prices. */
export const COSTS = {
  /** Cost per unit falls this much every time total production doubles. */
  learningRate: 0.08,
  /** Experience you start with, in years of standard production (so the first rounds don't drop too fast). */
  priorYears: 2,
  /** The experience curve stops here. */
  learningFloor: 0.75,
  /** Above this share of capacity, extra units run in overtime. */
  overtimeFrom: 0.9,
  /** Overtime units cost this much more. */
  overtimePremium: 0.25,
  /** Below this share of capacity, idle machines cost money. */
  idleBelow: 0.6,
  /** Cost per idle unit of capacity below that line, as a fraction of the base unit cost. */
  idleCostRate: 0.15,
  /** Share of the unit cost that is raw material (bought a round ahead, at the material price index). */
  materialShare: 0.45,
  /** Material index: pulled back to 1, plus a move that the outlook hints at, plus noise. */
  materialPull: 0.3,
  materialMove: 0.09,
  materialVol: 0.03,
  materialRange: [0.7, 1.45] as [number, number],
  /** How often the published outlook is right. */
  outlookAccuracy: 0.75,
  /** Materials you didn't order in time are bought on the spot market at this premium. */
  spotPremium: 0.15,
  /** Holding cost on materials in stock, per round. */
  materialHolding: 0.02,
  /** Materials count in company value at this share of what you paid. */
  materialBookValue: 0.9,
  /** Slow trends per buyer group, per round: one group grows, one shrinks, the others drift. */
  trendGrow: [0.015, 0.03] as [number, number],
  trendShrink: [-0.03, -0.015] as [number, number],
  trendDrift: 0.008,
  /** This game's price sensitivity per buyer group, as a multiple of usual. */
  sensitivityRange: [0.85, 1.15] as [number, number],
};

/** Bulk buyer: takes leftover stock after the market at a low price (a share of last round's average price). */
export const BULK = { priceShare: [0.4, 0.55] as [number, number], maxShareOfCapacity: 0.5 };

/** Live stock exchange during a round: price impact per share traded, fee, and the cap (control needs a takeover bid). */
// Shares bought on the exchange count towards the difficulty's maxSharesPerRound, together with end-of-round takeover bids.
export const EXCHANGE = { impactPerShare: 0.005, fee: 0.02, maxHolding: 50 };

/** Live auctions: minimum raise and the "going once, going twice" timer after each bid. */
export const LIVE_AUCTION = { minRaise: 10_000, raiseShare: 0.05, goingMs: 45_000 };

/** Deals between players: limits that keep them sane. */
export const DEALS = { maxPrice: 50_000_000, maxLoan: 5_000_000, maxLoanRounds: 3, maxPactRounds: 4, maxPenalty: 5_000_000 };

/** Investor call: give guidance, hit it, and investors trust you more. */
export const GUIDANCE = {
  /** Hit: both errors within these (units, profit). */
  hit: [0.1, 0.15] as [number, number],
  /** Miss: either error above these. In between is "close" (no change). */
  miss: [0.25, 0.4] as [number, number],
  credibilityRange: [-2, 3] as [number, number],
  /** Company value moves this much per credibility point. */
  valuePerPoint: 0.03,
  /** Interest rate moves this much per point (lower when trusted). */
  interestPerPoint: 0.004,
};

export const CAMPAIGNS: Record<CampaignType, { segment: Record<SegmentId, number>; hypeGain: number; brandGain: number; flopChance: number }> = {
  discount: { segment: { budget: 0.7, mainstream: 0.2, premium: -0.3, hype: 0.0 }, hypeGain: 2, brandGain: -0.5, flopChance: 0 },
  tv: { segment: { budget: 0.2, mainstream: 0.6, premium: 0.15, hype: 0.15 }, hypeGain: 4, brandGain: 1, flopChance: 0 },
  luxury: { segment: { budget: -0.1, mainstream: 0.15, premium: 0.7, hype: 0.1 }, hypeGain: 3, brandGain: 2, flopChance: 0 },
  viral: { segment: { budget: 0.05, mainstream: 0.15, premium: 0.0, hype: 0.6 }, hypeGain: 22, brandGain: 0, flopChance: 0.25 },
};

export const TRAITS: Record<CeoTrait, { name: string; description: string }> = {
  ruthless: { name: "Ruthless", description: "Takeover premiums 15% lower" },
  visionary: { name: "Visionary", description: "R&D 15% more effective" },
  influencer: { name: "Influencer", description: "Hype gains 15% higher" },
  pennyPincher: { name: "Penny-Pincher", description: "Production costs 8% lower" },
};

export const TRAIT_EFFECTS = {
  ruthlessPremiumFactor: 0.85,
  visionaryRndFactor: 1.15,
  influencerHypeFactor: 1.15,
  pennyPincherCostFactor: 0.92,
};

export const DIFFICULTIES: Record<DifficultyId, DifficultyConfig> = {
  standard: { id: "standard", takeoverUnlockRound: 3, takeoverCooldown: 2, maxSharesPerRound: 15, newsChance: 0.6, retailUnlockRound: 3 },
  // Tycoon uses the Standard rules until its extra mechanics (hiring, multi-product, logistics) are built.
  tycoon: { id: "tycoon", takeoverUnlockRound: 3, takeoverCooldown: 2, maxSharesPerRound: 15, newsChance: 0.6, retailUnlockRound: 3 },
  cutthroat: { id: "cutthroat", takeoverUnlockRound: 1, takeoverCooldown: 0, maxSharesPerRound: 20, newsChance: 0.75, retailUnlockRound: 2 },
};

const CHOCOLATE: IndustryConfig = {
  id: "chocolate",
  name: "Chocolate",
  labels: { product: "bar", products: "bars", capacity: "factory capacity", quality: "cocoa quality", unit: "bars" },
  potentialPerCompany: 1_000_000,
  growth: 0.03,
  segments: {
    budget: { weight: 0.36, refPrice: 1.1, priceSensitivity: 3.4, qualityWeight: 0.15, brandWeight: 0.1, hypeWeight: 0.0 },
    mainstream: { weight: 0.32, refPrice: 2.2, priceSensitivity: 2.4, qualityWeight: 0.35, brandWeight: 0.35, hypeWeight: 0.15 },
    premium: { weight: 0.14, refPrice: 3.4, priceSensitivity: 1.7, qualityWeight: 0.55, brandWeight: 0.6, hypeWeight: 0.1, cheapPenaltyBelow: 0.6, cheapPenalty: 1.5 },
    hype: { weight: 0.18, refPrice: 2.6, priceSensitivity: 1.2, qualityWeight: 0.1, brandWeight: 0.3, hypeWeight: 1.4 },
  },
  baseUnitCost: 0.5,
  qualityCostStep: 0.6,
  qualityCostCurve: 0.08,
  start: { cash: 1_000_000, capacity: 900_000, brand: 30, hype: 10, qualityCap: 3, price: 2.2, quality: 3 },
  priceRange: [0.3, 12],
  crazyProducts: ["Bacon-pickle bar", "Chocolate-covered broccoli", "Self-melting bar", "Spicy ghost-pepper truffle"],
  news: [
    { id: "raptors", headline: "Dinosaurs brought back to life; a herd of raptors eats half the world's cocoa beans", effect: { costMultiplier: 1.4 }, duration: 2 },
    { id: "horoscope-rates", headline: "Central bank chair raises interest rates because his horoscope told him to", effect: { interestDelta: 0.02 }, duration: 2 },
    { id: "burgerland", headline: "President of Burgerland posts that one company's chocolate is \"tremendous, the best, maybe ever\"", effect: { randomCompanyBoost: 0.4 }, duration: 1 },
    { id: "boredom-cure", headline: "Influencer claims chocolate cures boredom; everyone suddenly wants some", effect: { demandMultiplier: 1.6 }, duration: 1 },
    { id: "aliens", headline: "Aliens land and only buy the cheapest chocolate on the market", effect: { cheapestBoost: 0.8 }, duration: 1 },
    { id: "screws", headline: "Global shortage of tiny screws jams every chocolate factory", effect: { capacityMultiplier: 0.8 }, duration: 1 },
    { id: "recession", headline: "Recession hits: shoppers hunt for bargains", effect: { segmentMultiplier: { budget: 1.4, premium: 0.7, hype: 0.85 } }, duration: 2 },
    { id: "boom", headline: "Economy booms; everyone treats themselves to the fancy stuff", effect: { segmentMultiplier: { premium: 1.5, budget: 0.85 } }, duration: 2 },
    { id: "tiktok", headline: "New trend: people film themselves unwrapping chocolate in slow motion", effect: { segmentMultiplier: { hype: 1.8 } }, duration: 1 },
    { id: "dentists", headline: "Dentists' association declares chocolate \"basically a vegetable\"", effect: { demandMultiplier: 1.25 }, duration: 1 },
    { id: "sugar-tax", headline: "Parliament introduces a sugar tax after a minister loses a bet", effect: { costMultiplier: 1.15, demandMultiplier: 0.9 }, duration: 2 },
    { id: "heatwave", headline: "Record heatwave melts half the country's shop displays", effect: { demandMultiplier: 0.8 }, duration: 1 },
    { id: "valentines", headline: "Dating app glitch matches everyone with everyone. Valentine's Day declared every day", effect: { segmentMultiplier: { premium: 1.5, hype: 1.3 } }, duration: 1 },
    { id: "gym-craze", headline: "New fitness craze: running a marathon while eating a chocolate bar", effect: { demandMultiplier: 1.2 }, duration: 1 },
    { id: "cocoa-strike", headline: "Cocoa pickers' union strikes for better hats. Fair enough, honestly", effect: { costMultiplier: 1.25 }, duration: 1 },
    { id: "cheap-wars", headline: "Supermarket chains start a price war over who sells the saddest chocolate", effect: { segmentMultiplier: { budget: 1.3, mainstream: 0.9 } }, duration: 1 },
    { id: "food-critic", headline: "Famous food critic cries on live TV after one bite of dark chocolate", effect: { segmentMultiplier: { premium: 1.6 } }, duration: 1 },
    { id: "diet-trend", headline: "Everyone's on the new \"only beige food\" diet. Chocolate is too brown", effect: { demandMultiplier: 0.82 }, duration: 1 },
    { id: "squirrel", headline: "Squirrel gang raids a warehouse in broad daylight, takes only the hazelnut stock", effect: { capacityMultiplier: 0.85 }, duration: 1 },
    { id: "kids-show", headline: "Hit kids' show features a talking chocolate bar. Parents give up", effect: { segmentMultiplier: { mainstream: 1.4, budget: 1.2 } }, duration: 1 },
    { id: "luxury-scandal", headline: "Undercover reporter finds \"artisan\" chocolate is just regular chocolate with a ribbon", effect: { segmentMultiplier: { premium: 0.65 } }, duration: 1 },
    { id: "random-viral", headline: "A grandma's review of one company's chocolate gets 40 million views", effect: { randomCompanyBoost: 0.45 }, duration: 1 },
    { id: "cheapest-tourists", headline: "Bus of 3,000 tourists arrives and buys the cheapest bars to take home as \"local delicacy\"", effect: { cheapestBoost: 0.7 }, duration: 1 },
    { id: "factory-cat", headline: "A cat falls asleep on a conveyor belt; every factory stops to film it", effect: { capacityMultiplier: 0.88 }, duration: 1 },
    { id: "rate-cut-choc", headline: "Central bank cuts interest rates to cheer up a sad intern", effect: { interestDelta: -0.02 }, duration: 2 },
    { id: "sugar-cheap", headline: "Sugar beet harvest so big farmers are building houses out of it", effect: { costMultiplier: 0.8 }, duration: 2 },
    { id: "unboxing-ban", headline: "Social network bans unboxing videos after one goes on for nine hours", effect: { segmentMultiplier: { hype: 0.8 } }, duration: 1 },
    { id: "easter", headline: "Easter moved forward by a month \"for logistical reasons\". Nobody asks questions", effect: { demandMultiplier: 1.35 }, duration: 1 },
    { id: "office-snacks", headline: "Companies replace bonuses with office snack bowls. Employees furious, snack bowls full", effect: { segmentMultiplier: { mainstream: 1.3, budget: 1.15, premium: 0.85 } }, duration: 1 },
    { id: "cocoa-flood", headline: "Cocoa trees confused by weather, produce double. Scientists shrug", effect: { costMultiplier: 0.85 }, duration: 1 },
    { id: "influencer-quit", headline: "The country's biggest snack influencer quits \"to find himself\"", effect: { segmentMultiplier: { hype: 0.8 } }, duration: 1 },
    { id: "chocolate-day", headline: "Parliament declares a national chocolate day by accident (the vote was about tax)", effect: { demandMultiplier: 1.3 }, duration: 1 },
    { id: "machine-bug", headline: "Software update makes every wrapping machine wrap things twice", effect: { costMultiplier: 1.12, capacityMultiplier: 0.9 }, duration: 1 },
    { id: "rich-kids", headline: "Rich kids start paying their homework helpers in fancy truffles", effect: { segmentMultiplier: { premium: 1.4, hype: 1.2 } }, duration: 1 },
    { id: "bank-panic-choc", headline: "Bank's computer thinks it's 1982 and charges 1982 interest rates", effect: { interestDelta: 0.025 }, duration: 1 },
    { id: "cheap-lovers", headline: "Students discover chocolate counts as a \"meal\" on their meal plan", effect: { segmentMultiplier: { budget: 1.25, hype: 1.2 } }, duration: 1 },
  ],
};

/**
 * AI and Weed reuse Chocolate's tuned market structure, scaled by unit cost, so balance carries over.
 * Only names, labels, growth, crazy products and news differ.
 */
function deriveIndustry(
  base: IndustryConfig,
  o: Pick<IndustryConfig, "id" | "name" | "labels" | "growth" | "crazyProducts" | "news"> & { baseUnitCost: number; segmentTweaks?: Partial<Record<SegmentId, Partial<SegmentConfig>>> },
): IndustryConfig {
  const f = o.baseUnitCost / base.baseUnitCost;
  const { segmentTweaks, ...rest } = o;
  const segments = Object.fromEntries(
    Object.entries(base.segments).map(([k, v]) => [k, { ...v, ...(segmentTweaks?.[k as SegmentId] ?? {}), refPrice: Math.round(v.refPrice * f * 100) / 100 }]),
  ) as Record<SegmentId, SegmentConfig>;
  return {
    ...base,
    ...rest,
    segments,
    potentialPerCompany: Math.round(base.potentialPerCompany / f),
    start: { ...base.start, capacity: Math.round(base.start.capacity / f), price: Math.round(base.start.price * f * 100) / 100 },
    priceRange: [Math.round(base.priceRange[0] * f * 100) / 100, Math.round(base.priceRange[1] * f * 100) / 100],
  };
}

const AI = deriveIndustry(CHOCOLATE, {
  // Faster growth and this industry's news favour premium a little; a slightly smaller premium group (and bigger hype group) evens it out.
  segmentTweaks: { premium: { weight: 0.14 }, hype: { weight: 0.17 }, mainstream: { weight: 0.33 } },
  id: "ai",
  name: "AI",
  labels: { product: "subscription", products: "subscriptions", capacity: "servers", quality: "model quality", unit: "subscriptions" },
  baseUnitCost: 4,
  growth: 0.04,
  crazyProducts: ["AI toaster", "AI that writes apologies for you", "Smart fridge that judges you", "AI pet rock"],
  news: [
    { id: "gpu-yacht", headline: "Tech billionaire buys every GPU on Earth to decorate his yacht", effect: { costMultiplier: 1.4 }, duration: 2 },
    { id: "ai-ceo", headline: "A company's AI model votes itself in as CEO and gives everyone Fridays off", effect: { randomCompanyBoost: 0.4 }, duration: 1 },
    { id: "ai-safety", headline: "Parliament passes an AI safety law nobody has read", effect: { costMultiplier: 1.15 }, duration: 2 },
    { id: "chatbot-poem", headline: "Chatbot writes a poem so moving the whole internet signs up", effect: { demandMultiplier: 1.5 }, duration: 1 },
    { id: "bubble", headline: "Analysts warn of an AI bubble; investors panic, then forget", effect: { segmentMultiplier: { hype: 0.6, budget: 1.2 } }, duration: 1 },
    { id: "server-fire", headline: "Data center catches fire after a server tries to mine its own crypto", effect: { capacityMultiplier: 0.8 }, duration: 1 },
    { id: "rates-ai", headline: "Central bank chair raises rates because the vibes were off", effect: { interestDelta: 0.02 }, duration: 2 },
    { id: "enterprise", headline: "Every bank suddenly needs \"an AI strategy\" by Monday", effect: { segmentMultiplier: { premium: 1.6 } }, duration: 2 },
    { id: "free-tier", headline: "Students discover the free tier; servers groan", effect: { segmentMultiplier: { budget: 1.5 } }, duration: 1 },
    { id: "robot-dance", headline: "Viral video of a robot doing the floss sends AI gadgets flying off the shelves", effect: { segmentMultiplier: { hype: 1.8 } }, duration: 1 },
    { id: "chip-glut", headline: "Chip factory overproduces by a factor of ten after someone typed one zero too many", effect: { costMultiplier: 0.8 }, duration: 2 },
    { id: "grandma-ai", headline: "Grandmas discover AI chatbots and won't stop asking them for soup recipes", effect: { segmentMultiplier: { mainstream: 1.5 } }, duration: 1 },
    { id: "hallucination", headline: "Chatbot tells a million people the moon is a cheese wheel. Trust in AI wobbles", effect: { demandMultiplier: 0.8 }, duration: 1 },
    { id: "power-cut-ai", headline: "Power company accidentally unplugs the city to charge a single e-scooter", effect: { capacityMultiplier: 0.82 }, duration: 1 },
    { id: "ai-homework", headline: "Every school bans AI homework help. Every student signs up anyway", effect: { segmentMultiplier: { budget: 1.4, hype: 1.2 } }, duration: 1 },
    { id: "ceo-keynote", headline: "Tech keynote goes viral when the CEO's robot dog bites him on stage", effect: { segmentMultiplier: { hype: 1.5 } }, duration: 1 },
    { id: "privacy-panic", headline: "Report reveals smart speakers have been listening to people sing in the shower", effect: { segmentMultiplier: { mainstream: 0.75, premium: 0.85 } }, duration: 1 },
    { id: "lawyers-ai", headline: "Lawyers find out AI can write contracts. Lawyers find out AI can't write contracts", effect: { segmentMultiplier: { premium: 1.4 } }, duration: 1 },
    { id: "free-ai", headline: "Mystery startup offers AI for free \"forever\". Lasts nine days", effect: { cheapestBoost: 0.7 }, duration: 1 },
    { id: "random-ai-viral", headline: "One company's AI writes a birthday song so good it tops the charts", effect: { randomCompanyBoost: 0.45 }, duration: 1 },
    { id: "cooling", headline: "Data centers run out of cooling water after a heatwave; servers wear tiny fans", effect: { capacityMultiplier: 0.85, costMultiplier: 1.1 }, duration: 1 },
    { id: "rates-down-ai", headline: "Central bank cuts rates after asking a chatbot what to do", effect: { interestDelta: -0.02 }, duration: 2 },
    { id: "office-mandate", headline: "Every office must now have an \"AI buddy\" for each employee, by law (nobody knows why)", effect: { demandMultiplier: 1.3 }, duration: 1 },
    { id: "luxury-ai", headline: "Billionaires show off personal AI butlers with British accents", effect: { segmentMultiplier: { premium: 1.5, budget: 0.85 } }, duration: 1 },
    { id: "ai-flop", headline: "AI-written movie is so bad cinemas hand out refunds and blankets", effect: { segmentMultiplier: { hype: 0.65 } }, duration: 1 },
    { id: "cheap-phones", headline: "New €20 phone runs AI apps surprisingly well, mostly by guessing", effect: { segmentMultiplier: { budget: 1.5 } }, duration: 1 },
    { id: "energy-tax", headline: "New energy tax on data centers, paid in electricity bills nobody can read", effect: { costMultiplier: 1.2 }, duration: 2 },
    { id: "ai-friend", headline: "Survey: 40% of people would rather talk to their AI than their in-laws", effect: { demandMultiplier: 1.2, segmentMultiplier: { mainstream: 1.15 } }, duration: 1 },
    { id: "gpu-thief", headline: "Gang of crypto miners steals a truck of GPUs, gets lost, returns it", effect: { costMultiplier: 1.12 }, duration: 1 },
    { id: "robot-strike", headline: "Delivery robots refuse to work in the rain. Same, honestly", effect: { capacityMultiplier: 0.9 }, duration: 1 },
    { id: "ai-fair", headline: "Biggest tech fair of the year: everyone leaves with a free AI stress ball", effect: { segmentMultiplier: { hype: 1.4, mainstream: 1.1 } }, duration: 1 },
    { id: "budget-cuts-ai", headline: "Companies cut costs; \"the expensive AI\" is the first thing to go", effect: { segmentMultiplier: { premium: 0.7, budget: 1.2 } }, duration: 1 },
    { id: "bank-glitch-ai", headline: "A trading bot buys every government bond by mistake. Interest rates jump", effect: { interestDelta: 0.025 }, duration: 1 },
    { id: "students-free", headline: "Exam season: students pay anything for an AI that explains maths slowly", effect: { demandMultiplier: 1.25 }, duration: 1 },
    { id: "chip-tariff", headline: "Two countries argue over who invented the microchip; tariffs on everything", effect: { costMultiplier: 1.25 }, duration: 1 },
  ],
});

const WEED = deriveIndustry(CHOCOLATE, {
  // Faster growth and this industry's news favour premium a little; a slightly smaller premium group (and bigger hype group) evens it out.
  segmentTweaks: { premium: { weight: 0.145 }, hype: { weight: 0.16 }, mainstream: { weight: 0.335 } },
  id: "weed",
  name: "Weed (18+)",
  labels: { product: "gram", products: "grams", capacity: "grow rooms", quality: "strain quality", unit: "grams" },
  baseUnitCost: 2.5,
  growth: 0.04,
  crazyProducts: ["Glow-in-the-dark gummies", "Weed-scented candles", "Edible pizza boxes", "Lavender-lemon space cake"],
  news: [
    { id: "pigeons", headline: "City council allows delivery by carrier pigeon", effect: { demandMultiplier: 1.3 }, duration: 1 },
    { id: "raccoons", headline: "Raccoons break into a warehouse and refuse to leave", effect: { capacityMultiplier: 0.8 }, duration: 1 },
    { id: "snack-shortage", headline: "Nationwide snack shortage; customers hold off until chips are back", effect: { demandMultiplier: 0.8 }, duration: 1 },
    { id: "festival", headline: "Biggest music festival of the year sells out in seconds", effect: { segmentMultiplier: { hype: 1.8 } }, duration: 1 },
    { id: "connoisseur", headline: "Fancy magazine declares craft strains \"the new wine\"", effect: { segmentMultiplier: { premium: 1.5 } }, duration: 1 },
    { id: "fertilizer", headline: "Fertilizer prices triple after a farmer's goat eats the supply", effect: { costMultiplier: 1.35 }, duration: 2 },
    { id: "rates-weed", headline: "Central bank chair raises rates, says he \"just felt like it\"", effect: { interestDelta: 0.02 }, duration: 2 },
    { id: "budget-hunt", headline: "Students' loans arrive late; everyone hunts for bargains", effect: { segmentMultiplier: { budget: 1.4, premium: 0.7 } }, duration: 2 },
    { id: "boom-weed", headline: "Economy booms; everyone upgrades to the fancy stuff", effect: { segmentMultiplier: { premium: 1.5, budget: 0.85 } }, duration: 2 },
    { id: "celebrity", headline: "A company's strain gets name-dropped in a chart-topping song", effect: { randomCompanyBoost: 0.4 }, duration: 1 },
    { id: "rain-perfect", headline: "Perfect weather all season; growers call it \"suspiciously chill\"", effect: { costMultiplier: 0.8 }, duration: 2 },
    { id: "wellness", headline: "Wellness magazines declare CBD the new kale", effect: { segmentMultiplier: { premium: 1.25, mainstream: 1.3 } }, duration: 1 },
    { id: "power-bill", headline: "Power company triples prices for grow lights after its CEO \"had a dream\"", effect: { costMultiplier: 1.25 }, duration: 1 },
    { id: "munchies", headline: "Fast-food chains launch a \"midnight menu\". Customers are suddenly very relaxed", effect: { demandMultiplier: 1.25 }, duration: 1 },
    { id: "moth", headline: "A plague of very polite moths eats one in five plants", effect: { capacityMultiplier: 0.82 }, duration: 1 },
    { id: "students-week", headline: "University freshers' week lasts a whole month this year", effect: { segmentMultiplier: { budget: 1.5, hype: 1.2 } }, duration: 1 },
    { id: "docu", headline: "Hit documentary about craft growers makes everyone want the fancy stuff", effect: { segmentMultiplier: { premium: 1.35, mainstream: 1.1 } }, duration: 1 },
    { id: "cheapest-weed", headline: "Backpackers' travel blog lists the cheapest shop in the country. Queues form", effect: { cheapestBoost: 0.7 }, duration: 1 },
    { id: "random-weed", headline: "One company's edible wins \"Snack of the Year\" at a very confused county fair", effect: { randomCompanyBoost: 0.45 }, duration: 1 },
    { id: "rates-down-weed", headline: "Central bank cuts rates; chair seen smiling for the first time in years", effect: { interestDelta: -0.02 }, duration: 2 },
    { id: "health-scare", headline: "Tabloid claims edibles make you forget your password. Sales dip", effect: { demandMultiplier: 0.82 }, duration: 1 },
    { id: "influencer-detox", headline: "Top influencers go on a \"clean living\" retreat and post nothing but smoothies", effect: { segmentMultiplier: { hype: 0.65 } }, duration: 1 },
    { id: "gummies-trend", headline: "Gummy bears in tiny sunglasses take over every feed", effect: { segmentMultiplier: { hype: 1.6 } }, duration: 1 },
    { id: "rent-rise", headline: "Warehouse rents double after a landlord discovers spreadsheets", effect: { costMultiplier: 1.15 }, duration: 2 },
    { id: "lab-test", headline: "Independent lab says most \"premium\" strains are \"fine, just fine\"", effect: { segmentMultiplier: { premium: 0.7 } }, duration: 1 },
    { id: "stoner-film", headline: "A slow-paced film about a sofa becomes the biggest movie of the year", effect: { demandMultiplier: 1.2, segmentMultiplier: { mainstream: 1.15 } }, duration: 1 },
    { id: "bargain-bin", headline: "Discount chain enters the market selling grams next to the toilet paper", effect: { segmentMultiplier: { budget: 1.4, mainstream: 0.85 } }, duration: 1 },
    { id: "seed-shortage", headline: "Seed shortage after a farmer's parrot learns to open the storage room", effect: { capacityMultiplier: 0.9, costMultiplier: 1.1 }, duration: 1 },
    { id: "wedding-season", headline: "Wedding season: every couple wants \"tasteful\" gift bags for guests", effect: { segmentMultiplier: { premium: 1.35, mainstream: 1.1 } }, duration: 1 },
    { id: "rates-weed-up", headline: "Bank raises rates \"to make the graph look cooler\"", effect: { interestDelta: 0.02 }, duration: 1 },
    { id: "tourist-boom", headline: "Travel site names the country \"the chillest place on Earth\"; tourists pour in", effect: { demandMultiplier: 1.3 }, duration: 1 },
    { id: "grow-tech", headline: "New LED lamps make plants grow faster and sing (a little)", effect: { costMultiplier: 0.88 }, duration: 1 },
    { id: "dry-spell", headline: "Dry spell; reservoirs so low the fish are queueing for water", effect: { capacityMultiplier: 0.85 }, duration: 1 },
    { id: "pet-ban", headline: "Vets warn: keep edibles away from dogs. Dogs disagree", effect: { segmentMultiplier: { mainstream: 0.85 } }, duration: 1 },
  ],
});

/** How strongly the funny headlines move the market. They used to swing segments by 40-80%; now they nudge. */
export const NEWS_STRENGTH = 0.35;
function soften(e: NewsEffect, k: number): NewsEffect {
  const m = (x: number | undefined) => (x === undefined ? undefined : Math.round((1 + (x - 1) * k) * 1000) / 1000);
  const out: NewsEffect = {};
  if (e.costMultiplier !== undefined) out.costMultiplier = m(e.costMultiplier);
  if (e.demandMultiplier !== undefined) out.demandMultiplier = m(e.demandMultiplier);
  if (e.capacityMultiplier !== undefined) out.capacityMultiplier = m(e.capacityMultiplier);
  if (e.interestDelta !== undefined) out.interestDelta = Math.round(e.interestDelta * 0.5 * 10000) / 10000;
  if (e.randomCompanyBoost !== undefined) out.randomCompanyBoost = Math.round(e.randomCompanyBoost * k * 1000) / 1000;
  if (e.cheapestBoost !== undefined) out.cheapestBoost = Math.round(e.cheapestBoost * k * 1000) / 1000;
  if (e.segmentMultiplier) out.segmentMultiplier = Object.fromEntries(Object.entries(e.segmentMultiplier).map(([s, v]) => [s, m(v)]));
  return out;
}
const softened = (ind: IndustryConfig): IndustryConfig => ({ ...ind, news: ind.news.map((n) => ({ ...n, kind: "story" as const, effect: soften(n.effect, NEWS_STRENGTH) })) });

/** Market report: small, TOPSIM-style indicators drawn every round (1 round each). */
export const ECONOMY = {
  perRound: [2, 3] as [number, number],
  material: { chocolate: "Cocoa", ai: "Chip and power", weed: "Fertilizer and power" } as Record<IndustryId, string>,
};

export const INDUSTRIES: Record<IndustryId, IndustryConfig> = { chocolate: softened(CHOCOLATE), ai: softened(AI), weed: softened(WEED) };

// ---------------------------------------------------------------------------
// House rules, mergers, hostile bids and product reviews
// ---------------------------------------------------------------------------

/** House rules a group can set in the lobby. */
export const HOUSE_RULES = {
  startCash: [500_000, 1_000_000, 2_000_000] as number[],
  startCashRange: [250_000, 5_000_000] as [number, number],
  startDebtRange: [0, 5_000_000] as [number, number],
  startCapacityRange: [0.5, 2] as [number, number],
  startQualityRange: [3, 5] as [number, number],
  startBrandRange: [0, 80] as [number, number],
  startStoresRange: [0, 5] as [number, number],
  founderSharesRange: [10, 60] as [number, number],
  marketSizeRange: [0.5, 2] as [number, number],
  growthRange: [-0.05, 0.15] as [number, number],
  takeoverRoundRange: [1, 10] as [number, number],
  sharesPerRoundRange: [5, 50] as [number, number],
  roundsRange: [3, 99] as [number, number],
  /** Calm: fewer, softer stories. Wild: a story every round, hitting 1.5x as hard. */
  news: {
    calm: { storyChanceFactor: 0.4, ecoPerRound: [1, 2] as [number, number], strength: 0.7 },
    normal: { storyChanceFactor: 1, ecoPerRound: [2, 3] as [number, number], strength: 1 },
    wild: { storyChanceFactor: 10, ecoPerRound: [3, 4] as [number, number], strength: 1.5 },
  },
};

/** "Unlimited" games run with this many rounds until the host ends them. */
export const UNLIMITED_ROUNDS = 999;

/** Handicaps: a company's starting cash and factory scale with its start level; brand shifts a little. */
export const START_LEVELS = {
  weak: { cash: 0.5, capacity: 0.75, brand: -10 },
  normal: { cash: 1, capacity: 1, brand: 0 },
  strong: { cash: 1.5, capacity: 1.25, brand: 10 },
  giant: { cash: 3, capacity: 2, brand: 25 },
};

/** Ready-made starting situations. `rules` fill in whatever the host didn't set; the extras happen in createGame. */
export const SCENARIOS = {
  none: { name: "Normal start", description: "Everyone starts the same, in a normal market.", rules: {} },
  recession: { name: "Recession", description: "A smaller, shrinking market. Bargain hunters rule the first rounds, luxury buyers hide.", rules: { marketSize: 0.85, growth: -0.02 } },
  debt: { name: "Everyone in debt", description: "Every company starts with €3M of bank debt. Interest bites from day one.", rules: { startDebt: 3_000_000, startCash: 1_500_000 } },
  giant: { name: "Giant vs startups", description: "One random company starts as a giant (3x cash, double factory, famous brand). Everyone else: team up or get eaten.", rules: {} },
  goldrush: { name: "Gold rush", description: "A huge, fast-growing market and cheap materials. Build fast before everyone else does.", rules: { marketSize: 1.3, growth: 0.1 } },
};

/** Quarterly dividends: every 3 rounds, companies pay their policy share of the quarter's profit to shareholders. */
export const DIVIDENDS = {
  every: 3,
  policies: [0, 25, 50] as const,
  /** Investors pay more for a company that pays dividends: value bonus per policy step while the last dividend is recent. */
  valuePremium: { 0: 0, 25: 0.04, 50: 0.08 } as Record<number, number>,
};

/** Board votes on big decisions. */
export const BOARD = {
  /** Extra loans above the credit line can take total debt up to this share of the hard ceiling. */
  maxBoardDebtShare: 1,
};

/** Whoever takes control of a company pays the largest other shareholder this share of the company's value. */
export const RUNNER_UP = { share: 0.1, minShares: 5 };

/** Rare, huge events that hit every industry (house rule "mega"). Not softened like the funny stories. */
export const MEGA = {
  chance: 0.07,
  fromRound: 3,
  events: [
    { id: "mega-crash", headline: "MEGA EVENT: Stock market crash! Shoppers panic and stop spending", effect: { demandMultiplier: 0.88, interestDelta: 0.005 }, duration: 2 },
    { id: "mega-boom", headline: "MEGA EVENT: Lottery jackpot shared by half the country. Everyone is rich (for now)", effect: { demandMultiplier: 1.15, segmentMultiplier: { premium: 1.1 } }, duration: 2 },
    { id: "mega-supply", headline: "MEGA EVENT: Giant container ship stuck sideways in the canal. Again. Supplies run dry", effect: { costMultiplier: 1.18, capacityMultiplier: 0.9 }, duration: 2 },
    { id: "mega-heat", headline: "MEGA EVENT: The summer that never ends. Nobody leaves the house, everyone scrolls", effect: { demandMultiplier: 0.92, segmentMultiplier: { hype: 1.25 } }, duration: 2 },
    { id: "mega-rates", headline: "MEGA EVENT: Central bank chair replaced by a parrot. The parrot loves high rates", effect: { interestDelta: 0.015 }, duration: 2 },
    { id: "mega-free", headline: "MEGA EVENT: Government sends every citizen a €500 \"treat yourself\" voucher", effect: { demandMultiplier: 1.2, segmentMultiplier: { budget: 1.1 } }, duration: 1 },
    { id: "mega-blackout", headline: "MEGA EVENT: Continent-wide blackout. Factories run on hamster wheels", effect: { capacityMultiplier: 0.8 }, duration: 1 },
    { id: "mega-offline", headline: "MEGA EVENT: The whole internet goes offline for a week. People rediscover shops", effect: { segmentMultiplier: { mainstream: 1.15, budget: 1.1, hype: 0.9 } }, duration: 1 },
    { id: "mega-cheap", headline: "MEGA EVENT: Scientists invent a machine that makes raw materials from air. Prices collapse", effect: { costMultiplier: 0.82 }, duration: 2 },
    { id: "mega-luxury", headline: "MEGA EVENT: Billionaire buys everything with a gold label \"for the vibes\"", effect: { segmentMultiplier: { premium: 1.3 } }, duration: 1 },
    { id: "mega-trend", headline: "MEGA EVENT: The whole planet joins one giant online challenge. Whatever is viral sells out", effect: { segmentMultiplier: { hype: 1.35 } }, duration: 1 },
  ],
};

/** Friendly mergers between two players' companies. */
export const MERGER = {
  /** The survivor's board rests after a merger, like after a takeover (rounds without share purchases). */
  cooldown: 1,
};

/** Owning this share of a company without control makes headlines: a hostile bid, the target gets a round to defend. */
export const HOSTILE_BID_SHARES = 40;

/** Review lines. {p} = product name, {u} = unit (bar, subscription...), {c} = company. */
export const REVIEWS = {
  critic: {
    5: ["\"{p} is the best {u} I've had this year. And I've had a lot.\" ★★★★★ Food Critic Weekly", "\"Worth every cent. Possibly worth more cents.\"", "\"{c} has done it. Book the gold medal.\"", "\"I'd sell my car for another {p}.\""],
    4: ["\"Solid. {p} punches above its price.\"", "\"Good stuff. I'd tell my mum about {p}.\"", "\"{c} knows what it's doing. Mostly.\"", "\"Better than it has any right to be.\""],
    3: ["\"It's a {u}. It does {u} things. Fine.\"", "\"{p}: perfectly, aggressively average.\"", "\"Not bad, not good, very much a {u}.\"", "\"Three stars. The stars are tired.\""],
    2: ["\"{p} costs too much for what it is.\"", "\"I wanted to like {p}. I tried. Twice.\"", "\"Tastes like a premium price, nothing else.\"", "\"{c}, we need to talk.\""],
    1: ["\"{p} is an insult to the very idea of a {u}.\"", "\"My dog refused {p}. My dog eats socks.\"", "\"One star, and only because zero isn't allowed.\"", "\"Who approved this? Seriously, who?\""],
  } as Record<number, string[]>,
  soldOut: ["Customer: \"Sold out AGAIN? I've been to four shops for {p}!\"", "Reddit: \"Has anyone actually seen {p} in a store this week?\"", "Customer: \"Queued 40 minutes, got the last {u}. Worth it.\""],
  leftover: ["Store manager: \"We've got a warehouse full of {p}. Anyone?\"", "Customer: \"There's a whole aisle of {p}. Nobody's touching it.\"", "Reseller: \"{p} for a third off, still no takers.\""],
  cheap: ["Customer: \"{p} is SO cheap. Suspiciously cheap.\"", "Student: \"{p} is my entire budget plan now.\""],
  luxury: ["Customer: \"Paid a fortune for {p}. I feel rich. And poor.\"", "Influencer: \"{p} is a lifestyle, not a {u}.\""],
  hype: ["TikTok: \"Everyone's posting {p}. I don't even know what it is.\"", "Teenager: \"If you don't have {p} are you even alive?\""],
  flop: ["Comment section: \"{c}'s new ad is the cringiest thing I've seen in years.\""],
  launch: ["Customer: \"The new {c} launch is unhinged and I love it.\""],
};
