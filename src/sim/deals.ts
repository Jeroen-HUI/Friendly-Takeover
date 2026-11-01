// How computer players handle private deals: they say yes to good offers, no to bad ones,
// and now and then pitch a deal themselves. Used in single-player (online, deals are between people).

import { BALANCE, DIFFICULTIES, companyValues, rulesOf, sharePrices, type Company, type DealOrder, type GameState, type LoanDealTerms, type MergerDealTerms, type PactDealTerms, type ShareDealTerms } from "../engine";
import { Rng } from "../engine/rng";

const pick = <T,>(rng: Rng, list: T[]) => list[rng.int(list.length)];

/** A bot's answer to a deal offered to it, with a line for the chat. */
export function botRespondDeal(state: GameState, botId: string, deal: DealOrder, strategy = "", seed = 1): { accept: boolean; line: string } {
  const rng = new Rng((seed ^ (deal.id.length * 7919) ^ state.round * 104729) | 0);
  const bot = state.companies.find((c) => c.id === botId)!;
  const other = state.companies.find((c) => c.id === (deal.from === botId ? deal.to : deal.from))!;
  const no = (lines: string[]) => ({ accept: false, line: pick(rng, lines) });
  const yes = (lines: string[]) => ({ accept: true, line: pick(rng, lines) });
  if (!bot || !other || bot.bankrupt) return no(["..."]);
  const prices = sharePrices(state);

  if (deal.kind === "shares") {
    const t = deal.terms as ShareDealTerms;
    const target = state.companies.find((c) => c.id === t.company);
    if (!target) return no(["Which company?"]);
    const fair = prices[target.id] * t.qty;
    // "sell": the proposer sells to the other side; "buy": the proposer buys from them.
    const botSells = (t.direction === "sell" ? deal.from : deal.to) === botId;
    if (state.round < DIFFICULTIES[state.config.difficulty].takeoverUnlockRound) return no(["Share trading isn't open yet. Ask me again later."]);
    if (botSells) {
      // Selling: wants a premium, a big one for its own company, and never hands over control cheaply.
      const own = target.id === botId;
      const after = (target.shares.holders[other.id] ?? 0) + t.qty;
      const premium = own ? (after > BALANCE.controlThreshold ? 2.5 : 1.5) : 1.15;
      if (t.price >= fair * premium) return yes([`Pleasure doing business. ${t.qty}% is yours.`, "Deal. Don't spend it all at once... oh wait, that's me.", "Fine. My accountant is crying with joy."]);
      return no([`For ${t.qty}%? I want at least €${Math.round((fair * premium) / 1000)}k.`, "That's an insult to my shareholders. Mostly me.", "Nice try. Come back with a real number."]);
    }
    // Buying: only a bargain, and only with cash to spare.
    if (t.price <= fair * 0.9 && bot.cash > t.price + 500_000) return yes(["A bargain? Don't mind if I do.", "Sold to the bot in the nice suit!"]);
    return no(["Too pricey for me.", `Those shares are worth about €${Math.round(fair / 1000)}k. Not more.`, "My cash has other plans this round."]);
  }

  if (deal.kind === "loan") {
    const t = deal.terms as LoanDealTerms;
    const botLends = (t.direction === "lend" ? deal.from : deal.to) === botId;
    const rate = Math.pow(Math.max(0.01, t.repay / Math.max(1, t.amount)), 1 / Math.max(1, t.rounds)) - 1;
    if (botLends) {
      const risky = other.debt > 4_000_000 || other.cash < 0;
      if (risky) return no(["Your debt scares me. Hard pass.", "I've seen your balance sheet. No."]);
      if (rate >= 0.1 && t.amount <= bot.cash * 0.35) return yes([`${Math.round(rate * 100)}% a round? Deal. Pay me back or I tell the newspapers.`, "Fine. I'll be watching your cash flow."]);
      return no([`At ${Math.round(rate * 100)}%? The bank pays better. I want 10%+.`, "Not that much, not that cheap."]);
    }
    if (bot.cash < 700_000 && rate <= 0.08) return yes(["Cheaper than the bank? Yes please.", "You're a lifesaver. Literally, my CFO fainted."]);
    return no(["I'm fine for cash, thanks.", "At that rate I'd rather call the bank."]);
  }

  if (deal.kind === "merger") {
    const t = deal.terms as MergerDealTerms;
    if (!rulesOf(state).takeovers) return no(["Mergers are off in this game."]);
    if (state.round < DIFFICULTIES[state.config.difficulty].takeoverUnlockRound) return no(["Too early to get married. Ask me again in a few rounds."]);
    const v = companyValues(state), mine = v[botId] ?? 0, theirs = v[other.id] ?? 0;
    const botLeads = t.survivor === botId;
    // Running the show: yes if the partner adds real value. Being absorbed: only when clearly behind.
    if (botLeads) {
      if (theirs >= mine * 0.25) return yes(["A merger with me in charge? Where do I sign?", "Welcome aboard. I'll keep your coffee machine.", "Deal. I always wanted a bigger factory."]);
      return no(["You'd bring... what exactly? No offence.", "Grow a bit first, then we'll talk."]);
    }
    if (strategy.includes("raider")) return no(["Me, a junior partner? Never.", "I don't merge. I acquire."]);
    if (mine < theirs * 0.6 && rng.chance(0.7)) return yes(["Fine, you run it. I'll take my shares and a nice title.", "Better a slice of a big cake than all of a small one. Deal."]);
    return no(["Why would I hand you my company?", "Make me the boss and we'll talk.", "I'm doing fine on my own, thanks."]);
  }

  // Pact: raiders laugh, others like peace, especially when the other side owns a lot of them.
  const t = deal.terms as PactDealTerms;
  if (strategy.includes("raider")) return no(["A pact? With my business model? No.", "I don't do peace. I do acquisitions."]);
  const theyHoldMe = bot.shares.holders[other.id] ?? 0;
  if (theyHoldMe >= 15 || t.penalty >= 200_000 || rng.chance(0.6)) return yes([`Pact signed. ${t.rounds} rounds of peace. Probably.`, "Friends! For now.", "Agreed. I'll keep my lawyers on standby anyway."]);
  return no(["I like to keep my options open.", "Make the penalty hurt more and we'll talk."]);
}

