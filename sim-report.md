# Friendly Takeover: skill vs luck report

80 matches per test, 8 rounds, seats rotated every match. "Pro" bots try out candidate plans with the engine before deciding (like a player who does the maths), without seeing the dice: rivals are assumed to repeat their last plan and every try uses a different random seed. "Smart" bots read their reports, steer price by sell-through, plan production and capacity, open stores when they fill up, play the endgame, and use wildcards, auctions, votes and missions. "Naive" bots repeat one fixed plan. "Sloppy" is the smart bot with ±25% random mistakes.

## 1. Does thinking beat a fixed plan?
Each match: a pro bot and a naive bot with the SAME positioning, plus two naive bots in other positions.

| Positioning | Pro avg rank | Naive avg rank | Pro beats naive twin |
|---|---|---|---|
| budget | 1.24 | 3.52 | 98% |
| mainstream | 1.14 | 2.81 | 93% |
| premium | 1.02 | 2.42 | 98% |
| hype | 1.76 | 1.52 | 44% |

## 2. All skilled players: chocolate, standard

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 53% | 1.75 | €14.02M | 0% | 0% |
| pro-mainstream | 15% | 2.85 | €12.29M | 0% | 0% |
| pro-premium | 8% | 3.06 | €11.80M | 0% | 1% |
| pro-hype | 25% | 3.24 | €11.75M | 0% | 0% |
| smart-raider | 0% | 4.10 | €10.35M | 0% | 0% |

Per match: 0.01 takeovers, 0.00 bankruptcies, 0.15 showdowns (defender won 92%), 11.0 wildcards played. Missions completed: 47%. Average auction prices: bankrupt rival's factory €0.43M, patent €0.43M, celebrity endorsement €0.20M, prime high-street location €0.25M.

## 2. All skilled players: ai, standard

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 39% | 2.00 | €14.39M | 0% | 0% |
| pro-mainstream | 14% | 2.75 | €13.16M | 0% | 0% |
| pro-premium | 19% | 2.90 | €12.85M | 0% | 1% |
| pro-hype | 28% | 3.16 | €12.76M | 0% | 1% |
| smart-raider | 1% | 4.19 | €10.91M | 0% | 0% |

Per match: 0.03 takeovers, 0.00 bankruptcies, 0.17 showdowns (defender won 86%), 11.9 wildcards played. Missions completed: 47%. Average auction prices: bankrupt rival's factory €0.43M, prime high-street location €0.25M, patent €0.41M, celebrity endorsement €0.20M.

## 2. All skilled players: weed, standard

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 46% | 1.88 | €14.81M | 0% | 0% |
| pro-mainstream | 18% | 2.49 | €13.62M | 0% | 0% |
| pro-premium | 20% | 2.66 | €13.43M | 0% | 0% |
| pro-hype | 16% | 3.91 | €11.46M | 0% | 0% |
| smart-raider | 0% | 4.06 | €10.94M | 0% | 0% |

Per match: 0.00 takeovers, 0.00 bankruptcies, 0.19 showdowns (defender won 100%), 11.1 wildcards played. Missions completed: 47%. Average auction prices: bankrupt rival's factory €0.42M, prime high-street location €0.25M, patent €0.41M, celebrity endorsement €0.21M.

## 2. All skilled players: chocolate, cutthroat

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 39% | 2.20 | €12.99M | 0% | 0% |
| pro-premium | 28% | 2.33 | €12.83M | 0% | 0% |
| pro-mainstream | 15% | 2.56 | €12.29M | 0% | 0% |
| pro-hype | 19% | 3.33 | €10.84M | 0% | 1% |
| smart-raider | 0% | 4.59 | €8.64M | 0% | 0% |

Per match: 0.01 takeovers, 0.00 bankruptcies, 0.01 showdowns (defender won 0%), 11.9 wildcards played. Missions completed: 50%. Average auction prices: patent €0.43M, prime high-street location €0.25M, bankrupt rival's factory €0.42M, celebrity endorsement €0.20M.

## 2. All skilled players: chocolate, tycoon

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-budget | 50% | 1.73 | €13.53M | 0% | 0% |
| pro-mainstream | 19% | 2.50 | €12.11M | 0% | 0% |
| pro-premium | 13% | 2.96 | €11.41M | 0% | 0% |
| pro-hype | 19% | 3.49 | €10.62M | 0% | 1% |
| smart-raider | 0% | 4.33 | €9.35M | 0% | 0% |

Per match: 0.01 takeovers, 0.00 bankruptcies, 0.13 showdowns (defender won 90%), 10.9 wildcards played. Missions completed: 46%. Average auction prices: bankrupt rival's factory €0.43M, patent €0.41M, celebrity endorsement €0.20M, prime high-street location €0.26M.

## 3. Skill ladder (same positioning, different skill)
Four mainstream companies: pro, smart, sloppy (smart with random mistakes), naive.

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-mainstream | 55% | 1.68 | €6.36M | 0% | 0% |
| smart-mainstream | 10% | 2.96 | €4.75M | 0% | 0% |
| sloppy-mainstream | 14% | 3.21 | €4.43M | 1% | 0% |
| mainstream | 21% | 2.14 | €5.82M | 0% | 0% |

Share of score differences explained by skill level: **25%** (the rest is luck: news, flops, traits, auctions, seat interactions).

## 4. Mirror match (pure luck)
Four identical pro mainstream players. Any difference is luck (traits, viral flops, news, auctions, missions).

Average score €10.53M, spread (std dev) €1.69M = 16% of the average. Matches played: 80.

## 5. How often does the better player win?

| Strategy | Win rate | Avg rank | Avg score | Bankrupt | Taken over |
|---|---|---|---|---|---|
| pro-mainstream | 46% | 1.98 | €8.22M | 0% | 0% |
| pro-premium | 41% | 2.23 | €8.11M | 0% | 0% |
| smart-mainstream | 11% | 3.39 | €6.86M | 0% | 0% |
| mainstream | 1% | 3.60 | €6.75M | 0% | 0% |
| premium | 0% | 3.81 | €6.64M | 0% | 0% |

Pro beats smart: 76%. Pro beats naive (mainstream): 85%. Pro beats naive (premium): 79%.

## 6. Exploit hunt
Each habit plays one seat against pro budget, premium and hype bots. Compare with the pro and smart mainstream bots in the same seat.

| Habit | Win rate | Avg rank | Avg score | Bankrupt |
|---|---|---|---|---|
| pro-mainstream | 23% | 2.48 | €14.20M | 0% |
| smart-mainstream | 6% | 3.10 | €10.13M | 0% |
| plain-mainstream | 1% | 3.34 | €9.97M | 0% |
| shortseller | 1% | 3.67 | €8.60M | 0% |
| spammer | 3% | 3.29 | €9.15M | 0% |
| hoarder | 0% | 3.52 | €10.17M | 0% |
| loanshark | 0% | 3.90 | €6.04M | 0% |
| nomarketing | 0% | 3.92 | €7.82M | 0% |
| overbidder | 0% | 3.65 | €8.17M | 0% |
| dumper | 0% | 4.00 | €1.56M | 0% |
| raider | 0% | 3.55 | €9.93M | 0% |
| smart-raider | 0% | 3.30 | €10.64M | 0% |

_Generated in 876s._
