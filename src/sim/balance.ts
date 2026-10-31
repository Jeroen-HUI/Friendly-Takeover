// Quick balance check: all-pro field in every industry. Usage: npx tsx src/sim/balance.ts [matches] [difficulty]
import type { DifficultyId, IndustryId } from "../engine";
import { runMatch } from "./simulate";
import type { BotStrategy } from "./bots";
const N = Number(process.argv[2] ?? 30);
const diff = (process.argv[3] ?? "standard") as DifficultyId;
const lineup = (process.argv[4] ?? "pro-budget,pro-mainstream,pro-premium,pro-hype").split(",") as BotStrategy[];
for (const ind of ["chocolate", "ai", "weed"] as IndustryId[]) {
  const st: Record<string, { w: number; s: number; r: number }> = {};
  for (let m = 0; m < N; m++) {
    const rot = m % lineup.length;
    const seats = [...lineup.slice(rot), ...lineup.slice(0, rot)];
    const res = runMatch(seats, 777 + m, ind, diff);
    res.ranking.forEach((r, i) => { const a = (st[r.strategy] ??= { w: 0, s: 0, r: 0 }); a.s += r.score; a.r += i + 1; if (i === 0) a.w++; });
  }
  const per = Object.values(st)[0] ? N * lineup.length / Object.keys(st).length : N;
  console.log(ind.padEnd(10), Object.entries(st).map(([k, a]) => `${k} ${(100 * a.w / per).toFixed(0)}% ${(a.s / per / 1e6).toFixed(2)}M r${(a.r / per).toFixed(2)}`).join(" | "));
}
