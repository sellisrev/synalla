// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Tests for src/askaround.js (from the factory contract, plus regression tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeScenario, runScenario, GOLDEN_SEEDS, verify } from './fixtures/askaround/scenarios.mjs';

const implPath = ['askaround.ts', 'askaround.js'].map(f => path.join(import.meta.dirname, '..', 'src', f)).find(f => fs.existsSync(f));
const impl = await import(pathToFileURL(implPath).href);
const { buildRequest, collectOffers, rankOffers } = impl;
const DAY = 86400;
const failed = r => {
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0 && r.errors.every(e => typeof e === 'string'), 'errors must be a non-empty array of strings');
};
const S = c => c.repeat(64);
const need = (o = {}) => ({ category: 'books/children', topics: ['reading-method', 'age-5'], at: 1000, ...o });
const REQ = { id: 'req1', pubkey: S('f'), kind: 8446, created_at: 5000, tags: [['category', 'books'], ['t', 'x']], content: '{}', sig: 'x' };
const NOW = 5000 + DAY;
const body = (o = {}) => ({ type: 'sale', title: 'Phonics set', category: 'books/children', topics: ['phonics'], price: 20, currency: 'EUR', ...o });
const ev = (id, o = {}, b = {}) => {
  const e = { id, pubkey: S('a'), kind: 8443, created_at: 6000, tags: [['e', 'req1']], content: JSON.stringify(body(b)), ...o };
  e.sig = 'ok:' + id;
  return e;
};
const collect = (events, opts = {}) => collectOffers(REQ, events, { now: NOW, verify, ...opts });

test('exports exactly the three functions', () => {
  assert.deepEqual(Object.keys(impl).sort(), ['buildRequest', 'collectOffers', 'rankOffers']);
});

test('buildRequest: the spec example', () => {
  const r = buildRequest({ category: 'books/children', topics: ['reading-method', 'age-5', 'age-5'], region: 'FR', at: 1000, note: 'For a beginner reader', private: ['Lou'], budget: 30 });
  assert.deepEqual(r, { ok: true, template: { kind: 8446, created_at: 1000,
    tags: [['category', 'books/children'], ['t', 'age-5'], ['t', 'reading-method'], ['g', 'FR'], ['expiration', '1210600']],
    content: '{"v":1,"category":"books/children","topics":["age-5","reading-method"],"region":"FR","note":"For a beginner reader"}' } });
  assert.equal(Object.getPrototypeOf(r.template), Object.prototype);
});

test('buildRequest: defaults, no region, days', () => {
  const r = buildRequest(need({ days: 1 }));
  assert.deepEqual(r.template.tags, [['category', 'books/children'], ['t', 'age-5'], ['t', 'reading-method'], ['expiration', String(1000 + DAY)]]);
  assert.equal(r.template.content, '{"v":1,"category":"books/children","topics":["age-5","reading-method"],"region":null,"note":""}');
  assert.equal(buildRequest(need()).template.tags.at(-1)[1], String(1000 + 14 * DAY));
  assert.equal(buildRequest(need({ days: 90 })).ok, true);
  const n0 = Object.create(null); Object.assign(n0, need());
  assert.equal(buildRequest(n0).ok, true);
});

test('buildRequest: invalid needs', () => {
  for (const n of [null, [], 'x', {}, need({ extra: 1 }), need({ category: 'Books' }), need({ category: 'a/b/c/d/e' }), need({ topics: [] }),
    need({ topics: ['a', 'b', 'c', 'd', 'e', 'f'] }), need({ topics: ['Upper'] }), need({ topics: 'phonics' }), need({ region: 'fr' }),
    need({ region: 'FRA' }), need({ region: 'FR-ARAX' }), need({ region: undefined }), need({ at: -1 }), need({ at: 1.5 }),
    need({ days: 0 }), need({ days: 91 }), need({ days: 2.5 }), need({ note: 'x'.repeat(201) }), need({ note: 3 }),
    need({ private: 'Lyon' }), need({ private: [1] }), need({ budget: -1 }), need({ budget: Infinity }), need({ budget: '30' })]) failed(buildRequest(n));
  assert.equal(buildRequest(need({ note: 'x'.repeat(200), region: 'AT-9' })).ok, true);
  assert.equal(buildRequest(need({ at: 0, category: 'a/b/c/d' })).ok, true, 'time 0 and 4 segments are valid');
});

