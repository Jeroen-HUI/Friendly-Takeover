// A "skilled player" bot: it tries out candidate plans with the real engine (like a player doing
// their own maths in a spreadsheet) and picks the best one. It does not see the luck: each try runs
// on a different random seed, and rivals are assumed to repeat last round's plan.

import { companyValues, INDUSTRIES, RETAIL, resolveRound, teamOutput, type Company, type Decisions, type GameState } from "../engine";
import { Rng } from "../engine/rng";
import { smartDecisions, type Position, type SmartOptions } from "./smart";

function run(state: GameState, me: Company, d: Partial<Decisions>, salt: number) {
  // Tycoon: hire just enough teams for the planned production.
  if (state.config.difficulty === "tycoon") {
    const need = Math.ceil((d.production ?? 0) / teamOutput(INDUSTRIES[state.config.industry]));
    d = { ...d, hire: Math.max(-10, Math.min(10, need - me.workers)) };
  }
  const next = resolveRound({ ...state, rngState: (state.rngState ^ Math.imul(salt + 1, 2654435761)) | 0 }, { [me.id]: d });
  return { next, c: next.companies.find((x) => x.id === me.id)! };
}

/** Score a plan: find the demand it creates, make that much, and value the result. */
function evaluate(state: GameState, me: Company, d: Partial<Decisions>, salt: number): { score: number; d: Partial<Decisions> } {
  const roundsLeft = state.config.rounds - state.round;
  const capAfter = me.capacity + (d.investCapacity ?? 0) / (5 * INDUSTRIES[state.config.industry].baseUnitCost);
  let demand = 0;
  for (const s of [salt, salt + 7]) {
    const { c } = run(state, me, { ...d, production: Math.round(capAfter) }, s);
    const h = c.history.at(-1)!;
    demand += (h.sold + h.unmetDemand) / 2;
  }
  const plan = { ...d, production: Math.max(0, Math.min(Math.floor(me.capacity), Math.round(demand * 1.02 - me.inventory))) };
  let score = 0;
  for (const s of [salt + 1, salt + 8]) {
    const { next, c } = run(state, me, plan, s);
    if (c.bankrupt) return { score: -1e12, d: plan };
    const h = c.history.at(-1)!;
    // What the plan adds now, the profit it keeps making later, and the hype it leaves behind.
    score += (companyValues(next)[me.id] + roundsLeft * Math.max(-2e6, h.profit) * 0.5 + c.hype * 8000 * Math.min(1, roundsLeft)) / 2;
  }
  return { score, d: plan };
}

export function oracleDecisions(pos: Position, state: GameState, c: Company, rng: Rng, opts: SmartOptions = {}): Partial<Decisions> {
  const base = smartDecisions(pos, state, c, rng, opts);
  if (state.round < 1) return base;
  const ind = INDUSTRIES[state.config.industry];
  const ref = ind.segments[pos].refPrice;
  const salt = state.round * 131 + c.id.charCodeAt(c.id.length - 1) * 17;
  let best = { d: base as Partial<Decisions>, score: -Infinity };
  const consider = (d: Partial<Decisions>, k: number) => { const r = evaluate(state, c, d, salt + k); if (r.score > best.score) best = r; };

  for (const m of [0.85, 0.95, 1.05, 1.17, 1.3, 1.45, 1.6]) consider({ ...base, price: ref * m }, 0);
  const mk = base.marketingBudget ?? 0;
  for (const f of [0, 0.5, 1.6, 2.5]) consider({ ...best.d, marketingBudget: mk * f }, 1);
  const b0 = best.d;
  for (const u of [0.1, 0.25]) consider({ ...b0, investCapacity: c.capacity * u * 5 * ind.baseUnitCost }, 2);
  const b1 = best.d;
  for (const n of [0, 2, RETAIL.maxOpenPerRound]) if (n !== (b1.storesOpen ?? 0)) consider({ ...b1, storesOpen: n }, 3);
  if (state.config.difficulty === "tycoon") {
    const need = Math.ceil((best.d.production ?? 0) / teamOutput(ind));
    return { ...best.d, hire: Math.max(-10, Math.min(10, need - c.workers)) };
  }
  return best.d;
}
