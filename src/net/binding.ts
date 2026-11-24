// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
// Built from the factory contract in software-factory/binding (reference version).

// Reference for binding.ts: a home's two keys (Dina did:key and Nostr key), bound both ways.

/** Final (22 Nov 2026): replaceable kind for a home's two-key binding; pinned by __tests__/kinds.test.ts. */
export const BIND_KIND = 19469;

const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,60}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const DAY = 86400;

type Ev = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
type Deps = { verifyEvent: (e: Ev) => boolean; verifyEd: (did: string, text: string, sigHex: string) => boolean };
type Item = { event: Ev; seenAt: number };

const isTime = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const isDid = (x: unknown): x is string => typeof x === 'string' && DID_RE.test(x);
const isHex = (x: unknown, re: RegExp): x is string => typeof x === 'string' && re.test(x);

export function pairText(did: string, nostr: string, createdAt: number, expiresAt: number | null): string {
  if (!isDid(did)) throw new TypeError('bad did');
  if (!isHex(nostr, HEX64)) throw new TypeError('bad nostr key');
  if (!isTime(createdAt)) throw new TypeError('bad createdAt');
  if (expiresAt !== null && (!isTime(expiresAt) || expiresAt <= createdAt)) throw new TypeError('bad expiresAt');
  return `synalla-pair-v1\n${did}\n${nostr}\n${createdAt}\n${expiresAt === null ? 'none' : expiresAt}`;
}

export function cancelText(targetId: string): string {
  if (!isHex(targetId, HEX64)) throw new TypeError('bad target id');
  return `synalla-cancel-v1\n${targetId}`;
}

export function pairTemplate(p: { did: string; nostr: string; createdAt: number; expiresAt: number | null; edSig: string }) {
  pairText(p.did, p.nostr, p.createdAt, p.expiresAt);
  if (!isHex(p.edSig, HEX128)) throw new TypeError('bad edSig');
  const tags = [['t', 'pair'], ['did', p.did], ['ed-sig', p.edSig]];
  if (p.expiresAt !== null) tags.push(['expires', String(p.expiresAt)]);
  return { kind: BIND_KIND, created_at: p.createdAt, tags, content: '' };
}

export function cancelTemplate(p: { targetId: string; createdAt: number; did?: string; edSig?: string }) {
  cancelText(p.targetId);
  if (!isTime(p.createdAt)) throw new TypeError('bad createdAt');
  const tags = [['t', 'cancel'], ['e', p.targetId]];
  if (p.did !== undefined || p.edSig !== undefined) {
    if (!isDid(p.did)) throw new TypeError('bad did');
    if (!isHex(p.edSig, HEX128)) throw new TypeError('bad edSig');
    tags.push(['did', p.did], ['ed-sig', p.edSig]);
  }
  return { kind: BIND_KIND, created_at: p.createdAt, tags, content: '' };
}

function safe(f: () => boolean): boolean {
  try { return f() === true; } catch { return false; }
}

export function readStatement(event: unknown, deps: Deps) {
  const bad = (reason: string) => ({ ok: false, reason });
  const e = event as Ev;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return bad('not an event');
  if (!isHex(e.id, HEX64) || !isHex(e.pubkey, HEX64)) return bad('bad id or pubkey');
  if (!isTime(e.created_at) || e.kind !== BIND_KIND || e.content !== '' || typeof e.sig !== 'string') return bad('bad fields');
  if (!Array.isArray(e.tags)) return bad('bad tags');
  const tags = new Map<string, string>();
  for (const t of e.tags) {
    if (!Array.isArray(t) || t.length !== 2 || typeof t[0] !== 'string' || typeof t[1] !== 'string') return bad('bad tag');
    if (!['t', 'did', 'ed-sig', 'expires', 'e'].includes(t[0])) return bad('unknown tag');
    if (tags.has(t[0])) return bad('repeated tag');
    tags.set(t[0], t[1]);
  }
  if (!safe(() => deps.verifyEvent(e))) return bad('bad event signature');
  const type = tags.get('t');
  if (type === 'pair') {
    if (tags.has('e')) return bad('unknown tag');
    const did = tags.get('did'), edSig = tags.get('ed-sig'), exp = tags.get('expires');
    if (!isDid(did) || !isHex(edSig, HEX128)) return bad('bad pair tags');
    let expiresAt: number | null = null;
    if (exp !== undefined) {
      if (!/^(0|[1-9][0-9]{0,15})$/.test(exp)) return bad('bad expires');
      expiresAt = Number(exp);
      if (!isTime(expiresAt) || expiresAt <= e.created_at) return bad('bad expires');
    }
    const text = pairText(did, e.pubkey, e.created_at, expiresAt);
    if (!safe(() => deps.verifyEd(did, text, edSig))) return bad('bad ed25519 signature');
    return { ok: true, type: 'pair', id: e.id, did, nostr: e.pubkey, createdAt: e.created_at, expiresAt };
  }
  if (type === 'cancel') {
    if (tags.has('expires')) return bad('unknown tag');
    const target = tags.get('e');
    if (!isHex(target, HEX64)) return bad('bad cancel target');
    const did = tags.get('did'), edSig = tags.get('ed-sig');
    if (did === undefined && edSig === undefined) {
      return { ok: true, type: 'cancel', id: e.id, target, by: 'nostr', key: e.pubkey, createdAt: e.created_at };
    }
    if (!isDid(did) || !isHex(edSig, HEX128)) return bad('bad cancel tags');
    if (!safe(() => deps.verifyEd(did, cancelText(target), edSig))) return bad('bad ed25519 signature');
    return { ok: true, type: 'cancel', id: e.id, target, by: 'ed', key: did, createdAt: e.created_at };
  }
  return bad('unknown statement type');
}

