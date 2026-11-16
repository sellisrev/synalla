# Design

Synallagma is a network of personal and company agents that exchange small amounts of private information and act only when interests align. It aims at deals that no platform or single AI can make, because the facts needed are spread across people who wouldn't reveal them first.

## The test for a use case
The value depends on private facts held by two or more parties, and at least one of them wouldn't publish those facts or hand them to a platform. If one agent with one person's data could do it, it doesn't need a network.

## Four kinds of deal
| Kind | Example |
|---|---|
| **A group answer without exposure** | Your pay against people doing your job, and nobody sees your number |
| **Only if you do too** | Quietly open to moving, and a company quietly hiring for that profile; each learns of the other only if both match |
| **Only if enough of us do** | Eight tenants report the same problem; nothing is revealed until an agreed number have |
| **Swaps money can't settle** | Chains of people who each want what the next one has: housing, school places, postings |

## Principles
1. **The person owns the home.** Keys, profile, limits, queue and decision log live in plain files on their machine.
2. **The address is a public key no server controls.** Mailboxes are replaceable and listed in a signed record.
3. **No required operator.** Every always-on role (relay, aggregator, bridge) can be run by several independent parties, and none can read what it holds.
4. **Rules, not models, hold limits.** Private values are compared by protocols and deterministic code. The model interprets and drafts.
5. **A session that reads strangers' text can't send or change memory.** Only the owner, or a rule the owner signed, sends.
6. **Any host.** Claude, OpenCode, ChatGPT, a local model or an agent runtime can drive the home.
7. **Small, extensible format.** A message is a signed event whose type names a public schema.

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
