// src/engine/types.ts
var SEGMENTS = ["budget", "mainstream", "premium", "hype"];

// src/engine/config.ts
var BALANCE = {
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
  brandValuePerPoint: 15e3,
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
  maxDebt: 6e6,
  /** Banks lend you up to this share of your company value (but at least minCreditLimit). */
  creditLimitShare: 0.5,
  minCreditLimit: 2e6,
  /** Marketing: diminishing returns scale (euros). */
  marketingScale: 15e4,
  /** Brand: points per log-step of investment, and the investment scale. */
  brandGainPerStep: 6,
  brandScale: 2e5,
  brandDecay: 0.95,
  hypeDecay: 0.65,
  /** R&D needed (cumulative, euros) to unlock quality caps 4 and 5. */
  rndThresholds: { 4: 45e4, 5: 115e4 },
  /** Takeovers. */
  takeoverPremium: 0.15,
  /** Extra premium per share the buyer already holds (shares get pricier as you accumulate). */
  premiumPerHeldShare: 8e-3,
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
  dumpImpactPerShare: 3e-3,
  dumpImpactCapPerRound: 0.15,
  sentimentMax: 0.3,
  /** Panic fades: this share of it is left at the start of the next round. */
  sentimentRecovery: 0.5
};
var RETAIL = {
  /** Opening one store (an investment: it stays on the books). */
  openCost: 15e4,
  /** Rent and staff per store per round. */
  upkeep: 35e3,
  /** Book value of one store in the company valuation. */
  bookValue: 9e4,
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
  maxStores: 16
};
var WILDCARDS = {
  crazy: { name: "Crazy product launch", cost: 15e4, maxUses: 2, needsTarget: false, exposeChance: 0, description: "A wild limited edition. 55% chance of a hype explosion this round, 45% chance it flops and hurts your brand" },
  poach: { name: "Poach talent", cost: 1e5, maxUses: 2, needsTarget: true, exposeChance: 0.5, description: "Steal 30% of a rival's R&D progress. 50% chance the news finds out" },
  spy: { name: "Spy", cost: 5e4, maxUses: 2, needsTarget: true, exposeChance: 0.25, description: "See one rival's full plan for this round in your report. 25% chance you're caught" },
  lobby: { name: "Lobby", cost: 12e4, maxUses: 2, needsTarget: false, exposeChance: 0, description: "This round, bad news can't raise your costs or interest or cut your capacity" },
  scandal: { name: "Leak a scandal", cost: 1e5, maxUses: 2, needsTarget: true, exposeChance: 0.35, description: "A rival loses brand and hype right away. 35% chance it's traced back to you" },
  lawsuit: { name: "Lawsuit", cost: 8e4, maxUses: 2, needsTarget: true, exposeChance: 0, description: "A rival pays \u20AC250k in legal costs. 30% chance it backfires and you pay instead" }
};
var WILDCARD_EFFECTS = {
  crazySuccess: 0.55,
  crazyHype: 30,
  crazyUtility: 0.8,
  crazyFlopBrand: 5,
  crazyFlopHype: 10,
  poachShare: 0.3,
  scandalBrand: 6,
  scandalHype: 12,
  exposedBrand: 4,
  lawsuitCost: 25e4,
  lawsuitBackfire: 0.3
};
var SHOWDOWN = { minStake: 5e4 };
var AUCTION = {
  rounds: [3, 6, 9, 12],
  minBid: 5e4,
  items: {
    endorsement: { name: "Celebrity endorsement", description: "+15 brand right away" },
    patent: { name: "Patent", description: "Your maximum quality goes up by one level" },
    factory: { name: "Bankrupt rival's factory", description: "+25% factory capacity" },
    location: { name: "Prime high-street location", description: "Two free stores (works once retail is open)" }
  }
};
var SUMMIT = {
  rounds: [4, 7, 10],
  duration: 2,
  regulations: {
    luxuryTax: { name: "Luxury tax", description: "Premium buyers -10% for 2 rounds", effect: { segmentMultiplier: { premium: 0.9 } } },
    bargainBan: { name: "Bargain ban", description: "Budget buyers -10% for 2 rounds", effect: { segmentMultiplier: { budget: 0.9 } } },
    influencerLaw: { name: "Influencer law", description: "Hype buyers -12% for 2 rounds", effect: { segmentMultiplier: { hype: 0.88 } } },
    middleClassCut: { name: "Middle-class tax cut", description: "Mainstream buyers +10% for 2 rounds", effect: { segmentMultiplier: { mainstream: 1.1 } } },
    cheapCredit: { name: "Cheap credit", description: "Interest -1 point for 2 rounds", effect: { interestDelta: -0.01 } },
    greenRules: { name: "Green production rules", description: "Production costs +5% for 2 rounds", effect: { costMultiplier: 1.05 } }
  }
};
var BOARD_SEAT_SHARES = 25;
var EVENTS = {
  blackFriday: { name: "Black Friday", description: "Everyone shops: demand +15%, bargain hunters +25% this round", effect: { demandMultiplier: 1.15, segmentMultiplier: { budget: 1.25 } } },
  investorDay: { name: "Investor Day", description: "Takeover premiums are halved this round", premiumFactor: 0.5 }
};
var BANKRUPTCY_SALE = { minBid: 1e5, capacityShare: 0.75, brandShare: 0.25 };
var MISSIONS = {
  stake: { name: "Silent partner", description: "Own at least 30% of {target} at the end" },
  stores: { name: "High-street king", description: "Have at least 8 stores at the end" },
  premiumLead: { name: "Luxury leader", description: "Sell the most to premium buyers in the final round" },
  budgetLead: { name: "Discount champion", description: "Sell the most to budget buyers in the final round" },
  debtFree: { name: "Clean books", description: "Finish with no debt and more than \u20AC2M cash" },
  quality5: { name: "Perfectionist", description: "Unlock quality 5" },
  volume: { name: "Volume machine", description: "Sell the most units over the whole game" },
  brand: { name: "Household name", description: "Have the strongest brand at the end" }
};
var MISSION_BONUS = 6e5;
var TYCOON = {
  laborShare: 0.3,
  teamOutputShare: 0.05,
  hireCostFactor: 0.6,
  severanceFactor: 1.2,
  maxHirePerRound: 10
};
var JOURNALIST = { brand: 4, hype: 8 };
var RESEARCH = {
  competitors: { name: "Competitor spending", cost: 6e4, description: "Each rival's production, quality, marketing, R&D, brand and factory spending this round" },
  survey: { name: "Customer survey", cost: 3e4, description: "How customers rate every company's brand and hype after this round" },
  forecast: { name: "Insider tip", cost: 5e4, description: "Learn the news that will hit the round after next, a full round before everyone else" }
};
var CAMPAIGNS = {
  discount: { segment: { budget: 0.7, mainstream: 0.2, premium: -0.3, hype: 0 }, hypeGain: 2, brandGain: -0.5, flopChance: 0 },
  tv: { segment: { budget: 0.2, mainstream: 0.6, premium: 0.15, hype: 0.15 }, hypeGain: 4, brandGain: 1, flopChance: 0 },
  luxury: { segment: { budget: -0.1, mainstream: 0.15, premium: 0.7, hype: 0.1 }, hypeGain: 3, brandGain: 2, flopChance: 0 },
  viral: { segment: { budget: 0.05, mainstream: 0.15, premium: 0, hype: 0.6 }, hypeGain: 22, brandGain: 0, flopChance: 0.25 }
};
var TRAIT_EFFECTS = {
  ruthlessPremiumFactor: 0.85,
  visionaryRndFactor: 1.15,
  influencerHypeFactor: 1.15,
  pennyPincherCostFactor: 0.92
};
var DIFFICULTIES = {
  standard: { id: "standard", takeoverUnlockRound: 3, takeoverCooldown: 2, maxSharesPerRound: 25, newsChance: 0.6, retailUnlockRound: 3 },
  // Tycoon uses the Standard rules until its extra mechanics (hiring, multi-product, logistics) are built.
  tycoon: { id: "tycoon", takeoverUnlockRound: 3, takeoverCooldown: 2, maxSharesPerRound: 25, newsChance: 0.6, retailUnlockRound: 3 },
  cutthroat: { id: "cutthroat", takeoverUnlockRound: 1, takeoverCooldown: 0, maxSharesPerRound: 35, newsChance: 0.75, retailUnlockRound: 2 }
};
var CHOCOLATE = {
  id: "chocolate",
  name: "Chocolate",
  labels: { product: "bar", products: "bars", capacity: "factory capacity", quality: "cocoa quality", unit: "bars" },
  potentialPerCompany: 1e6,
  growth: 0.03,
  segments: {
    budget: { weight: 0.36, refPrice: 1.1, priceSensitivity: 3.4, qualityWeight: 0.15, brandWeight: 0.1, hypeWeight: 0 },
    mainstream: { weight: 0.32, refPrice: 2.2, priceSensitivity: 2.4, qualityWeight: 0.35, brandWeight: 0.35, hypeWeight: 0.15 },
    premium: { weight: 0.14, refPrice: 3.4, priceSensitivity: 1.7, qualityWeight: 0.55, brandWeight: 0.6, hypeWeight: 0.1, cheapPenaltyBelow: 0.6, cheapPenalty: 1.5 },
    hype: { weight: 0.18, refPrice: 2.6, priceSensitivity: 1.2, qualityWeight: 0.1, brandWeight: 0.3, hypeWeight: 1.4 }
  },
  baseUnitCost: 0.5,
  qualityCostStep: 0.6,
  qualityCostCurve: 0.08,
  start: { cash: 1e6, capacity: 9e5, brand: 30, hype: 10, qualityCap: 3, price: 2.2, quality: 3 },
  priceRange: [0.3, 12],
  crazyProducts: ["Bacon-pickle bar", "Chocolate-covered broccoli", "Self-melting bar", "Spicy ghost-pepper truffle"],
  news: [
    { id: "raptors", headline: "Dinosaurs brought back to life; a herd of raptors eats half the world's cocoa beans", effect: { costMultiplier: 1.4 }, duration: 2 },
    { id: "horoscope-rates", headline: "Central bank chair raises interest rates because his horoscope told him to", effect: { interestDelta: 0.02 }, duration: 2 },
    { id: "burgerland", headline: `President of Burgerland posts that one company's chocolate is "tremendous, the best, maybe ever"`, effect: { randomCompanyBoost: 0.4 }, duration: 1 },
    { id: "boredom-cure", headline: "Influencer claims chocolate cures boredom; everyone suddenly wants some", effect: { demandMultiplier: 1.6 }, duration: 1 },
    { id: "aliens", headline: "Aliens land and only buy the cheapest chocolate on the market", effect: { cheapestBoost: 0.8 }, duration: 1 },
    { id: "screws", headline: "Global shortage of tiny screws jams every chocolate factory", effect: { capacityMultiplier: 0.8 }, duration: 1 },
    { id: "recession", headline: "Recession hits: shoppers hunt for bargains", effect: { segmentMultiplier: { budget: 1.4, premium: 0.7, hype: 0.85 } }, duration: 2 },
    { id: "boom", headline: "Economy booms; everyone treats themselves to the fancy stuff", effect: { segmentMultiplier: { premium: 1.5, budget: 0.85 } }, duration: 2 },
    { id: "tiktok", headline: "New trend: people film themselves unwrapping chocolate in slow motion", effect: { segmentMultiplier: { hype: 1.8 } }, duration: 1 },
    { id: "dentists", headline: `Dentists' association declares chocolate "basically a vegetable"`, effect: { demandMultiplier: 1.25 }, duration: 1 },
    { id: "sugar-tax", headline: "Parliament introduces a sugar tax after a minister loses a bet", effect: { costMultiplier: 1.15, demandMultiplier: 0.9 }, duration: 2 },
    { id: "heatwave", headline: "Record heatwave melts half the country's shop displays", effect: { demandMultiplier: 0.8 }, duration: 1 }
  ]
};
function deriveIndustry(base, o) {
  const f = o.baseUnitCost / base.baseUnitCost;
  const segments = Object.fromEntries(
    Object.entries(base.segments).map(([k, v]) => [k, { ...v, refPrice: Math.round(v.refPrice * f * 100) / 100 }])
  );
  return {
    ...base,
    ...o,
    segments,
    potentialPerCompany: Math.round(base.potentialPerCompany / f),
    start: { ...base.start, capacity: Math.round(base.start.capacity / f), price: Math.round(base.start.price * f * 100) / 100 },
    priceRange: [Math.round(base.priceRange[0] * f * 100) / 100, Math.round(base.priceRange[1] * f * 100) / 100]
  };
}
var AI = deriveIndustry(CHOCOLATE, {
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
    { id: "enterprise", headline: 'Every bank suddenly needs "an AI strategy" by Monday', effect: { segmentMultiplier: { premium: 1.6 } }, duration: 2 },
    { id: "free-tier", headline: "Students discover the free tier; servers groan", effect: { segmentMultiplier: { budget: 1.5 } }, duration: 1 },
    { id: "robot-dance", headline: "Viral video of a robot doing the floss sends AI gadgets flying off the shelves", effect: { segmentMultiplier: { hype: 1.8 } }, duration: 1 }
  ]
});
var WEED = deriveIndustry(CHOCOLATE, {
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
    { id: "connoisseur", headline: 'Fancy magazine declares craft strains "the new wine"', effect: { segmentMultiplier: { premium: 1.5 } }, duration: 1 },
    { id: "fertilizer", headline: "Fertilizer prices triple after a farmer's goat eats the supply", effect: { costMultiplier: 1.35 }, duration: 2 },
    { id: "rates-weed", headline: 'Central bank chair raises rates, says he "just felt like it"', effect: { interestDelta: 0.02 }, duration: 2 },
    { id: "budget-hunt", headline: "Students' loans arrive late; everyone hunts for bargains", effect: { segmentMultiplier: { budget: 1.4, premium: 0.7 } }, duration: 2 },
    { id: "boom-weed", headline: "Economy booms; everyone upgrades to the fancy stuff", effect: { segmentMultiplier: { premium: 1.5, budget: 0.85 } }, duration: 2 },
    { id: "celebrity", headline: "A company's strain gets name-dropped in a chart-topping song", effect: { randomCompanyBoost: 0.4 }, duration: 1 }
  ]
});
var NEWS_STRENGTH = 0.35;
function soften(e, k) {
  const m = (x) => x === void 0 ? void 0 : Math.round((1 + (x - 1) * k) * 1e3) / 1e3;
  const out = {};
  if (e.costMultiplier !== void 0) out.costMultiplier = m(e.costMultiplier);
  if (e.demandMultiplier !== void 0) out.demandMultiplier = m(e.demandMultiplier);
  if (e.capacityMultiplier !== void 0) out.capacityMultiplier = m(e.capacityMultiplier);
  if (e.interestDelta !== void 0) out.interestDelta = Math.round(e.interestDelta * 0.5 * 1e4) / 1e4;
  if (e.randomCompanyBoost !== void 0) out.randomCompanyBoost = Math.round(e.randomCompanyBoost * k * 1e3) / 1e3;
  if (e.cheapestBoost !== void 0) out.cheapestBoost = Math.round(e.cheapestBoost * k * 1e3) / 1e3;
  if (e.segmentMultiplier) out.segmentMultiplier = Object.fromEntries(Object.entries(e.segmentMultiplier).map(([s, v]) => [s, m(v)]));
  return out;
}
var softened = (ind) => ({ ...ind, news: ind.news.map((n) => ({ ...n, kind: "story", effect: soften(n.effect, NEWS_STRENGTH) })) });
var ECONOMY = {
  perRound: [2, 3],
  material: { chocolate: "Cocoa", ai: "Chip and power", weed: "Fertilizer and power" }
};
var INDUSTRIES = { chocolate: softened(CHOCOLATE), ai: softened(AI), weed: softened(WEED) };