test('buildRequest: unsafe notes fail', () => {
  for (const note of ['see https://shop.fr/x', 'HTTP://A.B', 'www.shop', 'go to example.com', 'mail lou@ex.org', 'ping @lou', 'call 06 12 34 56 78',
    'call +43 (660) 123-4567', 'ref 123456789']) failed(buildRequest(need({ note })));
  for (const note of ['ages 4 to 6', 'about 12345678 is fine', 'email @ me', 'files.zip', 'a@b']) assert.equal(buildRequest(need({ note })).ok, true, note);
});

test('buildRequest: private terms and budget never published', () => {
  failed(buildRequest(need({ note: 'We live in Lyon', private: ['Lyon'] })));
  failed(buildRequest(need({ note: 'We live in LYON', private: ['lyon'] })));
  failed(buildRequest(need({ private: ['READING'] })), 'topics count');
  failed(buildRequest(need({ private: ['children'] })), 'category counts');
  failed(buildRequest(need({ region: 'FR-ARA', private: ['fr-ara'] })), 'region counts');
  assert.equal(buildRequest(need({ note: 'Lo and behold', private: ['Lo'] })).ok, true, 'short terms are ignored');
  failed(buildRequest(need({ note: 'Lyon area', private: ['lyo'] })), 'a 3-character term counts');
  failed(buildRequest(need({ note: 'only 1 copy', budget: 1 })), 'budget 1 counts');
  failed(buildRequest(need({ note: 'up to 30 euros', budget: 30 })));
  failed(buildRequest(need({ note: 'up to 12.5', budget: 12.5 })));
  assert.equal(buildRequest(need({ note: 'zero', budget: 0 })).ok, true);
  const r = buildRequest(need({ budget: 456, private: ['Versi'] }));
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes('456') && !JSON.stringify(r).includes('Versi'));
});

test('buildRequest never changes its argument', () => {
  const n = need({ topics: ['b', 'a', 'b'], private: ['xyz'] });
  const snap = JSON.stringify(n);
  buildRequest(n);
  assert.equal(JSON.stringify(n), snap);
});

test('collectOffers: a valid offer', () => {
  const r = collect([ev('e1', {}, { url: 'https://shop.example/1', extra: 'ignored', topics: ['b', 'a', 'b'] })]);
  assert.deepEqual(r, { ok: true, rejected: [], offers: [{ id: 'e1', seller: S('a'), created_at: 6000, type: 'sale', title: 'Phonics set',
    category: 'books/children', topics: ['a', 'b'], price: 20, currency: 'EUR', url: 'https://shop.example/1' }] });
  assert.equal(collect([ev('e1')]).offers[0].url, null);
});

test('collectOffers: invalid request, events or options', () => {
  failed(collectOffers(null, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, kind: 1 }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, id: 5 }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, tags: [['t', 'x']] }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, tags: [['category', 'Bad']] }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, tags: [['category', 'books', 3]] }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, created_at: -1 }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, created_at: 2.5 }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, pubkey: null }, [], { now: 1, verify }));
  failed(collectOffers({ ...REQ, tags: 'x' }, [], { now: 1, verify }));
  failed(collectOffers(REQ, 'x', { now: 1, verify }));
  failed(collectOffers(REQ, [], { now: -1, verify }));
  failed(collectOffers(REQ, [], { now: 1 }));
  failed(collectOffers(REQ, [], null));
  assert.equal(collectOffers({ ...REQ, tags: [['t', 'x'], ['category', 'books'], ['category', 'Bad']] }, [], { now: 1, verify }).ok, true);
});

