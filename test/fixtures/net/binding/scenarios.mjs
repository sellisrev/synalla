// Random scenarios for binding.ts. Data for the tests: don't change this file.
// Signatures are fake but strict: FAKE.verifyEvent and FAKE.verifyEd accept only what FAKE.signEvent / FAKE.edSign made.

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function hashHex(text, len) {
  let out = '', h = 2166136261 >>> 0, i = 0;
  while (out.length < len) {
    for (const ch of text + '#' + i) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    out += h.toString(16).padStart(8, '0'); i++;
  }
  return out.slice(0, len);
}

export const FAKE = {
  edSign: (did, text) => hashHex('ed|' + did + '|' + text, 128),
  signEvent(t, pubkey) {
    const id = hashHex(JSON.stringify([pubkey, t.created_at, t.kind, t.tags, t.content]), 64);
    return { id, pubkey, created_at: t.created_at, kind: t.kind, tags: t.tags, content: t.content, sig: 'sig:' + id + ':' + pubkey };
  },
};
export const DEPS = {
  verifyEvent: e => e.sig === 'sig:' + e.id + ':' + e.pubkey,
  verifyEd: (did, text, sig) => sig === FAKE.edSign(did, text),
};
const ALT = {
  ok: DEPS,
  throwEd: { verifyEvent: DEPS.verifyEvent, verifyEd: () => { throw new Error('x'); } },
  oneEd: { verifyEvent: DEPS.verifyEvent, verifyEd: () => 1 },
  throwEv: { verifyEvent: () => { throw new Error('x'); }, verifyEd: DEPS.verifyEd },
};
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const did = n => 'did:key:z6Mk' + Array.from({ length: 44 }, (_, i) => B58[(n * 7 + i * 13) % 58]).join('');
export const npub = n => hashHex('nostr' + n, 64);
export const KIND = 19469; // the final binding kind (was 17790 when the kit was written)

export function pairEvent({ d, n, at, exp = null, badEd = false, badSig = false, extraTags = [] }) {
  const text = `synalla-pair-v1\n${d}\n${n}\n${at}\n${exp === null ? 'none' : exp}`;
  const tags = [['t', 'pair'], ['did', d], ['ed-sig', badEd ? FAKE.edSign(d, text + 'x') : FAKE.edSign(d, text)]];
  if (exp !== null) tags.push(['expires', String(exp)]);
  const e = FAKE.signEvent({ kind: KIND, created_at: at, tags: [...tags, ...extraTags], content: '' }, n);
  if (badSig) e.sig = 'sig:' + '0'.repeat(64) + ':' + n;
  return e;
}
export function cancelEvent({ target, at, byNostr, byDid, publisher }) {
  const tags = [['t', 'cancel'], ['e', target]];
  if (byDid) tags.push(['did', byDid], ['ed-sig', FAKE.edSign(byDid, `synalla-cancel-v1\n${target}`)]);
  return FAKE.signEvent({ kind: KIND, created_at: at, tags, content: '' }, byNostr ?? publisher);
}

// Signed but malformed: each passes both signature checks, so only the shape rules can reject it.
export function oddSigned(r, d, n, at) {
  const pick = a => a[Math.floor(r() * a.length)];
  const kind = Math.floor(r() * 7);
  const sign = (exp, extra = []) => {
    const text = `synalla-pair-v1\n${d}\n${n}\n${at}\n${exp === null ? 'none' : exp}`;
    return [['t', 'pair'], ['did', d], ['ed-sig', FAKE.edSign(d, text)], ...extra];
  };
  let tags;
  if (kind === 0) tags = [['t', 'pair'], ['did', d, 'extra'], ['ed-sig', FAKE.edSign(d, `synalla-pair-v1\n${d}\n${n}\n${at}\nnone`)]];
  else if (kind === 1) tags = sign(at + 5, [['expires', at + 5]]);
  else if (kind === 2) { const raw = pick(['0' + (at + 9), String(at + 9) + '.0', ' ' + (at + 9), '1e10', '0x' + (at + 9).toString(16)]); tags = sign(Number(raw), [['expires', raw]]); }
  else if (kind === 3) tags = sign(at, [['expires', String(at)]]);
  else if (kind === 4) tags = sign(at + 1, [['expires', String(at + 1)]]);
  else if (kind === 5) return FAKE.signEvent({ kind: KIND, created_at: at, tags: [['t', 'cancel'], ['e', n], ['did', d]], content: '' }, n);
  else return FAKE.signEvent({ kind: KIND, created_at: at, tags: [['t', 'cancel'], ['e', n], ['ed-sig', FAKE.edSign(d, 'synalla-cancel-v1\n' + n)]], content: '' }, n);
  return FAKE.signEvent({ kind: KIND, created_at: at, tags, content: '' }, n);
}

