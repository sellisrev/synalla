// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// The threshold pool's rules at their exact boundaries. Every expected value below is worked out by hand from the
// rules in src/pool.js, not copied from a run. Found by mutation testing (21 Nov 2026): the "fewer than k is not
// published" line could be deleted or shifted by one without a test failing (the differencing check hid it), and the
// published statistics were never compared with exact values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecordStore, progressCard, publishRound, personalView, ladder, canonical, normaliseQuestion, differencingCheck, MIN_K,
} from '../src/pool.js';

const Q = {
  id: 'q-guard',
  attributes: { role: ['QA', 'PM'], region: ['Lyon', 'Paris'] },
  attributeOrder: ['role', 'region'],
  broadenOrder: ['region', 'role'],
  k: 5,
  minDistinct: 2,
};
let n = 0;
const key = () => `guard-record-${String(++n).padStart(8, '0')}`;
function add(store, attrs, values) { return values.map(v => store.upsert(key(), attrs, v)); }
const QA_LYON = { role: 'QA', region: 'Lyon' };
const PM_LYON = { role: 'PM', region: 'Lyon' };
const stats = (g) => ({ count: g.count, q1: g.q1, median: g.median, q3: g.q3 });

// ---- the k threshold and the distinct-values rule --------------------------------------------------------------------

test('a group of exactly k people with enough distinct values is published, broad first', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [40000, 41000, 42000, 43000, 44000]);
  const { release } = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  // ladder: QA·Lyon, QA, Everyone; all have the same 5 members, so each is safe after the one before
  assert.deepEqual(release.groups.map(g => g.label), ['Everyone', 'QA', 'QA · Lyon']);
  // nearest rank on 5 sorted values: q1 = 2nd, median = 3rd, q3 = 4th
  for (const g of release.groups) assert.deepEqual(stats(g), { count: 5, q1: 41000, median: 42000, q3: 43000 });
  assert.deepEqual(release.waiting, []);
});

test('a group below k is skipped silently: it is neither published nor listed as waiting', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [40000, 41000, 42000, 43000, 44000]);
  add(s, PM_LYON, [50000, 51000, 52000, 53000]); // 4 PMs: below k
  const { release } = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  // Everyone (9) is published. QA (5) would let anyone compute the 4 PMs as Everyone minus QA, so it waits.
  assert.deepEqual(release.groups.map(g => g.label), ['Everyone']);
  assert.deepEqual(release.waiting.map(w => w.label), ['QA', 'QA · Lyon']);
  for (const w of release.waiting) assert.equal(w.reason, 'result due in a coming round');
});

test('distinct values: exactly minDistinct publishes; one fewer waits with the neutral reason', () => {
  const two = new RecordStore(Q);
  add(two, QA_LYON, [40000, 40000, 40000, 50000, 50000]);
  const r2 = publishRound(Q, two.all(), [], { round: 1, at: 'x' }).release;
  assert.deepEqual(stats(r2.groups[0]), { count: 5, q1: 40000, median: 40000, q3: 50000 });
  const one = new RecordStore(Q);
  add(one, QA_LYON, [40000, 40000, 40000, 40000, 40000]);
  const r1 = publishRound(Q, one.all(), [], { round: 1, at: 'x' }).release;
  assert.deepEqual(r1.groups, []);
  assert.deepEqual(r1.waiting, ['Everyone', 'QA', 'QA · Lyon'].map(label => ({ label, reason: 'result due in a coming round' })));
});

// ---- statistics -----------------------------------------------------------------------------------------------------

test('quartiles are nearest-rank on numbers sorted as numbers, not as text', () => {
  const s = new RecordStore({ ...Q, minDistinct: 2 });
  add(s, QA_LYON, [100, 20, 3, 1000, 50]); // as text: 100, 1000, 20, 3, 50
  const g = publishRound(Q, s.all(), [], { round: 1, at: 'x' }).release.groups[0];
  assert.deepEqual(stats(g), { count: 5, q1: 20, median: 50, q3: 100 });
});

test('quartiles on 1..20: q1 = 5, median = 10, q3 = 15 (nearest rank)', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, Array.from({ length: 20 }, (_, i) => 20 - i));
  const g = publishRound(Q, s.all(), [], { round: 1, at: 'x' }).release.groups[0];
  assert.deepEqual(stats(g), { count: 20, q1: 5, median: 10, q3: 15 });
});

// ---- rounds, repeats, carried results ------------------------------------------------------------------------------

test('round numbers: explicit wins; otherwise one more than the highest in history; 1 to start', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4, 5]);
  assert.equal(publishRound(Q, s.all(), [], { at: 'x' }).release.round, 1);
  assert.equal(publishRound(Q, [], [{ round: 3, rows: [] }, { round: 1, rows: [] }], { at: 'x' }).release.round, 4);
  assert.equal(publishRound(Q, [], [{ round: 3, rows: [] }], { round: 9, at: 'x' }).release.round, 9);
});

