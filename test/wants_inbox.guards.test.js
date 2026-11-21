// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// wants.js: the routing bands, every input check, and the floor's learning rules at their exact boundaries.
// inbox.js: relay URL rules, which inbox list wins, the relay cap and the delivery plan.
// Found by mutation testing (21 Nov 2026): wants.js scored 69% and inbox.js 77%.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';
import { wantScore, createWantGate, routeWant, recordAnswer, recordMiss } from '../src/wants.js';
import { createInboxList, readInboxList, deliveryPlan, INBOX_LIST_KIND } from '../src/inbox.js';

const err = (msg) => ({ ok: false, errors: [msg] });
const gate = (o = {}) => { const g = createWantGate(o); assert.equal(g.ok, true, JSON.stringify(g.errors)); return g.state; };

// ---- wantScore ------------------------------------------------------------------------------------------------------

test('wantScore: 1 - p(none), rounded to 3 decimals; refuses anything that is not a plain object with a valid none', () => {
  assert.deepEqual(wantScore({ none: 0.12345, job: 0.5 }), { ok: true, score: 0.877 });
  assert.deepEqual([wantScore({ none: 0 }).score, wantScore({ none: 1 }).score], [1, 0]);
  const bad = err('probs must be an object with a "none" probability');
  for (const p of [null, [], 'x', new Date(), Object.create(null), {}, { none: -0.01 }, { none: 1.01 }, { none: NaN },
    { none: Infinity }, { none: '0.5' }]) assert.deepEqual(wantScore(p), bad, String(JSON.stringify(p)));
});

// ---- createWantGate -------------------------------------------------------------------------------------------------

test('createWantGate: defaults are the ones chosen on 17 Nov 2026', () => {
  assert.deepEqual(gate(), { version: 1, act: 0.9, floor: 0.2, step: 0.05, minFloor: 0.05, maxFloor: 0.6, window: 8,
    minYes: 0.25, keep: 200, answers: [], changes: [] });
});

test('createWantGate: every invalid option is refused with its own message', () => {
  for (const o of [null, [], new Date()]) assert.deepEqual(createWantGate(o), err('options must be a plain object'));
  assert.deepEqual(createWantGate({ speed: 1 }), err('unknown option: speed'));
  for (const k of ['act', 'floor', 'step', 'minFloor', 'maxFloor', 'minYes'])
    for (const v of [-0.01, 1.01, NaN, '0.5']) assert.deepEqual(createWantGate({ [k]: v }), err(`${k} must be in 0..1`), `${k}=${v}`);
  for (const k of ['window', 'keep'])
    for (const v of [0, 1.5, -1, '3']) assert.deepEqual(createWantGate({ [k]: v }), err(`${k} must be a positive integer`), `${k}=${v}`);
  const order = err('need minFloor <= floor <= maxFloor < act');
  assert.deepEqual(createWantGate({ minFloor: 0.3, floor: 0.2 }), order);
  assert.deepEqual(createWantGate({ floor: 0.7 }), order, 'floor above maxFloor');
  assert.deepEqual(createWantGate({ maxFloor: 0.9 }), order, 'maxFloor equal to act');
  assert.equal(createWantGate({ minFloor: 0.2, floor: 0.2, maxFloor: 0.2 }).ok, true, 'equalities allowed below act');
  assert.equal(createWantGate({ window: 1, keep: 1 }).ok, true);
  assert.deepEqual(createWantGate({ step: 0 }), err('step must be above 0'));
});

// ---- routeWant ------------------------------------------------------------------------------------------------------

test('routeWant: act at and above act, confirm from floor up to act, drop below floor', () => {
  const s = gate();
  const r = (v) => routeWant(s, v);
  assert.deepEqual([r(1), r(0.9), r(0.899), r(0.2), r(0.199), r(0)].map(x => x.route), ['act', 'act', 'confirm', 'confirm', 'drop', 'drop']);
  assert.deepEqual(r(0.9), { ok: true, route: 'act' });
  for (const v of [-0.1, 1.1, NaN, '0.5']) assert.deepEqual(r(v), err('score must be in 0..1'));
});

