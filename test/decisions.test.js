// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Tests for src/decisions.js (from the factory contract, plus regression tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeScenario, runScenario, GOLDEN_SEEDS } from './fixtures/decisions/scenarios.mjs';

const implPath = path.join(import.meta.dirname, '..', 'src', 'decisions.js');
const impl = await import(pathToFileURL(implPath).href);
const { createMemory, recordDecision, liftDecision, activeDecisions, checkOffer } = impl;

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const YEAR = 365 * 86400, DAY = 86400;
const offer = (o = {}) => ({ id: 'o1', seller: A, category: 'books/children/reading-method', topics: ['phonics', 'age-5'], ...o });
function rec(m, input) {
  const r = recordDecision(m, input);
  assert.equal(r.ok, true, 'expected ok: ' + JSON.stringify(r));
  return r.memory;
}
const failed = r => {
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0 && r.errors.every(e => typeof e === 'string'), 'errors must be a non-empty array of strings');
};
const deepPlain = v => {
  if (Array.isArray(v)) return v.every(deepPlain);
  if (v && typeof v === 'object') return Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(deepPlain);
  return true;
};

test('exports exactly the five functions', () => {
  assert.deepEqual(Object.keys(impl).sort(), ['activeDecisions', 'checkOffer', 'createMemory', 'liftDecision', 'recordDecision']);
});

test('a topic named like an Object property is kept', () => {
  const r = recordDecision(createMemory(), { verdict: 'no', scope: { level: 'topic', category: 'books', topics: ['constructor', 'tostring'] }, at: 1 });
  assert.deepEqual(r.decision.scope.topics, ['constructor', 'tostring']);
});

test('createMemory', () => {
  assert.deepEqual(createMemory(), { version: 1, next: 1, decisions: [] });
  const a = createMemory(); a.decisions.push(1);
  assert.deepEqual(createMemory().decisions, []);
});

test('recordDecision stores the decision with defaults', () => {
  const m0 = createMemory();
  const r = recordDecision(m0, { verdict: 'no', scope: { level: 'category', category: 'books/reading-method' }, at: 1000 });
  assert.equal(r.ok, true);
  const d = { id: 'd1', verdict: 'no', scope: { level: 'category', category: 'books/reading-method' }, at: 1000, until: 1000 + 5 * YEAR, liftedAt: null, note: '' };
  assert.deepEqual(r.decision, d);
  assert.deepEqual(r.memory, { version: 1, next: 2, decisions: [d] });
  assert.deepEqual(m0, { version: 1, next: 1, decisions: [] }, 'the argument must not change');
  assert.ok(deepPlain(r));
});

test('default spans per verdict, explicit until and null', () => {
  let m = createMemory();
  const sc = { level: 'offer', offerId: 'o1' };
  const a = recordDecision(m, { verdict: 'not_now', scope: sc, at: 10 }); m = a.memory;
  const b = recordDecision(m, { verdict: 'yes', scope: sc, at: 10 }); m = b.memory;
  const c = recordDecision(m, { verdict: 'no', scope: sc, at: 10, until: 11 }); m = c.memory;
  const d = recordDecision(m, { verdict: 'no', scope: sc, at: 10, until: null, note: 'never' });
  assert.equal(a.decision.until, 10 + 90 * DAY);
  assert.equal(b.decision.until, 10 + YEAR);
  assert.equal(c.decision.until, 11);
  assert.equal(d.decision.until, null);
  assert.equal(d.decision.note, 'never');
  assert.deepEqual(d.memory.decisions.map(x => x.id), ['d1', 'd2', 'd3', 'd4']);
  assert.equal(d.memory.next, 5);
});

test('scope fields are stored in table order and topics sorted and de-duplicated', () => {
  let m = createMemory();
  const r = recordDecision(m, { verdict: 'no', scope: { topics: ['b', 'a', 'b'], category: 'books', level: 'topic' }, at: 1 });
  assert.deepEqual(Object.keys(r.decision.scope), ['level', 'category', 'topics']);
  assert.deepEqual(r.decision.scope.topics, ['a', 'b']);
  const s = recordDecision(m, { verdict: 'no', scope: { category: 'books', seller: A, level: 'seller_category' }, at: 1 });
  assert.deepEqual(Object.keys(s.decision.scope), ['level', 'seller', 'category']);
  assert.deepEqual(Object.keys(r.decision), ['id', 'verdict', 'scope', 'at', 'until', 'liftedAt', 'note']);
});