test('collectOffers: each rejection reason, first rule wins', () => {
  const cases = [
    [null, 'bad_signature'], [[], 'bad_signature'], [{ ...ev('x1'), sig: 'forged' }, 'bad_signature'],
    [{ ...ev('x2', { kind: 1 }) }, 'wrong_kind'],
    [ev('x3', { tags: [['e', 'other']] }), 'not_for_request'], [ev('x4', { tags: 'e' }), 'not_for_request'],
    [ev('x5', { tags: [['e', 'req1'], ['p', 5]] }), 'not_for_request'],
    [ev('x6', { pubkey: S('f') }), 'own_request'],
    [ev('x7', { content: '{oops' }), 'bad_content'], [ev('x8', { content: '[1]' }), 'bad_content'],
    [ev('x9', {}, { type: 'gift' }), 'bad_content'], [ev('x10', {}, { title: '' }), 'bad_content'], [ev('x11', {}, { title: 'x'.repeat(121) }), 'bad_content'],
    [ev('x12', {}, { category: 'Books' }), 'bad_content'], [ev('x13', {}, { topics: Array(9).fill('a') }), 'bad_content'],
    [ev('x14', {}, { price: -1 }), 'bad_content'], [ev('x15', {}, { price: '20' }), 'bad_content'], [ev('x16', {}, { currency: 'eur' }), 'bad_content'],
    [ev('x17', {}, { url: 'http://x' }), 'bad_content'], [ev('x18', {}, { url: 'https://' + 'x'.repeat(293) }), 'bad_content'],
    [ev('x19', { tags: [['e', 'req1'], ['expiration', 'soon']] }), 'bad_content'], [ev('x20', { content: 5 }), 'bad_content'],
    [ev('x21', {}, { category: 'games' }), 'wrong_category'], [ev('x22', {}, { category: 'bookshop' }), 'wrong_category'],
    [ev('x23', { tags: [['e', 'req1'], ['expiration', String(NOW)]] }), 'expired'],
    [ev('x24', { created_at: 4999 }), 'out_of_time'], [ev('x25', { created_at: NOW + 301 }), 'out_of_time'], [ev('x26', { created_at: 1.5 }), 'out_of_time'],
  ];
  for (const [e, reason] of cases) {
    const r = collect([e]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.rejected, [{ index: 0, id: e && typeof e === 'object' && !Array.isArray(e) ? e.id : null, reason }], JSON.stringify(e)?.slice(0, 120));
    assert.deepEqual(r.offers, []);
  }
  for (const e of [ev('k1', { created_at: 5000 }), ev('k2', { created_at: NOW + 300 }), ev('k3', { tags: [['x'], ['e', 'req1', 'extra'], ['expiration', String(NOW + 1)]] }),
    ev('k4', {}, { category: 'books' }), ev('k5', {}, { price: 0, topics: [] }), ev('k6', {}, { url: 'https://' + 'x'.repeat(292) }),
    ev('k7', {}, { title: 'x' }), ev('k8', {}, { title: 'x'.repeat(120) }), ev('k9', {}, { category: 'books/a/b/c' })]) {
    assert.equal(collect([e]).offers.length, 1, e.id);
  }
});

test('collectOffers: verify is called only for plain objects, and must return exactly true', () => {
  const seen = [];
  const r = collect([null, 7, ev('a1'), ev('a2', { pubkey: S('b') })], { verify: e => { seen.push(e.id); return e.id === 'a1' ? 1 : true; } });
  assert.deepEqual(seen, ['a1', 'a2']);
  assert.deepEqual(r.offers.map(o => o.id), ['a2']);
  assert.deepEqual(r.rejected.map(x => x.reason), ['bad_signature', 'bad_signature', 'bad_signature']);
});