// ---- recordAnswer -----------------------------------------------------------------------------------------------------

const ans = (score, yes, at) => ({ score, yes, at });
const feed = (s, list) => list.reduce((st, a) => { const r = recordAnswer(st, a); assert.equal(r.ok, true); return r.state; }, s);

test('recordAnswer: every invalid answer is refused with its own message', () => {
  const s = gate();
  for (const a of [null, [], 'x']) assert.deepEqual(recordAnswer(s, a), err('answer must be a plain object'));
  assert.deepEqual(recordAnswer(s, ans(1.5, true, 1)), err('score must be in 0..1'));
  assert.deepEqual(recordAnswer(s, ans(0.5, 'yes', 1)), err('yes must be true or false'));
  for (const at of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) assert.deepEqual(recordAnswer(s, ans(0.5, true, at)), err('at must be a time'), String(at));
  assert.equal(recordAnswer(s, ans(0.5, true, 0)).ok, true, 'time 0 is a time');
});

test('recordAnswer: the floor rises one step when the window of lowest answers is mostly no; the state is copied', () => {
  const s = gate({ window: 3 });
  const after = feed(s, [ans(0.3, false, 1), ans(0.4, false, 2), ans(0.5, false, 3)]);
  assert.equal(after.floor, 0.25);
  assert.deepEqual(after.changes, [{ at: 3, from: 0.2, to: 0.25, reason: 'mostly no at the bottom of the confirm band' }]);
  assert.deepEqual([s.floor, s.answers, s.changes], [0.2, [], []], 'input state not changed');
  assert.equal(feed(s, [ans(0.3, false, 1), ans(0.4, false, 2)]).floor, 0.2, 'window not full yet');
});

test('recordAnswer: the yes share must be below minYes (equal is enough to stay)', () => {
  const s = gate({ window: 4, minYes: 0.25 });
  assert.equal(feed(s, [ans(0.3, true, 1), ans(0.3, false, 2), ans(0.3, false, 3), ans(0.3, false, 4)]).floor, 0.2, '1 of 4 = 0.25');
  assert.equal(feed(s, [ans(0.3, false, 1), ans(0.3, false, 2), ans(0.3, false, 3), ans(0.3, false, 4)]).floor, 0.25, '0 of 4');
});

test('recordAnswer: only answers in the confirm band count (floor included, act excluded)', () => {
  const s = gate({ window: 2 });
  assert.equal(feed(s, [ans(0.9, false, 1), ans(0.95, false, 2)]).floor, 0.2, 'answers at or above act do not count');
  assert.equal(feed(s, [ans(0.1, false, 1), ans(0.19, false, 2)]).floor, 0.2, 'answers below the floor do not count');
  assert.equal(feed(s, [ans(0.2, false, 1), ans(0.899, false, 2)]).floor, 0.25, 'floor and just below act count');
});

test('recordAnswer: the window takes the lowest-scoring answers, not the oldest or the highest', () => {
  // window 2, minYes 0.5: raise when both answers in the window are no.
  const s = gate({ window: 2, minYes: 0.5 });
  // the two oldest are high-scoring yes; two later low-scoring no answers are the lowest two: raise.
  assert.equal(feed(s, [ans(0.8, true, 1), ans(0.7, true, 2), ans(0.3, false, 3), ans(0.25, false, 4)]).floor, 0.25);
  // the two lowest are yes, the two highest are no: no raise.
  assert.equal(feed(s, [ans(0.3, true, 1), ans(0.25, true, 2), ans(0.8, false, 3), ans(0.7, false, 4)]).floor, 0.2);
});

test('recordAnswer: only answers after the last change count, so one bad batch raises the floor once', () => {
  const s = gate({ window: 2 });
  const once = feed(s, [ans(0.3, false, 1), ans(0.3, false, 2)]);
  assert.equal(once.floor, 0.25);
  const same = feed(once, [ans(0.3, false, 2)]); // same time as the change: not after it
  assert.equal(same.floor, 0.25);
  assert.equal(feed(once, [ans(0.3, false, 3), ans(0.3, false, 4)]).floor, 0.3, 'two new no answers raise it again');
});

