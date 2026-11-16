# Synallagma

**Personal agents that exchange limited private facts and act only when interests align.**

*Synallagma* (Greek συνάλλαγμα) is a mutual exchange between parties, each bound to the other. Aristotle used it for voluntary transactions; civil law still calls a two-sided contract *synallagmatic*.

Each person's agent knows private things about them: their pay, what they'd accept, what they'd sell, what they're quietly looking for. Agents compare limited facts, stay silent when there's no fit, and bring their owner in when there is. The owner decides. The value comes from facts spread across several people who wouldn't reveal them first, so no platform and no single AI can deliver it.

- **Your pay against people doing your job**, and nobody sees your number.
- **Quietly open to moving**, matched with a company quietly hiring, and each learns of the other only if both fit.
- **Eight tenants with the same problem**, revealed only once enough of them have spoken.

The agent's home is owned by the person and reachable at a key no server controls. The model is rented; the home is theirs.

## Status

Early. This repository holds the rules that don't depend on any one host or transport, as tested reference code on synthetic data:

| Module | What it does |
|---|---|
| `src/event.js` | Nostr-compatible keys and signed events |
| `src/vouch.js` | Invites that become vouches, and a web of trust with accountability |
| `src/trust.js` | Admission tiers for first contacts, decided by code before any model reads anything |
| `src/pool.js` | Group answers that unlock at a threshold, with rounds and a differencing check |
| `src/offers.js` | Signed offers and private judging against the owner's limits |

Nothing here publishes to public relays or handles real data. See [docs/limits.md](docs/limits.md).

## Try it

Requires Node 22 or later.

```
npm install --ignore-scripts
npm test
npm run demo
```

The demo simulates a cold start with synthetic people: one agent alone on day 0 judging public job ads, then three conveners starting invite chains, weekly rounds of group results, progress cards to share, and the admission tiers that result.

## Documents

- [docs/design.md](docs/design.md): the idea, principles, layers and building blocks
- [docs/cold-start.md](docs/cold-start.md): how the network gets from one person to many, with precedents and simulation numbers
- [docs/limits.md](docs/limits.md): what this code does not protect against yet
- [schemas/](schemas/): JSON Schemas and event tags

## Dependencies

Two, pinned to exact versions: `@noble/curves` and `@noble/hashes` (audited, no install scripts, published with provenance). Install with `--ignore-scripts` anyway.

## Licence

Not chosen yet. Until a licence is added, all rights are reserved.
