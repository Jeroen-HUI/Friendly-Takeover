// Runs many bot matches and reports how each strategy performs.
// Usage: npx tsx src/sim/simulate.ts [matches] [industry] [difficulty]
//        npx tsx src/sim/simulate.ts trace [industry] [seed]   -> one match, round by round

import { INDUSTRIES, teamOutput, createGame, resolveRound, standings, type CeoTrait, type Decisions, type GameState, type IndustryId, type DifficultyId } from "../engine";

const CEO_TRAITS_LIST: CeoTrait[] = ["ruthless", "visionary", "influencer", "pennyPincher"];
import { Rng } from "../engine/rng";
import { botDecisions, BOT_STRATEGIES, type BotStrategy } from "./bots";

/** Generic defense every bot uses: buy back shares when a rival holds 25% or more. */
function withDefense(state: GameState, companyId: string, d: Partial<Decisions>): Partial<Decisions> {
  const c = state.companies.find((x) => x.id === companyId)!;
  const threat = Math.max(0, ...Object.values(c.shares.holders));
  if (threat >= 25 && c.cash > 1_200_000) return { ...d, buyback: 10 };
  return d;
}

export interface MatchResult {
  ranking: { strategy: BotStrategy; score: number; bankrupt: boolean; controlled: boolean }[];
  takeovers: number;
  bankruptcies: number;
  state: GameState;
}

export function runMatch(strategies: BotStrategy[], seed: number, industry: IndustryId = "chocolate", difficulty: DifficultyId = "standard", rounds = 8): MatchResult {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const players = strategies.map((s, i) => ({
    id: `p${i}`,
    playerName: `${s}-${i}`,
    companyName: `${s[0].toUpperCase()}${s.slice(1)} Co ${i}`,
    trait: rng.pick(CEO_TRAITS_LIST),
  }));
  let state = createGame({ industry, difficulty, rounds, seed }, players);
  while (!state.finished) {
    const decisions: Record<string, Partial<Decisions>> = {};
    state.companies.forEach((c, i) => {
      if (c.bankrupt) return;
      const d = withDefense(state, c.id, botDecisions(strategies[i], state, c, rng));
      // Tycoon: bots that don't plan staff hire enough teams for what they want to make.
      if (difficulty === "tycoon" && d.hire === undefined) {
        const need = Math.ceil(Math.min(c.capacity, d.production ?? c.capacity) / teamOutput(INDUSTRIES[industry]));
        d.hire = Math.max(-10, Math.min(10, need - c.workers));
      }
      decisions[c.id] = d;
    });
    state = resolveRound(state, decisions);
  }
  const table = standings(state);
  const idx = (id: string) => Number(id.slice(1));
  return {
    ranking: table.map((r) => ({ strategy: strategies[idx(r.companyId)], score: r.score, bankrupt: r.bankrupt, controlled: !!r.controlledBy })),
    takeovers: state.companies.filter((c) => c.controlledBy).length,
    bankruptcies: state.companies.filter((c) => c.bankrupt).length,
    state,
  };
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("en").padStart(12);
}

export interface TournamentOptions {
  pool?: BotStrategy[];
  /** Draw strategies with replacement, so several players can pick the same strategy. */
  replacement?: boolean;
  minPlayers?: number;
  maxPlayers?: number;
}

export function runTournament(matches: number, industry: IndustryId, difficulty: DifficultyId, opts: TournamentOptions = {}) {
  const pool = opts.pool ?? BOT_STRATEGIES;
  const minP = opts.minPlayers ?? 4;
  const maxP = opts.maxPlayers ?? 6;
  const stats: Record<string, { played: number; wins: number; rankSum: number; scoreSum: number; bankrupt: number; controlled: number }> = {};
  for (const s of pool) stats[s] = { played: 0, wins: 0, rankSum: 0, scoreSum: 0, bankrupt: 0, controlled: 0 };
  let takeovers = 0;
  let bankruptcies = 0;
  const rng = new Rng(12345);
  for (let m = 0; m < matches; m++) {
    const size = minP + rng.int(maxP - minP + 1);
    const lineup = opts.replacement ? Array.from({ length: size }, () => rng.pick(pool)) : rng.shuffle(pool).slice(0, Math.min(size, pool.length));
    const res = runMatch(lineup, 1000 + m, industry, difficulty);
    takeovers += res.takeovers;
    bankruptcies += res.bankruptcies;
    // With replacement, a strategy that appears twice counts once per seat; win share is split.
    res.ranking.forEach((r, rank) => {
      const s = stats[r.strategy];
      s.played++;
      s.rankSum += rank / (res.ranking.length - 1); // 0 = first, 1 = last
      s.scoreSum += r.score;
      if (rank === 0) s.wins++;
      if (r.bankrupt) s.bankrupt++;
      if (r.controlled) s.controlled++;
    });
  }
  return { stats, takeovers, bankruptcies, matches };
}

