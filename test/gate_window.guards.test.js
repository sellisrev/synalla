// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// The knock age window, pruning and snapshots (24 Nov 2026, pilot plan W3). Before, the gate had no age limit, so it
// could never forget a seen id and its memory grew for ever; now knocks older than the window are refused, ids older
// than it are forgotten once a day, counters from before yesterday are dropped, and the state can be saved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from '../src/event.js';
import { createKnock } from '../src/knock.js';
import { Gate, DEFAULT_GATE_POLICY } from '../src/gate.js';

const DAY = 86400, T = 1_800_000_000;
const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const owner = person(), contact = person();
const graph = { hops: () => Infinity, removed: new Set() };
const knock = (at, note = '') => createKnock(contact.sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note }, { createdAt: at });
const gate = (policy = {}) => new Gate({ owner: owner.pk, contacts: [contact.pk], graph, policy: { perSenderPerDay: { A: 1000 }, ...policy } });

test('defaults: a 10-day window and 5 minutes of clock slack', () => {
  assert.equal(DEFAULT_GATE_POLICY.maxAgeSeconds, 10 * DAY);
  assert.equal(DEFAULT_GATE_POLICY.maxFutureSeconds, 300);
});

test('age window: exactly at the edge is accepted, one second beyond is refused, both ways', () => {
  const g = gate();
  assert.equal(g.receive(knock(T - 10 * DAY), T).action, 'inbox');
  assert.deepEqual(g.receive(knock(T - 10 * DAY - 1), T).reasons, ['too old']);
  assert.equal(g.receive(knock(T + 300), T).action, 'inbox');
  assert.deepEqual(g.receive(knock(T + 301), T).reasons, ['dated in the future']);
  const narrow = gate({ maxAgeSeconds: 60, maxFutureSeconds: 0 });
  assert.deepEqual(narrow.receive(knock(T - 61), T).reasons, ['too old']);
  assert.deepEqual(narrow.receive(knock(T + 1), T).reasons, ['dated in the future']);
});

test('a refused knock is not remembered: the same knock later in the window is accepted once', () => {
  const g = gate();
  const k = knock(T + 1000);
  assert.deepEqual(g.receive(k, T).reasons, ['dated in the future']);
  assert.equal(g.receive(k, T + 1000).action, 'inbox');
  assert.deepEqual(g.receive(k, T + 1001).reasons, ['duplicate']);
});

test('once a day, ids too old to come back are forgotten; newer ones are kept', () => {
  const g = gate();
  const old = knock(T), recent = knock(T + 5 * DAY, 'recent');
  g.receive(old, T);
  g.receive(recent, T + 5 * DAY);
  assert.deepEqual([...g.seen.keys()].sort(), [old.id, recent.id].sort());
  g.receive(knock(T + 11 * DAY, 'later'), T + 11 * DAY);
  assert.equal(g.seen.has(old.id), false, 'older than the window: forgotten');
  assert.equal(g.seen.has(recent.id), true);
  assert.deepEqual(g.receive(old, T + 11 * DAY).reasons, ['too old'], 'and refused if it comes back');
  assert.deepEqual(g.receive(recent, T + 11 * DAY).reasons, ['duplicate']);
});

test('pruning runs once per day: within the same day nothing is forgotten', () => {
  const g = gate({ maxAgeSeconds: 100 });
  const day0 = Math.floor(T / DAY) * DAY;
  const a = knock(day0 + 10);
  g.receive(a, day0 + 10);
  g.receive(knock(day0 + 500, 'b'), day0 + 500); // same day, past a's window: no prune yet
  assert.equal(g.seen.has(a.id), true);
});

test('counters from before yesterday are dropped; yesterday\'s are kept', () => {
  const g = gate({ perSenderPerDay: { A: 1 } });
  const d0 = Math.floor(T / DAY) * DAY;
  g.receive(knock(d0 + 10), d0 + 10);
  g.receive(knock(d0 + DAY + 10, 'd1'), d0 + DAY + 10);
  assert.deepEqual([...g.counts.keys()].map(k => k.split('|')[0]).sort(), [String(d0 / DAY), String(d0 / DAY + 1)]);
  g.receive(knock(d0 + 2 * DAY + 10, 'd2'), d0 + 2 * DAY + 10);
  assert.deepEqual([...g.counts.keys()].map(k => k.split('|')[0]).sort(), [String(d0 / DAY + 1), String(d0 / DAY + 2)]);
  // A clock that steps back to yesterday still finds yesterday's count.
  assert.deepEqual(g.receive(knock(d0 + DAY + 20, 'back'), d0 + DAY + 20).reasons, ['sender reached its daily limit']);
});