test('recordAnswer: the floor stops at maxFloor and logs no further change', () => {
  const s = gate({ window: 1, floor: 0.6, maxFloor: 0.6 });
  const after = feed(s, [ans(0.7, false, 1), ans(0.8, false, 2)]);
  assert.deepEqual([after.floor, after.changes], [0.6, []]);
});

test('recordAnswer: keeps only the last `keep` answers', () => {
  const s = gate({ keep: 3, window: 10 });
  const three = feed(s, [ans(0.3, true, 1), ans(0.3, true, 2), ans(0.3, true, 3)]);
  assert.deepEqual(three.answers.map(a => a.at), [1, 2, 3]);
  assert.deepEqual(feed(three, [ans(0.3, true, 4)]).answers.map(a => a.at), [2, 3, 4]);
});

// ---- recordMiss -------------------------------------------------------------------------------------------------------

test('recordMiss: a miss below the floor lowers it one step, never below the missed score or minFloor', () => {
  const s = gate();
  const one = recordMiss(s, { score: 0.1, at: 5 });
  assert.equal(one.ok, true);
  assert.deepEqual([one.state.floor, one.state.changes], [0.15, [{ at: 5, from: 0.2, to: 0.15, reason: 'missed a real want' }]]);
  assert.equal(recordMiss(s, { score: 0.18, at: 5 }).state.floor, 0.18, 'not below the missed score');
  assert.equal(recordMiss(gate({ floor: 0.07 }), { score: 0, at: 5 }).state.floor, 0.05, 'not below minFloor');
  assert.equal(recordMiss(s, { score: 0.2, at: 5 }).state.floor, 0.2, 'a miss at the floor was not dropped');
  assert.equal(s.floor, 0.2, 'input state not changed');
});

test('recordMiss: every invalid miss is refused with its own message', () => {
  const s = gate();
  for (const m of [null, [], 'x']) assert.deepEqual(recordMiss(s, m), err('miss must be a plain object'));
  for (const v of [-0.1, 1.1, NaN]) assert.deepEqual(recordMiss(s, { score: v, at: 1 }), err('score must be in 0..1'));
  for (const at of [-1, 1.5, '1']) assert.deepEqual(recordMiss(s, { score: 0.1, at }), err('at must be a time'));
});

// ---- inbox.js -------------------------------------------------------------------------------------------------------

const sk = generateSecretKey(), pk = getPublicKey(sk);
const T0 = 1_800_000_000;

test('createInboxList: relays normalised (no fragment, no trailing slash), deduplicated, signed as kind 10050', () => {
  const e = createInboxList(sk, ['wss://a.example/', 'wss://a.example#x', 'wss://b.example/path/'], { createdAt: T0 });
  assert.equal(e.kind, INBOX_LIST_KIND);
  assert.deepEqual(e.tags, [['relay', 'wss://a.example'], ['relay', 'wss://b.example/path']]);
});

test('createInboxList: refuses non-URLs, plain ws, credentials, an empty list and more than 8 relays', () => {
  assert.throws(() => createInboxList(sk, ['not a url']), { message: 'not a URL: not a url' });
  assert.throws(() => createInboxList(sk, ['ws://a.example']), { message: 'inbox relays must use wss:// (ws://a.example)' });
  assert.throws(() => createInboxList(sk, ['wss://user@a.example']), { message: 'relay URLs must not carry credentials' });
  assert.throws(() => createInboxList(sk, ['wss://:secret@a.example']), { message: 'relay URLs must not carry credentials' });
  assert.throws(() => createInboxList(sk, []), { message: 'at least one relay' });
  const r = (n) => Array.from({ length: n }, (_, i) => `wss://r${i}.example`);
  assert.equal(createInboxList(sk, r(8), { createdAt: T0 }).tags.length, 8);
  assert.throws(() => createInboxList(sk, r(9)), { message: 'at most 8 relays' });
});