function printTournament(t: ReturnType<typeof runTournament>, label: string) {
  console.log(`\n=== ${label}: ${t.matches} matches ===`);
  console.log("strategy     seats   win%   avgRank(0=1st,1=last)  avgScore    bankrupt%  takenOver%");
  for (const [name, s] of Object.entries(t.stats)) {
    if (!s.played) continue;
    console.log(
      `${name.padEnd(12)} ${String(s.played).padStart(6)} ${((100 * s.wins) / s.played).toFixed(1).padStart(5)}  ${(s.rankSum / s.played).toFixed(2).padStart(14)}       ${fmt(s.scoreSum / s.played)} ${((100 * s.bankrupt) / s.played).toFixed(1).padStart(10)} ${((100 * s.controlled) / s.played).toFixed(1).padStart(10)}`,
    );
  }
  console.log(`takeovers per match: ${(t.takeovers / t.matches).toFixed(2)}, bankruptcies per match: ${(t.bankruptcies / t.matches).toFixed(2)}`);
}

function trace(industry: IndustryId, seed: number) {
  const lineup: BotStrategy[] = ["budget", "mainstream", "premium", "hype", "raider"];
  const res = runMatch(lineup, seed, industry);
  for (const c of res.state.companies) {
    console.log(`\n${c.companyName} (${c.trait})`);
    console.log("rnd  price  q  produced     sold   unmet     revenue      profit        cash        value   brand hype events");
    for (const h of c.history) {
      console.log(
        `${String(h.round).padStart(3)} ${h.price.toFixed(2).padStart(6)} ${h.quality} ${String(h.produced).padStart(9)} ${String(h.sold).padStart(8)} ${String(h.unmetDemand).padStart(7)} ${fmt(h.revenue)} ${fmt(h.profit)} ${fmt(h.cashEnd)} ${fmt(h.value)}  ${h.events.join("; ")}`,
      );
    }
    console.log(`final brand ${c.brand.toFixed(1)} hype ${c.hype.toFixed(1)} cap ${c.capacity} qcap ${c.qualityCap} shares ${JSON.stringify(c.shares)}`);
  }
  console.log("\nNews feed:");
  for (const f of res.state.feed) console.log(`  R${f.round}: ${f.headline}`);
  console.log("\nStandings:");
  for (const r of standings(res.state)) console.log(`  ${r.companyName.padEnd(18)} score ${fmt(r.score)} value ${fmt(r.value)} ${r.controlledBy ? "(controlled by " + r.controlledBy + ")" : ""}`);
}

const [, , a, b, c] = process.argv;
if (a === "trace") {
  trace((b as IndustryId) ?? "chocolate", Number(c ?? 7));
} else if (process.argv[1]?.endsWith("simulate.ts")) {
  const matches = Number(a ?? 600);
  const industry = (b as IndustryId) ?? "chocolate";
  const difficulty = (c as DifficultyId) ?? "standard";
  const core: BotStrategy[] = ["budget", "mainstream", "premium", "hype"];
  printTournament(runTournament(matches, industry, difficulty, { pool: core, minPlayers: 4, maxPlayers: 4 }), `${industry} / ${difficulty} — one of each core strategy`);
  printTournament(runTournament(matches, industry, difficulty, { pool: core, replacement: true }), `${industry} / ${difficulty} — 4-6 players, strategies may repeat`);
  printTournament(runTournament(matches, industry, difficulty, { pool: BOT_STRATEGIES, replacement: true }), `${industry} / ${difficulty} — all bots incl. raider, dumper, random`);
}
