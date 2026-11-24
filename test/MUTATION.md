# Mutation testing

`npm run test:mutation` breaks the code in small ways (Stryker) and checks that a test fails each time. Line coverage
only shows that code ran; mutation score shows that tests check what it does. Reports go to `reports/` (not in git).

Rule: a change may not lower a module's mutation score. A surviving mutant is either killed by a new test that pins
the exact behaviour, or listed below as equivalent (no input can tell it apart) or unreachable through the public API.

## Scores

Full run on the TypeScript sources, 22 Nov 2026 (3,584 mutants). The "now" column adds the survivors killed by tests
written after that run; each of those kills was checked by applying the mutant to a copy of the code and running the
suite.

| Module | 21 Nov 2026 baseline (JS) | TS run 22 Nov | Now |
|---|---:|---:|---:|
| seal.ts | 67% | 95.96% | 95.96% |
| trust.ts | 63% | 95.12% | 95.12% |
| gate.ts | 68% | 100% | 100% |
| event.ts | 60% | 88.79% | 88.79% |
| knock.ts | 64% | 94.33% | 95.36% |
| vouch.ts | 68% | 95.20% | 95.94% |
| pool.ts | 73% | 97.67% | 97.67% |
| offers.ts | 56% | 96.09% | 96.09% |
| circle.ts | 58% | 98.02% | 98.02% |
| inbox.ts | 77% | 98.90% | 98.90% |
| wants.ts | 69% | 97.69% | 97.69% |
| askaround.ts | 87% | 96.04% | 97.11% |
| decisions.ts | 87% | 96.08% | 97.29% |
| all files | 75.7% | 96.18% | 96.76% |

Every remaining survivor is accepted below.

**Full rerun, 24 Nov 2026** (concurrency 2, 60 s, the guarded runner of `tools/run-mutation.sh`): **96.82%**, 3,470
killed, 114 survived, 0 timed out, 4 mutants not run (no coverage). Per module: askaround 97.22, circle 98.02,
decisions 97.29, event 88.79, gate 100, inbox 98.90, knock 95.36, offers 96.09, pool 97.67, seal 95.96, trust 95.12,
vouch 95.94, wants 97.69. Every one of the 114 survivors has an entry below (checked by script against the report).
This confirms the "Now" column, which was computed from per-mutant replays. (A run on 23 Nov is void: its 2,598
timeouts came from leaking mutants and a loaded machine; see `tools/mutation-test.mjs`.)

**net/binding.ts and net/admission.ts (moved from the bridge, 24 Nov 2026):** first run 75.86% (binding 72.02%,
admission 81.75%; 231 survivors). Their only tests here are the factory kits' recorded scenarios; the bridge's
end-to-end tests cover them too but are not run by Stryker. Guard tests are owed before the next change to either
file; until then this is their baseline.

**didkey.ts (W4 Ed25519 and did:key without Dina), 24 Nov 2026:** first run 92.06% (10 survivors); guard tests killed
6 (4 confirmed by applying the mutant, 2 were message-only variants of the same checks); 4 equivalent, below. Byte
parity with Dina is a bridge test (`didkey_parity.test.ts`).

**entries.ts (W4 circle entries and asks), 24 Nov 2026:** first run 94.20% (16 survivors); guard tests killed 7, each
checked by applying the mutant; the 9 left are accepted below.

**gate.ts, 24 Nov 2026 (knock age window, pruning, snapshots):** the run on the changed file gave 95.12% (10
survivors, all in the new code); guard tests in `gate_window.guards.test.js` then killed 8 of them, each checked by
applying the mutant. The 2 left are accepted below.

**succession.ts (W2 recovery rule), 24 Nov 2026:** first run 85.71% (38 survivors: the property tests never produced a
denial signed by another key, a citation of another claim's conflict, a rival claim below the threshold, duplicate
claim ids, and never asserted the trust flag); guard tests added (`succession.guards.test.js`); second run **95.11%**;
two more survivors then killed (own-claim citation, non-object statement), each checked by applying the mutant. The
remaining 11 are accepted below.

## Two arguments used for many survivors

- **Distinct ids.** Two different events (or offers, or decisions) never share an id, so `<` and `<=` on ids give the
  same answer.
- **Sort comparators.** V8's sort only asks whether the comparator is negative. A mutant that changes a positive
  result to 0, or 0 to a positive result, sorts the same. When the input is already in id order and the sort is stable
  (it always is in V8), a dropped tie-break also sorts the same.

## Accepted survivors

### seal.ts
- L49 `len <= 32` → `len < 32` or `false`: the general formula also gives 32 for every len ≤ 32. Equivalent.
- L50 `len - 1` → `len + 1`: only differs where len or len+1 is a power of two, and there the chunk rounding gives
  the same padded length (checked by hand at 63, 64, 511, 512, 1023, 1024). Equivalent.
