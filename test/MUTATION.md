# Mutation testing

`npm run test:mutation` breaks the code in small ways (Stryker) and checks that a test fails each time. Line coverage
only shows that code ran; mutation score shows that tests check what it does. Reports go to `reports/` (not in git).

Rule: a change may not lower a module's mutation score. A surviving mutant is either killed by a new test that pins
the exact behaviour, or listed below as equivalent (no input can tell it apart) or unreachable through the public API.

## Scores

| Module | 21 Nov 2026 baseline | Now |
|---|---:|---:|
| seal.js | 67% | 94% (all remaining survivors accepted below) |
| trust.js | 63% | 95% (all remaining survivors accepted below) |
| gate.js | 68% | 100% |
| event.js | 60% | 89% (all remaining survivors accepted below) |
| knock.js | 64% | 94% (all remaining survivors accepted below) |
| vouch.js | 68% | 94% (all remaining survivors accepted below) |
| pool.js | 73% | 97% (all remaining survivors accepted below) |
| offers.js | 56% | 96% (all remaining survivors accepted below) |
| circle.js | 58% | 98% (all remaining survivors accepted below) |
| inbox.js | 77% | 99% (remaining survivor accepted below) |
| wants.js | 69% | 98% (all remaining survivors accepted below) |
| all files | 75.7% | (rerun pending) |

## Accepted survivors

### seal.js
- L45 `len <= 32` → `len < 32` or `false`: the general formula also gives 32 for every len ≤ 32. Equivalent.
- L46 `len - 1` → `len + 1`: only differs where len or len+1 is a power of two, and there the chunk rounding gives
  the same padded length (checked by hand at 63, 64, 511, 512, 1023, 1024). Equivalent.
- L47 `nextPower <= 256` → `< 256`: at 256 both chunks are 32. Equivalent.
- L65 one of three padding conditions → `false`: `body.length !== len` is implied by the padded-length check.
- L77 AAD length guard: `hmacAad` is only called with the 32-byte nonce sliced from the payload. Unreachable.
- L96 data-size bounds: the payload-size check (132–87472 base64 chars) already bounds the decoded size to 99–65603.
  Unreachable through `decrypt`; kept as defence in depth.

### trust.js
- L42 `e.id > prev.id` → `>=`: two different events never share an id. Equivalent.
- L44 the p-tag filter (`?? []`, both regex anchors, the default): the count tests exact membership of the sender's
  key, so malformed tags can never match it either way. Equivalent.
- L65 default `contacts = []` → a placeholder array: it can never contain a real public key. Equivalent.

### event.js
- L14–15 hex anchors: a longer pubkey or sig makes `hexToBytes`/`schnorr.verify` throw, which `verifyEvent` reports as
  false; through `signEvent` the pubkey is derived, so never malformed. Equivalent at the API.
- L53 object check: `verifyEvent` catches the TypeError a non-object raises anyway; `signEvent` always builds an
  object. Equivalent at the API.
- L55 id format: an id that is not the lowercase hex hash already fails `eventId(e) !== e.id`. Equivalent.

### knock.js
- L35 email quantifiers: the pattern is unanchored, so `x+` and `x` match the same texts. Equivalent.
- L40 `?? []` default, L42 the group split: a phone run always ends with a digit and can only start with a separator
  when that separator is `(`, which already marks it as a phone. Equivalent.
- L64 filter of non-text field values: the scan loop skips non-strings itself. Equivalent (redundant guard).

### vouch.js
- L111 `entry.id > prev.id` → `>=`, L123 `at < prev` → `<=`, L134 sort `<` → `<=`: they differ only on equal ids,
  equal times for the same key, or equal issuer+subject keys, none of which change the result. Equivalent.
- L143, L173, L179, L181 placeholder arrays: a placeholder string is never a real key. Equivalent.
- L168 removed-target guard, L169 removed-roots filter: `activeEdges` already drops every edge from or to a removed
  key, so neither changes a hop count (L168 also covers a removed key that is its own root). Redundant guards.
- L182 / L184 BFS `seen` bookkeeping: breadth-first order already returns the shortest distance and `maxHops` bounds
  the loop; only speed changes. Equivalent.

### pool.js
- L65 `typeof value !== 'number'` → `false`: `Number.isFinite` already rejects every non-number. Equivalent.
- L141 loop bound `r < rows` → `true` / `<=`: once r reaches rows the pivot search finds nothing and continues.
  Equivalent.
- L147 Bareiss `/ prevPivot` → `* prevPivot`: changes the size of entries, never which are zero, so the rank is the
  same (BigInt, no overflow). Equivalent for `rank`.
- L178 early `safe` when there are no small atoms: the full computation gives the same answer. Equivalent.
- L209 canonical tie-break `<` → `<=`: two candidate specs never have the same canonical text. Equivalent.
- L228 pushing a repeated set again: a duplicate row does not change the rank. Equivalent.
- L246 `<` → `<=` on equal rounds: two history rows for the same spec in the same round carry the same result.
  Equivalent.

Note: "fewer than k is not published" (L219) is backed by the differencing check, which also refuses a group below k.
The tests pin L219 itself through what the differencing check cannot show: a group below k must not appear in the
public `waiting` list, and a group of exactly k must be published.

### offers.js
- L26 the `!= null` guards around `payMin > payMax`: a comparison with `undefined` is already false. Equivalent.
- L70 / L71 / L73 `!= null` → `true`: a missing value becomes `NaN` or repeats `lo`, and every comparison with it gives
  the same verdict. Equivalent. (L72 is not: with a floor of 0, `null >= 0` is true; a test pins that case.)

### circle.js
- L13 `Buffer.from(s, 'utf8')` → `''`: an empty encoding name defaults to UTF-8. Equivalent.
- L39 `typeof p.c !== 'string'` → `false`: the hex regex rejects every non-string anyway. Equivalent.

### inbox.js
- L36 `e.id > best.id` → `>=`: two different events never share an id. Equivalent.

### wants.js
- L22 `typeof v === 'object'` → `true`: strings and numbers fail the prototype check anyway. Equivalent.
- L23 the `typeof v === 'number'` part of `isScore`: `Number.isFinite` and the 0..1 range reject every non-number.
  Equivalent.
- L70 trimming when `length > keep` → always / `>=`: slicing the last `keep` of a list that already fits changes
  nothing. Equivalent.
- L85 miss `score < floor` → `<=`: at the floor, the clamped new floor equals the old one and `change` does nothing.
  Equivalent.
