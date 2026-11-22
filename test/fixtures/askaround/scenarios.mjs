// Random scenarios for askaround.mjs. Data for the tests: don't change this file.
// Signatures are simulated: an event "verifies" when its sig is 'ok:' + its id.

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export const verify = e => e.sig === 'ok:' + e.id;

const CATS = ['books', 'books/children', 'books/children/reading-method', 'books/novels', 'games', 'games/puzzle', 'games/puzzle/co-op', 'bookshop'];
const TOPICS = ['phonics', 'montessori', 'age-4', 'age-5', 'french', 'english', 'co-op', 'solo', 'remote', 'cozy'];
const SELLERS = ['a', 'b', 'c', 'd', 'e'].map(c => c.repeat(64));
const ME = 'f'.repeat(64);
const NOTES = ['For a beginner reader', 'Short sessions please', 'We live in Lyon', 'see www.example.com', 'call 06 12 34 56 78',
  'write to me@example.org', 'ping @lou_parent', 'budget around 30', 'ages 4 to 6', '', 'Cozy co-op games, 2 players', 'ref 123 456 789'];

export function makeScenario(seed) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const some = (a, min, max) => Array.from({ length: min + Math.floor(r() * (max - min + 1)) }, () => pick(a));
  const steps = [];
  // buildRequest cases
  for (let i = 0; i < 6; i++) {
    const need = { category: pick(CATS), topics: some(TOPICS, 1, 5), at: 1000 + Math.floor(r() * 1e6) };
    if (r() < 0.6) need.region = pick(['FR', 'FR-ARA', 'AT', 'AT-9', 'fr', 'FRA', 'FR-ARAX']);
    if (r() < 0.5) need.days = pick([1, 14, 90, 0, 91, 3.5]);
    if (r() < 0.7) need.note = pick(NOTES);
    if (r() < 0.5) need.private = pick([['Lyon'], ['Lou', 'Versi'], ['Lo'], ['montessori'], ['COZY']]);
    if (r() < 0.4) need.budget = pick([30, 0, 12.5, 456, -1]);
    if (r() < 0.08) need.extra = true;
    if (r() < 0.05) need.topics = [];
    steps.push({ op: 'build', need });
  }
  // a request, replies, and rankings
  const reqCat = pick(['books', 'books/children', 'games']);
  const request = { id: 'r' + seed, pubkey: ME, kind: 8446, created_at: 5000, tags: [['category', reqCat], ['t', 'x']], content: '{}', sig: 'x' };
  const now = 5000 + 86400;
  const events = [];
  const n = 6 + Math.floor(r() * 12);
  for (let i = 0; i < n; i++) {
    const cat = r() < 0.8 ? pick(CATS.filter(c => c === reqCat || c.startsWith(reqCat + '/'))) : pick(CATS);
    const body = { type: pick(['sale', 'service', 'sale', 'job']), title: 'Offer ' + i, category: cat, topics: some(TOPICS, 0, 4),
      price: pick([5, 12, 19.9, 30, 30, 45, 80]), currency: r() < 0.85 ? 'EUR' : 'USD' };
    if (r() < 0.4) body.url = 'https://shop.example/' + i;
    const e = { id: 'e' + String(Math.floor(r() * 90) + 10) + i, pubkey: pick(SELLERS), kind: 8443,
      created_at: 5000 + Math.floor(r() * 4) * 3600, tags: [['e', request.id]], content: JSON.stringify(body) };
    if (r() < 0.25) e.tags.push(['expiration', String(pick([now - 1, now, now + 1, now + 86400]))]);
    const fault = r();
    if (fault < 0.04) e.kind = 1;
    else if (fault < 0.08) e.tags = [['e', 'other']];
    else if (fault < 0.11) e.pubkey = ME;
    else if (fault < 0.14) e.content = '{bad json';
    else if (fault < 0.17) e.content = JSON.stringify({ ...body, price: -1 });
    else if (fault < 0.20) e.content = JSON.stringify({ ...body, url: 'http://insecure.example' });
    else if (fault < 0.23) e.created_at = 4000;
    else if (fault < 0.26) e.created_at = now + 301;
    else if (fault < 0.28) e.tags.push(['expiration', 'soon']);
    else if (fault < 0.30) e.content = JSON.stringify({ ...body, title: '' });
    else if (fault < 0.32) e.content = JSON.stringify({ ...body, topics: ['Bad Topic'] });
    e.sig = r() < 0.94 ? 'ok:' + e.id : 'forged';
    events.push(e);
  }
  if (r() < 0.2) events.push(null, 'junk', [1]);
  steps.push({ op: 'collect', request, events, now });
  for (let k = 0; k < 4; k++) {
    const limits = {};
    if (r() < 0.7) limits.budget = pick([10, 25, 30, 50, 0]);
    if (r() < 0.5) limits.currency = pick(['EUR', 'USD']);
    if (r() < 0.6) limits.wantTopics = some(TOPICS, 0, 4);
    if (r() < 0.3) limits.mustTopics = some(TOPICS, 1, 2);
    const options = {};
    if (r() < 0.6) options.top = pick([1, 2, 3, 5, 10]);
    const suppress = r() < 0.5 ? [pick(SELLERS), pick(SELLERS)] : [];
    steps.push({ op: 'rank', limits, options, suppress });
  }
  return steps;
}

export function runScenario(impl, steps) {
  const out = [];
  const norm = res => (res && res.ok === false
    ? { ok: false, errorsOk: Array.isArray(res.errors) && res.errors.length > 0 && res.errors.every(e => typeof e === 'string') }
    : res);
  let offers = [];
  for (const s of steps) {
    if (s.op === 'build') out.push(norm(impl.buildRequest(s.need)));
    else if (s.op === 'collect') {
      const res = impl.collectOffers(s.request, s.events, { now: s.now, verify });
      if (res && res.ok) offers = res.offers;
      out.push(norm(res));
    } else {
      const calls = [];
      const isSuppressed = o => { calls.push(o.id); return s.suppress.includes(o.seller); };
      const res = impl.rankOffers(offers, s.limits, { ...s.options, isSuppressed: s.suppress.length ? isSuppressed : null });
      out.push({ result: norm(res), calls });
    }
  }
  return JSON.parse(JSON.stringify(out));
}

export const GOLDEN_SEEDS = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