test('null-prototype input objects are accepted', () => {
  const input = Object.create(null);
  const scope = Object.create(null);
  Object.assign(scope, { level: 'seller', seller: A });
  Object.assign(input, { verdict: 'yes', scope, at: 5 });
  const r = recordDecision(createMemory(), input);
  assert.equal(r.ok, true);
  assert.ok(deepPlain(r));
});

test('invalid inputs are refused and change nothing', () => {
  const m = createMemory();
  const ok = { verdict: 'no', scope: { level: 'category', category: 'books' }, at: 100 };
  const bad = [
    null, [], 'x', {},
    { ...ok, verdict: 'maybe' }, { ...ok, verdict: undefined }, { scope: ok.scope, at: 100 },
    { ...ok, at: -1 }, { ...ok, at: 1.5 }, { ...ok, at: NaN }, { ...ok, at: '100' }, { verdict: 'no', scope: ok.scope },
    { ...ok, until: 100 }, { ...ok, until: 99 }, { ...ok, until: undefined }, { ...ok, until: 2.5 },
    { ...ok, note: 'x'.repeat(281) }, { ...ok, note: 5 }, { ...ok, extra: true },
    { ...ok, scope: null }, { ...ok, scope: [] }, { ...ok, scope: { level: 'all' } }, { ...ok, scope: { level: 'category' } },
    { ...ok, scope: { level: 'category', category: 'Books' } }, { ...ok, scope: { level: 'category', category: '' } },
    { ...ok, scope: { level: 'category', category: 'a/b/c/d/e' } }, { ...ok, scope: { level: 'category', category: 'a//b' } },
    { ...ok, scope: { level: 'category', category: 'x'.repeat(33) } }, { ...ok, scope: { level: 'category', category: 'books/' } },
    { ...ok, scope: { level: 'category', category: 'books', seller: A } },
    { ...ok, scope: { level: 'topic', category: 'books', topics: [] } }, { ...ok, scope: { level: 'topic', category: 'books', topics: ['a', 1] } },
    { ...ok, scope: { level: 'topic', category: 'books', topics: Array(9).fill('a') } }, { ...ok, scope: { level: 'topic', category: 'books' } },
    { ...ok, scope: { level: 'seller', seller: 'A'.repeat(64) } }, { ...ok, scope: { level: 'seller', seller: 'a'.repeat(63) } },
    { ...ok, scope: { level: 'seller_category', seller: A } }, { ...ok, scope: { level: 'offer', offerId: '' } },
    { ...ok, scope: { level: 'offer', offerId: 'has space' } }, { ...ok, scope: { level: 'offer', offerId: 'x'.repeat(65) } },
    { ...ok, scope: { level: 'offer', offerId: 7 } },
  ];
  for (const input of bad) failed(recordDecision(m, input));
  assert.deepEqual(m, createMemory());
  assert.equal(recordDecision(m, { ...ok, note: 'x'.repeat(280), until: 101 }).ok, true);
  assert.equal(recordDecision(m, { ...ok, scope: { level: 'seller', seller: '0123456789abcdef'.repeat(4) } }).ok, true);
  assert.equal(recordDecision(m, { ...ok, scope: { level: 'offer', offerId: 'x' } }).ok, true);
  assert.equal(recordDecision(m, { ...ok, scope: { level: 'offer', offerId: 'A-z_9'.repeat(12) + 'abcd' } }).ok, true);
  assert.equal(recordDecision(m, { ...ok, scope: { level: 'category', category: '0-9' } }).ok, true);
  assert.equal(recordDecision(m, { ...ok, scope: { level: 'topic', category: 'a/b/c/d', topics: Array(8).fill('a') } }).ok, true);
});

test('liftDecision', () => {
  let m = rec(createMemory(), { verdict: 'no', scope: { level: 'seller', seller: A }, at: 100 });
  const before = JSON.parse(JSON.stringify(m));
  failed(liftDecision(m, 'd2', 200));
  failed(liftDecision(m, 'd1', 99));
  failed(liftDecision(m, 'd1', -5));
  failed(liftDecision(m, 'd1', 1.5));
  const r = liftDecision(m, 'd1', 100);
  assert.equal(r.ok, true);
  assert.equal(r.memory.decisions[0].liftedAt, 100);
  assert.deepEqual(m, before, 'the argument must not change');
  failed(liftDecision(r.memory, 'd1', 300));
  assert.deepEqual(Object.keys(r).sort(), ['memory', 'ok']);
});

