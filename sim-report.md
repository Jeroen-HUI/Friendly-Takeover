# Friendly Takeover: skill vs luck report

60 matches per test, 8 rounds, seats rotated every match. "Pro" bots try out candidate plans with the engine before deciding (like a player who does the maths), without seeing the dice: rivals are assumed to repeat their last plan and every try uses a different random seed. "Smart" bots read their reports, steer price by sell-through, plan production and capacity, open stores when they fill up, play the endgame, and use wildcards, auctions, votes and missions. "Naive" bots repeat one fixed plan. "Sloppy" is the smart bot with ±25% random mistakes.

## 1. Does thinking beat a fixed plan?
Each match: a pro bot and a naive bot with the SAME positioning, plus two naive bots in other positions.

| Positioning | Pro avg rank | Naive avg rank | Pro beats naive twin |
|---|---|---|---|
| budget | 1.35 | 3.77 | 95% |
| mainstream | 1.15 | 2.57 | 95% |
| premium | 1.02 | 2.18 | 98% |
| hype | 1.70 | 1.43 | 38% |

## 2. All skilled players: chocolate, standard

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 33% | 2.08 | €12.06M | 0% | 0% |
| pro-premium | 25% | 2.53 | €11.34M | 0% | 0% |
| pro-mainstream | 15% | 2.87 | €11.26M | 0% | 0% |
| pro-hype | 27% | 3.52 | €10.66M | 0% | 2% |
| smart-raider | 0% | 4.00 | €9.87M | 0% | 0% |

Per match: 0.02 takeovers, 0.00 bankruptcies, 0.20 showdowns (defender won 92%), 12.3 wildcards played. Missions completed: 47%. Average auction prices: celebrity endorsement €0.20M, prime high-street location €0.25M, bankrupt rival's factory €0.43M, patent €0.43M.

## 2. All skilled players: ai, standard

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 20% | 2.35 | €12.36M | 0% | 0% |
| pro-hype | 28% | 2.98 | €12.30M | 0% | 0% |
| pro-premium | 23% | 2.78 | €12.17M | 0% | 0% |
| pro-mainstream | 28% | 2.78 | €12.02M | 0% | 0% |
| smart-raider | 0% | 4.10 | €10.49M | 0% | 0% |

Per match: 0.00 takeovers, 0.00 bankruptcies, 0.13 showdowns (defender won 100%), 12.7 wildcards played. Missions completed: 47%. Average auction prices: bankrupt rival's factory €0.43M, celebrity endorsement €0.21M, patent €0.42M, prime high-street location €0.25M.

## 2. All skilled players: weed, standard

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-hype | 40% | 2.97 | €12.65M | 0% | 0% |
| pro-budget | 17% | 2.32 | €12.52M | 0% | 0% |
| pro-premium | 20% | 2.67 | €12.25M | 0% | 2% |
| pro-mainstream | 23% | 2.92 | €12.15M | 0% | 0% |
| smart-raider | 0% | 4.13 | €10.35M | 0% | 0% |

Per match: 0.02 takeovers, 0.00 bankruptcies, 0.12 showdowns (defender won 86%), 11.4 wildcards played. Missions completed: 47%. Average auction prices: celebrity endorsement €0.20M, prime high-street location €0.26M, bankrupt rival's factory €0.43M, patent €0.42M.

## 2. All skilled players: chocolate, cutthroat

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-premium | 33% | 2.15 | €12.63M | 0% | 0% |
| pro-budget | 13% | 2.67 | €11.54M | 0% | 0% |
| pro-mainstream | 18% | 2.62 | €11.39M | 0% | 0% |
| pro-hype | 35% | 2.85 | €11.20M | 0% | 0% |
| smart-raider | 0% | 4.72 | €8.15M | 0% | 0% |

Per match: 0.00 takeovers, 0.00 bankruptcies, 0.03 showdowns (defender won 100%), 12.1 wildcards played. Missions completed: 50%. Average auction prices: celebrity endorsement €0.20M, prime high-street location €0.25M, patent €0.42M, bankrupt rival's factory €0.43M.

## 2. All skilled players: chocolate, tycoon

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 25% | 2.18 | €11.73M | 0% | 0% |
| pro-mainstream | 28% | 2.67 | €11.15M | 0% | 0% |
| pro-premium | 20% | 2.73 | €10.96M | 0% | 0% |
| pro-hype | 25% | 3.43 | €10.38M | 0% | 2% |
| smart-raider | 2% | 3.98 | €9.54M | 0% | 0% |

Per match: 0.02 takeovers, 0.00 bankruptcies, 0.27 showdowns (defender won 94%), 12.3 wildcards played. Missions completed: 48%. Average auction prices: celebrity endorsement €0.20M, prime high-street location €0.25M, bankrupt rival's factory €0.43M, patent €0.42M.

## 3. Skill ladder (same positioning, different skill)
Four mainstream companies: pro, smart, sloppy (smart with random mistakes), naive.

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-mainstream | 49% | 1.75 | €5.94M | 0% | 0% |
| smart-mainstream | 13% | 2.95 | €4.43M | 0% | 0% |
| sloppy-mainstream | 18% | 3.09 | €4.26M | 0% | 0% |
| mainstream | 21% | 2.21 | €5.40M | 0% | 0% |

Share of score differences explained by skill level: **21%** (the rest is luck: news, flops, traits, auctions, seat interactions).

## 4. Mirror match (pure luck)
Four identical pro mainstream players. Any difference is luck (traits, viral flops, news, auctions, missions).

Average score €10.18M, spread (std dev) €1.36M = 13% of the average. Matches played: 60.

## 5. How often does the better player win?

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-premium | 48% | 1.93 | €7.80M | 0% | 0% |
| pro-mainstream | 37% | 2.10 | €7.51M | 0% | 0% |
| premium | 7% | 3.33 | €6.37M | 0% | 0% |
| mainstream | 0% | 3.77 | €6.10M | 0% | 0% |
| smart-mainstream | 8% | 3.87 | €5.90M | 0% | 0% |

Pro beats smart: 82%. Pro beats naive (mainstream): 87%. Pro beats naive (premium): 80%.

## 6. Exploit hunt
Each habit plays one seat against pro budget, premium and hype bots. Compare with the pro and smart mainstream bots in the same seat.

| Habit | Win rate | Avg rank | Avg score | Bankrupt |
|---|---|---|---|---|
| pro-mainstream | 18% | 2.25 | €13.17M | 0% |
| smart-mainstream | 0% | 3.65 | €8.41M | 0% |
| plain-mainstream | 2% | 3.48 | €8.78M | 0% |
| shortseller | 0% | 3.82 | €7.77M | 0% |
| spammer | 2% | 3.55 | €8.30M | 0% |
| hoarder | 7% | 3.32 | €9.95M | 0% |
| loanshark | 0% | 3.98 | €5.50M | 0% |
| nomarketing | 0% | 3.90 | €7.84M | 0% |
| overbidder | 0% | 3.83 | €7.35M | 0% |
| dumper | 0% | 4.00 | €1.10M | 0% |
| raider | 0% | 3.57 | €9.28M | 0% |
| smart-raider | 3% | 3.53 | €9.39M | 0% |

_Generated in 477s._
