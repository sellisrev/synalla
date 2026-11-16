# Cold start

A network whose value comes from private facts held by several parties is worth nothing to its first member. This note sets out how Synallagma gets from one person to a working network, which precedents each step rests on, and which parts are already in the code.

## Five cold starts, not one

| Cold start | Why it bites here |
|---|---|
| **Value** | A group answer needs at least k people (k = 15 by default). A match needs both sides present. One agent alone can't do either. |
| **Trust** | A new key has no history. The admission gate drops unknown senders, so a newcomer can't reach anyone, and everyone looks like a spammer. |
| **Counterparties** | Companies, landlords and buyers won't join a network that has no people on it. They are the hard side. |
| **Hosting** | Offline-to-offline delivery needs some machine to hold bytes, and the design has no required operator. |
| **Install** | People won't install an agent for a network that doesn't exist yet. |

## What worked elsewhere

| Precedent | What it shows | Source |
|---|---|---|
| Andrew Chen's *Cold Start Problem*: build the smallest stable "atomic network" first, then the next one | Solve one dense group at a time; the problem recurs for each new group | [summary](https://www.sachinrekhi.com/andrew-chen-the-cold-start-problem) |
| Chris Dixon's "come for the tool, stay for the network" (Dropbox: sync first, shared folders later) | A single-player use lowers the size an atomic network needs | [summary](https://medium.com/twosapp/the-cold-start-problem-how-to-start-and-scale-network-effects-by-andrew-chen-813f0668c70f) |
| Blind: company boards open only after more than 30 employees verify with a work email | A threshold per natural group, with a credential that proves membership | [Wikipedia](https://en.wikipedia.org/wiki/Blind_(app)) |
| Glassdoor: give one review or salary to see the rest | Give-to-get makes contributing the price of reading | [TechCrunch, 2008](https://techcrunch.com/2008/06/10/at-glassdoor-find-out-how-much-people-really-make-at-google-microsoft-yahoo-and-everywhere-else/) |
| Levels.fyi: started in 2017 with imperfect crowdsourced data, on a Google Sheets backend, verified later through offer letters and W-2s | Start rough and useful, add proof later | [CNBC](https://www.cnbc.com/2019/06/14/how-much-google-facebook-other-tech-giants-pay-software-engineers.html), [Levels.fyi on Google Sheets](https://www.levels.fyi/community/thread/4Hfrn0/how-google-sheets-powered-levels-fyi-to-millions-of-users), [Fast Company](https://www.fastcompany.com/90604436/levels-fyi-leveling-tech-salaries-leveling-negotiation) |
| Assurance contracts and Tabarrok's dominant assurance contracts: pledges count only above a threshold, and early signers get something if it fails | Waiting becomes visible progress, and joining early costs nothing | [Wikipedia](https://en.wikipedia.org/wiki/Assurance_contract) |
| Bluesky starter packs: over 335,000 created in six months, behind nearly 20% of all follows from June 2024 to January 2025, and 20-40% of daily follows during migration spikes; they reinforce existing communities | Curated lists by trusted people carry newcomers into a graph | [Lancaster University](https://www.lancaster.ac.uk/news/starter-packs-have-played-a-central-role-in-blueskys-rapid-growth-new-study-shows), [arXiv 2501.11605](https://arxiv.org/abs/2501.11605) |
| Lobsters' invite tree: who invited whom is recorded, and moderators can prune a whole branch; its founder says it didn't grow as hoped | Invites give accountability, at the cost of slower growth | [jcs.org](https://jcs.org/notes/955524103454605404), [Tildes thread](https://tildes.net/~tildes/1sc/brainstorming_trust_system_ideas) |
| Nostr web of trust: new users "don't exist in anyone else's Web of Trust yet"; proposals use preloaded trust, QR invites and personalised PageRank (Vertex) | The trust cold start is known and unsolved on Nostr | [Damus article](https://damus.io/naddr1qqgrwd34vvek2wf5ve3nwcmrxycrxq3qklkk3vrzme455yh9rl2jshq7rc8dpegj3ndf82c3ks2sk40dxt7qxpqqqp65wrp5t4t), [OpenSats WoT topic](https://opensats.org/topics/web-of-trust) |
| Keybase: link a key to existing Twitter, GitHub or Reddit accounts with signed public proofs | Borrow trust from identities people already have | [Keybase docs](https://book.keybase.io/docs/server) |
| Signal contact discovery: find which of your contacts are already there without handing over the address book | Existing relationships are the first graph | [Signal blog](https://signal.org/blog/private-contact-discovery/) |
| Caillaud and Jullien, "Chicken & Egg" (2003): subsidise one side ("divide"), recover on the other ("conquer") | Make the side that comes first pay nothing | [RAND J. Econ.](https://econpapers.repec.org/RePEc:rje:randje:v:34:y:2003:i:2:p:309-28) |
| Airbnb cross-posted listings to Craigslist; Reddit's founders posted from fake accounts | Piggybacking works, but Airbnb broke Craigslist's terms and Reddit faked its users. A trust network can't do either | [Andrew Chen](https://andrewchen.com/how-to-be-a-growth-hacker-an-airbnbcraigslist-case-study/), [Vice](https://www.vice.com/en/article/how-reddit-got-huge-tons-of-fake-accounts-2/) |
| Kidney exchange: pools are thin; waiting thickens them, and pooling registries raises matches | Rounds and broader pools trade speed for matches | [Ashlagi et al.](https://arxiv.org/pdf/1301.3509), [multi-registry study](https://arxiv.org/pdf/2012.06647) |
| Edge City Agent Village (with Index Network), May-June 2026: 239 agents, 572 surfaced opportunities, 147 accepted, in one village | A co-located community is an atomic network for agents | [Edge Esmeralda](https://edgeesmeralda2026.substack.com/p/the-agent-village-experiment-at-edge), [Cosmos Institute](https://blog.cosmos-institute.org/p/we-gave-a-village-personal-ai-agents) |

## How Synallagma starts

### 1. One person already gets something (value, install)
An agent with no peers still reads signed public offers and judges each one against limits only its owner knows: "this Lyon QA lead job pays above your floor". Offers taken from public job ads are signed by whoever converted them, keep their source URL, and are always marked as derived, so they are never shown as a person or company on the network. The first use needs no install at all: a person's existing AI reads their payslip and fills in an anonymous record.

*In the code:* `src/offers.js` (`createOffer`, `judgeOffer`), shown on day 0 of the demo.

### 2. Atomic networks: one role, one country, through conveners (value)
The first networks are groups that already talk to each other: a meetup, a community Slack, a school's alumni, the tenants of one building. A **convener** (meetup organiser, community lead) starts a circle with invite links. Each question has a ladder of nested groups, from narrow (role, seniority, region, company type) to broad (role only). People see the narrowest group that has unlocked, so early contributors get a role-level answer long before their own niche fills.

Simulation with the real publication code, five runs per size, an uneven mix of roles and regions, k = 15, three roles:

| Contributors | See any result | Narrowest result is role only | Role and seniority | Role, seniority and region or narrower |
|---:|---:|---:|---:|---:|
| 30 | 21% | 21% | 0% | 0% |
| 60 | 88% | 88% | 0% | 0% |
| 100 | 100% | 78% | 22% | 0% |
| 200 | 100% | 37% | 58% | 5% |
| 400 | 100% | 6% | 62% | 32% |
| 800 | 100% | 0% | 32% | 68% |

So one role across one country is an atomic network at about 60 people, and the narrow cells that make the answer personal need several hundred. Conveners should start with one role and a country, not one city.

*In the code:* `ladder`, `personalView` in `src/pool.js`; `examples/questions/pay_product_fr.json`.

### 3. Thresholds turn waiting into progress (value)
Before a group reaches k, the only thing shown is progress: "QA engineer · Senior: 11 of 15, 4 more to unlock". The card never says who shared it or whether they took part, so anyone can post it. This is an assurance contract without money: contributing early costs nothing, the result appears once enough people join, and early contributors always get the broader group's answer in the meantime. Contributing is the price of seeing your own position (give-to-get). Group results, once unlocked, can be public, because the chart is what spreads.

*In the code:* `progressCard`, `publishRound`, `personalView`; `progressCardSvg` in `src/circle.js` draws the card at the size LinkedIn previews use.

### 4. Invites are vouches (trust)
An invite link is a one-time code. Redeeming it gives the newcomer a signed vouch from the person who invited them, so they arrive with a place in the web of trust instead of none. The inviter is accountable: if someone they vouched for is removed, they get a strike and can't vouch for anyone new for a period, and a second strike cuts their whole branch. Each home computes tiers from its own contacts and the vouches it sees: contacts and people they invited go to the inbox, two invites away gets a knock card, and strangers with no vouch or proof are dropped. A convener's circle is a starter pack with accountability.

People without an invite aren't locked out: a one-person proof (passport or EU wallet) or a refundable deposit gets them into the requests folder, at a low daily cap.

*In the code:* `src/vouch.js` (`createInvite`, `redeemInvite`, `acceptRedemption`, `VouchGraph`), `src/trust.js` (`admissionTier`). Conveners get batches of single-use links from `createCircle` in `src/circle.js`; the code travels in the link's fragment, so no web page that hosts the link ever receives it.

### 5. Borrow existing graphs and channels, within their rules (trust, install, counterparties)
- **The AI people already use** is the first host: no install for the first question.
- **Nostr keys and follow lists** can count as an optional, capped trust signal for people already on Nostr.
- **Proofs of existing accounts** (work email via zk-email, old accounts via zkTLS, as Keybase did with public posts) give newcomers trust without an inviter.
- **Email bridge** reaches companies that aren't on any agent network.
- **Interoperation** with Dina homes and Index Network communities, which already have users.
- Nothing is scraped against a site's terms, and no profile is ever created for a person who didn't join.

*In the code:* `followedByFollows` in `src/trust.js` counts how many accounts the owner follows also follow a sender, from signed follow lists; three or more give tier C, never higher on their own. The rest is planned; the event format is Nostr's, so Nostr keys and relays work as they are.

### 6. The hard side comes later and pays nothing to start (counterparties)
People come first and pay nothing. Companies take part by publishing one signed offer, with no account. Until they do, derived offers from public job ads stand in for them, clearly labelled. Paid outcomes (a consented hire, a switch) come only after a match both sides accepted.

*In the code:* derived offers in `src/offers.js`.

### 7. Rounds keep thin groups safe while they thicken (value, privacy)
Results come out in rounds. A group refreshes only when enough has changed since its last release that no combination of published results can isolate fewer than k people. Until then it keeps showing its last result, marked with its date. This is the kidney-exchange trade: wait for thickness rather than match too early, here to protect privacy.

*In the code:* `differencingCheck`, `publishRound`; tested against a brute-force attacker.

### 8. No operator needed to start (hosting)
Public Nostr relays carry mail from day one. In a retention test with throwaway keys and synthetic sealed messages, 6 of 12 public relays still held every message after 10 days (16 November 2026); 3 had dropped them, 1 refused them and 2 were unreachable that day. Senders therefore post to several relays, and people who need guaranteed retention use a paid or friendly inbox relay. The pay question needs one small collector, and later two independent aggregators so that no server sees anyone's pay.

## What Synallagma doesn't do to start faster
- **No fake users.** Reddit's founders faked accounts; a network whose value is trust can't.
- **No ghost profiles.** No intents or profiles are written for people found on the web who didn't join.
- **No scraping against terms.** Public ads are used only where the source allows it.
- **No public participation.** Sharing a card never shows that the sharer contributed.

## Measures to watch in the first circles
- Time from a convener's first invite to the first unlocked result.
- Share of contributors who see any result after one week and after one month.
- Invites redeemed per contributor (the circle grows only above about 1).
- Share of contributors who come back when their narrower group unlocks.
- Strikes per hundred invites (the trust model's health).

## Risks
- **Invite-only growth is slow.** Lobsters' founder says it didn't grow as he hoped. The proof-based way in matters as much as invites.
- **Self-selection.** Results describe "people who joined", not the market.
- **Exact progress counts.** They show how many people joined a group, though never who. Participation in a small group can itself be sensitive.
- **Conveners concentrate trust.** A bad convener's branch can be cut, but the circle loses its organiser.
- **Simulated numbers.** The coverage table depends on the assumed mix of roles and regions. Real circles will be lumpier.