test('active means at <= t < until and t < liftedAt', () => {
  let m = rec(createMemory(), { verdict: 'no', scope: { level: 'seller', seller: A }, at: 100, until: 200 });
  m = rec(m, { verdict: 'yes', scope: { level: 'seller', seller: B }, at: 150, until: null });
  m = liftDecision(m, 'd2', 300).memory;
  const ids = t => activeDecisions(m, t).map(d => d.id);
  assert.deepEqual(ids(99), []);
  assert.deepEqual(ids(100), ['d1']);
  assert.deepEqual(ids(150), ['d1', 'd2']);
  assert.deepEqual(ids(199), ['d1', 'd2']);
  assert.deepEqual(ids(200), ['d2']);
  assert.deepEqual(ids(299), ['d2']);
  assert.deepEqual(ids(300), []);
  const list = activeDecisions(m, 150);
  list[0].verdict = 'changed'; list[0].scope.seller = 'x';
  assert.equal(m.decisions[0].verdict, 'no', 'returned decisions must be copies');
  assert.equal(m.decisions[0].scope.seller, A);
});

test('checkOffer with no decisions shows the offer', () => {
  assert.deepEqual(checkOffer(createMemory(), offer(), 5), { ok: true, show: true, decision: null, verdict: null, level: null, until: null });
});

test('checkOffer refuses bad offers and times', () => {
  const m = createMemory();
  for (const [o, t] of [[null, 1], [[], 1], [offer({ id: 1 }), 1], [offer({ seller: null }), 1], [offer({ category: 'Books' }), 1],
    [offer({ category: '' }), 1], [offer({ topics: 'x' }), 1], [offer({ topics: [1] }), 1], [offer(), -1], [offer(), 1.5], [offer(), '1']]) failed(checkOffer(m, o, t));
  assert.equal(checkOffer(m, offer({ topics: [], extra: 1 }), 1).ok, true);
});

test('which scopes apply', () => {
  const cases = [
    [{ level: 'offer', offerId: 'o1' }, true], [{ level: 'offer', offerId: 'o2' }, false],
    [{ level: 'seller', seller: A }, true], [{ level: 'seller', seller: B }, false],
    [{ level: 'seller_category', seller: A, category: 'books' }, true], [{ level: 'seller_category', seller: B, category: 'books' }, false],
    [{ level: 'seller_category', seller: A, category: 'games' }, false],
    [{ level: 'topic', category: 'books', topics: ['phonics'] }, true], [{ level: 'topic', category: 'books', topics: ['phonics', 'age-5'] }, true],
    [{ level: 'topic', category: 'books', topics: ['phonics', 'french'] }, false], [{ level: 'topic', category: 'games', topics: ['phonics'] }, false],
    [{ level: 'category', category: 'books' }, true], [{ level: 'category', category: 'books/children/reading-method' }, true],
    [{ level: 'category', category: 'books/children/reading-method/phonics' }, false], [{ level: 'category', category: 'book' }, false],
    [{ level: 'category', category: 'books/child' }, false],
  ];
  for (const [scope, applies] of cases) {
    const m = rec(createMemory(), { verdict: 'no', scope, at: 1 });
    assert.equal(checkOffer(m, offer(), 2).show, !applies, JSON.stringify(scope));
  }
  const m = rec(createMemory(), { verdict: 'no', scope: { level: 'category', category: 'books' }, at: 1 });
  assert.equal(checkOffer(m, offer({ category: 'bookshop' }), 2).show, true);
});

test('strongest decision: level first', () => {
  let m = rec(createMemory(), { verdict: 'no', scope: { level: 'category', category: 'books' }, at: 10 });
  m = rec(m, { verdict: 'yes', scope: { level: 'seller_category', seller: A, category: 'books' }, at: 5 });
  assert.deepEqual(checkOffer(m, offer(), 20), { ok: true, show: true, decision: 'd2', verdict: 'yes', level: 'seller_category', until: 5 + YEAR });
  assert.equal(checkOffer(m, offer({ seller: B }), 20).decision, 'd1');
  m = rec(m, { verdict: 'not_now', scope: { level: 'offer', offerId: 'o1' }, at: 1 });
  assert.deepEqual(checkOffer(m, offer(), 20), { ok: true, show: false, decision: 'd3', verdict: 'not_now', level: 'offer', until: 1 + 90 * DAY });
  m = rec(createMemory(), { verdict: 'yes', scope: { level: 'topic', category: 'books', topics: ['phonics'] }, at: 10 });
  m = rec(m, { verdict: 'no', scope: { level: 'seller', seller: A }, at: 5 });
  assert.equal(checkOffer(m, offer(), 20).decision, 'd2', 'seller beats topic');
});

