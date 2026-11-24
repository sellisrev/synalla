// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// Each rule of succession.ts at an input only that rule decides. Found by the first mutation run (24 Nov 2026, 85.7%):
// the property tests never produced a denial signed by another key, a citation of another claim's conflict, a rival
// claim with no attester, or duplicate claim ids, and never asserted the trust flag on accepted or disputed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { succession, HOLD, CONTACT_MIN_AGE, ACCEPT_AT, SETTLE_AT } from '../src/succession.js';

const DAY = 86400, T = 1_800_000_000, OLD = 'old', NEW = 'new';
const claim = (id, next, seenAt = T, old = OLD) => ({ type: 'claim', id, old, next, seenAt });
const att = (id, c, attester, cites = [], seenAt = T + 10) => ({ type: 'attest', id, claim: c, attester, channel: 'phone', seenAt, cites });
const deny = (id, c, old = OLD, seenAt = T + 5) => ({ type: 'deny', id, claim: c, old, seenAt });
const peer = (contacts, extra = {}) => ({ contacts: new Map(contacts.map(k => [k, T - 30 * DAY])), now: T + 10 * DAY, ...extra });

test('constants are the decided values', () => {
  assert.equal(HOLD, 72 * 3600);
  assert.equal(CONTACT_MIN_AGE, 14 * DAY);
  assert.equal(ACCEPT_AT, 2);
  assert.equal(SETTLE_AT, 3);
});

test('the trust flag: false once suspended, accepted or disputed', () => {
  const p = peer(['a', 'b']);
  assert.equal(succession(OLD, [claim('c', NEW), att('1', 'c', 'a'), att('2', 'c', 'b')], p).oldKeyTrusted, false);
  assert.equal(succession(OLD, [claim('c', NEW), att('1', 'c', 'a'), att('2', 'c', 'b'), deny('d', 'c')], p).oldKeyTrusted, false);
});

test('only a denial signed by the old key counts', () => {
  const st = [claim('c', NEW), att('1', 'c', 'a'), att('2', 'c', 'b'), deny('d', 'c', 'someone-else')];
  assert.equal(succession(OLD, st, peer(['a', 'b'])).state, 'accepted');
});

test("citing another claim's denial does not settle this one", () => {
  // R is denied by the thief; F (1 attester) is denied too. R's attesters cite only F's denial.
  const st = [claim('R', NEW), claim('F', 'fake'), att('f', 'F', 'x'), deny('dF', 'F'), deny('dR', 'R'),
    att('1', 'R', 'a', ['dF']), att('2', 'R', 'b', ['dF']), att('3', 'R', 'e', ['dF'])];
  const r = succession(OLD, st, peer(['a', 'b', 'e', 'x']));
  assert.equal(r.state, 'disputed');
  assert.deepEqual(r.claims.find(c => c.id === 'R').fresh, []);
});

test('a rival claim below the threshold is not a conflict to cite', () => {
  const st = [claim('R', NEW), claim('F', 'fake'), deny('dR', 'R'),
    att('1', 'R', 'a', ['F']), att('2', 'R', 'b', ['F']), att('3', 'R', 'e', ['F'])];
  assert.equal(succession(OLD, st, peer(['a', 'b', 'e'])).state, 'disputed');
  const both = [...st, att('f1', 'F', 'x'), att('f2', 'F', 'y')]; // F now at 2: a real conflict, and R's citations settle R
  const r = succession(OLD, both, peer(['a', 'b', 'e', 'x', 'y']));
  assert.equal(r.successor, NEW);
  assert.deepEqual(r.claims.find(c => c.id === 'R').fresh, ['a', 'b', 'e']);
});

test('a claim id seen twice keeps its earliest sighting, which sets the 14-day window', () => {
  // Contacts first seen 10 days before the earliest sighting: too new. Against the later sighting (5 days on) they
  // would be 15 days old and count, so taking the wrong sighting would accept.
  const contacts = new Map([['a', T - 10 * DAY], ['b', T - 10 * DAY]]);
  const early = claim('c', NEW, T), late = claim('c', NEW, T + 5 * DAY);
  for (const order of [[early, late], [late, early]]) {
    const r = succession(OLD, [...order, att('1', 'c', 'a'), att('2', 'c', 'b')], { contacts, now: T + 6 * DAY });
    assert.equal(r.state, 'claimed');
  }
  const exact = new Map([['a', T - 14 * DAY], ['b', T - 14 * DAY]]);
  assert.equal(succession(OLD, [early, att('1', 'c', 'a'), att('2', 'c', 'b')], { contacts: exact, now: T }).state, 'accepted',
    'exactly 14 days counts');
});

test('claims are reported in id order', () => {
  const r = succession(OLD, [claim('m', 'x2'), claim('b', 'x1'), claim('z', 'x3')], peer([]));
  assert.deepEqual(r.claims.map(c => c.id), ['b', 'm', 'z']);
});

test('error messages say what is wrong', () => {
  assert.throws(() => succession(OLD, [null], peer([])), /statement must be an object/);
  assert.throws(() => succession(OLD, [{ type: 'claim', id: 5, seenAt: T }], peer([])), /statement id must be a non-empty string/);
  assert.throws(() => succession(OLD, [{ type: 'claim', id: 'c', seenAt: 'x' }], peer([])), /seenAt must be a finite number/);
  assert.throws(() => succession(5, [], peer([])), /old must be a non-empty string/);
  assert.throws(() => succession(OLD, [], null), /bad peer view/);
});

test('citing your own claim is not knowing about a conflict', () => {
  const st = [claim('c', NEW), deny('d', 'c'), att('1', 'c', 'a', ['c']), att('2', 'c', 'b', ['c']), att('3', 'c', 'e', ['c'])];
  const r = succession(OLD, st, peer(['a', 'b', 'e']));
  assert.deepEqual(r.claims[0].fresh, []);
  assert.equal(r.state, 'disputed');
});

test('a non-object statement is refused as such', () => {
  assert.throws(() => succession(OLD, ['claim'], peer([])), /statement must be an object/);
});
