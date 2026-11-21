// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Guard tests for src/askaround.js and src/decisions.js, written from mutation testing (test/MUTATION.md):
// each test pins a check that could be deleted or loosened without any other test failing.
// Expected values are worked out by hand from the spec, not copied from the implementation's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, collectOffers, rankOffers } from '../src/askaround.js';
import { createMemory, recordDecision, liftDecision, checkOffer } from '../src/decisions.js';

const DAY = 86400;
const S = c => c.repeat(64);
const verify = e => e.sig === 'ok:' + e.id;
const need = (o = {}) => ({ category: 'books/children', topics: ['phonics'], at: 1000, ...o });
const err = (r, ...errors) => assert.deepEqual(r, { ok: false, errors });

// ---------- askaround: buildRequest ----------

test('buildRequest: a non-plain object is refused as such, not as missing keys', () => {
  err(buildRequest(new Date()), 'need not plain');
  err(buildRequest(new Map()), 'need not plain');
});

test('buildRequest: each required key on its own', () => {
  err(buildRequest({ topics: ['a'], at: 1 }), 'missing required key');
  err(buildRequest({ category: 'books', at: 1 }), 'missing required key');
  err(buildRequest({ category: 'books', topics: ['a'] }), 'missing required key');
});

test('buildRequest: segments are anchored at both ends and capped at 32 chars', () => {
  err(buildRequest(need({ topics: ['ok!'] })), 'invalid topics');
  err(buildRequest(need({ topics: ['a'.repeat(33)] })), 'invalid topics');
  err(buildRequest(need({ topics: ['phonics', 'Bad'] })), 'invalid topics');
  err(buildRequest(need({ category: 'books/Kids' })), 'invalid category');
  err(buildRequest(need({ category: 'a/b/c/d/e' })), 'invalid category');
  assert.equal(buildRequest(need({ category: 'a/b/c/d', topics: ['a'.repeat(32)] })).ok, true);
});

test('buildRequest: every private term must be a string', () => {
  err(buildRequest(need({ private: ['Lou', 5] })), 'invalid private');
});

test('buildRequest: an e-mail address with an unlisted top-level domain is refused', () => {
  err(buildRequest(need({ note: 'write to lou@mail.xyz please' })), 'unsafe note');
});

test('buildRequest: a handle at the very start of the note is refused; a single character after @ is not a handle', () => {
  err(buildRequest(need({ note: '@lou_m asks' })), 'unsafe note');
  assert.equal(buildRequest(need({ note: 'grade @a or better' })).ok, true);
});

test('buildRequest: a 9-digit number at the start of the note is refused; 8 digits pass', () => {
  err(buildRequest(need({ note: '612345678 is my number' })), 'long number');
  err(buildRequest(need({ note: 'call +33 6 12 34 56' })), 'long number');
  assert.equal(buildRequest(need({ note: '12345678 is fine' })).ok, true);
  assert.equal(buildRequest(need({ note: 'no digits here' })).ok, true);
});

test('buildRequest: a zero budget is never looked for in the text', () => {
  const r = buildRequest(need({ budget: 0, note: 'size 10 shoes' }));
  assert.equal(r.ok, true);
  err(buildRequest(need({ budget: 10, note: 'size 10 shoes' })), 'budget in text');
});

// ---------- askaround: collectOffers ----------

const REQ = { id: 'req1', pubkey: S('f'), kind: 7800, created_at: 5000, tags: [['category', 'books']], content: '{}', sig: 'x' };
const NOW = 5000 + DAY;
const body = (o = {}) => ({ type: 'sale', title: 'Phonics set', category: 'books/children', topics: ['phonics'], price: 20, currency: 'EUR', ...o });
const ev = (id, o = {}, b = {}) => {
  const e = { id, pubkey: S('a'), kind: 7797, created_at: 6000, tags: [['e', 'req1']], content: JSON.stringify(body(b)), ...o };
  e.sig = 'ok:' + id;
  return e;
};
const collect = (events, opts = {}) => collectOffers(REQ, events, { now: NOW, verify, ...opts });
const reasons = r => r.rejected.map(x => x.reason);

test('collectOffers: every request tag must be an array of strings', () => {
  err(collectOffers({ ...REQ, tags: [['category', 'books'], ['t', 5]] }, [], { now: NOW, verify }), 'bad tags');
});

test('collectOffers: the request id must sit in an "e" tag, not in any tag', () => {
  const r = collect([ev('a1', { tags: [['p', 'req1']] })]);
  assert.deepEqual(reasons(r), ['not_for_request']);
});

