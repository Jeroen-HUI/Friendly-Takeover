// Skill-vs-luck analysis. Writes sim-report.md.
// Usage: npx tsx src/sim/analyze.ts [matchesPerTest]

import { writeFileSync } from "node:fs";
import { AUCTION, standings, type DifficultyId, type IndustryId } from "../engine";
import { runMatch } from "./simulate";
import type { BotStrategy } from "./bots";

const N = Number(process.argv[2] ?? 120);
const out: string[] = [];
const log = (s = "") => { out.push(s); console.log(s); };
const pct = (x: number) => (100 * x).toFixed(0) + "%";
const eur = (x: number) => "€" + (x / 1e6).toFixed(2) + "M";

interface Agg { played: number; wins: number; rankSum: number; scoreSum: number; scores: number[]; bankrupt: number; controlled: number }
function newAgg(): Agg { return { played: 0, wins: 0, rankSum: 0, scoreSum: 0, scores: [], bankrupt: 0, controlled: 0 }; }

/** Runs a lineup many times, rotating seats so seat order never matters. */
function play(lineup: BotStrategy[], matches: number, industry: IndustryId, difficulty: DifficultyId, seedBase = 1) {
  const stats: Record<string, Agg> = {};
  const feature = { showdowns: 0, showdownWinsDefender: 0, auctions: 0, auctionPrice: {} as Record<string, number[]>, missions: 0, missionsDone: 0, wildcards: 0, takeovers: 0, bankrupt: 0 };
  const perSeed: { seed: number; ranks: Record<string, number>; scores: Record<string, number> }[] = [];
  for (let m = 0; m < matches; m++) {
    const rot = m % lineup.length;
    const seats = [...lineup.slice(rot), ...lineup.slice(0, rot)];
    const res = runMatch(seats, seedBase + m, industry, difficulty);
    const table = standings(res.state);
    const ranks: Record<string, number> = {}, scores: Record<string, number> = {};
    table.forEach((r, rank) => {
      const strat = seats[Number(r.companyId.slice(1))];
      const a = (stats[strat] ??= newAgg());
      a.played++; a.rankSum += rank + 1; a.scoreSum += r.score; a.scores.push(r.score);
      if (rank === 0) a.wins++;
      if (r.bankrupt) a.bankrupt++;
      if (r.controlledBy) a.controlled++;
      feature.missions++; if (r.missionDone) feature.missionsDone++;
      ranks[strat + "#" + r.companyId] = rank; scores[strat] = (scores[strat] ?? 0) + r.score;
    });
    perSeed.push({ seed: seedBase + m, ranks, scores });
    feature.takeovers += res.takeovers; feature.bankrupt += res.bankruptcies;
    for (const c of res.state.companies) for (const h of c.history) {
      if (h.showdownPaid > 0) feature.showdowns += 0.5; // both sides record it
      if (h.auctionPaid > 0) { feature.auctions++; }
      if (h.wildcardCost > 0) feature.wildcards++;
    }
    for (const f of res.state.feed) {
      const mm = f.headline.match(/wins the (.+) auction for €([\d,]+)/);
      if (mm) (feature.auctionPrice[mm[1]] ??= []).push(Number(mm[2].replace(/,/g, "")));
      if (f.headline.includes("fights off")) feature.showdownWinsDefender++;
    }
  }
  return { stats, feature, perSeed };
}

function table(stats: Record<string, Agg>, order?: string[]) {
  log("| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |");
  log("|---|---|---|---|---|---|");
  for (const k of order ?? Object.keys(stats).sort((a, b) => stats[b].scoreSum / stats[b].played - stats[a].scoreSum / stats[a].played)) {
    const a = stats[k]; if (!a) continue;
    log(`| ${k} | ${pct(a.wins / a.played)} | ${(a.rankSum / a.played).toFixed(2)} | ${eur(a.scoreSum / a.played)} | ${pct(a.bankrupt / a.played)} | ${pct(a.controlled / a.played)} |`);
  }
}

/** Share of score variance explained by which strategy a player used (0 = all luck, 1 = all strategy). */
function etaSquared(stats: Record<string, Agg>) {
  const all = Object.values(stats).flatMap((a) => a.scores);
  const mean = all.reduce((x, y) => x + y, 0) / all.length;
  const total = all.reduce((x, y) => x + (y - mean) ** 2, 0);
  const between = Object.values(stats).reduce((x, a) => { const m = a.scores.reduce((p, q) => p + q, 0) / a.scores.length; return x + a.scores.length * (m - mean) ** 2; }, 0);
  return between / total;
}

const t0 = Date.now();
log("# Friendly Takeover: skill vs luck report");
log();
log(`${N} matches per test, 8 rounds, seats rotated every match. "Pro" bots try out candidate plans with the engine before deciding (like a player who does the maths), without seeing the dice: rivals are assumed to repeat their last plan and every try uses a different random seed. "Smart" bots read their reports, steer price by sell-through, plan production and capacity, open stores when they fill up, play the endgame, and use wildcards, auctions, votes and missions. "Naive" bots repeat one fixed plan. "Sloppy" is the smart bot with ±25% random mistakes.`);

