# binding.ts: a home's two keys, bound both ways

Write `binding.ts`: TypeScript that Node runs directly by stripping types. Use only erasable syntax: type annotations, `type` aliases and interfaces are fine, but `enum`, `namespace`, parameter properties and decorators are not. The file has no imports and touches no clock, randomness, network, console or globals. Every function is pure: it never changes its arguments.

## Background

Each home has two keys:
- a **did**, a Dina identity of the form `did:key:z…`;
- a **nostr** key: 64 lowercase hex characters.

A **pair statement** says "this did and this nostr key belong together", and it is signed by both keys. The nostr key signs it as a Nostr event, and the did's key signs a fixed text that goes in a tag.

If one key is lost, the owner publishes a new pair that keeps the surviving key and adds a new one. That is a **rebind**. A rebind takes effect only after a delay, and during the delay the key being replaced can cancel it. This stops a thief who stole one key from silently taking over.

You never do cryptography. Signature checks are injected:

```ts
type Ev = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
type Deps = {
  verifyEvent: (e: Ev) => boolean;                              // checks the Nostr event's id and signature by e.pubkey
  verifyEd: (did: string, text: string, sigHex: string) => boolean; // checks an Ed25519 signature by the did's key over text
};
```

Treat a dep that throws, or returns anything other than `true`, as `false`.

## Shared rules

- **DID:** a value of type string that matches `/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,60}$/`.
- **HEX64:** a value of type string that matches `/^[0-9a-f]{64}$/`. **HEX128:** the same with `/^[0-9a-f]{128}$/`.
- Always check `typeof x === 'string'` before a regex: `RegExp.test` turns arrays and numbers into strings, so `['ab…']` would pass.
- **Time:** a safe integer ≥ 0 (`Number.isSafeInteger(n) && n >= 0`). Times are in seconds.
- `DAY = 86400`.

## Exports (exactly these seven names)

### `BIND_KIND`
The constant `17790`.

### `pairText(did, nostr, createdAt, expiresAt)`
Returns the text the did key signs:

```
synalla-pair-v1\n<did>\n<nostr>\n<createdAt>\n<expiresAt, or the word none when expiresAt is null>
```

Throw a `TypeError` in these cases, checked in this order:
- `did` is not a DID;
- `nostr` is not HEX64;
- `createdAt` is not a Time;
- `expiresAt` is neither `null` nor a Time greater than `createdAt`.

### `cancelText(targetId)`
Returns `synalla-cancel-v1\n<targetId>`. Throw a `TypeError` if `targetId` is not HEX64.

### `pairTemplate({ did, nostr, createdAt, expiresAt, edSig })`
1. Validate the first four fields exactly as `pairText` does, throwing the same errors.
2. Throw a `TypeError` if `edSig` is not HEX128.
3. Return a new object:
   ```
   { kind: 17790, created_at: createdAt, tags, content: '' }
   ```
   `tags` is `[['t','pair'], ['did', did], ['ed-sig', edSig]]`. When `expiresAt` is not null, append `['expires', String(expiresAt)]`.

The nostr key is not in the tags: it becomes the event's `pubkey` when the caller signs the event.

### `cancelTemplate({ targetId, createdAt, did?, edSig? })`
1. Validate `targetId` as `cancelText` does.
2. Throw a `TypeError` if `createdAt` is not a Time.
3. Start with `tags = [['t','cancel'], ['e', targetId]]`.
4. If `did` or `edSig` is not `undefined`, both must be valid: throw a `TypeError` if `did` is not a DID, then if `edSig` is not HEX128. Then append `['did', did], ['ed-sig', edSig]`.
5. Return `{ kind: 17790, created_at: createdAt, tags, content: '' }`.

A cancel without `did` is a **nostr cancel**: it is signed by the nostr key being replaced. A cancel with `did` is an **ed cancel**: the did's key signs `cancelText(targetId)`, and any Nostr key may publish the event.

### `readStatement(event, deps)`
Checks one event. It never throws. On failure it returns `{ ok: false, reason }`, where `reason` is a non-empty string; the wording is free. Checks, in this order:

1. `event` is a non-null object and not an array.
2. `id` is HEX64, and `pubkey` is HEX64.
3. `created_at` is a Time, `kind === 17790`, `content === ''`, and `sig` is a string.
4. `tags` is an array. Each tag must be an array of exactly 2 strings. The tag name must be one of `t`, `did`, `ed-sig`, `expires` or `e`, and no name may appear twice.
5. `deps.verifyEvent(event)` is true.
6. When the `t` tag is `pair`:
   - An `e` tag makes it invalid.
   - `did` and `ed-sig` tags must exist, with `did` a DID and `ed-sig` HEX128.
   - If an `expires` tag exists, its value must match `/^(0|[1-9][0-9]{0,15})$/`. `Number` of it must be a Time greater than `created_at`. Otherwise `expiresAt` is `null`.
   - `deps.verifyEd(did, pairText(did, pubkey, created_at, expiresAt), edSig)` must be true.
   - Result: `{ ok: true, type: 'pair', id, did, nostr: pubkey, createdAt: created_at, expiresAt }`.