test('an unchanged round republishes the same groups but adds nothing to the private history', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4, 5]);
  const r1 = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  assert.equal(r1.privateRows.length, 3);
  const r2 = publishRound(Q, s.all(), [{ round: 1, rows: r1.privateRows }], { round: 2, at: 'y' });
  assert.deepEqual(r2.release.groups.map(g => g.label), ['Everyone', 'QA', 'QA · Lyon']);
  assert.ok(r2.release.groups.every(g => g.asOfRound === undefined), 'fresh, not carried');
  assert.deepEqual(r2.privateRows, []);
});

test('a group that cannot be refreshed keeps its most recent published result, marked with that round', () => {
  const row = (round, q1) => ({ spec: {}, members: [`m${round}@1`], stats: { count: 5, q1, median: q1 + 1, q3: q1 + 2 }, round });
  const history = [{ round: 2, rows: [row(2, 70)] }, { round: 1, rows: [row(1, 10)] }];
  const g = publishRound(Q, [], history, { round: 3, at: 'x' }).release.groups;
  assert.deepEqual(g, [{ spec: {}, label: 'Everyone', count: 5, q1: 70, median: 71, q3: 72, asOfRound: 2 }]);
});

test('a group refreshed this round is not also carried from history', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4, 5]);
  const old = { spec: {}, members: ['a@1', 'b@1', 'c@1', 'd@1', 'e@1'], stats: { count: 5, q1: 9, median: 9, q3: 9 }, round: 1 };
  const g = publishRound(Q, s.all(), [{ round: 1, rows: [old] }], { round: 2, at: 'x' }).release.groups;
  const everyone = g.filter(x => x.label === 'Everyone');
  assert.equal(everyone.length, 1);
  assert.equal(everyone[0].asOfRound, undefined);
  assert.equal(everyone[0].median, 3);
});

test('release metadata: given time kept; default time is an ISO timestamp; k and question id included', () => {
  const r = publishRound(Q, [], [], { round: 1, at: '2026-11-21T00:00:00Z' }).release;
  assert.deepEqual([r.question, r.k, r.at], ['q-guard', 5, '2026-11-21T00:00:00Z']);
  const d = publishRound(Q, [], [], { round: 1 }).release;
  assert.match(d.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ---- personal view --------------------------------------------------------------------------------------------------

test('personalView: position uses strict quartile boundaries (a value equal to a boundary goes up)', () => {
  const release = { groups: [{ spec: {}, label: 'Everyone', count: 9, q1: 10, median: 20, q3: 30 }] };
  const at = (v) => personalView(Q, [], release, QA_LYON, v).position;
  assert.deepEqual([9, 10, 19, 20, 29, 30, 99].map(at),
    ['bottom quarter', 'second quarter', 'second quarter', 'third quarter', 'third quarter', 'top quarter', 'top quarter']);
  assert.equal(personalView(Q, [], release, QA_LYON).position, null, 'no own value, no position');
  assert.equal(personalView(Q, [], { groups: [] }, QA_LYON, 15).position, null, 'nothing published, no position');
});

test('personalView: locked cards stop at the first published rung; full-but-unpublished groups say so', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4, 5]);
  add(s, { role: 'QA', region: 'Paris' }, [6, 7]);
  const release = { groups: [{ spec: {}, label: 'Everyone', count: 7, q1: 2, median: 4, q3: 6 }] };
  const v = personalView(Q, s.all(), release, QA_LYON, 3);
  assert.equal(v.result.label, 'Everyone');
  assert.deepEqual(v.locked.map(c => c.text), [
    'QA · Lyon: 5 people, result due in a coming round',
    'QA: 7 people, result due in a coming round',
  ]);
  const p = personalView(Q, s.all(), release, { role: 'QA', region: 'Paris' }, 6);
  assert.deepEqual(p.locked.map(c => c.text), ['QA · Paris: 2 of 5, 3 more to unlock', 'QA: 7 people, result due in a coming round']);
});

// ---- validation and helpers -----------------------------------------------------------------------------------------

test('normaliseQuestion: refuses a missing id or attributes and unknown broaden attributes; fills defaults', () => {
  assert.throws(() => normaliseQuestion(undefined), { message: 'question.id required' });
  for (const bad of [{}, { id: '' }, { id: 5 }]) assert.throws(() => normaliseQuestion({ attributes: {}, ...bad }), { message: 'question.id required' }, JSON.stringify(bad));
  assert.throws(() => normaliseQuestion({ id: 'x' }), { message: 'question.attributes required' });
  assert.throws(() => normaliseQuestion({ id: 'x', attributes: 'role' }), { message: 'question.attributes required' });
  assert.throws(() => normaliseQuestion({ id: 'x', attributes: { a: ['1'] }, broadenOrder: ['b'] }), { message: 'broadenOrder names unknown attribute b' });
  const q = normaliseQuestion({ id: 'x', attributes: { a: ['1'] } });
  assert.deepEqual([q.k, q.minDistinct, q.rounding, q.valueMin, q.broadenOrder, q.attributeOrder, q.title], [15, 3, 1, 0, [], ['a'], 'x']);
  assert.deepEqual(ladder({ id: 'x', attributes: { a: ['1'] } }, { a: '1' }), [{ a: '1' }], 'no broadening: one rung');
  assert.equal(MIN_K, 5);
  assert.throws(() => normaliseQuestion({ id: 'x', attributes: {}, k: 4 }), RangeError);
  assert.equal(normaliseQuestion({ id: 'x', attributes: {}, k: 5 }).k, 5);
});

