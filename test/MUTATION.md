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
