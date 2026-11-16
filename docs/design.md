# Design

Synalla gives every person their own AI agent, which they own outright and which runs on their side. It uses any model provider for the reasoning, but its memory and its knowledge of its owner stay with the owner. Over time it builds a picture of who its owner is, for its owner only, and uses it to find what they want, whether they asked for it or not. It does that by talking with the agents of other people, authors, producers, employers and companies.

## What that looks like
A parent buys picture books for a small child. Their agent knows the child's age and what they've been reading. It notices that an author offers a reading method suited to that stage, which the parent had never heard of and would never have searched for. The agent shows the match, and the parent decides:

- **Yes.** They look at it, and perhaps buy it.
- **Look wider.** The agent asks other authors' and publishers' agents what they offer for the same need, compares, and comes back with the best options, or with nothing worth their time.
- **No.** The agent remembers, for a long time, and turns down similar matches without the parent having to say it again.

The same agent helps with a job search, a house, a tradesperson or a second-hand sale, from the same knowledge of its owner. Sellers reach the people who actually want what they offer, so ads become pointless. Fewer intermediaries sit between a small producer and a buyer, so buying gets more direct and often more local.

## Why the agent must be owned
An agent that knows this much about a person can't belong to a platform that sells attention. So:

- **Memory and keys stay with the owner.** The model is rented and can be swapped. The home, meaning memory, profile, limits and decisions, is the owner's own.
- **Nothing about the owner leaves without a reason.** Other agents get the least that a match needs: a need described in general terms, a price band, or a yes or no from a private comparison.
- **The owner decides.** The agent finds, compares and drafts. It acts only within limits the owner set.

## What the network adds
Some matches need only the owner's agent and a public offer. Others are impossible unless several agents hold private facts and compare them without revealing them:

| Kind | Example |
|---|---|
| **An offer meets an unspoken need** | The reading method above: the parent's knowledge of the child stays at home, and the author's offer comes to it |
| **Asking around without being exposed** | "Who offers X for my situation?" sent under a throwaway key, generalised so it doesn't identify the owner |
| **A group answer without exposure** | Your pay against people doing your job, and nobody sees your number |
| **Only if you do too** | Quietly open to moving, and a company quietly hiring for that profile; each learns of the other only if both match |
| **Only if enough of us do** | Eight tenants report the same problem; nothing is revealed until an agreed number have |
| **Swaps money can't settle** | Chains of people who each want what the next one has: housing, school places, postings |

## Principles
1. **The person owns the home.** Keys, memory, profile, limits, queue and decision log live in plain files on their machine.
2. **Any model, same memory.** The reasoning model can change without the agent forgetting anything about its owner.
3. **Decisions are remembered.** A "no" stands for a long time and covers similar offers, so the owner never repeats themselves.
4. **The address is a public key no server controls.** Mailboxes are replaceable and listed in a signed record.
5. **No required operator.** Every always-on role (relay, aggregator, bridge) can be run by several independent parties, and none can read what it holds.
6. **Rules, not models, hold limits.** Private values are compared by protocols and deterministic code. The model interprets and drafts.
7. **A session that reads strangers' text can't send or change memory.** Only the owner, or a rule the owner signed, sends.
8. **Any host.** Claude, OpenCode, ChatGPT, a local model or an agent runtime can drive the home.
9. **Small, extensible format.** A message is a signed event whose type names a public schema.

## How the network starts
A network built on several people's private facts is worth nothing to its first member, so each part of the code has a job in getting past that:

- **One agent alone is still useful.** It judges signed public offers, including offers derived from public job ads (always labelled as derived), against limits only its owner knows (`offers.js`).
- **Circles start through conveners.** A meetup organiser or community lead hands out single-use invite links (`circle.js`). Redeeming one gives the newcomer a vouch, so they arrive with a place in the web of trust instead of none, and the inviter is accountable for them (`vouch.js`, `trust.js`).
- **Waiting is shown as progress.** Before a group reaches its minimum size, only "11 of 15, 4 more to unlock" is shown. The card never reveals who shared it (`pool.js`, `circle.js`).
- **Early contributors get a broader answer.** Each question has a ladder of groups from narrow to broad, and people see the narrowest one that has unlocked. With 15 people per group and three roles, about 60 contributors give most people a role-level result, while the narrowest groups need several hundred, so circles start with one role across one country.
- **Existing graphs help, within limits.** Nostr follow lists count as a capped signal (`trust.js`), and the format is Nostr's, so existing keys and relays work.
- **No shortcuts.** No fake users, no profiles of people who didn't join, no scraping against a site's terms.

## Layers
```
 Owner ── approves ──┐
                     ▼
 ┌────────────── Home (owner's device) ──────────────┐
 │ keys or signer link · profile · limits (policy)   │
 │ queue · decision log · schemas                    │
 │                                                   │
 │ Home daemon (no AI)                               │
 │  fetch mail · verify signatures · apply policy    │
 │  run private-compare protocols · send approved    │
 └───────────────┬───────────────────────┬───────────┘
      MCP (local)│                       │ network
                 ▼                       ▼
 AI hosts: Claude · OpenCode ·      Nostr relays (mailbox, noticeboard)
 ChatGPT · local model ·            Email bridge · aggregators
 agent runtimes                     Company agents (A2A)
```

## Building blocks
| Need | Choice |
|---|---|
| Address and signatures | Nostr keys and NIP-01 events (secp256k1 Schnorr) |
| First-contact mail | NIP-17 sealed messages, gift-wrapped (NIP-59), sent to the recipient's listed inbox relays |
| Ongoing conversations | MLS over Nostr (Marmot) for forward secrecy |
| Admission | Typed knocks, tiers from contacts, vouches and proofs; rate-limiting nullifiers for strangers |
| Group answers | Threshold publication with a differencing check now; two-aggregator DAP later so no server sees a value |
| "Only if you do too" | Private set intersection over banded values |
| "Only if enough of us" | STAR threshold reveal |
| Proofs | zk-email (employer), one-person proofs with per-app nullifiers |
| Company agents | A2A outward; signed offers on the noticeboard; email bridge |
| Home node | Built on an existing open-source personal node (vault process holds keys, reasoning process never does) |

## What is in this repository now
| Module | What it does |
|---|---|
| `src/event.js` | Keys, signing and verification of NIP-01 events |
| `src/vouch.js` | Invites that become vouches; the web of trust with strikes, suspensions and branch cuts |
| `src/trust.js` | Admission tiers A-D for first contacts, from contacts, vouch distance and proofs |
| `src/pool.js` | Group answers that unlock at k, the broadening ladder, rounds, the differencing check, progress cards and personal views |
| `src/offers.js` | Signed offers, derived offers from public ads, and private judging against the owner's limits |
| `src/knock.js` | Typed first contact: categories, fields, a short note with no links, contacts or handles |
| `src/gate.js` | The home's gate: verifies, tiers, checks the category's minimum tier and daily limits, logs every decision |
| `src/seal.js` | NIP-44 v2 encryption and NIP-59 gift wrap for first-contact mail |
| `src/inbox.js` | Signed inbox lists (kind 10050) and the sender's delivery plan |
| `src/circle.js` | Invite links for a convener's circle and progress cards to share |
| `schemas/` | JSON Schemas for the objects above |

Everything else in the tables above is design, not code yet.