test('collectOffers: JSON content that is not an object is bad content, never a crash', () => {
  for (const content of ['null', '"text"', '[1]', '7', 'not json']) {
    const r = collect([ev('a1', { content })]);
    assert.deepEqual(reasons(r), ['bad_content'], content);
  }
});

test('collectOffers: content limits at their edges', () => {
  const t8 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.equal(collect([ev('a1', {}, { topics: t8 })]).offers.length, 1);
  assert.deepEqual(reasons(collect([ev('a1', {}, { topics: [...t8, 'i'] })])), ['bad_content']);
  for (const currency of ['EURO', 'XEUR', 'eur']) assert.deepEqual(reasons(collect([ev('a1', {}, { currency })])), ['bad_content'], currency);
  assert.deepEqual(reasons(collect([ev('a1', {}, { url: 'http://shop.example' })])), ['bad_content']);
  assert.equal(collect([ev('a1', {}, { url: 'https://shop.example' })]).offers[0].url, 'https://shop.example');
});

test('collectOffers: the same event received twice yields one offer and one superseded copy', () => {
  const e = ev('a1');
  const r = collect([e, { ...e }]);
  assert.deepEqual(r.offers.map(o => o.id), ['a1']);
  assert.deepEqual(r.rejected, [{ index: 1, id: 'a1', reason: 'superseded' }]);
});

test('collectOffers: offers come out sorted by id whatever the arrival order', () => {
  const r = collect([ev('c3', { pubkey: S('c') }), ev('a1', { pubkey: S('a') }), ev('b2', { pubkey: S('b') })]);
  assert.deepEqual(r.offers.map(o => o.id), ['a1', 'b2', 'c3']);
});

// ---------- askaround: rankOffers ----------

const offer = (id, o = {}) => ({ id, seller: S('a'), created_at: 6000, type: 'sale', title: 't', category: 'books', topics: ['phonics'], price: 20, currency: 'EUR', url: null, ...o });

test('rankOffers: malformed offers are refused with their own message', () => {
  err(rankOffers('abc', {}), 'offers not array');
  err(rankOffers([null], {}), 'bad offer');
  err(rankOffers([{ id: 'a' }], {}), 'bad offer');
  err(rankOffers([new Date()], {}), 'bad offer');
});

test('rankOffers: currency, wantTopics and mustTopics may be undefined or null; null currency means any', () => {
  for (const limits of [{ currency: undefined }, { currency: null }, { wantTopics: undefined }, { mustTopics: undefined }]) {
    assert.equal(rankOffers([offer('a')], limits).ok, true, JSON.stringify(limits));
  }
  for (const currency of ['EURO', 'XEUR']) err(rankOffers([offer('a')], { currency }), 'bad currency');
});

test('rankOffers: topic lists accept exactly 20, refuse 21, and check every entry', () => {
  const t20 = Array.from({ length: 20 }, (_, i) => 't' + i);
  assert.equal(rankOffers([offer('a')], { wantTopics: t20 }).ok, true);
  assert.equal(rankOffers([offer('a')], { mustTopics: [] }).ok, true);
  err(rankOffers([offer('a')], { wantTopics: [...t20, 'x'] }), 'bad wantTopics');
  err(rankOffers([offer('a')], { mustTopics: [...t20, 'x'] }), 'bad mustTopics');
  err(rankOffers([offer('a')], { mustTopics: ['phonics', 'Bad'] }), 'bad mustTopics');
  err(rankOffers([offer('a')], { mustTopics: 'phonics' }), 'bad mustTopics');
});

test('rankOffers: exclusions are listed in id order whatever the input order', () => {
  const r = rankOffers([offer('c', { currency: 'USD' }), offer('a', { currency: 'USD' }), offer('b', { currency: 'USD' })], { currency: 'EUR' });
  assert.deepEqual(r.excluded, [{ id: 'a', reason: 'currency' }, { id: 'b', reason: 'currency' }, { id: 'c', reason: 'currency' }]);
});

test('rankOffers: isSuppressed sees a copy of the whole offer', () => {
  const seen = [];
  const o = offer('a', { topics: ['phonics', 'age-5'] });
  const r = rankOffers([o], {}, { isSuppressed: c => { seen.push(structuredClone(c)); c.topics.push('x'); return c.seller === S('a') && c.topics.includes('age-5'); } });
  assert.deepEqual(seen, [o]);
  assert.deepEqual(o.topics, ['phonics', 'age-5']);
  assert.deepEqual(r.excluded, [{ id: 'a', reason: 'declined_before' }]);
});