const ODD = [null, undefined, 0, 1.5, -3, '', 'x', [], {}, ['t'], [1, 2], NaN, '__proto__', 'constructor', 2 ** 60];

export function makeScenario(seed) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const D = [1, 2, 3, 4].map(did), N = [1, 2, 3, 4, 5, 6].map(npub);
  const DAY = 86400, T0 = 1_800_000_000;
  const steps = [];
  const events = [];
  let t = T0;

  // A legit home, then rebinds (some hostile), cancels, refreshes and noise.
  const homeD = pick(D), homeN = pick(N);
  events.push({ e: pairEvent({ d: homeD, n: homeN, at: t, exp: r() < 0.3 ? t + int(1, 400) * DAY : null }), seen: t + int(0, 50) });
  const nOps = int(3, 12);
  for (let i = 0; i < nOps; i++) {
    t += int(0, 10) * DAY + int(0, 3000);
    const kind = r();
    if (kind < 0.3) {
      // rebind keeping the did or the nostr key
      const keepDid = r() < 0.5;
      const e = pairEvent({ d: keepDid ? homeD : pick(D), n: keepDid ? pick(N) : homeN, at: t - (r() < 0.3 ? int(1, 30) * DAY : 0),
        exp: r() < 0.2 ? t + int(1, 60) * DAY : null });
      events.push({ e, seen: t + int(0, 2) * DAY });
      if (r() < 0.5) {
        // a cancel, by the right or a wrong key, before or after the delay
        const right = r() < 0.7;
        const c = keepDid
          ? cancelEvent({ target: e.id, at: t + 10, byNostr: right ? homeN : pick(N) })
          : cancelEvent({ target: e.id, at: t + 10, byDid: right ? homeD : pick(D), publisher: pick(N) });
        events.push({ e: c, seen: t + int(0, 10) * DAY });
      }
    } else if (kind < 0.45) {
      events.push({ e: pairEvent({ d: homeD, n: homeN, at: t, exp: r() < 0.5 ? t + int(1, 90) * DAY : null }), seen: t });
    } else if (kind < 0.6) {
      events.push({ e: pairEvent({ d: pick(D), n: pick(N), at: t, badEd: r() < 0.5, badSig: r() < 0.5 }), seen: t });
    } else if (kind < 0.7) {
      events.push({ e: pairEvent({ d: pick(D), n: pick(N), at: t }), seen: t });
    } else if (kind < 0.8) {
      const e = pairEvent({ d: pick(D), n: pick(N), at: t, extraTags: [[pick(['x', 'constructor', '__proto__', 'e', 'did']), 'v']] });
      events.push({ e, seen: t, read: true });
    } else if (kind < 0.84) {
      events.push({ e: oddSigned(r, r() < 0.5 ? homeD : pick(D), r() < 0.5 ? homeN : pick(N), t), seen: t, read: true });
    } else if (kind < 0.88) {
      // two rebinds with the same createdAt: order by id decides
      for (const n of [pick(N), pick(N)]) events.push({ e: pairEvent({ d: homeD, n, at: t }), seen: t });
    } else if (kind < 0.91) {
      const base = pairEvent({ d: pick(D), n: pick(N), at: t });
      const broken = JSON.parse(JSON.stringify(base));
      const f = pick(['id', 'pubkey', 'created_at', 'kind', 'content', 'sig', 'tags']);
      broken[f] = pick(ODD);
      events.push({ e: broken, seen: t });
    } else if (kind < 0.94) {
      events.push({ e: pairEvent({ d: pick(D), n: pick(N), at: t + int(1, 3) * 600 }), seen: t });
    } else {
      const prev = pick(events);
      events.push({ e: prev.e, seen: prev.seen + int(-5, 5) * 3600 });
    }
  }
  if (r() < 0.2) events.push({ e: pick(ODD), seen: t });

  const items = events.map(x => ({ event: x.e, seenAt: x.seen }));
  for (const x of events.filter((y, i) => i < 6 || y.read)) steps.push({ op: 'read', event: x.e, deps: r() < 0.1 ? pick(['throwEd', 'oneEd', 'throwEv']) : 'ok' });
  const keys = [homeD, homeN, pick(D), pick(N)];
  for (let q = 0; q < 6; q++) {
    const now = T0 + int(0, Math.max(1, Math.ceil((t - T0) / DAY) + 20)) * DAY + int(0, 86399);
    const optsPick = r();
    const opts = optsPick < 0.4 ? undefined : optsPick < 0.5 ? null : optsPick < 0.7 ? {} : { delay: int(0, 10) * DAY, skew: int(0, 3) * 600 };
    const sub = r() < 0.3 ? items.filter(() => r() < 0.7) : items;
    steps.push({ op: 'resolve', items: sub, key: pick(keys), now, opts, hasOpts: optsPick >= 0.4 || r() < 0.5 });
  }
  if (r() < 0.3) steps.push({ op: 'resolve', items: pick([null, 'x', {}]), key: homeD, now: t });
  if (r() < 0.3) steps.push({ op: 'resolve', items, key: pick(['', 'did:key:abc', homeN.toUpperCase(), 5, [homeN], [homeD]]), now: t });
  if (r() < 0.3) steps.push({ op: 'resolve', items, key: homeD, now: pick([-1, 1.5, '1']) });
  if (r() < 0.3) steps.push({ op: 'resolve', items, key: homeD, now: t, opts: pick([{ delay: -1 }, { delay: 0.5 }, { skew: 'x' }, { delay: null }]), hasOpts: true });
  if (r() < 0.2) steps.push({ op: 'resolve', items, key: homeD, now: t, opts: pick([5, 'x', true, { skew: 1200 }, { delay: undefined }]), hasOpts: true });

  const tArgs = () => [r() < 0.85 ? pick(D) : pick(ODD), r() < 0.85 ? pick(N) : pick(ODD), r() < 0.9 ? int(0, 2e9) : pick(ODD),
    r() < 0.5 ? null : r() < 0.85 ? int(0, 2e9) : pick(ODD)];
  for (let k = 0; k < 4; k++) steps.push({ op: 'pairText', args: tArgs() });
  steps.push({ op: 'cancelText', args: [r() < 0.7 ? pick(N) : pick(ODD)] });
  for (let k = 0; k < 3; k++) {
    const [d, n, at, exp] = tArgs();
    steps.push({ op: 'pairTemplate', args: [{ did: d, nostr: n, createdAt: at, expiresAt: exp, edSig: r() < 0.8 ? FAKE.edSign('a', 'b') : pick(ODD) }] });
  }
  for (let k = 0; k < 3; k++) {
    const a = { targetId: r() < 0.85 ? pick(N) : pick(ODD), createdAt: r() < 0.9 ? int(0, 2e9) : pick(ODD) };
    if (r() < 0.5) { a.did = r() < 0.85 ? pick(D) : pick(ODD); a.edSig = r() < 0.85 ? FAKE.edSign('a', 'c') : pick(ODD); }
    if (r() < 0.1) a.did = undefined;
    steps.push({ op: 'cancelTemplate', args: [a] });
  }
  return steps;
}

const snapshot = v => JSON.stringify(v, (k, x) => (x === undefined ? '__undef__' : Number.isNaN(x) ? '__nan__' : x));

export function runScenario(impl, steps) {
  const out = [];
  for (const s of steps) {
    const before = snapshot(s);
    let res;
    try {
      if (s.op === 'read') res = impl.readStatement(s.event, ALT[s.deps ?? 'ok']);
      else if (s.op === 'resolve') res = s.hasOpts ? impl.resolve(s.items, s.key, s.now, DEPS, s.opts) : impl.resolve(s.items, s.key, s.now, DEPS);
      else res = impl[s.op](...s.args);
    } catch (e) {
      res = { threw: e instanceof TypeError ? 'TypeError' : 'other' };
    }
    if (res && res.ok === false && typeof res.reason === 'string' && res.reason.length > 0) res = { ok: false, reason: 'any' };
    out.push({ res: JSON.parse(JSON.stringify(res ?? null)), mutated: snapshot(s) !== before });
  }
  return out;
}

export const GOLDEN_SEEDS = [11, 12, 13, 14, 15, 16, 17, 18];
