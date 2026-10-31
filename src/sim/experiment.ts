// Balance experiments: tweak COSTS / GUIDANCE at runtime and run an all-pro field.
// Usage: npx tsx src/sim/experiment.ts <matches> <industry> '<json overrides {"COSTS":{...},"GUIDANCE":{...}}>'
import { COSTS, GUIDANCE, INDUSTRIES, type IndustryId } from "../engine";
import { runMatch } from "./simulate";
const N = Number(process.argv[2] ?? 30), ind = (process.argv[3] ?? "chocolate") as IndustryId;
const o = JSON.parse(process.argv[4] ?? "{}");
Object.assign(COSTS, o.COSTS ?? {}); Object.assign(GUIDANCE, o.GUIDANCE ?? {});
// INDUSTRY: top-level fields (growth, news: [] ...) and per-segment tweaks {"segments":{"premium":{"weight":0.12}}}.
const I = INDUSTRIES[ind] as any, io = o.INDUSTRY ?? {};
for (const [k, v] of Object.entries(io)) if (k === "segments") for (const [sg, t] of Object.entries(v as object)) Object.assign(I.segments[sg], t); else I[k] = v;
const lineup = ["pro-budget", "pro-mainstream", "pro-premium", "pro-hype"] as const;
const st: Record<string, { w: number; s: number }> = {};
for (let m = 0; m < N; m++) {
  const rot = m % 4, seats = [...lineup.slice(rot), ...lineup.slice(0, rot)];
  const res = runMatch([...seats], 777 + m, ind, "standard");
  res.ranking.forEach((r, i) => { const a = (st[r.strategy] ??= { w: 0, s: 0 }); a.s += r.score; if (i === 0) a.w++; });
}
const avg = Object.fromEntries(Object.entries(st).map(([k, a]) => [k, a.s / N]));
const vals = Object.values(avg), spread = (Math.max(...vals) - Math.min(...vals)) / (vals.reduce((a, b) => a + b, 0) / vals.length);
console.log(JSON.stringify(o).padEnd(60), Object.entries(st).map(([k, a]) => `${k.replace("pro-", "")} ${(100 * a.w / N).toFixed(0)}% ${(a.s / N / 1e6).toFixed(2)}M`).join(" | "), `spread ${(spread * 100).toFixed(0)}%`);
