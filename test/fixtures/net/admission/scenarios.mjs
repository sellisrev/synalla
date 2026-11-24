// Random scenarios for admission.ts. Data for the tests: don't change this file.
// A scenario is a list of admit calls; each call gets the state returned by the previous valid call.

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const hex = n => n.toString(16).padStart(2, '0').repeat(32);
const SENDERS = [1, 2, 3, 0xab, 0xff, 0x10].map(hex);
const TRUST = ['', '', '', 'unknown', 'blocked', 'Blocked', ' blocked', 'verified', 'trusted', 'contact_ring1', 'contact_ring2', 'self', 'friend', 'Verified',
  'constructor', '__proto__', 'x'.repeat(33)];
const TYPES = ['talk.message.v1', 'synalla.knock', 'service.offer', 'coordination.request', 'knock', 'synalla.knock.v2', 'x'];
const ODD = [null, undefined, 0, 1.5, -1, '', 'A', [], {}, NaN, 'constructor', '__proto__', 2 ** 60, 'a'.repeat(101)];

export function makeScenario(seed) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const steps = [];
  let now = 1_800_000_000 + int(0, 86399);
  const pr = r();
  const policy = pr < 0.4 ? undefined : pr < 0.5 ? null : pr < 0.8 ? { perDay: { A: int(0, 4), B: r() < 0.5 ? int(0, 3) : undefined }, maxSenders: r() < 0.5 ? int(0, 4) : undefined }
    : { knockType: pick(['knock', 'synalla.knock']), perDay: r() < 0.5 ? undefined : { B: int(1, 2) } };
  const n = int(8, 40);
  for (let i = 0; i < n; i++) {
    now += r() < 0.15 ? int(1, 2) * 86400 : r() < 0.08 ? -int(1, 2) * 86400 : int(0, 4000);
    const input = { tier: pick(['A', 'A', 'B', 'B', 'B', 'C', 'D']), dinaTrust: pick(TRUST), type: pick(TYPES), sender: pick(SENDERS), now };
    if (r() < 0.1) input[pick(['tier', 'dinaTrust', 'type', 'sender', 'now'])] = pick(ODD);
    const step = { input: r() < 0.03 ? pick(ODD) : input, policy, passPolicy: policy !== undefined || r() < 0.5 };
    if (r() < 0.04) step.badState = pick([null, {}, { version: 1, day: 0, counts: [['zz', 1]] }, { version: 1, day: 0, counts: [[SENDERS[1], 1], [SENDERS[0], 1]] },
      { version: 2, day: 0, counts: [] }, { version: 1, day: 0, counts: [], extra: 1 }, { version: 1, day: -2, counts: [] }, { version: 1, day: 0, counts: [[SENDERS[0], 0]] }]);
    if (r() < 0.03) step.policy = pick([[], 'x', { perDay: [] }, { perDay: { A: -1 } }, { perDay: { B: 1.5 } }, { knockType: '' }, { knockType: 5 }, { maxSenders: 1.5 }, { maxSenders: null }]), step.passPolicy = true;
    steps.push(step);
  }
  return steps;
}

const snapshot = v => JSON.stringify(v, (k, x) => (x === undefined ? '__undef__' : Number.isNaN(x) ? '__nan__' : x));

export function runScenario(impl, steps) {
  const out = [];
  let state = impl.emptyState();
  for (const s of steps) {
    const st = s.badState !== undefined ? s.badState : state;
    const before = snapshot([s, st]);
    let res;
    try {
      res = s.passPolicy ? impl.admit(s.input, st, s.policy) : impl.admit(s.input, st);
      if (s.badState === undefined) state = res.state;
    } catch (e) {
      res = { threw: e instanceof TypeError ? 'TypeError' : 'other' };
    }
    out.push({ res: JSON.parse(JSON.stringify(res)), mutated: snapshot([s, st]) !== before });
  }
  return out;
}

export const GOLDEN_SEEDS = [21, 22, 23, 24, 25, 26, 27, 28];