// src/engine/rng.ts
var Rng = class {
  constructor(state) {
    this.state = state;
  }
  state;
  /** Float in [0, 1). */
  next() {
    this.state = this.state + 1831565813 | 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }
  chance(p) {
    return this.next() < p;
  }
  pick(items) {
    return items[this.int(items.length)];
  }
  shuffle(items) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
};

// src/engine/engine.ts
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var num = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
var deepClone = (v) => typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
function defaultDecisions(industry) {
  const s = industry.start;
  return {
    price: s.price,
    production: Math.round(s.capacity * 0.8),
    quality: s.quality,
    marketingBudget: 15e4,
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
    hire: 0
  };
}
function teamOutput(industry) {
  return Math.round(industry.potentialPerCompany * TYCOON.teamOutputShare);
}
function teamWage(industry) {
  return TYCOON.laborShare * industry.baseUnitCost * teamOutput(industry);
}
function retailRefPrice(industry) {
  return Math.round(industry.segments.mainstream.refPrice * RETAIL.refFactor * 100) / 100;
}
function storeCapacity(industry) {
  return Math.round(industry.potentialPerCompany * RETAIL.storeCapacityShare);
}
function createGame(config, players) {
  if (players.length < 2 || players.length > 8) throw new Error("A game needs 2 to 8 players");
  const industry = INDUSTRIES[config.industry];
  const companies = players.map((p) => ({
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
    workers: config.difficulty === "tycoon" ? Math.ceil(industry.start.capacity * 0.8 / teamOutput(industry)) : 0,
    journalistPoints: 0,
    inventoryUnitCost: 0,
    shares: { founder: BALANCE.startShares.founder, float: BALANCE.startShares.float, treasury: 0, holders: {} },
    controlledBy: null,
    takeoverCooldown: 0,
    bankrupt: false,
    lastDecisions: defaultDecisions(industry),
    history: []
  }));
  const mrng = new Rng(config.seed ^ 1540483477 | 0);
  const missionIds = Object.keys(MISSIONS);
  for (const c of companies) {
    const id = mrng.pick(missionIds);
    c.mission = id === "stake" ? { id, targetId: mrng.pick(companies.filter((o) => o.id !== c.id)).id } : { id };
  }
  const lastPlayable = Math.max(3, config.rounds - 1);
  const pickRound = (from) => from + mrng.int(Math.max(1, lastPlayable - from + 1));
  const bf = pickRound(3);
  let inv = pickRound(3);
  if (inv === bf) inv = bf > 3 ? bf - 1 : bf + 1;
  const specialEvents = [{ round: bf, id: "blackFriday" }, { round: inv, id: "investorDay" }].filter((e) => e.round <= config.rounds);
  const yearZero = {
    config,
    round: 0,
    companies,
    news: [],
    feed: [],
    rngState: config.seed | 0,
    finished: false,
    auction: null,
    summit: null,
    specialEvents
  };
  return resolveRound(yearZero, {});
}
function unitCost(industry, quality, costMultiplier = 1, trait, tycoon = false) {
  const traitFactor = trait === "pennyPincher" ? TRAIT_EFFECTS.pennyPincherCostFactor : 1;
  const labor = tycoon ? TYCOON.laborShare : 0;
  const q = quality - 1;
  return industry.baseUnitCost * (1 + industry.qualityCostStep * q + industry.qualityCostCurve * q * q - labor) * costMultiplier * traitFactor;
}
function baseValue(c, industry) {
  if (c.bankrupt) return 0;
  const last = c.history.slice(-2).map((h) => h.profit);
  const avgProfit = last.length ? last.reduce((a, b) => a + b, 0) / last.length : 0;
  const value = c.cash - c.debt + c.capacity * BALANCE.capacityBookValue * industry.baseUnitCost + (c.stores ?? 0) * RETAIL.bookValue + c.inventory * c.inventoryUnitCost * BALANCE.inventoryValueRate + c.brand * BALANCE.brandValuePerPoint + Math.max(0, avgProfit) * BALANCE.earningsMultiple;
  return value > 0 ? value * (1 - (c.sentiment ?? 0)) : value;
}
function companyValues(state) {
  const industry = INDUSTRIES[state.config.industry];
  const base = {};
  for (const c of state.companies) base[c.id] = baseValue(c, industry);
  const out = {};
  for (const c of state.companies) {
    if (c.bankrupt) {
      out[c.id] = 0;
      continue;
    }
    let stakes = 0;
    for (const t of state.companies) {
      const held = t.shares.holders[c.id] ?? 0;
      if (held > 0) stakes += held / 100 * Math.max(0, base[t.id]);
    }
    out[c.id] = base[c.id] + stakes;
  }
  return out;
}
function sharePrices(state) {
  const v = companyValues(state);
  const out = {};
  for (const id of Object.keys(v)) out[id] = Math.max(0, v[id]) / 100;
  return out;
}
function activeNewsEffects(state) {
  let costMultiplier = 1;
  let demandMultiplier = 1;
  let interestDelta = 0;
  let capacityMultiplier = 1;
  const segmentMultiplier = { budget: 1, mainstream: 1, premium: 1, hype: 1 };
  const companyBoost = {};
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
function creditLimit(state, c) {
  const value = companyValues(state)[c.id] ?? 0;
  return Math.min(BALANCE.maxDebt, Math.max(BALANCE.minCreditLimit, BALANCE.creditLimitShare * Math.max(0, value)));
}
function sanitizeDecisions(state, c, input) {
  const industry = INDUSTRIES[state.config.industry];
  const prev = c.lastDecisions;
  const d = input ?? {};
  const campaign = d.campaign && d.campaign in CAMPAIGNS ? d.campaign : prev.campaign;
  const price = clamp(num(d.price, prev.price), industry.priceRange[0], industry.priceRange[1]);
  const floor = state.round > 1 ? Math.min(c.qualityCap, c.history.at(-1)?.quality ?? 1) : 1;
  const quality = clamp(Math.round(num(d.quality, prev.quality)), floor, c.qualityCap);
  const production = Math.max(0, Math.round(num(d.production, prev.production)));
  const nonNeg = (v, fb) => Math.max(0, num(v, fb));
  const loanRaw = num(d.loanChange, 0);
  const loanChange = loanRaw >= 0 ? Math.min(loanRaw, Math.max(0, creditLimit(state, c) - c.debt)) : -Math.min(-loanRaw, c.debt);
  const buyShares = {};
  for (const [target, qty] of Object.entries(d.buyShares ?? {})) {
    const q = Math.max(0, Math.floor(num(qty, 0)));
    if (q > 0 && target !== c.id && state.companies.some((o) => o.id === target)) buyShares[target] = q;
  }
  const sellShares = {};
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
    research: Array.isArray(d.research) ? [...new Set(d.research.filter((r) => typeof r === "string" && r in RESEARCH))] : [],
    wildcard: d.wildcard && typeof d.wildcard === "object" && d.wildcard.card in WILDCARDS ? { card: d.wildcard.card, target: typeof d.wildcard.target === "string" ? d.wildcard.target : void 0 } : null,
    takeoverStake: Math.max(0, num(d.takeoverStake, 0)),
    defenseStake: Math.max(0, num(d.defenseStake, prev.defenseStake ?? 0)),
    auctionBid: Math.max(0, num(d.auctionBid, 0)),
    bankruptBids: Object.fromEntries(Object.entries(d.bankruptBids ?? {}).map(([k, v]) => [k, Math.max(0, num(v, 0))]).filter(([k, v]) => v > 0 && state.companies.some((o) => o.id === k && o.bankrupt))),
    vote: d.vote === "a" || d.vote === "b" ? d.vote : null,
    journalistTarget: null,
    hire: clamp(Math.round(num(d.hire, 0)), -TYCOON.maxHirePerRound, TYCOON.maxHirePerRound),
    storesOpen: clamp(Math.floor(num(d.storesOpen, 0)), 0, RETAIL.maxOpenPerRound),
    storesClose: Math.max(0, Math.floor(num(d.storesClose, 0))),
    retailPrice: clamp(num(d.retailPrice, prev.retailPrice ?? retailRefPrice(industry)), industry.priceRange[0], industry.priceRange[1])
  };
}
function economyItem(state, rng, kind) {
  const pct = (lo, hi) => Math.round((lo + rng.next() * (hi - lo)) * 10) / 10;
  const up = rng.chance(0.5);
  const material = ECONOMY.material[state.config.industry];
  const seg = rng.pick(["budget", "mainstream", "premium", "hype"]);
  const segName = { budget: "Bargain hunters", mainstream: "Regular shoppers", premium: "Luxury buyers", hype: "Trend chasers" }[seg];
  let headline, effect;
  switch (kind) {
    case 0: {
      const x = pct(1, 5);
      headline = up ? `Economy grows ${x}%: people spend a bit more` : `Economy shrinks ${x}%: people spend a bit less`;
      effect = { demandMultiplier: up ? 1 + x / 100 : 1 - x / 100 };
      break;
    }
    case 1: {
      const x = pct(2, 7);
      headline = `${material} prices ${up ? "up" : "down"} ${x}%`;
      effect = { costMultiplier: up ? 1 + x / 100 : 1 - x / 100 };
      break;
    }
    case 2: {
      const x = pct(3, 8);
      headline = `${segName} ${up ? "buy more" : "hold back"}: ${up ? "+" : "-"}${x}% in that group`;
      effect = { segmentMultiplier: { [seg]: up ? 1 + x / 100 : 1 - x / 100 } };
      break;
    }
    case 3: {
      headline = up ? "Central bank raises interest by half a point" : "Central bank cuts interest by half a point";
      effect = { interestDelta: up ? 5e-3 : -5e-3 };
      break;
    }
    default: {
      const x = pct(1, 4);
      headline = up ? `Consumer confidence up: demand +${x}%` : `Consumer confidence down: demand -${x}%`;
      effect = { demandMultiplier: up ? 1 + x / 100 : 1 - x / 100 };
      break;
    }
  }
  return { event: { id: `eco-${kind}-${state.round}`, headline, effect, duration: 1, kind: "economy" }, roundsLeft: 1 };
}
function pickRoundNews(state, rng, industry) {
  const [lo, hi] = ECONOMY.perRound;
  const kinds = rng.shuffle([0, 1, 2, 3, 4]).slice(0, lo + rng.int(hi - lo + 1));
  const items = kinds.map((k) => economyItem(state, rng, k));
  const story = pickNews(state, rng, industry);
  return story ? [story, ...items] : items;
}
function pickNews(state, rng, industry) {
  const difficulty = DIFFICULTIES[state.config.difficulty];
  if (!rng.chance(difficulty.newsChance)) return null;
  const usedIds = new Set(state.news.map((n) => n.event.id));
  const recentHeadlines = new Set(state.feed.map((f) => f.headline));
  let pool = industry.news.filter((e) => !usedIds.has(e.id) && !recentHeadlines.has(e.headline));
  if (pool.length === 0) pool = industry.news.filter((e) => !usedIds.has(e.id));
  if (pool.length === 0) return null;
  const event = rng.pick(pool);
  const active = { event, roundsLeft: event.duration };
  if (event.effect.randomCompanyBoost) {
    const alive = state.companies.filter((c) => !c.bankrupt);
    if (alive.length === 0) return null;
    active.targetCompanyId = rng.pick(alive).id;
  }
  return active;
}
function newsHeadline(state, n) {
  const t = n.targetCompanyId ? state.companies.find((c) => c.id === n.targetCompanyId) : void 0;
  return t ? `${n.event.headline} (it's ${t.companyName})` : n.event.headline;
}
function drawNews(state, rng, industry) {
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
      next.targetCompanyId = alive.length ? rng.pick(alive).id : void 0;
    }
    state.news.push(next);
    state.feed.push({ round: state.round, headline: newsHeadline(state, next) });
  }
  state.upcomingNews = pickRoundNews(state, rng, industry);
}
var FLOP_LINES = [
  "{c}'s viral stunt flops: the video gets 12 views, 11 of them from {p}'s mum",
  `{c}'s viral stunt backfires: the internet decides the mascot is "deeply unsettling"`,
  "{c} tried to go viral. Instead it went to court",
  "{c}'s influencer campaign collapses after the influencer is revealed to be three kids in a trench coat"
];
function resolveRound(input, decisionsByCompany) {
  if (input.finished) throw new Error("Game is finished");
  const state = deepClone(input);
  const industry = INDUSTRIES[state.config.industry];
  const difficulty = DIFFICULTIES[state.config.difficulty];
  const rng = new Rng(state.rngState);
  const fx = activeNewsEffects(state);
  const round = state.round;
  const alive = state.companies.filter((c) => !c.bankrupt);
  const n = state.companies.length;
  for (const c of state.companies) c.sentiment = (c.sentiment ?? 0) * BALANCE.sentimentRecovery;
  const startPrices = sharePrices(state);
  const dec = {};
  for (const c of alive) {
    if (c.takeoverCooldown > 0) c.takeoverCooldown--;
    dec[c.id] = sanitizeDecisions(state, c, decisionsByCompany[c.id]);
  }
  const tycoon = state.config.difficulty === "tycoon";
  const cashAtStart = Object.fromEntries(alive.map((c) => [c.id, c.cash]));
  const byIdAll = new Map(state.companies.map((c) => [c.id, c]));
  const special = {};
  for (const c of alive) special[c.id] = { wildcard: 0, legal: 0, staff: 0, auction: 0, events: [] };
  const shielded = /* @__PURE__ */ new Set();
  const crazyBoost = {};
  const spyReports = {};
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
    const target = wc.target ? byIdAll.get(wc.target) : void 0;
    if (used >= card.maxUses || card.needsTarget && (!target || target.bankrupt || target.id === c.id)) continue;
    c.wildcardsUsed[wc.card] = used + 1;
    c.cash -= card.cost;
    special[c.id].wildcard += card.cost;
    const exposed = card.exposeChance > 0 && rng.chance(card.exposeChance);
    const E = WILDCARD_EFFECTS;
    const crazy = INDUSTRIES[state.config.industry].crazyProducts;
    switch (wc.card) {
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
        const stolen = target.rndProgress * E.poachShare;
        target.rndProgress -= stolen;
        c.rndProgress += stolen;
        special[c.id].events.push(`Poached \u20AC${Math.round(stolen).toLocaleString("en")} of R&D from ${target.companyName}`);
        if (exposed) state.feed.push({ round, headline: `${target.companyName}'s top scientists spotted carrying boxes into ${c.companyName}` });
        break;
      }
      case "spy": {
        const { wildcard: _w, journalistTarget: _j, ...plan } = dec[target.id];
        spyReports[c.id] = { companyId: target.id, companyName: target.companyName, decisions: plan };
        if (exposed) state.feed.push({ round, headline: `Fake plumber caught in ${target.companyName}'s boardroom. He works for ${c.companyName}.` });
        break;
      }
      case "lobby":
        shielded.add(c.id);
        special[c.id].events.push("Lobbied: shielded from bad news this round");
        break;
      case "scandal":
        target.brand = clamp(target.brand - E.scandalBrand, 0, 100);
        target.hype = clamp(target.hype - E.scandalHype, 0, 100);
        state.feed.push({ round, headline: exposed ? `Leaked memo shows ${c.companyName} spread the dirt on ${target.companyName}` : `Scandal! Anonymous leak rocks ${target.companyName}` });
        if (exposed) c.brand = clamp(c.brand - E.exposedBrand, 0, 100);
        break;
      case "lawsuit": {
        const backfire = rng.chance(E.lawsuitBackfire);
        const payer = backfire ? c : target;
        payer.cash -= E.lawsuitCost;
        if (special[payer.id]) special[payer.id].legal += E.lawsuitCost;
        state.feed.push({ round, headline: backfire ? `Judge throws out ${c.companyName}'s lawsuit against ${target.companyName} and makes them pay` : `${target.companyName} loses a lawsuit filed by ${c.companyName}` });
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
      if (item === "patent") {
        c.qualityCap = Math.min(5, c.qualityCap + 1);
        c.rndProgress = Math.max(c.rndProgress, BALANCE.rndThresholds[c.qualityCap] ?? c.rndProgress);
      }
      if (item === "factory") c.capacity = Math.round(c.capacity + industry.start.capacity * 0.25);
      if (item === "location") c.stores = Math.min(RETAIL.maxStores, c.stores + 2);
      state.feed.push({ round, headline: `${c.companyName} wins the ${AUCTION.items[item].name.toLowerCase()} auction for \u20AC${Math.round(top).toLocaleString("en")}` });
      special[c.id].events.push(`Won the auction: ${AUCTION.items[item].name}`);
    } else {
      state.feed.push({ round, headline: `Nobody bids on the ${AUCTION.items[state.auction.item].name.toLowerCase()}. Awkward.` });
    }
  }
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
      state.feed.push({ round, headline: `${winner.companyName} buys what's left of ${dead.companyName} for \u20AC${Math.round(top).toLocaleString("en")}` });
      special[winner.id].events.push(`Bought ${dead.companyName}'s assets: +${cap.toLocaleString("en")} capacity${stores ? `, +${stores} stores` : ""}`);
    } else {
      state.feed.push({ round, headline: `Nobody bids on ${dead.companyName}'s old factory. It becomes a trampoline park.` });
    }
    dead.capacity = 0;
    dead.stores = 0;
  }
  if (state.bankruptcySales) state.bankruptcySales = state.bankruptcySales.filter((l) => l.round !== round);
  let passedRegulation = null;
  if (state.summit && state.summit.round === round) {
    const votes = { a: 0, b: 0 };
    for (const c of alive) {
      const v = dec[c.id].vote;
      if (v) votes[v]++;
    }
    const pick = votes.a === votes.b ? rng.chance(0.5) ? "a" : "b" : votes.a > votes.b ? "a" : "b";
    passedRegulation = state.summit.options[pick === "a" ? 0 : 1];
    const reg = SUMMIT.regulations[passedRegulation];
    state.feed.push({ round, headline: `Industry summit votes ${Math.max(votes.a, votes.b)} to ${Math.min(votes.a, votes.b)} for the ${reg.name.toLowerCase()}` });
  }
  const journalistHits = [];
  for (const j of state.companies.filter((c) => c.bankrupt)) {
    const tid = decisionsByCompany[j.id]?.journalistTarget;
    const t = typeof tid === "string" ? byIdAll.get(tid) : void 0;
    if (!t || t.bankrupt) continue;
    t.brand = clamp(t.brand - JOURNALIST.brand, 0, 100);
    t.hype = clamp(t.hype - JOURNALIST.hype, 0, 100);
    journalistHits.push({ journalist: j, target: t, before: startPrices[t.id] * 100 });
    state.feed.push({ round, headline: `Exclusive by reporter ${j.playerName}: what really goes on inside ${t.companyName}` });
  }
  const work = alive.map((c) => {
    const d = dec[c.id];
    const shield = shielded.has(c.id);
    const debtStart = c.debt;
    const cashStart = cashAtStart[c.id];
    const inventoryStart = c.inventory;
    const capacityStart = c.capacity;
    const interest = debtStart * (BALANCE.baseInterest + (shield ? Math.min(0, fx.interestDelta) : fx.interestDelta));
    c.debt += d.loanChange;
    c.cash += d.loanChange;
    const capMult = shield ? Math.max(1, fx.capacityMultiplier) : fx.capacityMultiplier;
    const staffCap = tycoon ? c.workers * teamOutput(industry) : Infinity;
    const cap = Math.floor(Math.min(c.capacity * capMult, staffCap));
    const produced = Math.min(d.production, cap);
    const uc = unitCost(industry, d.quality, shield ? Math.min(1, fx.costMultiplier) : fx.costMultiplier, c.trait, tycoon);
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
      retailDemand: 0,
      retailSold: 0,
      storesOpened,
      storesClosed
    };
  });
  const cheapest = work.length ? work.reduce((a, b) => b.d.price < a.d.price ? b : a) : null;
  const marketSize = industry.potentialPerCompany * n * Math.pow(1 + industry.growth, round - 1) * fx.demandMultiplier;
  const offers = work.filter((w) => w.available > 0);
  const avg = (f) => offers.length ? offers.reduce((a, w) => a + f(w), 0) / offers.length : 0;
  const avgQ = offers.length ? avg((w) => w.d.quality) : 3;
  const avgBrand = offers.length ? avg((w) => w.c.brand) : 30;
  const avgHype = offers.length ? avg((w) => w.c.hype) : 10;
  const avgPrice = offers.length ? avg((w) => w.d.price) : 0;
  const refAvg = SEGMENTS.reduce((a, s) => a + industry.segments[s].weight * industry.segments[s].refPrice, 0);
  const drift = avgPrice > 0 ? Math.max(0.6, Math.min(1.6, 1 + BALANCE.priceAnchorDrift * (avgPrice / refAvg - 1))) : 1;
  for (const s of SEGMENTS) {
    const seg = industry.segments[s];
    const ref = seg.refPrice * drift;
    const potential = marketSize * seg.weight * fx.segmentMultiplier[s];
    const attraction = work.map((w) => {
      if (w.available <= 0) return 0;
      const { c, d } = w;
      let u = -seg.priceSensitivity * (d.price / ref - 1);
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
      const q = potential * attraction[i] / denom;
      w.demandBySeg[s] = q;
      w.demand += q;
    });
  }
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
    w.retailDemand = Math.min(retailPotential * retailAttraction[i] / retailDenom, w.c.stores * storeCap);
    w.retailSold = Math.floor(Math.min(w.retailDemand, w.available));
  });
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
      const extra = Math.min(w.available - w.retailSold - w.sold, switching * w.demand / stockWeight);
      w.sold += extra;
    }
  }
  for (const w of work) w.sold = Math.floor(w.sold);
  const segSold = { budget: 0, mainstream: 0, premium: 0, hype: 0 };
  const segOf = (w, s) => w.demand > 0 ? w.sold * w.demandBySeg[s] / w.demand : 0;
  for (const w of work) for (const s of SEGMENTS) segSold[s] += segOf(w, s);
  const profitById = {};
  const reports = {};
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
    const productionCost = w.produced * w.unitCost;
    const researchCost = d.research.reduce((a, r) => a + RESEARCH[r].cost, 0);
    const sp = special[c.id];
    w.events.unshift(...sp.events);
    const profit = revenue - cogs - holdingCost - fixedCost - d.marketingBudget - d.investRnd - d.investBrand - researchCost - storeUpkeep - w.interest - sp.wildcard - sp.legal - sp.staff - sp.auction;
    c.cash += revenue - productionCost - holdingCost - fixedCost - d.marketingBudget - d.investRnd - d.investBrand - researchCost - d.investCapacity - storeOpenCost - storeUpkeep - w.interest;
    c.inventory = inventoryEnd;
    c.inventoryUnitCost = inventoryEnd > 0 ? w.avgCost : 0;
    profitById[c.id] = profit;
    const segments = {};
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
      events: w.events
    };
  }
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
    c.lastDecisions = { ...d, sellShares: {}, loanChange: 0, buyShares: {}, buyback: 0, research: [], storesOpen: 0, storesClose: 0, wildcard: null, takeoverStake: 0, auctionBid: 0, bankruptBids: {}, vote: null, hire: 0 };
  }
  const byId = new Map(state.companies.map((c) => [c.id, c]));
  for (const w of rng.shuffle(work)) {
    const seller = w.c;
    for (const [targetId, requested] of Object.entries(w.d.sellShares)) {
      const target = byId.get(targetId);
      if (!target) continue;
      const held = target.shares.holders[seller.id] ?? 0;
      const qty = Math.min(requested, held);
      if (qty <= 0) continue;
      const impact = target.bankrupt ? 0 : Math.min(BALANCE.dumpImpactCapPerRound, qty * BALANCE.dumpImpactPerShare, BALANCE.sentimentMax - target.sentiment);
      target.sentiment += Math.max(0, impact);
      const price = startPrices[target.id] * (1 - Math.max(0, impact)) * (1 - BALANCE.sellDiscount);
      seller.cash += qty * price;
      reports[seller.id].shareSales += qty * price;
      const left = held - qty;
      if (left > 0) target.shares.holders[seller.id] = left;
      else delete target.shares.holders[seller.id];
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
  const showdownDone = /* @__PURE__ */ new Set();
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
        if (target.controlledBy && target.controlledBy !== buyer.id) {
          w.events.push(`Couldn't buy shares of ${target.companyName}: it's controlled by someone else`);
          continue;
        }
        const held = target.shares.holders[buyer.id] ?? 0;
        const ruthless = buyer.trait === "ruthless" ? TRAIT_EFFECTS.ruthlessPremiumFactor : 1;
        const investorDay = (state.specialEvents ?? []).some((e) => e.round === round && e.id === "investorDay") ? EVENTS.investorDay.premiumFactor : 1;
        const premium = (BALANCE.takeoverPremium + BALANCE.premiumPerHeldShare * held) * ruthless * investorDay;
        const price = startPrices[target.id] * (1 + premium);
        if (price <= 0) continue;
        const afford = Math.floor(Math.max(0, buyer.cash) / price);
        let qty = Math.min(requested, target.shares.float, difficulty.maxSharesPerRound, afford);
        if (qty < requested) {
          const why = qty === afford && afford < Math.min(target.shares.float, difficulty.maxSharesPerRound) ? `not enough cash left after this round's other costs (shares cost \u20AC${Math.round(price).toLocaleString("en")} each)` : qty === target.shares.float ? `only ${target.shares.float} were for sale` : `you can buy at most ${difficulty.maxSharesPerRound} per company per round`;
          w.events.push(qty > 0 ? `Wanted ${requested} shares of ${target.companyName}, got ${qty}: ${why}` : `Couldn't buy shares of ${target.companyName}: ${why}`);
        }
        if (qty <= 0) continue;
        if (held + qty > BALANCE.controlThreshold && !target.controlledBy && !showdownDone.has(target.id) && !target.bankrupt) {
          const defense = Math.min(dec[target.id]?.defenseStake ?? 0, Math.max(0, target.cash));
          if (defense >= SHOWDOWN.minStake) {
            showdownDone.add(target.id);
            const attack = Math.min(w.d.takeoverStake, Math.max(0, buyer.cash - qty * price));
            buyer.cash -= attack;
            target.cash -= defense;
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
      const part = payout * held / 100;
      holder.cash += part;
      if (reports[holderId]) reports[holderId].dividendsReceived += part;
    }
  }
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
      w.events.push(`Emergency loan of \u20AC${Math.round(loan).toLocaleString("en")} (fee \u20AC${Math.round(fee).toLocaleString("en")})`);
    }
  }
  for (const c of state.companies) {
    if (c.bankrupt) continue;
    if (c.cash < 0 && c.debt >= BALANCE.maxDebt) goBankrupt(state, c, round, byId);
  }
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
  for (const h of journalistHits) if (finalValues[h.target.id] < h.before) h.journalist.journalistPoints++;
  state.news = state.news.map((a) => ({ ...a, roundsLeft: a.roundsLeft - 1 })).filter((a) => a.roundsLeft > 0);
  if (passedRegulation) {
    const reg = SUMMIT.regulations[passedRegulation];
    state.news.push({ event: { id: "reg-" + passedRegulation, headline: "New rule: " + reg.name, effect: reg.effect, duration: SUMMIT.duration }, roundsLeft: SUMMIT.duration });
  }
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
    drawNews(state, rng, industry);
    if (AUCTION.rounds.includes(state.round)) {
      const item = rng.pick(Object.keys(AUCTION.items));
      state.auction = { round: state.round, item };
      state.feed.push({ round: state.round, headline: `Auction this round: ${AUCTION.items[item].name}. Sealed bids only.` });
    }
    if (SUMMIT.rounds.includes(state.round)) {
      const regs = rng.shuffle(Object.keys(SUMMIT.regulations));
      state.summit = { round: state.round, options: [regs[0], regs[1]] };
      state.feed.push({ round: state.round, headline: `Industry summit: vote on the ${SUMMIT.regulations[regs[0]].name.toLowerCase()} or the ${SUMMIT.regulations[regs[1]].name.toLowerCase()}` });
    }
  }
  const tip = state.finished || state.round >= state.config.rounds ? [] : state.upcomingNews ?? [];
  for (const w of work) {
    const bought = w.d.research;
    if (!bought.length) continue;
    const result = {};
    if (bought.includes("competitors")) {
      result.competitors = work.filter((o) => o.c.id !== w.c.id).map((o) => ({
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
        retailPrice: o.d.retailPrice
      }));
    }
    if (bought.includes("survey")) {
      result.survey = state.companies.filter((c) => !c.bankrupt).map((c) => ({ companyId: c.id, companyName: c.companyName, brand: c.brand, hype: c.hype }));
    }
    if (bought.includes("forecast") && !state.finished) {
      result.forecast = { round: state.round + 1, news: tip.map((t) => ({ headline: newsHeadline(state, t), effect: t.event.effect, duration: t.event.duration, kind: t.event.kind ?? "story" })) };
    }
    reports[w.c.id].research = result;
  }
  for (const w of work) {
    const seats = work.filter((o) => o.c.id !== w.c.id && (o.c.shares.holders[w.c.id] ?? 0) >= BOARD_SEAT_SHARES).map((o) => {
      const r = reports[o.c.id];
      return { companyId: o.c.id, companyName: o.c.companyName, held: o.c.shares.holders[w.c.id] ?? 0, report: { price: r.price, quality: r.quality, produced: r.produced, sold: r.sold, revenue: r.revenue, profit: r.profit, cashEnd: r.cashEnd, debtEnd: r.debtEnd, marketingCost: r.marketingCost, rndCost: r.rndCost, capacityInvest: r.capacityInvest, stores: r.stores } };
    });
    if (seats.length) reports[w.c.id].research = { ...reports[w.c.id].research ?? {}, boardSeats: seats };
  }
  for (const [id, spy] of Object.entries(spyReports)) {
    if (!reports[id]) continue;
    reports[id].research = { ...reports[id].research ?? {}, spy };
  }
  state.rngState = rng.state;
  return state;
}
function goBankrupt(state, c, round, byId) {
  c.bankrupt = true;
  c.inventory = 0;
  if (round + 1 <= state.config.rounds && (c.capacity > 0 || c.stores > 0)) {
    (state.bankruptcySales ??= []).push({ round: round + 1, companyId: c.id });
    state.feed.push({ round: round + 1, headline: `Bankruptcy sale this round: ${c.companyName}'s factory${c.stores ? " and stores" : ""} go to the highest bidder` });
  }
  state.feed.push({ round, headline: `${c.companyName} goes bankrupt. ${c.playerName} trades the corner office for a press badge.` });
  for (const other of byId.values()) {
    if (other.controlledBy === c.id) other.controlledBy = null;
  }
}
function missionDone(state, c) {
  if (c.bankrupt || !c.mission) return false;
  const alive = state.companies.filter((o) => !o.bankrupt);
  const lastSeg = (o, s) => o.history.at(-1)?.segments[s].sold ?? 0;
  const totalSold = (o) => o.history.filter((h) => h.round >= 1).reduce((a, h) => a + h.sold, 0);
  const isTop = (f) => alive.every((o) => o.id === c.id || f(c) > f(o));
  switch (c.mission.id) {
    case "stake": {
      const t = state.companies.find((o) => o.id === c.mission.targetId);
      return !!t && (t.shares.holders[c.id] ?? 0) >= 30;
    }
    case "stores":
      return c.stores >= 8;
    case "premiumLead":
      return isTop((o) => lastSeg(o, "premium"));
    case "budgetLead":
      return isTop((o) => lastSeg(o, "budget"));
    case "debtFree":
      return c.debt <= 0 && c.cash >= 2e6;
    case "quality5":
      return c.qualityCap >= 5;
    case "volume":
      return isTop(totalSold);
    case "brand":
      return isTop((o) => o.brand);
  }
}
function standings(state) {
  const values = companyValues(state);
  const rows = state.companies.map((c) => {
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
      journalistPoints: c.journalistPoints ?? 0
    };
  });
  return rows.sort((a, b) => Number(b.monopoly) - Number(a.monopoly) || b.score - a.score);
}
function publicInfo(state) {
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
      bankrupt: c.bankrupt
    };
  });
}
export {
  INDUSTRIES,
  companyValues,
  createGame,
  publicInfo,
  resolveRound,
  standings
};