// ---------- decisions ----------

const A = S('a');
const rec = (m, input) => { const r = recordDecision(m, input); assert.equal(r.ok, true, JSON.stringify(r)); return r.memory; };
const rd = input => recordDecision(createMemory(), input);
const base = (o = {}) => ({ verdict: 'no', scope: { level: 'category', category: 'books' }, at: 100, ...o });

test('recordDecision: non-object input is refused as such', () => {
  for (const input of ['x', null, [1], 5]) err(rd(input), 'input must be a plain object');
});

test('recordDecision: each missing required key is named', () => {
  err(rd({ scope: base().scope, at: 1 }), 'missing required key: verdict');
  err(rd({ verdict: 'no', at: 1 }), 'missing required key: scope');
  err(rd({ verdict: 'no', scope: base().scope }), 'missing required key: at');
});

test('recordDecision: a scope that is not an object is refused as such', () => {
  err(rd(base({ scope: 'books' })), 'scope must be a plain object');
  err(rd(base({ scope: ['category'] })), 'scope must be a plain object');
});

test('recordDecision: scope key errors, exactly', () => {
  err(rd(base({ scope: { level: 'seller' } })), 'scope must have exactly: level, seller', 'scope.seller must be a 64-char hex string');
  err(rd(base({ scope: { level: 'seller', foo: A } })), 'unexpected scope key: foo', 'scope.seller must be a 64-char hex string');
  err(rd(base({ scope: { level: 'bogus' } })), 'invalid scope level: bogus');
});

test('recordDecision: seller_category checks both seller and category', () => {
  err(rd(base({ scope: { level: 'seller_category', seller: 'x', category: 'books' } })), 'scope.seller must be a 64-char hex string');
  err(rd(base({ scope: { level: 'seller_category', seller: A, category: 'Books' } })), 'scope.category must be a valid category');
  err(rd(base({ scope: { level: 'topic', category: 'Books', topics: ['a'] } })), 'scope.category must be a valid category');
});

test('recordDecision: a seller is exactly 64 lower-case hex characters', () => {
  for (const seller of [S('g'), S('A'), S('a').slice(1), S('a') + 'a', 7]) {
    err(rd(base({ scope: { level: 'seller', seller } })), 'scope.seller must be a 64-char hex string');
  }
});

test('recordDecision: a category is a string of 1 to 4 valid segments', () => {
  for (const category of [123, 'a/b/c/d/e', '', 'a//b']) {
    err(rd(base({ scope: { level: 'category', category } })), 'scope.category must be a valid category');
  }
  assert.equal(rd(base({ scope: { level: 'category', category: 'a/b/c/d' } })).ok, true);
});

test('recordDecision: until is checked on its own even when at is bad', () => {
  err(rd(base({ at: -5, until: -1 })), 'at must be a safe integer >= 0', 'until must be null or a time strictly greater than at');
  err(rd(base({ at: -5, until: 0 })), 'at must be a safe integer >= 0');
});

test('liftDecision: at must be a safe integer >= 0; 0 is allowed', () => {
  const m = rec(createMemory(), base({ at: 0 }));
  err(liftDecision(m, 'd1', -1), 'at must be a safe integer >= 0');
  err(liftDecision(m, 'd1', 1.5), 'at must be a safe integer >= 0');
  assert.equal(liftDecision(m, 'd1', 0).ok, true);
});

test('checkOffer: non-object offers are refused as such; time 0 is allowed', () => {
  const m = createMemory();
  for (const o of ['x', null, []]) err(checkOffer(m, o, 1), 'offer must be a plain object');
  const o = { id: 'o1', seller: A, category: 'books', topics: [] };
  err(checkOffer(m, { ...o, category: 5 }, 1), 'offer.category must be a valid category');
  assert.equal(checkOffer(m, o, 0).ok, true);
});

test('checkOffer: among equally specific decisions made at the same time, the last recorded wins', () => {
  let m = createMemory();
  for (const verdict of ['no', 'yes', 'not_now', 'yes', 'no']) m = rec(m, base({ verdict }));
  const r = checkOffer(m, { id: 'o1', seller: A, category: 'books', topics: [] }, 200);
  assert.equal(r.decision, 'd5');
  assert.equal(r.verdict, 'no');
});