- L51 `nextPower <= 256` → `< 256`: at 256 both chunks are 32. Equivalent.
- L69 one of three padding conditions → `false`: `body.length !== len` is implied by the padded-length check.
- L81 AAD length guard and its message: `hmacAad` is only called with the 32-byte nonce sliced from the payload.
  Unreachable.
- L100 data-size bounds: the payload-size check (132–87472 base64 chars) already bounds the decoded size to 99–65603.
  Unreachable through `decrypt`; kept as defence in depth.

### trust.ts
- L49 `e.id > prev.id` → `>=`: distinct ids. Equivalent.
- L51 the p-tag filter (`?? []`, `?? ''`, both regex anchors): the count tests exact membership of the sender's key, so
  malformed tags can never match it either way. Equivalent.
- L72 default `contacts = []` → a placeholder array: it can never contain a real public key. Equivalent.

### event.ts
- L14–15 hex anchors: a longer pubkey or sig makes `hexToBytes`/`schnorr.verify` throw, which `verifyEvent` reports as
  false; through `signEvent` the pubkey is derived, so never malformed. Equivalent at the API.
- L71 object check: `verifyEvent` catches the TypeError a non-object raises anyway; `signEvent` always builds an
  object. Equivalent at the API.
- L74 id format: an id that is not the lowercase hex hash already fails `eventId(e) !== e.id`. Equivalent.
- L71, L73–75 messages: through `signEvent` the event is always an object with a derived pubkey and placeholder id and
  sig, so these messages are never thrown to a caller; `verifyEvent` swallows them. Unreachable at the API.

### knock.ts
- L42 email quantifiers: the pattern is unanchored, so `x+` and `x` match the same texts. Equivalent.
- L47 `?? []` default, L49 the group split: a phone run always ends with a digit and can only start with a separator
  when that separator is `(`, which already marks it as a phone. Equivalent.
- L72 filter of non-text field values, and the `?? ''` note default: the scan loop skips non-strings itself, and a
  placeholder note raises no problem. Equivalent.

### vouch.ts
- L120 `entry.id > prev.id` → `>=`, L132 `at < prev` → `<=`, L143 sort `<` → `<=`: they differ only on equal ids,
  equal times for the same key, or equal issuer+subject keys, none of which change the result. Equivalent.
- L140 destructuring defaults: the key always has both parts. L184, L186 placeholder arrays: a placeholder string is
  never a real key. Equivalent.
- L177 removed-target guard, L178 removed-roots filter: `activeEdges` already drops every edge from or to a removed
  key, so neither changes a hop count (L177 also covers a removed key that is its own root). Redundant guards.
- L187 / L189 BFS `seen` bookkeeping: breadth-first order already returns the shortest distance and `maxHops` bounds
  the loop; only speed changes. Equivalent.

### pool.ts
- L78 `typeof value !== 'number'` → `false`: `Number.isFinite` already rejects every non-number. Equivalent.
- L154 loop bound `r < rows` → `true` / `<=`: once r reaches rows the pivot search finds nothing and continues.
  Equivalent.
- L162 Bareiss `/ prevPivot` → `* prevPivot`: changes the size of entries, never which are zero, so the rank is the
  same (BigInt, no overflow). Equivalent for `rank`.
- L190 early `safe` when there are no small atoms: the full computation gives the same answer. Equivalent.
- L216 canonical tie-break `<` → `<=`: two candidate specs never have the same canonical text. Equivalent.
- L235 pushing a repeated set again: a duplicate row does not change the rank. Equivalent.
- L253 `<` → `<=` on equal rounds: two history rows for the same spec in the same round carry the same result.
  Equivalent.

Note: "fewer than k is not published" is backed by the differencing check, which also refuses a group below k. The
tests pin the k rule itself through what the differencing check cannot show: a group below k must not appear in the
public `waiting` list, and a group of exactly k must be published.

### offers.ts
- L34 the `!= null` guards around `payMin > payMax`: a comparison with `undefined` is already false. Equivalent.
- L74 / L75 / L77 `!= null` → `true`: a missing value becomes `NaN` or repeats `lo`, and every comparison with it gives
  the same verdict (at L77, `hi` is never null: both bounds missing returns earlier). L76 is not equivalent: with a
  floor of 0, `null >= 0` is true; a test pins that case.

### circle.ts
- L19 `Buffer.from(s, 'utf8')` → `''`: an empty encoding name defaults to UTF-8. Equivalent.
- L44 `typeof p.c !== 'string'` → `false`: the hex regex rejects every non-string anyway. Equivalent. The whole
  condition → `false` is not: a malformed code would pass. Pinned 23 Nov (`survivors_2026-11-23.guards.test.js`).

### inbox.ts
- L40 `e.id > best.id` → `>=`: distinct ids. Equivalent.