test('strongest decision: then category depth, topic count, time, id number', () => {
  let m = rec(createMemory(), { verdict: 'no', scope: { level: 'category', category: 'books/children' }, at: 10 });
  m = rec(m, { verdict: 'yes', scope: { level: 'category', category: 'books' }, at: 20 });
  assert.equal(checkOffer(m, offer(), 30).decision, 'd1', 'deeper category wins over later');
  m = rec(createMemory(), { verdict: 'no', scope: { level: 'topic', category: 'books', topics: ['phonics', 'age-5'] }, at: 10 });
  m = rec(m, { verdict: 'yes', scope: { level: 'topic', category: 'books', topics: ['phonics'] }, at: 20 });
  assert.equal(checkOffer(m, offer(), 30).decision, 'd1', 'more topics wins');
  m = rec(createMemory(), { verdict: 'no', scope: { level: 'seller', seller: A }, at: 20 });
  m = rec(m, { verdict: 'yes', scope: { level: 'seller', seller: A }, at: 10 });
  assert.equal(checkOffer(m, offer(), 30).decision, 'd1', 'later at wins');
  m = createMemory();
  for (let i = 0; i < 12; i++) m = rec(m, { verdict: i === 11 ? 'yes' : 'no', scope: { level: 'seller', seller: A }, at: 10 });
  assert.equal(checkOffer(m, offer(), 30).decision, 'd12', 'd12 beats d9: compare numbers');
  m = createMemory();
  for (let i = 0; i < 10; i++) m = rec(m, { verdict: i === 9 ? 'yes' : 'no', scope: { level: 'seller', seller: A }, at: 10 });
  assert.equal(checkOffer(m, offer(), 30).decision, 'd10', 'd10 beats d9');
  assert.equal(checkOffer(m, offer(), 30).show, true);
});

test('expired and lifted decisions no longer apply', () => {
  let m = rec(createMemory(), { verdict: 'not_now', scope: { level: 'category', category: 'books' }, at: 0 });
  assert.equal(checkOffer(m, offer(), 90 * DAY - 1).show, false);
  assert.equal(checkOffer(m, offer(), 90 * DAY).show, true);
  m = rec(m, { verdict: 'no', scope: { level: 'seller', seller: A }, at: 10 });
  assert.equal(checkOffer(m, offer(), 20).decision, 'd2');
  m = liftDecision(m, 'd2', 30).memory;
  assert.equal(checkOffer(m, offer(), 29).decision, 'd2');
  assert.equal(checkOffer(m, offer(), 30).decision, 'd1');
  assert.equal(checkOffer(m, offer(), 5).show, false, 'decisions made later do not apply yet');
});

test('arguments never change and results are independent', () => {
  let m = rec(createMemory(), { verdict: 'no', scope: { level: 'topic', category: 'books', topics: ['x', 'a'] }, at: 1 });
  const snap = JSON.stringify(m);
  const input = { verdict: 'yes', scope: { level: 'topic', category: 'books', topics: ['b', 'a'] }, at: 2 };
  const inSnap = JSON.stringify(input);
  const r = recordDecision(m, input);
  assert.equal(JSON.stringify(m), snap);
  assert.equal(JSON.stringify(input), inSnap);
  r.decision.scope.topics.push('zzz');
  assert.deepEqual(r.memory.decisions[1].scope.topics, ['a', 'b']);
  r.memory.decisions[0].verdict = 'yes';
  assert.equal(m.decisions[0].verdict, 'no');
  const o = offer();
  const oSnap = JSON.stringify(o);
  checkOffer(m, o, 3);
  assert.equal(JSON.stringify(o), oSnap);
  const l = liftDecision(m, 'd1', 5);
  l.memory.decisions[0].scope.topics.push('q');
  assert.equal(JSON.stringify(m), snap);
});

for (const seed of GOLDEN_SEEDS) {
  test(`golden scenario ${seed}`, () => {
    const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'decisions', 'golden.json'), 'utf8'))[seed];
    const steps = makeScenario(seed);
    const got = runScenario(impl, steps);
    for (let i = 0; i < golden.length; i++) assert.deepEqual(got[i], golden[i], `step ${i}: ${JSON.stringify(steps[i] ?? 'final memory').slice(0, 300)}`);
  });
}

