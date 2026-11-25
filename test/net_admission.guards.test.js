// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
// Guard tests for the SPEC in test/fixtures/net/admission/SPEC.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as admission from '../src/net/admission.js';

const hex = c => c.repeat(64);
const A = hex('a'), B = hex('b'), C = hex('c');
const input = (over = {}) => ({ tier: 'A', dinaTrust: '', type: 'hello', sender: A, now: 0, ...over });
const state = (counts = [], day = 0) => ({ version: 1, day, counts });
const admit = (i = input(), s = state(), p) => admission.admit(i, s, p);
const drop = reason => ({ route: 'drop', senderTrust: 'unknown', reasons: [reason] });

test('exports: defaults are exact, frozen, and emptyState is fresh (S1 S2)', () => {
  assert.deepEqual(admission.CONTACT_LEVELS, ['verified', 'trusted', 'contact_ring1', 'contact_ring2', 'self']);
  assert.deepEqual(admission.DEFAULT_POLICY, { perDay: { A: 100, B: 5 }, knockType: 'synalla.knock', maxSenders: 10000 });
  assert.ok(Object.isFrozen(admission.DEFAULT_POLICY.perDay));
  const a = admission.emptyState(), b = admission.emptyState();
  assert.deepEqual(a, { version: 1, day: -1, counts: [] });
  assert.notEqual(a, b);
  assert.notEqual(a.counts, b.counts);
});

test('HEX64 is anchored at both ends for senders and state counts (S3 S4)', () => {
  assert.deepEqual(admit(input({ sender: A + 'f' })).decision, drop('bad input'));
  assert.deepEqual(admit(input({ sender: 'f' + A })).decision, drop('bad input'));
  assert.throws(() => admit(input(), state([[A + 'f', 1]])), TypeError);
  assert.throws(() => admit(input(), state([['f' + A, 1]])), TypeError);
});

test('times are safe non-negative integers, checked consistently (S5)', () => {
  assert.throws(() => admit(input(), state(), { perDay: { A: -1 } }), TypeError);
  assert.throws(() => admit(input(), state(), { perDay: { B: 1.5 } }), TypeError);
  assert.throws(() => admit(input(), state(), { maxSenders: -1 }), TypeError);
  assert.deepEqual(admit(input({ now: -1 })).decision, drop('bad input'));
  assert.deepEqual(admit(input({ now: 1.5 })).decision, drop('bad input'));
  assert.throws(() => admit(input(), state([], 1.5)), TypeError);
});

test('state must be a plain non-array object: arrays and functions are rejected (S6 S7 S9 S11)', () => {
  const fields = { version: 1, day: 0, counts: [] };
  assert.throws(() => admit(input(), Object.assign([], fields)), TypeError);
  const fn = () => {};
  assert.throws(() => admit(input(), Object.assign(fn, fields)), TypeError);
  assert.throws(() => admit(input(), null), TypeError);
});

test('counts must be an array (S13 S14)', () => {
  assert.throws(() => admit(input(), { version: 1, day: 0, counts: new Set([[A, 1]]) }), TypeError);
  assert.deepEqual(admit(input(), state([[A, 1]])).decision.route, 'dina');
});

test('count entries must be two-element arrays (S15 S16 S17 S18)', () => {
  assert.throws(() => admit(input(), state([[A, 1, 9]])), TypeError);
  assert.throws(() => admit(input(), state([{ 0: A, 1: 1, length: 2 }])), TypeError);
});

test('count senders and counts must be valid (S19)', () => {
  assert.throws(() => admit(input(), state([[[A], 1]])), TypeError);
  assert.throws(() => admit(input(), state([[hex('z'), 1]])), TypeError);
  assert.throws(() => admit(input(), state([[A, 0]])), TypeError);
});

test('count senders are strictly increasing (S20 S21)', () => {
  assert.throws(() => admit(input(), state([[B, 1], [A, 1]])), TypeError);
  assert.throws(() => admit(input(), state([[A, 1], [A, 1]])), TypeError);
});