const byTimeThenId = (a: { t: number; id: string }, b: { t: number; id: string }) =>
  a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function resolve(items: Item[], key: string, now: number, deps: Deps, opts?: { delay?: number; skew?: number }) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!isDid(key) && !isHex(key, HEX64)) throw new TypeError('bad key');
  if (!isTime(now)) throw new TypeError('bad now');
  const o: any = opts !== null && typeof opts === 'object' ? opts : {};
  const delay = o.delay === undefined ? 7 * DAY : o.delay;
  const skew = o.skew === undefined ? 600 : o.skew;
  if (!isTime(delay) || !isTime(skew)) throw new TypeError('bad opts');

  // 1. collect
  const kept = new Map<string, { s: any; seenAt: number }>();
  for (const it of items) {
    if (!it || typeof it !== 'object' || !isTime(it.seenAt) || it.seenAt > now) continue;
    const s: any = readStatement(it.event, deps);
    if (!s.ok || s.createdAt > now + skew) continue;
    const old = kept.get(s.id);
    if (!old || it.seenAt < old.seenAt) kept.set(s.id, { s, seenAt: it.seenAt });
  }
  const entries = [...kept.values()].filter(x => x.s.type === 'pair')
    .map(x => ({ t: Math.max(x.s.createdAt, x.seenAt), id: x.s.id, s: x.s })).sort(byTimeThenId);
  const cancels = [...kept.values()].filter(x => x.s.type === 'cancel');

  // 2. the timeline: identities start at a pair's entry time; a rebind takes effect `delay` later
  const ids: { did: string; nostr: string; since: number; expiresAt: number | null; ever: Set<string> }[] = [];
  const queue: { t: number; id: string; s: any; who: number }[] = [];
  const holds = (x: { did: string; nostr: string }, k: string) => x.did === k || x.nostr === k;
  const shareOne = (x: { did: string; nostr: string }, s: any) => (s.did === x.did) !== (s.nostr === x.nostr);
  const valid = (q: { t: number; s: any; who: number }) => {
    const x = ids[q.who]!; // who is always the index of an identity in ids
    if (!shareOne(x, q.s)) return false;
    const by = q.s.did === x.did ? 'nostr' : 'ed';
    const replaced = by === 'nostr' ? x.nostr : x.did;
    const added = by === 'nostr' ? q.s.nostr : q.s.did;
    if (ids.some((y, j) => j !== q.who && holds(y, added))) return false;
    return !cancels.some(c => c.s.target === q.s.id && c.s.by === by && c.s.key === replaced && c.seenAt < q.t);
  };
  let i = 0;
  for (;;) {
    queue.sort(byTimeThenId);
    const a = queue[0], e = entries[i];
    if (a !== undefined && a.t <= now && (e === undefined || a.t <= e.t)) {
      queue.shift();
      if (valid(a)) {
        const x = ids[a.who]!;
        Object.assign(x, { did: a.s.did, nostr: a.s.nostr, since: a.t, expiresAt: a.s.expiresAt });
        x.ever.add(a.s.did); x.ever.add(a.s.nostr);
      }
      continue;
    }
    if (e === undefined || e.t > now) break;
    i++;
    const touch = ids.map((x, j) => (holds(x, e.s.did) || holds(x, e.s.nostr) ? j : -1)).filter(j => j >= 0);
    if (touch.length === 0) {
      ids.push({ did: e.s.did, nostr: e.s.nostr, since: e.t, expiresAt: e.s.expiresAt, ever: new Set([e.s.did, e.s.nostr]) });
    } else if (touch.length === 1) {
      const w = touch[0]!, x = ids[w]!; // touch holds indexes found in ids
      if (x.did === e.s.did && x.nostr === e.s.nostr) x.expiresAt = e.s.expiresAt;
      else queue.push({ t: e.t + delay, id: e.s.id, s: e.s, who: w });
    }
  }

  // 3. result
  let who = ids.findIndex(x => holds(x, key));
  if (who === -1) who = ids.findIndex(x => x.ever.has(key));
  if (who === -1) return { status: entries.some(e => holds(e.s, key)) ? 'unbound' : 'none' };
  const x = ids[who]!; // who >= 0 here
  const pending = queue.filter(q => q.who === who && q.t > now && valid(q)).sort(byTimeThenId)
    .map(q => ({ id: q.s.id, did: q.s.did, nostr: q.s.nostr, effectiveAt: q.t }));
  const status = !holds(x, key) ? 'replaced' : x.expiresAt !== null && now >= x.expiresAt ? 'expired' : 'active';
  return { status, did: x.did, nostr: x.nostr, since: x.since, expiresAt: x.expiresAt, pending };
}
