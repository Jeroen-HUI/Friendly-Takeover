# Friendly Takeover

Multiplayer business game for friend groups: everyone runs a company in the same market, competes round by round, and can buy each other out.

This repository holds the game engine, a bot simulator to test balance, the playable game (single-player against bots, and online multiplayer with friends), and the Supabase backend (database plus the `game` server function).

## Play it

The whole game is one HTML file. Open `index.html` in a browser, or play the hosted version on GitHub Pages (repo Settings → Pages → Deploy from a branch → `main`; folder `/ (root)` or `/docs` both work): `https://jeroen-hui.github.io/Friendly-Takeover/`.

**Single-player:** New game, against bots. Your game saves in your browser.

**Online with friends:** Multiplayer → Create a game. You get a 6-character code and an invite link (`…/Friendly-Takeover/?join=CODE`). Friends choose Multiplayer → Join (or open the link). The host picks industry, difficulty, rounds, time per round and up to 4 bots, then starts. Everyone plans their round on their own screen and submits; the host can skip the timer once everyone is ready, otherwise the round closes when time runs out (players who didn't submit repeat last round's plan). Rivals' secret numbers stay on the server. If you close the tab, Multiplayer → Rejoin brings you back.

Online play needs the hosted page (GitHub Pages) or the local file with internet access; it does not work inside the Claude artifact preview.

## Quick start

```bash
npm install
npm run typecheck   # TypeScript check
npm test            # 11 engine tests
npm run sim         # 500 bot matches, Chocolate / Standard
npm run trace       # one match, round by round, with the news feed
node scripts/build-web.mjs        # builds dist/friendly-takeover.html from src/web/game.html (playable prototype, you vs bots)
node test/prototype.smoke.mjs     # plays a full match in that page headlessly
npx tsx test/multiplayer.smoke.ts # plays an online match against an in-memory copy of the backend
npm run smoke                     # build + both smoke tests
```

The prototype is one self-contained HTML file: the engine runs in the browser, so no server is needed. It is also published as a private Claude artifact.

Other industries: `npm run sim:ai`, `npm run sim:weed`, or `npx tsx src/sim/simulate.ts 500 chocolate cutthroat`.

## How the engine works

`resolveRound(state, decisions)` takes the full game state and every player's decisions and returns the next state. It is pure and deterministic: the same input always gives the same output, it never mutates its input, and randomness comes from a seeded generator stored in the state. That lets the server re-run or audit any round.

Each round:

1. **Decisions** are cleaned up: missing fields repeat last round, values are clamped (price range, quality cap, capacity, debt limit). Round 1 sets your quality freely; after that quality can only go up, so you commit to a positioning like in TOPSIM.
2. **Specials before the market**: Tycoon staff (hiring, wages, layoffs), wildcards (crazy launch, poach, spy, lobby, scandal, lawsuit; one per round, two uses each), the sealed-bid auction (rounds 3 and 6), the industry summit vote (rounds 4 and 7; the winning rule runs for 2 rounds), and journalists (bankrupt players) publishing an exposé.
3. **Market**: total demand is split into four segments (Budget, Mainstream, Premium, Hype). In each segment, every company gets an attractiveness score from price, quality, brand, hype and its marketing campaign, all measured against the other companies (quality, brand and hype relative to the market average; the reference price drifts toward the average price charged). Demand is shared by those scores (a logit model), with an outside option so very high prices shrink the market.
4. **Stock limits**: a company can only sell what it has; half of the unmet demand switches to rivals with stock left.
5. **Accounting**: revenue, production cost, holding cost on unsold stock, factory upkeep, marketing, R&D, brand, interest.
6. **Brand, hype, R&D, capacity** update. Viral stunts can flop (25%) and produce a news headline.
7. **Shares**: sales first (you get the share price minus 5%; every share dumped knocks 0.3% off that company's value, max 15% a round, and the panic halves each round), then buybacks (defense), then purchases in random order. More than 50 shares = control, then a cooldown. A purchase that would take control of a company with a defense fund triggers a **boardroom showdown**: sealed stakes, higher wins, tie goes to the defender, both pay.
8. **Subsidiaries** pay half their profit as dividends to shareholders.
9. **Emergency loans** cover negative cash; a company that cannot borrow more goes bankrupt (the player becomes a journalist).
10. **Valuation** and **next round's news**.

Score at the end = company value (cash − debt + factory + stores + stock + brand + earnings power + stakes in others). Controlled companies score at 75%; controllers get 10% of each subsidiary's value as a bonus. A completed **secret mission** adds €750k.

All balance numbers live in `src/engine/config.ts`. AI and Weed are derived from Chocolate's tuned market, scaled by unit cost, so balance carries over.

## Skill vs luck (`npm run analyze`, full output in `sim-report.md`)

Three kinds of bots test the balance. **Pro** bots try out candidate plans with the engine before deciding, like a player who does the maths, but without seeing the dice: rivals are assumed to repeat their last plan and every try uses a different random seed. **Smart** bots follow good rules of thumb (read the reports, buy the forecast, steer price by sell-through, open stores when they fill up, use wildcards, auctions, votes and missions). **Naive** bots repeat one fixed plan.

| Test (60 matches each, €1M start, relative market, milder news) | Result |
| --- | --- |
| Pro vs naive bot with the same positioning | Pro finishes higher 95–98% (budget, mainstream, premium), 38% (hype) |
| Pro vs smart vs naive, same lineup | Pro beats smart 82% and naive 87% of the time |
| Four identical pro players (pure luck) | Final scores differ by about 13% (std dev), down from 17% with the old news |
| All-pro field, average score per positioning | Within about 8% of each other in every industry and difficulty |

- **News is closer to TOPSIM now.** Every round has a market report with 2–3 small indicators (economy, raw material prices, one customer group buying more or less, interest, consumer confidence; ±1–8%, one round each) plus a funny story about 60% of the time. Story effects are 35% of what they used to be, so a recession nudges budget demand up ~14% instead of 40%.
- **The market is relative.** Buyers judge quality, brand and hype against the market average, and their sense of a normal price drifts 30% toward what companies actually charge.
- **Starting with €1M makes mistakes hurt.** The bank lends up to half your company value (at least €2M).
- **No exploit beats good play.** Sabotage spam, short-selling the leader, overproducing, maxing out loans, dropping marketing, overbidding at auctions and price dumping all score lower than plain good play.
- **Game end:** after the chosen number of rounds (6, 8, 10 or 12), or immediately when one company controls every other company still in business (monopoly win).
- **Board seats:** owning 25%+ of a company gets you a copy of its round report.
- **Special rounds:** Black Friday (demand +15%, bargain hunters +25%) and Investor Day (takeover premiums halved), each once per game, announced a round ahead.
- **Renaming:** whoever takes over a company can rename it (`renameCompany`); the original name is kept for the final screen.
- **Bankruptcy sales:** a bankrupt company's factory (75%), stores and a quarter of its brand go to the highest sealed bid the next round.

Quick per-industry balance check: `npm run balance` (all-pro field).

## Database (Supabase)

Migrations are in `supabase/migrations/` and are already applied to the project.

| Table | Who can read | Purpose |
| --- | --- | --- |
| `games` | Members | Code, settings, status, current round, deadline |
| `players` | Members | Names, CEO trait, host flag, `submitted_round` (ready status) |
| `game_states` | Nobody (server only) | Full engine state with everyone's secret numbers |
| `decisions` | Own only | Your decisions; writable only for the open round before the deadline |
| `round_results` | Members | Public results: news, public company info, standings |
| `player_reports` | Own only | Your detailed round report |
| `messages` | Sender and recipient | Private deal-making |

Functions: `create_game`, `join_game` (by 6-character code), `update_game_settings` (host only, lobby only). Realtime is on for `games`, `players`, `round_results` and `messages`.

Server function `game` (`supabase/functions/game`, deployed):

- `{ "action": "start", "game_id" }`: host only, in the lobby. Builds the engine state, opens round 1 with a deadline, and writes round-0 results and each player's starting report.
- `{ "action": "resolve", "game_id" }`: resolves the open round when everyone has submitted and the host skips the timer, or when the deadline has passed (any player may call it then). A claim on `games.current_round` makes sure two calls can never both resolve the same round. Players who did not submit repeat last round's decisions.
- `{ "action": "rename", "game_id", "target_id", "name" }`: whoever controls a company renames it.

The edge function loads `engine.js` from jsDelivr pinned to a commit (see the import in `index.ts`); after rebuilding `engine.js`, commit it, update that commit hash and redeploy.

The web page talks to Supabase with plain `fetch` (anonymous sign-in, REST, the `game` function) and polls every 2.5 seconds; no client library needed.

Tested end to end against the live project: create → join → settings → start → submit (spoofed submit refused) → early resolve refused → resolve with private views per player.

`engine.js` in that folder is generated: rebuild it with `npx esbuild supabase/functions/game/entry.ts --bundle --format=esm --target=es2022 --legal-comments=none --outfile=supabase/functions/game/engine.js` after changing the engine, then redeploy.

Row-level security was tested with three simulated users (host, friend, outsider): 15 out of 15 checks passed, including outsiders seeing nothing, players never seeing each other's decisions, nobody reading the secret game state, and no spoofed messages.

**Before the web app can sign players in**, turn on anonymous sign-ins: Supabase dashboard → Authentication → Sign In / Providers → Anonymous.

## Not built yet

- In-game chat and private deal messages between players (the `messages` table is ready).
- Automatic deadline resolution for daily mode (a scheduled job calling the `game` function; `pg_net` is already enabled).
- Tycoon extras beyond staff (multiple products, logistics).

## Structure

```
src/engine/   types, config (balance, industries, news), engine (resolveRound, scoring), rng
src/sim/      bots (naive, exploit habits), smart (rule-of-thumb bot), oracle (pro bot), simulate, analyze (skill vs luck), balance, diagnose
src/server/   online match logic shared by the edge function and tests (bots, per-player views)
src/web/      the game page (game.html + build script → docs/index.html)
test/         engine and server tests, page smoke tests (single-player and online)
supabase/     migrations and the game edge function
```