test('policy must be a non-null, non-array object (S22 S23 S24)', () => {
  assert.throws(() => admit(input(), state(), []), TypeError);
  assert.throws(() => admit(input(), state(), 'policy'), TypeError);
  assert.deepEqual(admit(input(), state(), {}).decision.route, 'dina');
});

test('missing perDay keys use the defaults (S26 S27 S28)', () => {
  assert.deepEqual(admit(input(), state(), {}).state.counts, [[A, 1]]);
  assert.deepEqual(admit(input(), state(), { perDay: undefined }).state.counts, [[A, 1]]);
});

test('perDay must be a non-null, non-array object (S29 S30 S31 S32)', () => {
  assert.throws(() => admit(input(), state(), { perDay: [] }), TypeError);
  assert.throws(() => admit(input(), state(), { perDay: null }), TypeError);
  const fn = () => {};
  fn.A = 5;
  fn.B = 5;
  assert.throws(() => admit(input(), state(), { perDay: fn }), TypeError);
});

test('a perDay with only A still keeps the default B limit (S34)', () => {
  const s = state([[B, 5]]);
  assert.deepEqual(admit(input({ sender: B, tier: 'B' }), s, { perDay: { A: 0 } }).decision, drop('daily limit for tier B reached'));
});

test('perDay.A override is applied when present (S35 S37)', () => {
  const s = state([[A, 1]]);
  assert.deepEqual(admit(input(), s, { perDay: { A: 1 } }).decision, drop('daily limit for tier A reached'));
});

test('perDay.A that is undefined counts as missing (S36 S38 S39)', () => {
  assert.deepEqual(admit(input(), state(), { perDay: {} }).state.counts, [[A, 1]]);
  assert.deepEqual(admit(input(), state(), { perDay: { A: undefined } }).state.counts, [[A, 1]]);
});

test('invalid perDay.A and B values throw (S40 S41 S43)', () => {
  assert.throws(() => admit(input(), state(), { perDay: { A: -1 } }), TypeError);
  assert.throws(() => admit(input(), state(), { perDay: { B: '5' } }), TypeError);
});

test('knockType must be a non-empty string and may be overridden (S44 S45 S46)', () => {
  assert.throws(() => admit(input(), state(), { knockType: '' }), TypeError);
  assert.throws(() => admit(input(), state(), { knockType: 5 }), TypeError);
  assert.deepEqual(admit(input({ type: 'custom' }), state(), { knockType: 'custom' }).decision,
    { route: 'knock', senderTrust: 'unknown', reasons: ['knock: the gate decides'] });
});

test('maxSenders is validated and enforced for new senders (S47)', () => {
  assert.throws(() => admit(input(), state(), { maxSenders: -1 }), TypeError);
  assert.deepEqual(admit(input({ sender: B }), state([[A, 1]]), { maxSenders: 1 }).decision, drop('too many senders today'));
});

test('input must be a non-null, non-array, non-function object (S48 S49 S50)', () => {
  const fields = input();
  assert.deepEqual(admit(Object.assign([], fields)).decision, drop('bad input'));
  const fn = () => {};
  assert.deepEqual(admit(Object.assign(fn, fields)).decision, drop('bad input'));
  assert.deepEqual(admit(null).decision, drop('bad input'));
});

test('dinaTrust and type have exact length bounds (S51 S52 S53)', () => {
  assert.deepEqual(admit(input({ dinaTrust: 'x'.repeat(33) })).decision, drop('bad input'));
  assert.deepEqual(admit(input({ dinaTrust: 'x'.repeat(32) })).decision.route, 'dina');
  assert.deepEqual(admit(input({ type: 'x'.repeat(101) })).decision, drop('bad input'));
  assert.deepEqual(admit(input({ type: 'x'.repeat(100) })).decision.route, 'dina');
  assert.deepEqual(admit(input({ type: 5 })).decision, drop('bad input'));
});

test('input sender must really be a HEX64 string (S54)', () => {
  assert.deepEqual(admit(input({ sender: [A] })).decision, drop('bad input'));
  assert.deepEqual(admit(input({ sender: 42 })).decision, drop('bad input'));
});

