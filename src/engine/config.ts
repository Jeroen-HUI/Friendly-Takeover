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
  standard: { id: "standard", takeoverUnlockRound: 3, takeoverCooldown: 2, maxSharesPerRound: 25, newsChance: 0.6, retailUnlockRound: 3 },
  // Tycoon uses the Standard rules until its extra mechanics (hiring, multi-product, logistics) are built.
  tycoon: { id: "tycoon", takeoverUnlockRound: 3, takeoverCooldown: 2, maxSharesPerRound: 25, newsChance: 0.6, retailUnlockRound: 3 },
  cutthroat: { id: "cutthroat", takeoverUnlockRound: 1, takeoverCooldown: 0, maxSharesPerRound: 35, newsChance: 0.75, retailUnlockRound: 2 },
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
  ],
};

/**
 * AI and Weed reuse Chocolate's tuned market structure, scaled by unit cost, so balance carries over.
 * Only names, labels, growth, crazy products and news differ.
 */
function deriveIndustry(
  base: IndustryConfig,
  o: Pick<IndustryConfig, "id" | "name" | "labels" | "growth" | "crazyProducts" | "news"> & { baseUnitCost: number },
): IndustryConfig {
  const f = o.baseUnitCost / base.baseUnitCost;
  const segments = Object.fromEntries(
    Object.entries(base.segments).map(([k, v]) => [k, { ...v, refPrice: Math.round(v.refPrice * f * 100) / 100 }]),
  ) as Record<SegmentId, SegmentConfig>;
  return {
    ...base,
    ...o,
    segments,
    potentialPerCompany: Math.round(base.potentialPerCompany / f),
    start: { ...base.start, capacity: Math.round(base.start.capacity / f), price: Math.round(base.start.price * f * 100) / 100 },
    priceRange: [Math.round(base.priceRange[0] * f * 100) / 100, Math.round(base.priceRange[1] * f * 100) / 100],
  };
}

const AI = deriveIndustry(CHOCOLATE, {
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
  ],
});

const WEED = deriveIndustry(CHOCOLATE, {
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
