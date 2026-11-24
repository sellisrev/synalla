# admission.ts: what an incoming message gets

Write `admission.ts`: TypeScript that Node runs directly by stripping types. Use only erasable syntax: no `enum`, `namespace`, parameter properties or decorators. The file has no imports and touches no clock, randomness, network, console or globals. Every function is pure: it never changes its arguments, and it returns new objects that share nothing with its inputs.

## Background

A home receives messages from other homes. Before the Dina pipeline sees a message, this module decides one of three routes:
- **`dina`:** pass the message to Dina with a trust level. Dina stages a message from a known level and quarantines one from `'unknown'`.
- **`knock`:** hand the message to the separate knock gate.
- **`drop`:** refuse it.

Inputs come from two places:
- The sender's **tier**, `'A' | 'B' | 'C' | 'D'`, which Synalla computes from vouches and proofs.
- The sender's **dinaTrust**, its level in the owner's Dina contact list. This is `''` when the sender is not a contact.

## Exports (exactly these four)

- `CONTACT_LEVELS`: `['verified', 'trusted', 'contact_ring1', 'contact_ring2', 'self']`, frozen with `Object.freeze`.
- `DEFAULT_POLICY`: `{ perDay: { A: 100, B: 5 }, knockType: 'synalla.knock', maxSenders: 10000 }`, frozen with `Object.freeze` (and `perDay` frozen too).
- `emptyState()`: returns a new `{ version: 1, day: -1, counts: [] }` on every call.
- `admit(input, state, policy?)`: returns `{ decision: { route, senderTrust, reasons }, state }`. `reasons` is an array with exactly one string.

## Definitions

- **Time:** a safe integer ≥ 0.
- **HEX64:** a string matching `/^[0-9a-f]{64}$/`.
- **State:** `{ version: 1, day, counts }`. `counts` is an array of `[sender, n]` pairs. It counts how many messages each sender has had routed to `dina` by the tier rules (steps 9 and 10 below) during `day`.

## `admit(input, state, policy?)`

### 1. Policy
An `undefined` or `null` policy means the defaults. Otherwise:
- The policy must be a non-array object, or throw a `TypeError`.
- `perDay`:
  - When present and not `undefined`, it must be a non-null, non-array object, or throw a `TypeError`. A key that is present with the value `undefined` counts as missing, here and for every other policy key.
  - Each of its keys `A` and `B`, when not `undefined`, must be a Time, or throw a `TypeError`. Check `A` first.
  - A missing or `undefined` key takes its default value.
- `knockType`: when present and not `undefined`, it must be a non-empty string, or throw a `TypeError`. Otherwise it takes the default.
- `maxSenders`: when present and not `undefined`, it must be a Time, or throw a `TypeError`. Otherwise it takes the default.

Check `perDay` first, then `knockType`, then `maxSenders`.

### 2. State
The state must be valid, or throw a `TypeError`. Valid means:
- a non-null, non-array object with `version === 1`;
- `day` is a safe integer ≥ -1;
- `counts` is an array of 2-item arrays `[sender, n]`, where `sender` is HEX64 and `n` is a safe integer ≥ 1;
- senders are in strictly increasing string order.

The policy is checked before the state.

### 3. Input
The input must be a non-null, non-array object with these fields:
- `tier`: one of `'A'`, `'B'`, `'C'` or `'D'`;
- `dinaTrust`: a string of at most 32 characters;
- `type`: a string of 1 to 100 characters;
- `sender`: HEX64;
- `now`: a Time.

If the input is not valid, do not throw. Return route `'drop'`, senderTrust `'unknown'` and reasons `['bad input']`, with a copy of the given state, unchanged.

A copy of a state always has exactly the fields `version`, `day` and `counts`; any other field of the given state is left out.

### 4. Day roll
`day = Math.floor(now / 86400)`. If `day` is greater than `state.day`, the working state becomes `{ version: 1, day, counts: [] }`. Otherwise (the same day, or a clock that went backwards) it is a copy of the given state: the day never moves backwards and counts are never reset by an earlier `now`. Every result below returns this working state, except rule 10, which returns it with one count added.

### 5. Rules
The first rule that matches decides:

| # | Condition | route | senderTrust | reason |
|---|---|---|---|---|
| 5 | `dinaTrust.trim().toLowerCase() === 'blocked'` | `drop` | `'blocked'` | `blocked contact` |
| 6 | `dinaTrust` is in `CONTACT_LEVELS` | `dina` | `dinaTrust` | `existing contact` |
| 7 | `tier === 'D'` | `drop` | `'unknown'` | `tier D: no contact, vouch or proof` |
| 8 | `type === knockType` | `knock` | `'unknown'` | `knock: the gate decides` |
| 8b | `tier === 'C'` | `drop` | `'unknown'` | `tier C may only knock` |
| 9 | `used >= limit` (see below) | `drop` | `'unknown'` | `daily limit for tier <tier> reached` |
| 9b | the sender has no entry yet and `counts.length >= maxSenders` | `drop` | `'unknown'` | `too many senders today` |
| 10 | tier `A` | `dina` | `'contact_ring2'` | `tier A: vouched` |
| 10 | tier `B` | `dina` | `'unknown'` | `tier B: held for you to accept` |

For rules 9 and 10:
- `limit` is `perDay.A` for tier A and `perDay.B` for tier B.
- `used` is the sender's count in the working state, or 0 if the sender has none.
- When rule 10 applies, the returned state has the sender's count set to `used + 1`. `counts` stays sorted by sender in string order, with one entry per sender.

Any other `dinaTrust` string, such as `''`, `'unknown'` or `'friend'`, is not a contact level. It falls through to the tier rules.

Knocks (rule 8) are not counted here: the knock gate has its own per-sender and daily limits.

## Checks

Run `node public.test.mjs`. The file must stay under 300 lines, with no line over 200 characters.
