# Friendly Takeover

Multiplayer business game for friend groups: everyone runs a company in the same market, competes round by round, and can buy each other out.

This repository holds the game engine, a bot simulator to test balance, the playable game (single-player against bots, and online multiplayer with friends), and the Supabase backend (database plus the `game` server function).

## Play it

The whole game is one HTML file. Open `index.html` in a browser, or play the hosted version on GitHub Pages (repo Settings → Pages → Deploy from a branch → `main`; folder `/ (root)` or `/docs` both work): `https://jeroen-hui.github.io/Friendly-Takeover/`.

**Single-player:** New game, against bots. Your game saves in your browser.

**Online with friends:** Multiplayer → Create a game. You get a 6-character code and an invite link (`…/Friendly-Takeover/?join=CODE`). Friends choose Multiplayer → Join (or open the link). The host picks industry, difficulty, rounds, time per round and up to 4 bots, then starts. Everyone plans their round on their own screen and submits; the host can skip the timer once everyone is ready, otherwise the round closes when time runs out (players who didn't submit repeat last round's plan). Rivals' secret numbers stay on the server. If you close the tab, Multiplayer → Rejoin brings you back.

Online play needs the hosted page (GitHub Pages) or the local file with internet access; it does not work inside the Claude artifact preview.

**Talk & deals (Chat button):** chat with the whole table or one player, and make private deals that the game enforces when the round resolves:
- **Shares:** sell or buy shares (your own founder shares or stakes you hold) for an agreed total price. Can hand over control: a takeover by handshake.
- **Loans:** lend or borrow; the repayment happens automatically 1–3 rounds later and counts in both company values meanwhile.
- **Non-attack pacts:** 1–4 rounds of no share buying and no targeted wildcards between two companies. Whoever breaks it pays the agreed penalty to the other, and the news calls it a betrayal.

In single-player the bots answer your offers (good offers get a yes) and now and then pitch you one. **Emoji reactions** float over the results and boardroom scenes (online, everyone sees them).

**Seasons:** after an online game, "Start a rematch" opens a new lobby in the same league; the final screen shows the season table (10/7/5/3/2/1 points per game).

**First game:** a short guided first round walks you through a real forecast with the calculator. The final screen has a "Your story" recap you can save as a picture, and a quick rating for playtest feedback.

**Accounts and friends:** everyone gets a guest profile automatically (name + 6-character friend code). Profile → "Save with email" turns it into a real account that works on every device (log in with an emailed link). Friends: add by code or share your invite link (`…/?friend=CODE`); in a lobby, tap Invite next to a friend and they get the invite on their main menu (codes and links still work too).

**Achievements:** 21 badges (wins, takeovers, handshake deals, investor calls, missions, betrayals, dailies, friends…), earned at the end of a game and saved to your account (and on the device when offline).

**Daily challenge:** the same market, rivals (4 hard bots) and starting news for everyone each day (chocolate or AI, 6 rounds). One scored try per day; practice runs after that don't count. **Leaderboards:** today's daily (everyone or friends) and all-time (wins, achievements, best daily).

**Live market (from round 3):** a stock exchange is open during the round. Buy or sell rivals' shares right away (up to 30 a round and 50% of a company; every share moves the price 0.5%, 2% fee); everyone sees the trades on the ticker. Taking control past 50% still goes through an end-of-round takeover bid. **Live auctions:** the boardroom auction and bankruptcy sales are open bidding: every bid restarts a 45-second hammer ("going once… going twice… sold!"), and the winner pays when the round closes. In single-player the bots trade and bid too.

**Raw materials, bought a round ahead:** you buy materials now at today's price index for next round's production. The news carries an outlook ("analysts expect prices to RISE/FALL…", right about 3 times out of 4). Stocked up before a rise: you're safe. Stocked up before a fall: you paid too much. Anything you run short of is bought on the spot market at the price then +15%; leftover materials cost 2% a round to hold.

**Bulk buyer:** a discount chain takes your leftover stock after the market at 40–55% of the average price (up to half your capacity). Cheap, but it empties the warehouse.

**Party mode (TV screen):** in the lobby, the Party mode card gives a secret TV link (`…/?tv=…`). Put it on the TV: it shows the join code, a skyline of company values, the round timer, who's ready, the live auction and exchange ticker, headlines, table talk and reactions, and a results show after every round, while everyone plays on their phone.

