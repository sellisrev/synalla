// Random scenarios for decisions.mjs. Data for the tests: don't change this file.
// A scenario is a list of steps run in order on one memory; every result is compared with the expected one.

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const CATS = ['books', 'books/children', 'books/children/reading-method', 'books/children/reading-method/phonics',
  'books/novels', 'games', 'games/puzzle', 'games/puzzle/co-op', 'jobs/design', 'jobs', 'bookshop'];
const TOPICS = ['phonics', 'montessori', 'age-4', 'age-5', 'french', 'english', 'co-op', 'solo', 'remote', 'paris'];
const SELLERS = ['a', 'b', 'c'].map(c => c.repeat(64)).concat(['0123456789abcdef'.repeat(4)]);
const OFFER_IDS = ['o1', 'o2', 'o3', 'o4', 'x', 'Offer_9-z'];

export function makeScenario(seed) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const some = (a, min, max) => {
    const n = min + Math.floor(r() * (max - min + 1));
    return Array.from({ length: n }, () => pick(a));
  };
  const steps = [];
  let t = 1000;
  const ids = [];
  const scopes = [];
  function offerNear() {
    // Most offers are built to fall under an earlier decision, so precedence is exercised.
    const o = { id: pick(OFFER_IDS), seller: pick(SELLERS), category: pick(CATS), topics: some(TOPICS, 0, 4) };
    for (let k = 0; k < 2 && scopes.length && r() < 0.8; k++) {
      const sc = pick(scopes);
      if (sc.offerId) o.id = sc.offerId;
      if (sc.seller) o.seller = sc.seller;
      if (sc.category) o.category = r() < 0.5 ? sc.category : pick(CATS.filter(c => c === sc.category || c.startsWith(sc.category + '/')));
      if (sc.topics) o.topics = [...new Set([...o.topics.slice(0, 2), ...sc.topics])];
    }
    return o;
  }
  function scope() {
    const level = pick(['offer', 'seller_category', 'seller', 'topic', 'category', 'category', 'topic']);
    if (level === 'offer') return { level, offerId: pick(OFFER_IDS) };
    if (level === 'seller') return { level, seller: pick(SELLERS) };
    if (level === 'seller_category') return { level, seller: pick(SELLERS), category: pick(CATS) };
    if (level === 'topic') return { level, category: pick(CATS), topics: some(TOPICS, 1, 3) };
    return { level, category: pick(CATS) };
  }
  function badInput() {
    const good = { verdict: 'no', scope: scope(), at: t };
    const k = Math.floor(r() * 12);
    if (k === 0) return { ...good, verdict: 'maybe' };
    if (k === 1) return { ...good, at: -1 };
    if (k === 2) return { ...good, at: 1.5 };
    if (k === 3) return { ...good, until: t };
    if (k === 4) return { ...good, note: 'x'.repeat(281) };
    if (k === 5) return { ...good, extra: 1 };
    if (k === 6) return { ...good, scope: { level: 'topic', category: 'books', topics: [] } };
    if (k === 7) return { ...good, scope: { level: 'seller', seller: 'A'.repeat(64) } };
    if (k === 8) return { ...good, scope: { level: 'category', category: 'Books' } };
    if (k === 9) return { ...good, scope: { level: 'category', category: 'a/b/c/d/e' } };
    if (k === 10) return { ...good, scope: { level: 'offer', offerId: 'o1', seller: SELLERS[0] } };
    return { ...good, scope: { level: 'everything' } };
  }
  const n = 12 + Math.floor(r() * 18);
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 4) * 86400 * pick([1, 30, 400]);
    const x = r();
    if (x < 0.55) {
      const input = { verdict: pick(['yes', 'no', 'not_now', 'no']), scope: scope(), at: t };
      const u = r();
      if (u < 0.2) input.until = null;
      else if (u < 0.45) input.until = t + 1 + Math.floor(r() * 200) * 86400;
      if (r() < 0.2) input.note = pick(['', 'not for us', 'already have one']);
      steps.push({ op: 'record', input });
      scopes.push(input.scope);
      ids.push(`d${ids.length + 1}`);
    } else if (x < 0.65) {
      steps.push({ op: 'record', input: badInput() });
    } else if (x < 0.75 && ids.length) {
      steps.push({ op: 'lift', id: r() < 0.85 ? pick(ids) : 'd999', at: r() < 0.9 ? t : 5 });
    } else if (x < 0.82) {
      steps.push({ op: 'active', at: t + Math.floor(r() * 3) * 86400 * 200 });
    } else {
      for (let j = 0; j < 3; j++) {
        steps.push({ op: 'check', at: t + Math.floor(r() * 4) * 86400 * pick([1, 100, 1000]), offer: offerNear() });
      }
    }
  }
  return steps;
}

// Runs a scenario against an implementation and returns the comparable results.
// Failed calls keep only { ok: false } and whether errors was a non-empty array of strings.
export function runScenario(impl, steps) {
  let memory = impl.createMemory();
  const out = [];
  const norm = res => (res && res.ok === false
    ? { ok: false, errorsOk: Array.isArray(res.errors) && res.errors.length > 0 && res.errors.every(e => typeof e === 'string') }
    : res);
  for (const s of steps) {
    if (s.op === 'record') {
      const res = impl.recordDecision(memory, s.input);
      if (res.ok) memory = res.memory;
      out.push(norm(res.ok ? { ok: true, decision: res.decision } : res));
    } else if (s.op === 'lift') {
      const res = impl.liftDecision(memory, s.id, s.at);
      if (res.ok) memory = res.memory;
      out.push(norm(res.ok ? { ok: true } : res));
    } else if (s.op === 'active') {
      out.push({ active: impl.activeDecisions(memory, s.at) });
    } else {
      out.push(norm(impl.checkOffer(memory, s.offer, s.at)));
    }
  }
  out.push({ memory });
  return JSON.parse(JSON.stringify(out));
}

export const GOLDEN_SEEDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