7. When the `t` tag is `cancel`:
   - An `expires` tag makes it invalid.
   - An `e` tag must exist and be HEX64. It is the `target`.
   - With neither `did` nor `ed-sig`: `{ ok: true, type: 'cancel', id, target, by: 'nostr', key: pubkey, createdAt: created_at }`.
   - Otherwise both are required, with `did` a DID and `ed-sig` HEX128. `deps.verifyEd(did, cancelText(target), edSig)` must be true. Result: `{ ok: true, type: 'cancel', id, target, by: 'ed', key: did, createdAt: created_at }`.
8. Any other `t` value, or no `t` tag at all, is invalid.

Result objects have exactly the fields listed, in any order.

### `resolve(items, key, now, deps, opts?)`
Who is `key` (a DID or a HEX64 nostr key) bound to right now? `items` is an array of `{ event, seenAt }`; `seenAt` is when this home first saw the event (only the home knows this time, so it cannot be faked by the sender).

`opts`: if it is not a non-null object (missing, `null`, a number, a string...), use `{}`. `delay` = `opts.delay` unless that is `undefined`, then `7 * DAY`; `skew` = `opts.skew` unless `undefined`, then `600`.

Throw `TypeError`, in this order: `items` is not an array; `key` is neither DID nor HEX64; `now` is not a Time; `delay` or `skew` is not a Time (so `null` throws).

**Step 1, collect.** Skip an item that is not a non-null object, whose `seenAt` is not a Time or is greater than `now`, that fails `readStatement`, or whose statement `createdAt` is greater than `now + skew`. When several items share a statement id, keep one: the one with the smallest `seenAt` (the first one on a tie).

Each kept pair gets an **entry time** `t = max(createdAt, seenAt)`. Sort the pairs by `t`, then by `id` (plain string comparison `<`). Cancels are kept aside with their `seenAt`.

**Step 2, the timeline.** Keep a list of **identities**, in creation order (index 0, 1, ...). Each identity has a current `did`, `nostr`, `since`, `expiresAt`, and `ever`: the set of every key it has held. An identity **holds** a key when the key equals its current `did` or `nostr`. Keep a **queue** of scheduled rebinds `{ t, id, s, who }` (`who` = the identity's index).

A scheduled rebind `q` is **valid** at a moment when all of these hold for identity `x = identities[q.who]` as it is at that moment:
- `q.s` shares exactly one key with `x` (`(q.s.did === x.did) !== (q.s.nostr === x.nostr)`);
- with `by = 'nostr'` if the did is shared (the nostr key is being replaced), else `'ed'`; `replaced` = `x.nostr` when `by` is `'nostr'`, else `x.did`; `added` = the other key of `q.s` (`q.s.nostr` when `by` is `'nostr'`, else `q.s.did`): no *other* identity currently holds `added`;
- no kept cancel `c` has `c.target === q.s.id`, `c.by === by`, `c.key === replaced` and `c.seenAt < q.t`.

Repeat:
1. Sort the queue by `t`, then `id`. Let `a` be its first element and `e` the next unprocessed pair.
2. If `a` exists, `a.t <= now`, and (`e` does not exist or `a.t <= e.t`): remove `a` from the queue. If `a` is valid, the identity takes `a.s`'s keys: `did`, `nostr` and `expiresAt` from `a.s`, `since = a.t`; add both keys to `ever`. Go back to 1.
3. Otherwise, if `e` does not exist or `e.t > now`: stop.
4. Otherwise process `e` (then move to the next pair). Find the identities that hold `e.s.did` or `e.s.nostr`:
   - none: create a new identity `{ did, nostr, since: e.t, expiresAt, ever: {did, nostr} }` from `e.s`;
   - exactly one, `x`, holding both of `e`'s keys: a refresh, set `x.expiresAt = e.s.expiresAt` (keep `since`);
   - exactly one, `x`, holding only one of them: schedule `{ t: e.t + delay, id: e.s.id, s: e.s, who: x's index }`;
   - two or more: ignore `e` (a pair may never join two identities).

**Step 3, result.**
- `who` = the first identity that holds `key`; if none, the first identity whose `ever` contains `key`.
- If there is no such identity: return `{ status: 'unbound' }` if some kept pair has `key` as its did or nostr, else `{ status: 'none' }`.
- Otherwise, for identity `x`: `status` is `'replaced'` if `x` does not hold `key`; else `'expired'` if `x.expiresAt` is not null and `now >= x.expiresAt`; else `'active'`.
- `pending` = the queue entries with `who` equal to this identity, `t > now`, and valid now, sorted by `t` then `id`, each mapped to `{ id: s.id, did: s.did, nostr: s.nostr, effectiveAt: t }`. It is always an array (possibly empty).
- Return `{ status, did: x.did, nostr: x.nostr, since: x.since, expiresAt: x.expiresAt, pending }`.

Return plain new objects that share nothing with the inputs.

## Checks

Run `node public.test.mjs`. The file must stay under 300 lines, with no line over 200 characters.