test('policy validation precedes state validation (S55)', () => {
  assert.throws(() => admit(input(), null, { knockType: '' }), TypeError);
});

test('blocked and contact rules come before the tier rules', () => {
  assert.deepEqual(admit(input({ dinaTrust: '  BLOCKED ' })).decision,
    { route: 'drop', senderTrust: 'blocked', reasons: ['blocked contact'] });
  for (const level of admission.CONTACT_LEVELS) {
    assert.deepEqual(admit(input({ dinaTrust: level, tier: 'D' })).decision,
      { route: 'dina', senderTrust: level, reasons: ['existing contact'] });
  }
  assert.deepEqual(admit(input({ dinaTrust: 'friend' })).decision.route, 'dina');
});

test('D, knock and C rules take precedence in order', () => {
  assert.deepEqual(admit(input({ tier: 'D' })).decision, drop('tier D: no contact, vouch or proof'));
  assert.deepEqual(admit(input({ tier: 'D', type: 'synalla.knock' })).decision, drop('tier D: no contact, vouch or proof'));
  assert.deepEqual(admit(input({ tier: 'C' })).decision, drop('tier C may only knock'));
  assert.deepEqual(admit(input({ tier: 'C', type: 'synalla.knock' })).decision.route, 'knock');
});

test('day rolls forward only, never backwards', () => {
  assert.deepEqual(admit(input({ tier: 'D', now: 86400 }), state([[A, 1]])).state, { version: 1, day: 1, counts: [] });
  assert.deepEqual(admit(input({ tier: 'D', now: 0 }), state([[A, 1]], 1)).state, { version: 1, day: 1, counts: [[A, 1]] });
  assert.deepEqual(admit(input({ now: 86400 }), state([[A, 5]])).state.counts, [[A, 1]]);
});

test('the daily limit is inclusive and its drop decision is exact (S56 S57 S58 S59 S60 S61 S62 S63 S64 S65 S66 S67)', () => {
  const s = state([[A, 1]]);
  const got = admit(input(), s, { perDay: { A: 1, B: 1 } });
  assert.deepEqual(got.decision, drop('daily limit for tier A reached'));
  assert.deepEqual(got.state, s);
  assert.deepEqual(Object.keys(got.decision).sort(), ['reasons', 'route', 'senderTrust']);
  assert.deepEqual(Object.keys(got.state).sort(), ['counts', 'day', 'version']);
  const b = admit(input({ tier: 'B', sender: B }), state([[B, 1]]), { perDay: { A: 100, B: 1 } });
  assert.deepEqual(b.decision, drop('daily limit for tier B reached'));
});

test('tier A uses its own limit rather than B (S56 S57)', () => {
  const s = state([[A, 2]]);
  assert.deepEqual(admit(input(), s, { perDay: { A: 2, B: 100 } }).decision, drop('daily limit for tier A reached'));
});

test('counted rules add one count and keep senders sorted', () => {
  const got = admit(input({ sender: A }), state([[B, 3]]));
  assert.deepEqual(got.state.counts, [[A, 1], [B, 3]]);
  assert.deepEqual(got.decision, { route: 'dina', senderTrust: 'contact_ring2', reasons: ['tier A: vouched'] });
  const b = admit(input({ tier: 'B', sender: C }), state([[B, 3]]));
  assert.deepEqual(b.decision, { route: 'dina', senderTrust: 'unknown', reasons: ['tier B: held for you to accept'] });
  assert.deepEqual(b.state.counts, [[B, 3], [C, 1]]);
  const again = admit(input(), state([[A, 2]]));
  assert.deepEqual(again.state.counts, [[A, 3]]);
});

test('admit is pure and copies only the specified state fields', () => {
  const s = { version: 1, day: 0, counts: [[B, 1]], extra: 'ignored' };
  const before = JSON.parse(JSON.stringify(s));
  const got = admit(input(), s);
  assert.deepEqual(s, before);
  assert.deepEqual(got.state, { version: 1, day: 0, counts: [[A, 1], [B, 1]] });
  assert.notEqual(got.state.counts[1], s.counts[0]);
});