/** Sometimes a bot pitches you a deal (at most one per round across all bots). */
export function botProposeDeal(state: GameState, bots: Record<string, string>, humanId: string, seed: number): { deal: DealOrder; line: string } | null {
  const rng = new Rng((seed ^ (state.round * 7919)) | 0);
  if (state.round < 2 || !rng.chance(0.3)) return null;
  const me = state.companies.find((c) => c.id === humanId);
  if (!me || me.bankrupt) return null;
  const alive = Object.keys(bots).map((id) => state.companies.find((c) => c.id === id)!).filter((c) => c && !c.bankrupt);
  if (!alive.length) return null;
  const bot = pick(rng, alive) as Company;
  const prices = sharePrices(state);
  const id = `bot-${bot.id}-${state.round}`;
  const unlocked = state.round >= DIFFICULTIES[state.config.difficulty].takeoverUnlockRound;
  // You own a chunk of the bot: it wants peace.
  if ((bot.shares.holders[humanId] ?? 0) >= 15) {
    return { deal: { id, from: bot.id, to: humanId, kind: "pact", terms: { rounds: 2, penalty: 300_000 } }, line: "You own a lot of me. How about a pact? Two rounds, €300k if you break it." };
  }
  // Bot holds your shares: offers them back at a premium.
  const held = me.shares.holders[bot.id] ?? 0;
  if (unlocked && held >= 5) {
    const qty = Math.min(held, 10);
    const price = Math.round((prices[humanId] * qty * 1.3) / 1000) * 1000;
    return { deal: { id, from: bot.id, to: humanId, kind: "shares", terms: { company: humanId, qty, price, direction: "sell" } }, line: `I'll sell you back ${qty} of your own shares for €${Math.round(price / 1000)}k. Before someone less friendly buys them.` };
  }
  // Short on cash: asks for a loan.
  if (bot.cash < 500_000 && me.cash > 1_500_000) {
    return { deal: { id, from: bot.id, to: humanId, kind: "loan", terms: { amount: 400_000, repay: 460_000, rounds: 1, direction: "borrow" } }, line: "Bit of a cash crunch here. Lend me €400k, I pay €460k back next round?" };
  }
  if (rng.chance(0.5)) return { deal: { id, from: bot.id, to: humanId, kind: "pact", terms: { rounds: 2, penalty: 200_000 } }, line: "Let's not hurt each other. Non-attack pact for two rounds?" };
  return null;
}