// 1. Smart vs naive, same positioning.
log(); log("## 1. Does thinking beat a fixed plan?");
log("Each match: a pro bot and a naive bot with the SAME positioning, plus two naive bots in other positions.");
log();
log("| Positioning | Pro avg rank | Naive avg rank | Pro beats naive twin |"); log("|---|---|---|---|");
for (const p of ["budget", "mainstream", "premium", "hype"] as const) {
  const others = (["budget", "mainstream", "premium", "hype"] as const).filter((x) => x !== p).slice(0, 2);
  const lineup: BotStrategy[] = [`pro-${p}` as BotStrategy, p, ...others];
  const r = play(lineup, N, "chocolate", "standard", 5000);
  let beats = 0;
  for (const s of r.perSeed) {
    const sr = Object.entries(s.ranks).find(([k]) => k.startsWith("pro-"))![1];
    const nr = Object.entries(s.ranks).find(([k]) => k.startsWith(p + "#"))![1];
    if (sr < nr) beats++;
  }
  log(`| ${p} | ${(r.stats[`pro-${p}`].rankSum / N).toFixed(2)} | ${(r.stats[p].rankSum / N).toFixed(2)} | ${pct(beats / N)} |`);
}

// 2. Everyone smart: are the positionings balanced?
for (const [industry, difficulty] of [["chocolate", "standard"], ["ai", "standard"], ["weed", "standard"], ["chocolate", "cutthroat"], ["chocolate", "tycoon"]] as [IndustryId, DifficultyId][]) {
  log(); log(`## 2. All skilled players: ${industry}, ${difficulty}`);
  const r = play(["pro-budget", "pro-mainstream", "pro-premium", "pro-hype", "smart-raider"], N, industry, difficulty, 9000);
  log(); table(r.stats);
  const f = r.feature;
  const prices = Object.entries(f.auctionPrice).map(([k, v]) => `${k} ${eur(v.reduce((a, b) => a + b, 0) / v.length)}`).join(", ");
  log();
  log(`Per match: ${(f.takeovers / N).toFixed(2)} takeovers, ${(f.bankrupt / N).toFixed(2)} bankruptcies, ${(f.showdowns / N).toFixed(2)} showdowns (defender won ${f.showdowns ? pct(f.showdownWinsDefender / f.showdowns) : "-"}), ${(f.wildcards / N).toFixed(1)} wildcards played. Missions completed: ${pct(f.missionsDone / f.missions)}. Average auction prices: ${prices || "none"}.`);
}

// 3. Skill ladder: smart vs sloppy vs naive, same positioning, so only skill differs.
log(); log("## 3. Skill ladder (same positioning, different skill)");
log("Four mainstream companies: pro, smart, sloppy (smart with random mistakes), naive.");
{
  const r = play(["pro-mainstream", "smart-mainstream", "sloppy-mainstream", "mainstream"], N * 2, "chocolate", "standard", 20000);
  log(); table(r.stats, ["pro-mainstream", "smart-mainstream", "sloppy-mainstream", "mainstream"]);
  log(); log(`Share of score differences explained by skill level: **${pct(etaSquared(r.stats))}** (the rest is luck: news, flops, traits, auctions, seat interactions).`);
}

// 4. Pure luck: identical smart players.
log(); log("## 4. Mirror match (pure luck)");
log("Four identical pro mainstream players. Any difference is luck (traits, viral flops, news, auctions, missions).");
{
  const r = play(["pro-mainstream", "pro-mainstream", "pro-mainstream", "pro-mainstream"], N, "chocolate", "standard", 30000);
  const scores = r.stats["pro-mainstream"].scores;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  const gaps = r.perSeed.map((s) => { const v = Object.values(s.ranks); return v; });
  log(); log(`Average score ${eur(mean)}, spread (std dev) ${eur(sd)} = ${pct(sd / mean)} of the average. Matches played: ${gaps.length}.`);
}

// 5. Seed consistency: does the same skill order come out every time?
log(); log("## 5. How often does the better player win?");
{
  const lineup: BotStrategy[] = ["pro-mainstream", "smart-mainstream", "mainstream", "pro-premium", "premium"];
  const r = play(lineup, N, "chocolate", "standard", 40000);
  let smartOverSloppy = 0, smartOverNaive = 0, sPremOverNaive = 0;
  for (const s of r.perSeed) {
    const rk = (p: string) => Object.entries(s.ranks).find(([k]) => k.startsWith(p + "#"))![1];
    if (rk("pro-mainstream") < rk("smart-mainstream")) smartOverSloppy++;
    if (rk("pro-mainstream") < rk("mainstream")) smartOverNaive++;
    if (rk("pro-premium") < rk("premium")) sPremOverNaive++;
  }
  log(); table(r.stats);
  log(); log(`Pro beats smart: ${pct(smartOverSloppy / N)}. Pro beats naive (mainstream): ${pct(smartOverNaive / N)}. Pro beats naive (premium): ${pct(sPremOverNaive / N)}.`);
}

// 6. Exploits.
log(); log("## 6. Exploit hunt");
log("Each habit plays one seat against pro budget, premium and hype bots. Compare with the pro and smart mainstream bots in the same seat.");
log();
log("| Habit | Win rate | Avg rank | Avg score | Bankrupt |"); log("|---|---|---|---|---|");
for (const h of ["pro-mainstream", "smart-mainstream", "plain-mainstream", "shortseller", "spammer", "hoarder", "loanshark", "nomarketing", "overbidder", "dumper", "raider", "smart-raider"] as BotStrategy[]) {
  const r = play([h, "pro-budget", "pro-premium", "pro-hype"], N, "chocolate", "standard", 50000);
  const a = r.stats[h];
  log(`| ${h} | ${pct(a.wins / a.played)} | ${(a.rankSum / a.played).toFixed(2)} | ${eur(a.scoreSum / a.played)} | ${pct(a.bankrupt / a.played)} |`);
}
log(); log(`_Generated in ${((Date.now() - t0) / 1000).toFixed(0)}s._`);
writeFileSync("sim-report.md", out.join("\n") + "\n");
