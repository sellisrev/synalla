# Synalla

**Your own AI agent: owned by you, working for you, talking with everyone else's.**

The name comes from *synallagma* (Greek συνάλλαγμα): a mutual exchange between parties, each bound to the other. Aristotle used it for voluntary transactions; civil law still calls a two-sided contract *synallagmatic*.

Synalla gives each person a personal AI agent they fully own. It can use any model provider for the reasoning, but its memory and its knowledge of its owner stay with the owner. It builds a picture of who its owner is, for its owner only, and uses it to find what they want, whether they asked for it or not, by talking with the agents of other people, authors, producers, employers and companies.

- **A parent's agent** notices that an author offers a reading method suited to their child's stage, something the parent never knew to look for. The parent looks and decides, or asks the agent to see what other authors offer. If the answer is no, the agent remembers and doesn't bring it up again.
- **A job search** where your agent and an employer's agent learn about each other only if the role clears your private floor.
- **Your pay against people doing your job**, and nobody sees your number.
- **A solo game developer** with no marketing budget reaches the players whose agents know they'd love the game, and sells to them direct, without a store taking its cut.

Sellers reach the people who actually want what they offer, so ads become pointless, and distribution monopolies lose their hold. Fewer intermediaries sit between producers and buyers. The model is rented; the home is yours.

## Status

Early. This repository holds the rules that don't depend on any one host or transport, as tested reference code on synthetic data:

| Module | What it does |
|---|---|
| `src/event.js` | Nostr-compatible keys and signed events |
| `src/vouch.js` | Invites that become vouches, and a web of trust with accountability |
| `src/trust.js` | Admission tiers for first contacts, decided by code before any model reads anything |
| `src/pool.js` | Group answers that unlock at a threshold, with rounds and a differencing check |
| `src/offers.js` | Signed offers and private judging against the owner's limits |
| `src/knock.js`, `src/gate.js` | Typed first contact, and the home's gate that routes it by tier, category and daily limits |
| `src/seal.js` | Sealed mail: NIP-44 v2 encryption and NIP-59 gift wrap, checked against the official test vectors |
| `src/decisions.js` | Remembered decisions: the owner's yes, no or not now, applied to similar offers for years, with the most specific decision winning |
| `src/askaround.js` | Asking around: a need published without who wants it, offers checked one per seller, ranked against the owner's private budget and past refusals |
| `src/inbox.js` | The signed inbox list (NIP-17 kind 10050): which relays hold an agent's mail, and which ones a sender writes to |
| `src/circle.js` | A convener's kit: single-use invite links (code kept in the URL fragment) and shareable progress cards |

Nothing here publishes to public relays or handles real data. See [docs/limits.md](docs/limits.md).

## Try it

Requires Node 22 or later.

```
npm install --ignore-scripts
npm test
npm run demo
```

`node examples/share_card.mjs card.svg` writes a sample progress card.

The demo simulates a cold start with synthetic people: one agent alone on day 0 judging public job ads, then three conveners starting invite chains, weekly rounds of group results, progress cards to share, and the admission tiers that result.

## Documents

- [docs/design.md](docs/design.md): the idea, principles, how the network starts, layers and building blocks
- [docs/limits.md](docs/limits.md): what this code does not protect against yet
- [schemas/](schemas/): JSON Schemas and event tags
- [kit/first-use/](kit/first-use/): the no-install first use (prompt, policy page, synthetic payslips, scorer) and a protocol to test it in real AI apps

## Dependencies

Two, pinned to exact versions: `@noble/curves` and `@noble/hashes` (audited, no install scripts, published with provenance). Install with `--ignore-scripts` anyway.

## Licence

Not chosen yet. Until a licence is added, all rights are reserved.