test('RecordStore: key length, attributes, value type and inclusive range; versions count up', () => {
  const s = new RecordStore({ ...Q, valueMin: 10, valueMax: 20 });
  assert.throws(() => s.upsert('k'.repeat(15), QA_LYON, 15), { message: 'record key must be a string of 16+ chars' });
  assert.throws(() => s.upsert(42, QA_LYON, 15), { message: 'record key must be a string of 16+ chars' });
  const k16 = 'k'.repeat(16);
  assert.throws(() => s.upsert(k16, undefined, 15), { message: 'attribute role must be one of QA, PM' });
  for (const bad of [NaN, Infinity, '15']) assert.throws(() => s.upsert(k16, QA_LYON, bad), { message: 'value must be a finite number' });
  assert.throws(() => s.upsert(k16, QA_LYON, 9), { message: 'value out of range' });
  assert.throws(() => s.upsert(k16, QA_LYON, 21), { message: 'value out of range' });
  assert.deepEqual([10, 20, 15].map(v => s.upsert(k16, QA_LYON, v).version), [1, 2, 3]);
});

test('canonical: the same spec in any key order gives the same text', () => {
  assert.equal(canonical({ region: 'Lyon', role: 'QA' }), canonical({ role: 'QA', region: 'Lyon' }));
  assert.notEqual(canonical({ role: 'QA' }), canonical({ role: 'PM' }));
});

test('progressCard: exactly k is unlocked; one fewer says how many are needed', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4]);
  assert.deepEqual(progressCard(Q, s.all(), QA_LYON), { label: 'QA · Lyon', count: 4, k: 5, needed: 1, unlocked: false, text: 'QA · Lyon: 4 of 5, 1 more to unlock' });
  add(s, QA_LYON, [5]);
  assert.deepEqual(progressCard(Q, s.all(), QA_LYON), { label: 'QA · Lyon', count: 5, k: 5, needed: 0, unlocked: true, text: 'QA · Lyon: unlocked (5 people)' });
});

test('differencingCheck: no small atoms is safe; a small atom that a difference isolates is not', () => {
  assert.deepEqual(differencingCheck([['a', 'b', 'c', 'd', 'e']], 5), { safe: true, smallAtoms: 0 });
  assert.deepEqual(differencingCheck([['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c', 'd', 'e']], 5), { safe: false, smallAtoms: 1 });
});

test('publish order: broad first, then bigger groups, then by canonical spec', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4, 5]);
  add(s, { role: 'QA', region: 'Paris' }, [6, 7, 8, 9, 10]);
  add(s, PM_LYON, [11, 12, 13, 14, 15]);
  const { release } = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  // all atoms have 5 people, so everything is safe; the order is the rule's alone
  assert.deepEqual(release.groups.map(g => g.label), ['Everyone', 'QA', 'PM', 'PM · Lyon', 'QA · Lyon', 'QA · Paris']);
});

test('an unchanged round is recognised as a repeat even when records arrive in another order', () => {
  const s = new RecordStore(Q);
  add(s, QA_LYON, [1, 2, 3, 4, 5]);
  const r1 = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  const r2 = publishRound(Q, [...s.all()].reverse(), [{ round: 1, rows: r1.privateRows }], { round: 2, at: 'y' });
  assert.deepEqual(r2.privateRows, []);
  const r1b = publishRound(Q, [...s.all()].reverse(), [], { round: 1, at: 'x' }); // stored history in another order
  assert.deepEqual(publishRound(Q, s.all(), [{ round: 1, rows: r1b.privateRows }], { round: 2, at: 'y' }).privateRows, []);
});

test('carried results: the latest round wins whatever the history order; rows without statistics are never carried', () => {
  const row = (round, q1) => ({ spec: {}, members: [`m${round}@1`], stats: { count: 5, q1, median: q1, q3: q1 }, round });
  for (const history of [[{ round: 1, rows: [row(1, 10)] }, { round: 2, rows: [row(2, 70)] }],
    [{ round: 2, rows: [row(2, 70)] }, { round: 1, rows: [row(1, 10)] }]]) {
    assert.equal(publishRound(Q, [], history, { round: 3, at: 'x' }).release.groups[0].q1, 70);
  }
  const noStats = [{ round: 1, rows: [{ spec: { role: 'QA' }, members: ['a@1'], round: 1 }] }];
  assert.deepEqual(publishRound(Q, [], noStats, { round: 2, at: 'x' }).release.groups, []);
});

test('publishRound without a history argument starts at round 1', () => {
  assert.equal(publishRound(Q, [], undefined, { at: 'x' }).release.round, 1);
  assert.equal(publishRound(Q, []).release.round, 1);
});