### wants.ts
- L30 `typeof v === 'object'` → `true`: strings and numbers fail the prototype check anyway. Equivalent.
- L31 the `typeof v === 'number'` part of `isScore`: `Number.isFinite` and the 0..1 range reject every non-number.
  Equivalent.
- L78 trimming when `length > keep` → always / `>=`: slicing the last `keep` of a list that already fits changes
  nothing. Equivalent.
- L93 miss `score < floor` → `<=`: at the floor, the clamped new floor equals the old one and `change` does nothing.
  Equivalent.

### askaround.ts
- L36 `p.length >= 1` → `true`: `split` never returns an empty array. Equivalent.
- L56 email quantifiers, L58 phone-run optional parts: the patterns are unanchored and the digit count decides, so the
  mutants match the same texts. Equivalent.
- L61 joining the request texts with `'\n'` → `''`: not equivalent: a private term would match across two fields
  (note "Gift ab" + category "books…" reads "abbooks"). Pinned 23 Nov (`survivors_2026-11-23.guards.test.js`).
- L111 the `JSON.parse` catch body emptied: `content` stays undefined and the plain-object check right after refuses it
  with the same reason. Equivalent.
- L184 and L228 id comparators: `<=` and the second branch are equivalent (distinct ids). `true`/`false` at L184 and
  the reversed comparator at L228 are not: they change the order of offers and of exclusions. Pinned 23 Nov
  (`survivors_2026-11-23.guards.test.js`).
- L203 `wantTopics` initial value: replaced before use whenever it is given, and an unused placeholder topic scores
  nothing. Equivalent.
- L251–252 the created_at and id tie-breaks of the ranking: the list is already in id order (L228) and the sort is
  stable. Equivalent.
- L255 `result.length > top` → `>=`: at equality both give 0. Equivalent.

### decisions.ts
- L29 `segs.length < 1` → `false`: `split` never returns an empty array. L34 the type check, length check and regex
  anchors: each is implied by the others for every input (an array holding a hex string has length 1). Equivalent.
- L49, L55 `hasOwnProperty` → `true`: decisions are plain objects built by this module, with no inherited enumerable
  keys. Equivalent.
- L118 the last `else if` → `true`: the level was already checked to be one of five; this is the only one left.
  L168–169 the same in `appliesTo`. Unreachable.
- L128 initial `decisionIdx = -1` → `+1`: it is only read after the id was found. L133 placeholder in
  `newDecisions`: in `liftDecision` the list is non-empty and every index is overwritten. Equivalent.
- L157 early return when nothing is active: the matching step then finds nothing and returns the same. Equivalent.
- L180–181 `at` and id tie-breaks, L186 sorting a copy: memory changes only through `recordDecision` (appends with the
  next id) and `liftDecision` (keeps positions), so stored order is id order and the sort is stable; `matching` is a
  fresh array. Equivalent through the API.

### succession.ts
- L99 `st.seenAt < prev.seenAt` → `<=`: two sightings of one claim id at the same time carry the same claim. Equivalent.
- L101 `s.type === 'deny'` → `true`: claims have no `claim` field and attestations no `old`, so the other two conditions
  already keep only denials. Equivalent.
- L110 `st.type !== 'attest'` → `false`: a claim has no `claim` field to look up, and a denial has no attester to be a
  contact. Equivalent.
- L117 the `cites ?? []` default → a placeholder id: no conflict ever has that id. Equivalent.
- L132 the claim-order comparator (five mutants): claim ids are distinct, and V8's sort only asks whether the result is
  negative (see "Sort comparators" above). Equivalent.
- L160 `confirmed.length > 1` → `>= 1`: exactly one confirmation already returned on the line before. Equivalent.
- L166 `settled.length > 1` → `false`: two settled claims are two candidates, so the `candidates.length > 1` check
  below returns disputed anyway. Equivalent.

### gate.ts
- L72 and L185 `#prunedDay = -1` → `+1`: the value only has to differ from every real day number; day 1 (2 January
  1970) is never a receive time. Equivalent.

### entries.ts
- L104, L112 `typeof content !== 'string'` → `false`, and L106, L114 the `catch` body emptied: a non-string or
  unparseable content then fails JSON.parse or the shape check, and the function returns null either way. Equivalent.
- L127 the id tie-break of `candidates` (five mutants): entry ids on one owner's list are distinct, and V8's sort
  only asks whether the comparator is negative (see "Sort comparators" above). Equivalent.

### didkey.ts
- L15, L32 loop bounds `zeros < length` → `true` / `<=`: reading one past the end gives `undefined`, which is neither
  `0` nor `'1'`, so the loop stops at the same place. Equivalent.
- L16 initial digit list with a placeholder string: the string coerces to 0 in the arithmetic and maps to nothing in
  the output, so every input gives the same text. Equivalent.
- L63 the error text inside `edVerify`: the `try` returns false before any message is seen. Equivalent.