**Rounds close on their own:** a scheduled job checks every minute and closes any round whose time is up, even if nobody has the game open.

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
5. **Accounting**: revenue, production cost, holding cost on unsold stock, factory upkeep, idle machines, marketing, R&D, brand, interest. Then the **investor call**: if you gave guidance, it's compared with what happened.
6. **Brand, hype, R&D, capacity** update. Viral stunts can flop (25%) and produce a news headline.
7. **Shares**: sales first (you get the share price minus 5%; every share dumped knocks 0.3% off that company's value, max 15% a round, and the panic halves each round), then buybacks (defense), then purchases in random order. More than 50 shares = control, then a cooldown. A purchase that would take control of a company with a defense fund triggers a **boardroom showdown**: sealed stakes, higher wins, tie goes to the defender, both pay.
8. **Subsidiaries** pay half their profit as dividends to shareholders.
9. **Emergency loans** cover negative cash; a company that cannot borrow more goes bankrupt (the player becomes a journalist).
10. **Valuation** and **next round's news**.

Score at the end = company value (cash − debt + factory + stores + stock + brand + earnings power + stakes in others). Controlled companies score at 75%; controllers get 10% of each subsidiary's value as a bonus. A completed **secret mission** adds €750k.

### Hidden mechanics (find them in the numbers)

Like TOPSIM, the game doesn't forecast for you. The Production tab shows your factory's limits, not the demand; the free market report shows totals only.

- **Experience curve:** every doubling of your total production saves about 8% of the basic process cost per unit (the same euro amount at every quality, so it rewards volume rather than premium).
- **Factory load:** units above 90% of capacity run in overtime (+25%); capacity left idle below 60% costs money.
- **Raw material price index:** moves around 1.00 (0.70–1.45) with a trend the news hints at a round ahead. Material is 45% of the standard unit cost; you buy it a round ahead (spot purchases +15%).
- **Buyer-group trends:** each game one group slowly grows (+1.5–3% a round), one shrinks, the others drift. Never announced; visible in market studies and sales history.
- **Price sensitivity per game:** each buyer group is 85–115% as price-sensitive as usual. Inferable from price and sales changes, or bought via the Buyer panel.
- **Investor call:** optional guidance on units sold and profit. Within 10% (units) and 15% (profit) = trust +1; more than 25% / 40% off = trust −1 (range −2..+3). Each trust point moves company value 3% and interest 0.4 points.
- **Research:** Competitor spending (€60k), Customer survey (€30k), Insider tip (€50k), Market study (€40k, per-group market size and next round's outlook), Buyer panel (€35k).

The game page has a **Calc** desk: a calculator (keyboard, memory, tape; click any number in a table to paste it) and notes per game.

All balance numbers live in `src/engine/config.ts`. AI and Weed are derived from Chocolate's tuned market, scaled by unit cost, so balance carries over.

## Skill vs luck (`npm run analyze`, full output in `sim-report.md`)

Three kinds of bots test the balance. **Pro** bots try out candidate plans with the engine before deciding, like a player who does the maths, but without seeing the dice: rivals are assumed to repeat their last plan and every try uses a different random seed. **Smart** bots follow good rules of thumb (read the reports, buy the forecast, steer price by sell-through, open stores when they fill up, use wildcards, auctions, votes and missions). **Naive** bots repeat one fixed plan.

| Test (80 matches each, €1M start, relative market, hidden mechanics, investor call) | Result |
| --- | --- |
| Pro vs naive bot with the same positioning | Pro finishes higher 98% (budget), 93% (mainstream), 98% (premium), 44% (hype) |
| Pro vs smart vs naive, same lineup | Pro beats smart 76% and naive 85% of the time |
| Four mainstream bots of different skill | Pro wins 55% (was 49%); skill explains 25% of score differences (was 21%) |
| Four identical pro players (pure luck) | Final scores differ by about 16% (std dev), up from 13%: trends and material prices add some uncertainty |
| Exploit hunt | No habit beats plain good play: best exploit (hoarding) scores like the smart bot, far below the pro |

- **News is closer to TOPSIM now.** Every round has a market report with 2–3 small indicators (economy, raw material prices, one customer group buying more or less, interest, consumer confidence; ±1–8%, one round each) plus a funny story about 60% of the time. Story effects are 35% of what they used to be, so a recession nudges budget demand up ~14% instead of 40%.
- **The market is relative.** Buyers judge quality, brand and hype against the market average, and their sense of a normal price drifts 30% toward what companies actually charge.
- **Starting with €1M makes mistakes hurt.** The bank lends up to half your company value (at least €2M).
- **No exploit beats good play.** Sabotage spam, short-selling the leader, overproducing, maxing out loans, dropping marketing, overbidding at auctions and price dumping all score lower than plain good play.
- **Game end:** after the chosen number of rounds (6, 8, 10 or 12), or immediately when one company controls every other company still in business (monopoly win).
- **Board seats:** owning 25%+ of a company gets you a copy of its round report.
- **Special rounds:** Black Friday (demand +15%, bargain hunters +25%) and Investor Day (takeover premiums halved), each once per game, announced a round ahead.
- **Renaming:** whoever takes over a company can rename it (`renameCompany`); the original name is kept for the final screen.
- **Bankruptcy sales:** a bankrupt company's factory (75%), stores and a quarter of its brand go to the highest sealed bid the next round.

Quick per-industry balance check: `npm run balance` (all-pro field). Try rule changes without editing code: `npx tsx src/sim/experiment.ts 24 ai '{"COSTS":{"overtimePremium":0}}'`.

All-pro win rates (60 matches per industry, with materials and the bulk buyer): chocolate 23–28%, AI 20–32%, weed 18–30% for every positioning; average scores within 10% (chocolate), 9% (AI) and 12% (weed). AI and weed use slightly different buyer-group sizes (AI: premium 14%, hype 17%; weed: premium 14.5%, hype 16%), because their faster growth and their news favoured premium or hype. Before the hidden mechanics, budget won only 2–5% and premium 38–50%.

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
- `{ "action": "trade", "game_id", "target_id", "qty" }`: live stock exchange, buy (qty > 0) or sell (qty < 0) right now.
- `{ "action": "bid", "game_id", "lot", "amount" }`: live auction bid (`"auction"` or a bankrupt company's id). Trades and bids use an optimistic update on `game_states.updated_at` so simultaneous ones never overwrite each other, and write the public live market to `market_live`.
- `{ "action": "tick" }` with header `x-tick-secret`: closes every overdue round. Called every minute by the `ft-close-overdue-rounds` pg_cron job; the secret lives in Vault (`ft_tick_secret`) and is checked with `tick_secret_ok`.

Accepted deals (`deals` table, offered by insert, answered with `respond_deal`, withdrawn with `cancel_deal`) are passed to the engine when the round resolves and marked done or failed with the reason. Chat is in `messages` (to everyone when `to_player_id` is null; `kind` = chat or reaction). Seasons: `games.league_id`, `league_table`, `league_lobby`. Playtest ratings go to `feedback` (insert-only). Live market: `market_live` (members read). Party mode: `games.tv_code` and `tv_snapshot(game_id, tv_code)`, readable without logging in, only with the secret code.

Accounts: `profiles` (name, friend code, stats), `friendships`, `game_invites`, `achievements`, `daily_scores`, all behind functions (`ensure_profile`, `add_friend`, `respond_friend`, `remove_friend`, `my_friends`, `invite_friend`, `my_invites`, `answer_invite`, `lobby_invites`, `record_result`, `grant_achievements`, `submit_daily`, `daily_board`, `alltime_board`). Email login uses Supabase Auth: a guest account is upgraded with `PUT /auth/v1/user {email}`, other devices log in with `POST /auth/v1/otp`. For the email links to come back to the game, set Authentication → URL Configuration → Site URL to the GitHub Pages address and add it under Redirect URLs.

The edge function loads `engine.js` from jsDelivr pinned to a commit (see the import in `index.ts`); after rebuilding `engine.js`, commit it, update that commit hash and redeploy.

The web page talks to Supabase with plain `fetch` (anonymous sign-in, REST, the `game` function) and polls every 2.5 seconds; no client library needed.

Tested end to end against the live project: create → join → settings → start → submit (spoofed submit refused) → early resolve refused → resolve with private views per player; live trade and bid sent at the same moment (both kept), TV snapshot (wrong code gets nothing), and the round report with exchange cash and materials.

`engine.js` in that folder is generated: rebuild it with `npx esbuild supabase/functions/game/entry.ts --bundle --format=esm --target=es2022 --legal-comments=none --outfile=supabase/functions/game/engine.js` after changing the engine, then redeploy.

Row-level security was tested with three simulated users (host, friend, outsider): 15 out of 15 checks passed, including outsiders seeing nothing, players never seeing each other's decisions, nobody reading the secret game state, and no spoofed messages.

**Before the web app can sign players in**, turn on anonymous sign-ins: Supabase dashboard → Authentication → Sign In / Providers → Anonymous.

## Not built yet

- Payments and a desktop build for Steam.
- Server-side checking of daily scores (the game runs in the browser, so a determined cheater could fake one).
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
