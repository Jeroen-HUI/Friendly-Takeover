// Builds the static search pages in docs/ (landing pages, the how-to-play guide and the business stories)
// and docs/sitemap.xml. The game itself (docs/index.html) is built by scripts/build-web.mjs and is not touched here.
// Run: node scripts/build-pages.mjs
import { writeFileSync, mkdirSync } from "node:fs";
const SITE = "https://friendlytakeovers.com";
const TODAY = new Date().toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#0f1530;color:#f1e7d2;font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#ffb35a}a:hover{color:#ffd09a}
.wrap{max-width:780px;margin:0 auto;padding:0 20px}
header{border-bottom:2px solid #26306a;background:#0b1026}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;padding-bottom:14px}
.brand{font-weight:900;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:#f6ead2;font-size:15px;line-height:1.15}
.brand span{color:#f3902f}
.btn{display:inline-block;background:#3fbf6a;color:#06210f;font-weight:900;text-decoration:none;border-radius:10px;padding:10px 18px;border-bottom:4px solid #23874a;letter-spacing:.03em}
.btn:hover{color:#06210f;background:#55d480}
.btn.big{font-size:21px;padding:16px 30px;border-radius:14px}
.crumb{font-size:14px;color:#a9b0d6;margin:26px 0 0}.crumb a{color:#a9b0d6}
h1{font-size:clamp(30px,5.4vw,44px);line-height:1.12;margin:14px 0 14px;color:#fff6e2;letter-spacing:-.01em}
h2{font-size:25px;line-height:1.25;margin:44px 0 10px;color:#fff6e2}
h3{font-size:19px;margin:26px 0 4px;color:#ffd9a6}
.lead{font-size:20px;color:#d9dcf2}
.cta{margin:26px 0 8px}.cta small{display:block;margin-top:10px;color:#a9b0d6;font-size:14.5px}
figure{margin:30px 0}figure img{display:block;width:100%;height:auto;border-radius:12px;border:2px solid #26306a}
figcaption{font-size:14px;color:#a9b0d6;margin-top:8px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:26px 0;padding:0;list-style:none}
.facts li{background:#161d44;border:2px solid #26306a;border-radius:12px;padding:14px 16px}
.facts b{display:block;font-size:21px;color:#ffb35a;line-height:1.2}.facts span{font-size:14.5px;color:#c4c9e6}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:16px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #26306a;vertical-align:top}th{color:#ffd9a6}
.tw{overflow-x:auto}
.box{background:#161d44;border:2px solid #26306a;border-radius:12px;padding:18px 20px;margin:26px 0}
.box h2,.box h3{margin-top:0}
.src{font-size:14.5px;color:#a9b0d6}
.end{background:#161d44;border-top:2px solid #26306a;margin-top:60px;padding:40px 0;text-align:center}
.end h2{margin-top:0}
footer{background:#0b1026;padding:34px 0 46px;font-size:14.5px;color:#a9b0d6}
footer .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:22px}
footer b{display:block;color:#f1e7d2;margin-bottom:6px}footer a{display:block;color:#c4c9e6;text-decoration:none;padding:2px 0}footer a:hover{color:#ffb35a}
footer p{margin:26px 0 0}`;

const PLAY = (label = "▶ Play now") => `<div class="cta"><a class="btn big" href="/">${label}</a><small>Free against bots · no download · no sign-up · your first online game with friends is free</small></div>`;
const FACTS = `<ul class="facts"><li><b>1 to 8 players</b><span>solo against bots, or online with friends</span></li><li><b>No download</b><span>runs in the browser on a laptop or a phone</span></li><li><b>Free to try</b><span>solo is free, and so is your first online game</span></li><li><b>€8.99 once</b><span>for the full game: unlimited online games, no subscription</span></li></ul>`;
const IMG = (file, alt, cap) => `<figure><img src="/img/${file}" width="1280" height="800" loading="lazy" alt="${esc(alt)}"><figcaption>${cap}</figcaption></figure>`;
const faq = (items) => ({ html: `<h2>Questions people ask</h2>` + items.map(([q, a]) => `<h3>${q}</h3><p>${a}</p>`).join(""), ld: { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") } })) } });

const PRICE_Q = ["Is Friendly Takeovers free?", "Playing solo against bots is free, and so is your first online game with friends. After that the full game is a one-time purchase of €8.99, with unlimited online games. There is no subscription and there are no in-game purchases."];
const DL_Q = ["Do we need to download or install anything?", "No. The game runs in the browser on a laptop, tablet or phone. One person creates a game and shares a 6-character code or an invite link; everyone else opens the link."];
const N_Q = ["How many people can play?", "Up to 8 players in one game. If you are short of people, the host can add up to 4 computer-run companies, and you can play alone against bots."];

// ---------------------------------------------------------------- landing pages and the guide
const PAGES = [
{ slug: "games-to-play-with-friends", nav: "Browser games to play with friends",
  title: "A browser game to play with friends online, no download | Friendly Takeovers",
  desc: "Looking for an online game to play with friends without downloading anything? Friendly Takeovers is a business game for up to 8 players: share a link and try to buy each other out. Free to try.",
  h1: "A browser game to play with friends, no download",
  lead: "Friendly Takeovers is a business game for friend groups. Everyone runs a company in the same market, and the fastest way to win is to buy your friends' companies out from under them.",
  body: () => { const f = faq([DL_Q, N_Q, PRICE_Q, ["Does it work on a phone?", "Yes. Everyone can play on their own phone. There is also a party mode: put the TV link on a big screen and it shows the skyline, the round timer, the news and the results show while everyone plays on their phone."], ["Can we play if we are not in the same room?", "Yes. Games are online, with a built-in chat for the whole table and for private one-on-one deals, so it works over a voice call just as well as on the couch."]]);
    return { ld: f.ld, html: `${PLAY()}${FACTS}
<h2>How a game night works</h2>
<p>One person opens the game, picks Multiplayer and creates a game. They get a 6-character code and an invite link to drop in the group chat. Everyone who opens the link gets a company: same starting cash, same factory, same market.</p>
<p>Then you play in rounds. Each round everybody secretly sets a price, decides how much to produce, and spends on quality, marketing and research. When the timer runs out, all the decisions are resolved together and the results show plays: who sold out, who is stuck with a full warehouse, whose company is suddenly worth the most.</p>
${IMG("news.jpg", "A breaking news broadcast in Friendly Takeovers: aliens want cheap chocolate, so the cheapest company sells more this round", "Every round starts with news that changes the market for everyone.")}
<h2>Why it works with a group</h2>
<p><b>Everyone is in the same market.</b> If your friend drops their price, your customers walk over to them. Nobody plays their own little game on the side.</p>
<p><b>You can buy each other.</b> From round 3 a stock exchange opens. Buy enough shares in a friend's company and you take control of it. They can see you coming on the ticker, which is where the shouting usually starts.</p>
<p><b>Deals are real.</b> In the chat you can offer shares, loans and non-attack pacts, to the whole table or in private. The game enforces whatever you agree, and if someone breaks a pact, the news calls it a betrayal in front of everyone.</p>
<p><b>There is a secret mission.</b> Each player gets a private goal worth a bonus on the final score, so nobody is quite sure what the others are up to until the last screen.</p>
${IMG("mission.jpg", "A top secret mission card in Friendly Takeovers: finish with no debt and more than 2 million in cash", "Every player gets a secret mission. Rivals only see it on the final screen.")}
<h2>How long does it take?</h2>
<p>The host chooses the number of rounds and the time per round. The Blitz preset is five rounds of two and a half minutes, which fits in a lunch break. A standard game is eight rounds, and the host can set anything from 3 rounds to an open-ended game.</p>
${f.html}` }; } },

{ slug: "business-simulation-game", nav: "Multiplayer business simulation game",
  title: "Multiplayer business simulation game: a tycoon game with friends | Friendly Takeovers",
  desc: "A multiplayer business simulation in your browser. Set prices, run a factory, read the market and take over rival companies. Up to 8 players, or solo against bots. Free to try.",
  h1: "A multiplayer business simulation you can play tonight",
  lead: "Most tycoon games are you against a spreadsheet. In Friendly Takeovers the other companies are run by your friends, they are fighting for the same customers, and any of them can buy you.",
  body: () => { const f = faq([["Is this a serious simulation or a party game?", "Both, on purpose. The market model is a real one: price, quality, brand and availability decide who sells what, and nobody tells you how much you will sell. The wrapping is a party game with news broadcasts, a results show and takeovers."], N_Q, PRICE_Q, DL_Q, ["Can I play alone?", "Yes. Solo against bots is free, with easy, normal and hard bots, and there is a daily challenge where everyone gets the same market and rivals and competes on one leaderboard."]]);
    return { ld: f.ld, html: `${PLAY()}${FACTS}
<h2>What you actually decide</h2>
<div class="tw"><table><tr><th>Area</th><th>Your decisions</th></tr>
<tr><td>Production</td><td>Price, how many units to make, and at what quality. Run the factory too full and you pay overtime; too empty and idle machines cost you.</td></tr>
<tr><td>Raw materials</td><td>Bought a round ahead at today's price. The news gives an outlook on where prices are going, and it is right about three times out of four.</td></tr>
<tr><td>R&amp;D</td><td>Research unlocks higher quality levels, up to quality 8.</td></tr>
<tr><td>Marketing</td><td>Campaigns for this round, brand for the long run.</td></tr>
<tr><td>Retail</td><td>Open your own stores from round 3.</td></tr>
<tr><td>Finance</td><td>Loans, dividends, and an investor call where you forecast your own sales and profit. Forecast well and investors trust you more.</td></tr>
<tr><td>Takeovers</td><td>A live stock exchange from round 3. Buy and sell shares in rivals, launch a takeover bid, or defend against one.</td></tr>
<tr><td>Boardroom</td><td>Wildcards, auctions, board votes and your secret mission.</td></tr></table></div>
${IMG("menu.jpg", "The Friendly Takeovers main menu: a pixel-art city skyline at night with one building per company", "Every company is a building in the skyline. Taller means worth more.")}
<h2>The maths is yours</h2>
<p>The game gives you a market report, your own profit and loss, your balance sheet and what your rivals did last round. It does not give you the answer. There is a calculator and a notepad in the top bar, and the people who use them tend to win.</p>
<p>Some things never show up in a headline: buyer groups slowly grow or shrink, buyers are more price-sensitive in one game than the next, and experience makes your production cheaper over time. It is all in the numbers for whoever looks.</p>
<h2>How you win</h2>
<p>The company worth the most at the end wins. Company value is cash minus debt, plus factory, stores, stock, brand, earnings power and the shares you hold in rivals. There is one shortcut: take control of every other company and the game ends on the spot. That is a monopoly.</p>
<h2>Three industries</h2>
<p>Each industry has its own costs, buyers and news stories. Chocolate is the classic consumer market and the best place to start. In AI you sell subscriptions and run servers in a faster-growing market, with its own set of news stories.</p>
${f.html}` }; } },

{ slug: "games-like-monopoly-online", nav: "Games like Monopoly to play online",
  title: "Games like Monopoly to play online with friends | Friendly Takeovers",
  desc: "Want a game like Monopoly to play online with friends, but with less dice and more scheming? Friendly Takeovers lets up to 8 players run companies and buy each other out. Free to try in the browser.",
  h1: "Like Monopoly online with friends, minus the dice",
  lead: "If what you like about Monopoly is getting rich, making deals and ruining a friendship or two, Friendly Takeovers keeps all of that and drops the parts where you just roll and wait.",
  body: () => { const f = faq([["Is this an official Monopoly game?", "No. Friendly Takeovers is an independent game and is not affiliated with Hasbro or the Monopoly brand. It is a different game for people who like the same things: money, deals and takeovers."], N_Q, DL_Q, PRICE_Q]);
    return { ld: f.ld, html: `${PLAY()}
<h2>What is the same, and what is different</h2>
<div class="tw"><table><tr><th></th><th>Classic property board game</th><th>Friendly Takeovers</th></tr>
<tr><td>Luck</td><td>Dice decide where you land</td><td>No dice. Everyone gets the same news and the same market; your decisions do the rest</td></tr>
<tr><td>Turns</td><td>One player at a time</td><td>Everyone plays every round at the same time, so nobody waits</td></tr>
<tr><td>Deals</td><td>Trade properties</td><td>Sell shares, lend money, sign non-attack pacts, merge companies. The game enforces every deal</td></tr>
<tr><td>Knocking someone out</td><td>They go bankrupt and leave the table</td><td>You buy control of their company on the stock exchange, or agree a friendly merger</td></tr>
<tr><td>Length</td><td>Until someone gives up</td><td>A fixed number of rounds the host picks, from a five-round Blitz upwards</td></tr>
<tr><td>Players</td><td>Around a board</td><td>Up to 8 online, each on their own phone or laptop</td></tr></table></div>
<h2>You can still win by monopoly</h2>
<p>The normal way to win is to own the most valuable company when the last round ends. The other way is to take control of every rival company. The moment you do, the game is over and you have a monopoly.</p>
${IMG("mission.jpg", "A top secret mission card in Friendly Takeovers", "Everyone also gets a secret mission worth a bonus at the end.")}
<h2>Made for the table talk</h2>
<p>The best part of any money game is the negotiating. Friendly Takeovers has a chat for the whole table and private chats per player, and deals you can actually sign: shares for cash, a loan that is repaid automatically a few rounds later, or a pact not to attack each other. Break a pact and you pay the penalty, and the news announces the betrayal to the whole table.</p>
${FACTS}${f.html}` }; } },

{ slug: "business-game-for-students", nav: "Business game for students and classes",
  title: "A business simulation game for students and classrooms | Friendly Takeovers",
  desc: "A business simulation game students can play in the browser: pricing, production, finance and competition in one shared market, with up to 8 players per game. Free to try, no installation.",
  h1: "A business simulation game for students",
  lead: "Friendly Takeovers was built by a business student who did a simulation in class and wanted a version his friends would play voluntarily. Same kind of decisions, in rounds, in one shared market, with a lot more at stake socially.",
  body: () => { const f = faq([["Is this a replacement for TOPSIM or another course simulation?", "No. It is a game, not a graded course tool, and it is not affiliated with TOPSIM or any other simulation provider. It covers the same kind of decisions in a lighter form, which makes it useful as a warm-up, an icebreaker or practice outside class."], ["How many students can play at once?", "Up to 8 companies per game, and you can run as many games side by side as you like. Students can also play in teams, with one team sharing a company on one screen."], ["Does it need installing on school computers?", "No. It runs in the browser on laptops, tablets and phones. Students join with a 6-character code or a link."], ["Do students need an account?", "Playing against bots needs no account at all. Online games use a guest profile or a free account with an email address."], PRICE_Q]);
    return { ld: f.ld, html: `${PLAY("▶ Try a round")}
<h2>What students practise</h2>
<div class="tw"><table><tr><th>Topic</th><th>In the game</th></tr>
<tr><td>Pricing and demand</td><td>Set a price in a market where buyer groups differ in how much they care about price, quality and brand.</td></tr>
<tr><td>Capacity planning</td><td>Decide production volume; overtime and idle capacity both cost money.</td></tr>
<tr><td>Purchasing</td><td>Buy raw materials a round ahead, with a price outlook that is usually but not always right.</td></tr>
<tr><td>Reading reports</td><td>Profit and loss, cash flow, balance sheet and cost per unit, every round.</td></tr>
<tr><td>Forecasting</td><td>An investor call each round: forecast sales and profit, and get rewarded for accuracy.</td></tr>
<tr><td>Finance</td><td>Credit lines, interest, dividends and what they do to company value.</td></tr>
<tr><td>Corporate control</td><td>Shares, takeover bids, friendly mergers and board votes weighted by shareholding.</td></tr></table></div>
<p>As in a course simulation, nobody tells you how much you will sell. There is a market report, a calculator and a notepad. The rest is up to the team.</p>
${IMG("news.jpg", "A breaking news broadcast in Friendly Takeovers: the cheapest company sells more this round", "Each round opens with news that shifts demand, costs or interest rates.")}
<h2>Fits in a lesson</h2>
<p>The host chooses the number of rounds and the minutes per round. A Blitz game is five rounds of two and a half minutes, short enough to play and discuss in one session. Longer set-ups work for a project week. A guided first round walks new players through a real forecast.</p>
<h2>For teachers</h2>
<p>You can try the whole thing alone against bots first, for free. The host can switch individual mechanics on or off, such as takeovers, mergers, dividends and auctions, and give players handicaps. If you would like to use it with a class and have questions, the contact address is in the game under Terms.</p>
${FACTS}${f.html}` }; } },

{ slug: "discord-games-with-friends", nav: "Games to play on Discord with friends",
  title: "A game to play on Discord with friends: no install, up to 8 players | Friendly Takeovers",
  desc: "Need a game for your Discord server or voice call? Friendly Takeovers runs in the browser: paste a link in the channel, up to 8 friends join, and you try to buy each other out. Free to try.",
  h1: "A game to play on Discord with friends",
  lead: "Paste one link in the channel, hop in voice, and within a minute everyone is running a company and eyeing each other's shares. Nothing to install, nothing to add to the server.",
  body: () => { const f = faq([["Is it a Discord bot or activity?", "No. It is a browser game. You share the invite link in a channel or DM and everyone opens it in their browser, so it works in any server without permissions or bots."], N_Q, PRICE_Q, ["Does everyone need the same device?", "No. Phones, tablets and laptops can all join the same game."]]);
    return { ld: f.ld, html: `${PLAY()}
<h2>Why it suits a voice call</h2>
<p><b>It is loud in the right way.</b> Rounds are secret until they resolve, then everyone sees the results at once. Someone always undercut someone.</p>
<p><b>Trades are public.</b> When the stock exchange opens in round 3, every share purchase shows on a live ticker. Buying 10% of a friend's company while they are talking is a move.</p>
<p><b>Private deals are private.</b> There are one-on-one chats inside the game for the deals you do not want the rest of the call to hear. The game enforces them when the round ends.</p>
<p><b>Short rounds.</b> The host sets the timer. Blitz is five rounds of two and a half minutes.</p>
${IMG("menu.jpg", "The Friendly Takeovers main menu with a pixel-art city skyline", "Create a game under Multiplayer and share the code or link.")}
<h2>Start one in a minute</h2>
<p>Open the game, choose Multiplayer, create a game and paste the invite link in your channel. Add bots if you want a fuller market. When everyone has joined, press start.</p>
<p>Streaming it to the channel? There is a party-mode screen made for that: it shows the skyline, the timer, who is ready, the ticker and the results show.</p>
<p>We also run our own Discord for finding people to play with. The link is on the game's main menu.</p>
${FACTS}${f.html}` }; } },

{ slug: "how-to-play", nav: "How to play",
  title: "How to play Friendly Takeovers: rules and beginner strategy",
  desc: "The rules of Friendly Takeovers in five minutes: how rounds work, what you decide, how company value is counted, how takeovers work, and seven tips for your first game.",
  h1: "How to play Friendly Takeovers",
  lead: "You run one company for a set number of rounds against your rivals. Whoever's company is worth the most at the end wins, unless someone takes control of every other company first. That is a monopoly, and it ends the game on the spot.",
  body: () => { const f = faq([["How do you win Friendly Takeovers?", "Have the most valuable company when the last round ends, or take control of every other company before then."], ["How is company value calculated?", "Cash minus debt, plus factory, stores, stock, brand, earnings power and the shares you hold in rival companies."], ["When can you buy shares in other companies?", "From round 3, when the stock exchange opens. You can buy a limited number of shares in each company per round, and taking control past 50% goes through a takeover bid at the end of the round."], N_Q, PRICE_Q]);
    return { ld: f.ld, html: `${PLAY()}
<h2>A round, step by step</h2>
<h3>1. Watch the news</h3><p>Each round starts with broadcasts: news that changes demand, costs or interest for this round. Rare mega events, such as a crash or a boom, hit everyone.</p>
<h3>2. Read</h3><p>The Market tab has the market report, the history and what your rivals did. Reports has your profit, cash, balance sheet, production and cost per unit. A paid market study shows the split per buyer group.</p>
<h3>3. Decide</h3><p>Go through the tabs from top to bottom: Production (price, amount, quality), R&amp;D, Marketing, Retail, Finance, Takeovers and the Boardroom. A tick shows which tabs you have visited this round.</p>
<h3>4. Submit</h3><p>You see your decision sheet first. Then everyone's decisions are resolved together and the results come in.</p>
${IMG("news.jpg", "A breaking news broadcast at the start of a round in Friendly Takeovers: aliens want cheap chocolate", "Round 1 of 8: the news comes first.")}
<h2>What decides your sales</h2>
<p>Buyers compare every company on price, quality, brand and whether the product is actually on the shelf. Different buyer groups weigh those differently, and those groups slowly grow or shrink during a game. Nobody tells you how much you will sell. You have a calculator, a notepad and last round's numbers.</p>
<h2>Money</h2>
<p><b>Raw materials</b> are bought a round ahead at today's price. If you run short, the game buys the rest on the spot market at 15% extra. Leftovers cost a little to store.</p>
<p><b>The factory</b> has a sweet spot. Too full and you pay overtime, too empty and idle machines cost money.</p>
<p><b>Loans</b> come from the bank up to your credit line. Run out of cash and you get an expensive emergency loan.</p>
<p><b>The investor call</b> lets you forecast your sales and profit each round. Being close raises investor trust, which raises your value and makes loans cheaper. Being far off lowers it.</p>
<h2>Shares and takeovers</h2>
<p>From round 3 the exchange is open during the round. Every purchase moves the price and shows on the ticker for everyone. Owning 40% of a company without controlling it makes headlines and warns the target. Past 50% you take control through a takeover bid when the round ends.</p>
<p>You can also do it by handshake. In the chat you can sell or buy shares for an agreed price, lend money, sign non-attack pacts for one to four rounds, or propose a friendly merger where two companies become one.</p>
<h2>Seven tips for your first game</h2>
<ol>
<li><b>Do not start a price war in round 1.</b> The cheapest company sells the most units and often earns the least.</li>
<li><b>Produce what you can sell.</b> A full warehouse is money standing still. Check last round's demand before you set production.</li>
<li><b>Buy materials when the outlook says prices will rise.</b> The outlook is right about three times out of four.</li>
<li><b>Take the investor call seriously.</b> A careful forecast is the cheapest value you can add.</li>
<li><b>Keep some credit free.</b> You need it the round someone starts buying your shares.</li>
<li><b>Watch the ticker from round 3.</b> If one name keeps buying your shares, find a friend to sign a pact with, or buy back.</li>
<li><b>Remember your secret mission.</b> The bonus is often the difference between second and first.</li>
</ol>
${f.html}` }; } },
];

// ---------------------------------------------------------------- business stories (from the short videos)
const STORIES = [
{ slug: "nokia", name: "How Nokia lost the phone market in six years", date: "2026-11-12",
  desc: "In 2007 Nokia was the world's biggest phone maker. In 2013 it sold its phone business to Microsoft for about $7.2 billion. What happened in between, and the one bet that did it.",
  body: `<p class="lead">In 2007, Nokia was the biggest phone maker on Earth. Six years later its phone business was sold, and two years after that the buyer wrote almost all of it off.</p>
<h2>What happened</h2>
<p>In 2007 Apple launched the iPhone, and in 2008 the first Android phones arrived. Nokia's own software, Symbian, was built for an older kind of phone and struggled to keep up.</p>
<p>In February 2011 Nokia had to pick what came next. It could have joined Android, like most other phone makers. Instead it bet everything on Microsoft's Windows Phone. The reasoning was that on Android, Nokia would be one maker among many, while on Windows Phone it would be the main partner.</p>
<p>It flopped. Buyers and app developers had already chosen sides. In September 2013 Microsoft agreed to buy Nokia's phone business for about $7.2 billion. In 2015 Microsoft wrote down about $7.6 billion on the deal, which is more or less all of it.</p>
<h2>The lesson</h2>
<p>Nokia did not lose because it made bad phones. It lost because of one strategic bet, made when it still had options. Being the biggest protects you for a while. It does not protect you from picking the wrong side.</p>
<p>Nokia itself survived, by the way. It is now a network equipment company.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>Every game has a round where you have to choose: research higher quality, or cut the price and go for volume. You cannot afford both, your rivals are choosing at the same time, and you only find out who was right when the results come in.</p></div>
<p class="src">Sources: Microsoft's announcement of the Nokia devices deal, September 2013; Microsoft's impairment charge, July 2015.</p>` },
{ slug: "blockbuster", name: "The day Blockbuster turned down Netflix for $50 million", date: "2026-11-12",
  desc: "In 2000 Netflix offered to sell itself to Blockbuster for $50 million. Blockbuster said no. Ten years later Blockbuster was bankrupt. The story, and why big companies miss small ones.",
  body: `<p class="lead">In 2000, Netflix offered to sell itself to Blockbuster for $50 million. Blockbuster laughed them out of the room.</p>
<h2>What happened</h2>
<p>Netflix was then a small company posting DVDs to people's homes, and it was losing money. Its founders flew to Dallas to meet Blockbuster's management with a proposal: buy us for $50 million and we will run your online business. As Netflix co-founder Marc Randolph tells it, the Blockbuster side could barely keep a straight face.</p>
<p>It is easy to see why. At its peak a few years later, Blockbuster had about 9,000 stores. It was the place where people rented films. A mail-order DVD service looked like a rounding error.</p>
<p>Then the stores became the problem. Rent, staff and late fees that customers hated were hard to walk away from, because they were also where the money came from. Blockbuster filed for bankruptcy in 2010. Today there is one Blockbuster left, in Bend, Oregon. Netflix is worth hundreds of billions of dollars.</p>
<h2>The lesson</h2>
<p>The thing that makes a company big is often the thing that stops it from changing. And the price of a small rival is never lower than on the day they come to you asking.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>Shares in the weakest company at the table are cheap in the early rounds. Players who laugh at the last-place company in round 3 sometimes find it has bought a stake in them by round 7.</p></div>
<p class="src">Source: as told by Netflix co-founder Marc Randolph. Blockbuster's bankruptcy filing, September 2010.</p>` },
{ slug: "nintendo", name: "Nintendo made playing cards for 88 years before its first console", date: "2026-11-12",
  desc: "Nintendo was founded in 1889 in Kyoto as a maker of hand-made playing cards. Its first video game console came out in 1977. What a 137-year-old company teaches about changing business.",
  body: `<p class="lead">Nintendo is 137 years old. It started in 1889, in Kyoto, making hand-made playing cards.</p>
<h2>What happened</h2>
<p>The company was founded by Fusajiro Yamauchi to make hanafuda, traditional Japanese flower cards. For decades, that was the business. In 1959 Nintendo signed a deal to put Disney characters on its cards, which opened up a new market: children.</p>
<p>In the 1960s the card market stopped growing and Nintendo started looking for something else. It moved into toys, and from toys into electronic games. Its first home console, the Color TV-Game, came out in Japan in 1977. That is 88 years after the company was founded.</p>
<p>The rest is better known: Donkey Kong in 1981, the Famicom in 1983, the Game Boy in 1989, and so on to the Switch.</p>
<h2>The lesson</h2>
<p>The business you start is not always the one you become. Nintendo did not jump from cards to consoles in one move. It went from cards to children's cards, to toys, to electronic toys, to video games. Each step was small and next door to the last one.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>Nobody finishes a game with the company they started. You begin with one small factory. By the last round you might be a premium brand with your own stores, a discount giant, or a holding company that mostly owns pieces of your friends.</p></div>
<p class="src">Sources: Nintendo company history. Age counted from the founding in September 1889 to 2026.</p>` },
{ slug: "pepsi", name: "Coca-Cola could have bought Pepsi three times", date: "2026-11-12",
  desc: "Pepsi went bankrupt in 1923, and between 1922 and 1933 Coca-Cola was offered the company three times. It said no each time. Today PepsiCo has higher revenue than Coca-Cola.",
  body: `<p class="lead">Coca-Cola could have bought Pepsi. Three times. It said no every time.</p>
<h2>What happened</h2>
<p>Pepsi-Cola was invented in the 1890s by Caleb Bradham, a pharmacist in North Carolina. After the First World War he bet heavily on sugar prices and lost. In 1923 Pepsi went bankrupt. It went under again in 1931.</p>
<p>Between 1922 and 1933, Pepsi was offered to the Coca-Cola Company three times. Coca-Cola declined each time. From where it stood, that made sense: why pay for a failing copy of your own product?</p>
<p>Pepsi's next owners tried something different. During the Depression they sold a bottle twice the size for the same five cents. Sales took off, and Coca-Cola had a rival for life.</p>
<p>Today PepsiCo, which also owns snack brands such as Lay's and Doritos, brings in more revenue than Coca-Cola: about $92 billion against about $47 billion in 2024. Coca-Cola is still the more profitable and more valuable company, but it has spent a century and a great deal of money fighting a competitor it could have bought for very little.</p>
<h2>The lesson</h2>
<p>The deal you skip can become your biggest rival. A struggling competitor is cheap for a reason, and sometimes the reason is temporary.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>When a rival has a terrible round, their share price drops and they need cash. That is the moment to make an offer. Wait two rounds and they may have recovered, and remember that you did not help.</p></div>
<p class="src">Sources: Pepsi-Cola company history; annual revenue 2024, PepsiCo about $92 billion and The Coca-Cola Company about $47 billion.</p>` },
{ slug: "red-bull", name: "Red Bull doesn't make Red Bull", date: "2026-11-12",
  desc: "Every can of Red Bull is produced by another company, the Austrian family firm Rauch. Red Bull itself does the marketing. How a company sells billions of cans without a factory.",
  body: `<p class="lead">Red Bull doesn't make Red Bull. Every can is made by another company: a family-owned juice business in Austria called Rauch.</p>
<h2>How it works</h2>
<p>Red Bull launched in Austria in 1987. From the start, production and canning were handed to Rauch, which still fills the cans today in Austria and Switzerland. Red Bull sells more than 12 billion of them a year.</p>
<p>So what does Red Bull actually do? Marketing, on a scale few companies match. It owns Formula One teams and football clubs. It runs air races and cliff-diving series. In 2012 it paid for a parachute jump from the edge of space and streamed it live to millions of people.</p>
<p>None of that is advertising in the usual sense. Red Bull does not buy space next to the event. It owns the event.</p>
<h2>The lesson</h2>
<p>It is not a drink company with a marketing budget. It is a marketing company that sells a drink. Red Bull worked out which part of the business customers actually pay extra for, kept that part, and let someone else do the rest.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>There is more than one way to win a market. One player builds the biggest factory, another pours everything into brand and charges more for the same product. Find the thing you are better at than the rest of the table and put your money there.</p></div>
<p class="src">Sources: Red Bull company information; Rauch Fruchtsäfte.</p>` },
{ slug: "lamborghini", name: "Lamborghini started with a complaint about a Ferrari", date: "2026-11-12",
  desc: "Ferruccio Lamborghini built tractors and drove Ferraris. The story goes that a complaint about a clutch led him to start his own car company in 1963, to beat Ferrari.",
  body: `<p class="lead">Lamborghini exists because of a complaint about a Ferrari. At least, that is how the story goes.</p>
<h2>What happened</h2>
<p>Ferruccio Lamborghini made tractors. He started after the Second World War, building them from leftover military hardware, and by the late 1950s he was a wealthy man. Wealthy enough to drive Ferraris.</p>
<p>The story goes that his Ferrari's clutch kept breaking, and that he went to complain to Enzo Ferrari himself. Legend says he was told to stick to tractors. What was actually said in that meeting, only the two of them knew.</p>
<p>What is certain is what came next. In 1963 he founded Automobili Lamborghini in Sant'Agata Bolognese, a short drive from Ferrari's home in Maranello. The first car, the 350 GT, followed in 1964. In 1966 came the Miura, which many people consider the first modern supercar.</p>
<h2>The lesson</h2>
<p>A lot of companies start with a customer who is annoyed and has the means to do something about it. Lamborghini knew engineering from his tractor business, he knew what bothered him about the best car on the market, and he had the money to try.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>Grudges are a real strategy. The friend who undercut your price in round 2 is the friend whose shares you start quietly buying in round 3. The game keeps a head-to-head record against each friend across your online games.</p></div>
<p class="src">Founded 1963. The exchange between the two men is legend.</p>` },
{ slug: "ikea", name: "Why nobody can buy IKEA", date: "2026-11-12",
  desc: "Most IKEA stores belong to a group owned by a Dutch foundation, the Stichting INGKA Foundation. A foundation has no shareholders, which makes IKEA close to takeover-proof.",
  body: `<p class="lead">The world's biggest furniture retailer is owned by a Dutch foundation. That makes it close to impossible to take over.</p>
<h2>How it works</h2>
<p>IKEA was founded in Sweden in 1943 by Ingvar Kamprad. In the 1980s he moved ownership out of the family's hands. Today most IKEA stores are run by Ingka Group, and Ingka Group is owned by the Stichting INGKA Foundation, registered in the Netherlands. The IKEA brand and concept sit in a separate group, Inter IKEA.</p>
<p>A foundation has no shareholders. There are no shares on a stock exchange, no family members who can sell their part, and nobody to make an offer to. A hostile takeover needs someone to buy from. Here there is nobody.</p>
<p>In 2006, The Economist looked at the structure and called the foundation the world's richest charity, and one of the least generous, since at the time little of the money went to charitable work. The foundation's giving has grown considerably since then.</p>
<h2>The lesson</h2>
<p>Who owns a company matters as much as how well it sells. Kamprad wanted IKEA to stay independent and to think in decades, not quarters, and he designed the ownership to make that the only option.</p>
<div class="box"><h3>In Friendly Takeovers</h3><p>You do not get a foundation. Every company's shares trade on the exchange from round 3, including yours. The only defences are holding on to your founder's shares, keeping cash free to buy back, and having friends who owe you a favour. Nobody is safe, not even from their best friend.</p></div>
<p class="src">Source: The Economist, May 2006.</p>` },
];

// ---------------------------------------------------------------- templates
const footer = () => `<footer><div class="wrap"><div class="cols">
<div><b>Play</b><a href="/">Play Friendly Takeovers</a><a href="/how-to-play">How to play</a><a href="/stories">Business stories</a></div>
<div><b>About the game</b>${PAGES.filter((p) => p.slug !== "how-to-play").map((p) => `<a href="/${p.slug}">${p.nav}</a>`).join("")}</div>
<div><b>Legal</b><a href="/?page=privacy">Privacy</a><a href="/?page=terms">Terms</a><a href="/?page=credits">Credits</a></div>
</div><p>Friendly Takeovers is an independent game. Company and product names on this site belong to their owners and are used for description only.</p></div></footer>`;

function page({ path, title, desc, h1, crumb, main, ld = [], type = "website" }) {
  const url = `${SITE}/${path}`;
  const bc = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [["Friendly Takeovers", SITE + "/"], ...crumb].map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Friendly Takeovers">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(h1)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f1530">
${[bc, ...ld].map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n")}
<style>${CSS}</style>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
<header><div class="wrap"><a class="brand" href="/">Friendly<br><span>Takeovers</span></a><a class="btn" href="/">▶ Play now</a></div></header>
<main class="wrap">
<p class="crumb"><a href="/">Friendly Takeovers</a>${crumb.map(([n, u], i) => " › " + (i === crumb.length - 1 ? esc(n) : `<a href="${u.replace(SITE, "")}">${esc(n)}</a>`)).join("")}</p>
<h1>${h1}</h1>
${main}
</main>
<section class="end"><div class="wrap"><h2>Think you can run a company better than your friends?</h2><a class="btn big" href="/">▶ Play Friendly Takeovers</a><p class="src">Free against bots · up to 8 players online · no download</p></div></section>
${footer()}
</body>
</html>
`;
}

mkdirSync("docs/stories", { recursive: true });
const urls = [[`${SITE}/`, "1.0"]];
for (const p of PAGES) {
  const b = p.body();
  writeFileSync(`docs/${p.slug}.html`, page({ path: p.slug, title: p.title, desc: p.desc, h1: p.h1, crumb: [[p.nav, `${SITE}/${p.slug}`]], main: `<p class="lead">${p.lead}</p>${b.html}`, ld: [b.ld] }));
  urls.push([`${SITE}/${p.slug}`, "0.8"]);
}
for (const s of STORIES) {
  const others = STORIES.filter((o) => o !== s);
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: s.name, description: s.desc, datePublished: s.date, dateModified: s.date, mainEntityOfPage: `${SITE}/stories/${s.slug}`, image: `${SITE}/og.jpg`, author: { "@type": "Organization", name: "Friendly Takeovers", url: SITE + "/" }, publisher: { "@type": "Organization", name: "Friendly Takeovers", url: SITE + "/" } };
  const main = `${s.body}${PLAY()}<h2>More business stories</h2><ul>${others.map((o) => `<li><a href="/stories/${o.slug}">${o.name}</a></li>`).join("")}</ul>`;
  writeFileSync(`docs/stories/${s.slug}.html`, page({ path: `stories/${s.slug}`, title: `${s.name} | Friendly Takeovers`, desc: s.desc, h1: s.name, crumb: [["Business stories", `${SITE}/stories`], [s.name, `${SITE}/stories/${s.slug}`]], main, ld: [ld], type: "article" }));
  urls.push([`${SITE}/stories/${s.slug}`, "0.6"]);
}
writeFileSync("docs/stories.html", page({ path: "stories", title: "Business stories: real takeovers, bad bets and missed deals | Friendly Takeovers", desc: "Short, true business stories: the deal Blockbuster turned down, the bet that sank Nokia, why nobody can buy IKEA, and more. Each one is a two-minute read.",
  h1: "Business stories", crumb: [["Business stories", `${SITE}/stories`]],
  main: `<p class="lead">Real takeovers, bad bets and missed deals. Each one is a two-minute read, and each one is a move you can try on your friends.</p>${STORIES.map((s) => `<div class="box"><h2 style="font-size:21px"><a href="/stories/${s.slug}">${s.name}</a></h2><p style="margin:0">${s.desc}</p></div>`).join("")}${PLAY()}` }));
urls.push([`${SITE}/stories`, "0.7"]);
writeFileSync("docs/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, p]) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>${p}</priority></url>`).join("\n")}\n</urlset>\n`);
console.log("pages:", urls.length - 1);