test('collectOffers: one offer per seller, latest then larger id; output sorted', () => {
  const r = collect([ev('m5', { created_at: 6000 }), ev('m2', { created_at: 7000 }), ev('m9', { created_at: 7000 }), ev('b1', { pubkey: S('b') }), ev('m1', { created_at: 5500 })]);
  assert.deepEqual(r.offers.map(o => o.id), ['b1', 'm9']);
  assert.deepEqual(r.rejected, [{ index: 0, id: 'm5', reason: 'superseded' }, { index: 1, id: 'm2', reason: 'superseded' }, { index: 4, id: 'm1', reason: 'superseded' }]);
  const mixed = collect([ev('p1', { created_at: 6000 }), ev('p2', { kind: 1 }), ev('p3', { created_at: 7000 }), ev('p4', { tags: [['e', 'x']] })]);
  assert.deepEqual(mixed.rejected.map(x => x.index), [0, 1, 3], 'rejected must be sorted by index, superseded entries included, not appended at the end');
  assert.deepEqual(mixed.rejected.map(x => x.reason), ['superseded', 'wrong_kind', 'not_for_request']);
  const back = collect([ev('n9', { created_at: 7000 }), ev('n2', { created_at: 7000 })]);
  assert.deepEqual(back.offers.map(o => o.id), ['n9'], 'same time: the larger id wins in either order');
  assert.deepEqual(back.rejected, [{ index: 1, id: 'n2', reason: 'superseded' }]);
});

test('collectOffers never changes its arguments', () => {
  const events = [ev('a1'), ev('a2', { pubkey: S('b') })];
  const snap = JSON.stringify([REQ, events]);
  collect(events);
  assert.equal(JSON.stringify([REQ, events]), snap);
});

const off = (id, o = {}) => ({ id, seller: S(id[0]), created_at: 6000, type: 'sale', title: 't', category: 'books', topics: ['phonics'], price: 20, currency: 'EUR', url: null, ...o });

test('rankOffers: order by fit, score, price, time, id', () => {
  const offers = [off('a1', { price: 40 }), off('b1', { price: 25, topics: ['phonics', 'age-5'] }), off('c1', { price: 10 }), off('d1', { price: 10, created_at: 7000 }),
    off('e1', { price: 10, created_at: 7000 }), off('f1', { price: 5, topics: [] })];
  const r = rankOffers(offers, { budget: 30, wantTopics: ['phonics', 'age-5', 'phonics'] }, { top: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ranked.map(x => [x.id, x.fit, x.score]), [['b1', 'within_budget', 2], ['d1', 'within_budget', 1], ['e1', 'within_budget', 1],
    ['c1', 'within_budget', 1], ['f1', 'within_budget', 0], ['a1', 'over_budget', 1]]);
  assert.deepEqual(r.ranked[0].offer, offers[1]);
  assert.notEqual(r.ranked[0].offer, offers[1]);
  assert.notEqual(r.ranked[0].offer.topics, offers[1].topics);
  assert.equal(r.more, 0);
  assert.deepEqual(r.excluded, []);
});

test('rankOffers: defaults and top', () => {
  const offers = Array.from({ length: 8 }, (_, i) => off('a' + i, { price: 10 + i }));
  const r = rankOffers(offers, {});
  assert.deepEqual(r.ranked.map(x => x.id), ['a0', 'a1', 'a2', 'a3', 'a4']);
  assert.ok(r.ranked.every(x => x.fit === 'no_budget' && x.score === 0));
  assert.equal(r.more, 3);
  assert.equal(rankOffers(offers, { budget: undefined }, { top: undefined, isSuppressed: undefined }).more, 3);
  assert.equal(rankOffers(offers, {}, { top: 1 }).more, 7);
  assert.equal(rankOffers(offers, {}, { top: 50 }).ranked.length, 8);
  assert.equal(rankOffers([], {}).ok, true);
  const nullProto = Object.create(null);
  assert.equal(rankOffers(offers, nullProto).ok, true);
});

test('rankOffers: exclusions in order, isSuppressed called once per offer with a copy', () => {
  const offers = [off('c1', { currency: 'USD' }), off('a1'), off('b1', { topics: ['age-5'] }), off('d1', { currency: 'USD' })];
  const calls = [];
  const r = rankOffers(offers, { currency: 'EUR', mustTopics: ['phonics'] }, {
    isSuppressed: o => { calls.push(o.id); o.topics.push('mutated'); o.price = 0; return o.id === 'd1' ? true : o.id === 'a1' ? 'yes' : false; },
  });
  assert.deepEqual(calls, ['a1', 'b1', 'c1', 'd1']);
  assert.deepEqual(r.excluded, [{ id: 'b1', reason: 'missing_topic' }, { id: 'c1', reason: 'currency' }, { id: 'd1', reason: 'declined_before' }]);
  assert.deepEqual(r.ranked.map(x => x.id), ['a1']);
  assert.deepEqual(offers[1].topics, ['phonics']);
  assert.equal(r.ranked[0].offer.price, 20);
});

test('rankOffers: invalid arguments', () => {
  for (const [o, l, opt] of [['x', {}, {}], [[], null, {}], [[], [], {}], [[], { budget: -1 }, {}], [[], { budget: '5' }, {}], [[], { currency: 'eur' }, {}],
    [[], { wantTopics: ['Bad'] }, {}], [[], { mustTopics: 'a' }, {}], [[], { wantTopics: Array(21).fill('a') }, {}], [[], {}, null],
    [[], {}, { top: 0 }], [[], {}, { top: 51 }], [[], {}, { top: 2.5 }], [[], {}, { isSuppressed: true }]]) failed(rankOffers(o, l, opt));
  assert.equal(rankOffers([], { budget: null, currency: null }, { isSuppressed: null }).ok, true);
});

for (const seed of GOLDEN_SEEDS) {
  test(`golden scenario ${seed}`, () => {
    const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'askaround', 'golden.json'), 'utf8'))[seed];
    const steps = makeScenario(seed);
    const got = runScenario(impl, steps);
    for (let i = 0; i < golden.length; i++) assert.deepEqual(got[i], golden[i], `step ${i} (${steps[i].op})`);
  });
}