test('snapshot and restore: a restarted gate still knows seen ids and today\'s counts; anything else is refused', () => {
  const g = gate({ perSenderPerDay: { A: 1 } });
  const k = knock(T);
  g.receive(k, T);
  const saved = JSON.parse(JSON.stringify(g.snapshot()));
  assert.deepEqual(saved, { version: 1, seen: [[k.id, T]], counts: [[`${Math.floor(T / DAY)}|${contact.pk}`, 1]] });
  const again = gate({ perSenderPerDay: { A: 1 } });
  again.restore(saved);
  assert.deepEqual(again.receive(k, T + 1).reasons, ['duplicate']);
  assert.deepEqual(again.receive(knock(T + 2, 'new'), T + 2).reasons, ['sender reached its daily limit']);
  for (const bad of [null, {}, { version: 2, seen: [], counts: [] }, { version: 1, seen: [[1, 2]], counts: [] }, { version: 1, seen: [['a', 1.5]], counts: [] },
    { version: 1, seen: [], counts: [['nope', 1]] }, { version: 1, seen: [['a']], counts: [] }, { version: 1, seen: 'x', counts: [] }, { version: 1, seen: [], counts: [['5|x', 'n']] }]) {
    assert.throws(() => again.restore(bad), /not a gate snapshot/, JSON.stringify(bad));
  }
});

test('after restore, the next receive prunes as on a new day', () => {
  const g = gate();
  g.restore({ version: 1, seen: [['old-id', T - 20 * DAY], ['new-id', T]], counts: [[`${Math.floor(T / DAY) - 5}|x`, 3]] });
  g.receive(knock(T, 'x'), T);
  assert.equal(g.seen.has('old-id'), false);
  assert.equal(g.seen.has('new-id'), true);
  assert.equal(g.counts.has(`${Math.floor(T / DAY) - 5}|x`), false);
});

test('an id dated exactly at the window edge is kept when pruning, so it is still a duplicate', () => {
  const g = gate();
  const t = (Math.floor(T / DAY) + 1) * DAY + 5; // the first receive of a new day prunes
  const k = knock(t - 10 * DAY);
  assert.equal(g.receive(k, t - 10 * DAY + 10).action, 'inbox');
  assert.deepEqual(g.receive(k, t).reasons, ['duplicate']);
});

test('restore refuses entries that are not pairs, mixed good and bad entries, and malformed counter keys', () => {
  const g = gate();
  for (const bad of [
    { version: 1, seen: [['a', 1], [1, 2]], counts: [['5|x', 1]] },
    { version: 1, seen: [{ 0: 'a', 1: 1, length: 2 }], counts: [] },
    { version: 1, seen: [['a', 1, 2]], counts: [] },
    { version: 1, seen: [], counts: [[['5|x'], 1]] },
    { version: 1, seen: [], counts: [['x5|y', 1]] },
  ]) assert.throws(() => g.restore(bad), /not a gate snapshot/, JSON.stringify(bad));
});

test('the tier C day cap survives a snapshot and restore', () => {
  const stranger = person();
  const g = new Gate({ owner: owner.pk, contacts: [], graph, proofsFor: () => ({ personhood: true }), policy: { dailyCapC: 1, perSenderPerDay: { C: 5 } } });
  const k = (sk, n) => createKnock(sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note: n }, { createdAt: T });
  assert.equal(g.receive(k(stranger.sk, 'a'), T).action, 'requests');
  const again = new Gate({ owner: owner.pk, contacts: [], graph, proofsFor: () => ({ personhood: true }), policy: { dailyCapC: 1, perSenderPerDay: { C: 5 } } });
  again.restore(JSON.parse(JSON.stringify(g.snapshot())));
  assert.deepEqual(again.receive(k(person().sk, 'b'), T + 1).reasons, ['daily cap for unvouched senders reached']);
});