test('readInboxList: only valid lists of that key and kind; newest wins; equal time by higher id', () => {
  const other = generateSecretKey();
  const old = createInboxList(sk, ['wss://old.example'], { createdAt: T0 });
  const neu = createInboxList(sk, ['wss://new.example'], { createdAt: T0 + 1 });
  const forged = { ...createInboxList(sk, ['wss://evil.example'], { createdAt: T0 + 9 }), sig: '0'.repeat(128) };
  const notMine = createInboxList(other, ['wss://theirs.example'], { createdAt: T0 + 9 });
  const wrongKind = signEvent({ kind: 3, created_at: T0 + 9, tags: [['relay', 'wss://k3.example']], content: '' }, sk);
  for (const order of [[old, neu, forged, notMine, wrongKind, null], [null, wrongKind, notMine, forged, neu, old]])
    assert.deepEqual(readInboxList(order, pk), { relays: ['wss://new.example'], listId: neu.id, at: T0 + 1 });
  assert.equal(readInboxList([notMine, forged], pk), null);
  let a, b;
  for (let i = 0; i < 200; i++) {
    a = createInboxList(sk, [`wss://a${i}.example`], { createdAt: T0 + 5 });
    b = createInboxList(sk, [`wss://b${i}.example`], { createdAt: T0 + 5 });
    if (a.id !== b.id) break;
  }
  const hi = a.id > b.id ? a : b;
  assert.equal(readInboxList([a, b], pk).listId, hi.id);
  assert.equal(readInboxList([b, a], pk).listId, hi.id);
});

test('readInboxList: skips non-relay tags and bad entries, deduplicates and caps at 8', () => {
  const tags = [['p', 'x'], ['relay', 'ws://insecure.example'], ['relay', 'nope'], ['relay', 'wss://a.example/'], ['relay', 'wss://a.example'],
    ...Array.from({ length: 10 }, (_, i) => ['relay', `wss://r${i}.example`])];
  const e = signEvent({ kind: INBOX_LIST_KIND, created_at: T0, tags, content: '' }, sk);
  const got = readInboxList([e], pk).relays;
  assert.deepEqual(got, ['wss://a.example', ...Array.from({ length: 7 }, (_, i) => `wss://r${i}.example`)]);
});

test('deliveryPlan: default 3 copies, never fewer than 2, failing relays last, nothing without relays', () => {
  const inbox = { relays: ['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example'] };
  assert.deepEqual(deliveryPlan(inbox), ['wss://a.example', 'wss://b.example', 'wss://c.example']);
  assert.deepEqual(deliveryPlan(inbox, { copies: 1 }), ['wss://a.example', 'wss://b.example']);
  assert.deepEqual(deliveryPlan(inbox, { copies: 9 }), inbox.relays);
  assert.deepEqual(deliveryPlan(inbox, { failing: ['wss://a.example/'] }), ['wss://b.example', 'wss://c.example', 'wss://d.example']);
  assert.deepEqual(deliveryPlan(inbox, { copies: 4, failing: ['wss://a.example', 'wss://b.example'] }),
    ['wss://c.example', 'wss://d.example', 'wss://a.example', 'wss://b.example']);
  for (const none of [null, undefined, {}, { relays: [] }]) assert.deepEqual(deliveryPlan(none), []);
});

test('recordAnswer: answers scored exactly at the act level do not count toward the floor', () => {
  assert.equal(feed(gate({ window: 2 }), [ans(0.9, false, 1), ans(0.9, false, 2)]).floor, 0.2);
});

test('readInboxList: a URL in a tag other than relay is never read as a relay', () => {
  const e = signEvent({ kind: INBOX_LIST_KIND, created_at: T0, content: '',
    tags: [['p', 'wss://not-a-relay.example'], ['r', 'wss://also-not.example'], ['relay', 'wss://yes.example']] }, sk);
  assert.deepEqual(readInboxList([e], pk).relays, ['wss://yes.example']);
});