// STATIC-START
// Skipped only under mutation testing, where Stryker's instrumentation rewrites the source on purpose.
test('file constraints', { skip: process.env.SYNALLA_MUTATION_RUN === '1' }, () => {
  const raw = fs.readFileSync(implPath, 'utf8');
  const lines = raw.split('\n');
  assert.ok(lines.length <= 300, `at most 300 lines, found ${lines.length}`);
  lines.forEach((l, i) => assert.ok(l.length <= 200, `line ${i + 1} is longer than 200 characters`));
  const banned = [/\bimport\b/, /\bfrom\s*['"`]/, /\brequire\b/, /\bprocess\b/, /\bglobalThis\b/, /\bglobal\b/, /\beval\b/, /\bFunction\s*\(/,
    /\.constructor\b/, /\bfetch\b/, /\bMath\.random\b/, /\bDate\b/, /\bperformance\b/, /\bcrypto\b/, /\bconsole\b/];
  for (const re of banned) assert.ok(!re.test(raw), `banned pattern ${re} found`);
});
// STATIC-END

test('non-string values never throw and fail cleanly', () => {
  failed(buildRequest(need({ category: 5 })));
  failed(buildRequest(need({ topics: [['age-5']] })));
  failed(buildRequest(need({ region: ['FR'] })));
  const req = { kind: 8446, id: 'r'.repeat(64), pubkey: S('a'), created_at: 0, tags: [['category', 'books']] };
  const ev = { id: 'x', kind: 8443, pubkey: S('b'), created_at: 10, tags: [['e', req.id]],
    content: JSON.stringify({ type: 'sale', title: 'T', category: ['books'], topics: [], price: 1, currency: 'EUR' }) };
  const r = collectOffers(req, [ev], { now: 100, verify: () => true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rejected, [{ index: 0, id: 'x', reason: 'bad_content' }]);
});

test('rankOffers treats an explicit undefined options like a missing one', () => {
  const r = rankOffers([], {}, undefined);
  assert.equal(r.ok, true);
});

test('a seller key named like an Object.prototype property is handled as any other', () => {
  const req = { kind: 8446, id: 'r'.repeat(64), pubkey: S('a'), created_at: 0, tags: [['category', 'books']] };
  const ev = { id: 'x', kind: 8443, pubkey: 'constructor', created_at: 10, tags: [['e', req.id]],
    content: JSON.stringify({ type: 'sale', title: 'T', category: 'books', topics: [], price: 1, currency: 'EUR' }) };
  const r = collectOffers(req, [ev], { now: 100, verify: () => true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.offers.map(o => o.id), ['x']);
  assert.deepEqual(r.rejected, []);
});
