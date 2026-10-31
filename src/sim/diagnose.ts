// Average economics per strategy (rounds 4-8) for one-of-each matches. Usage: npx tsx src/sim/diagnose.ts [industry]
import { runMatch } from "./simulate";
import type { BotStrategy } from "./bots";
import type { IndustryId } from "../engine";
const industry = (process.argv[2] as IndustryId) ?? "chocolate";
const lineup: BotStrategy[] = ["budget", "mainstream", "premium", "hype"];
const acc: Record<string, { n: number; sold: number; rev: number; profit: number; price: number; unmet: number; mkt: number; fixed: number; cogs: number; final: number }> = {};
for (const s of lineup) acc[s] = { n: 0, sold: 0, rev: 0, profit: 0, price: 0, unmet: 0, mkt: 0, fixed: 0, cogs: 0, final: 0 };
const M = 200;
for (let m = 0; m < M; m++) {
  const res = runMatch(lineup, 500 + m, industry);
  res.state.companies.forEach((c, i) => {
    const a = acc[lineup[i]];
    a.final += c.history.at(-1)!.value / M;
    for (const h of c.history.filter((h) => h.round >= 4)) {
      a.n++; a.sold += h.sold; a.rev += h.revenue; a.profit += h.profit; a.price += h.price; a.unmet += h.unmetDemand; a.mkt += h.marketingCost + h.brandCost + h.rndCost; a.fixed += h.fixedCost; a.cogs += h.revenue - h.profit - h.marketingCost - h.brandCost - h.rndCost - h.fixedCost;
    }
  });
}
const f = (x: number) => Math.round(x).toLocaleString("en").padStart(11);
console.log("strategy      price      sold     unmet     revenue  cogs+hold+int  mkt+brand+rnd   fixed      profit   finalValue");
for (const [s, a] of Object.entries(acc)) console.log(`${s.padEnd(11)} ${(a.price / a.n).toFixed(2).padStart(6)} ${f(a.sold / a.n)} ${f(a.unmet / a.n)} ${f(a.rev / a.n)} ${f(a.cogs / a.n)} ${f(a.mkt / a.n)} ${f(a.fixed / a.n)} ${f(a.profit / a.n)} ${f(a.final)}`);
