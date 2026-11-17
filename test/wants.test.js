// Tests for src/wants.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantScore, createWantGate, routeWant, recordAnswer, recordMiss } from '../src/wants.js';

const gate = (o) => { const r = createWantGate(o); assert.equal(r.ok, true, JSON.stringify(r)); return r.state; };
const answer = (s, a) => { const r = recordAnswer(s, a); assert.equal(r.ok, true, JSON.stringify(r)); return r.state; };
const route = (s, x) => routeWant(s, x).route;

test('score is 1 - p(none)', () => {
  assert.deepEqual(wantScore({ housing: 0.7, none: 0.3 }), { ok: true, score: 0.7 });
  assert.equal(wantScore({ housing: 1 }).ok, false);
  assert.equal(wantScore({ none: 1.2 }).ok, false);
});

test('defaults: act at 0.9, confirm from 0.2, drop below', () => {
  const s = gate();
  assert.equal(route(s, 0.95), 'act');
  assert.equal(route(s, 0.9), 'act');
  assert.equal(route(s, 0.89), 'confirm');
  assert.equal(route(s, 0.2), 'confirm');
  assert.equal(route(s, 0.19), 'drop');
  assert.equal(routeWant(s, NaN).ok, false);
});

test('the 30 experiment records route as in RESULTS.md', () => {
  // [score, real want] for d3-mini on want_detection.
  const recs = [[0.98,1],[1,1],[0.84,0],[0.99,1],[0.01,0],[0.93,1],[1,1],[0.18,0],[0.96,1],[0.96,1],[0.7,1],[0.05,0],[0.99,1],[0.22,1],[0,0],
    [0.93,1],[0.67,0],[0.96,1],[0.93,1],[0.22,1],[0.23,0],[0.04,0],[0.98,1],[0.6,1],[0.57,1],[0.96,1],[0.79,0],[0.93,1],[0,0],[0.91,1]];
  const s = gate(), n = { act: [0, 0], confirm: [0, 0], drop: [0, 0] };
  for (const [x, real] of recs) { n[route(s, x)][0]++; n[route(s, x)][1] += real; }
  assert.deepEqual(n, { act: [15, 15], confirm: [9, 5], drop: [6, 0] });
});

test('bad options are refused', () => {
  assert.equal(createWantGate({ floor: 0.95 }).ok, false);
  assert.equal(createWantGate({ act: 0.5, maxFloor: 0.6 }).ok, false);
  assert.equal(createWantGate({ colour: 1 }).ok, false);
  assert.equal(createWantGate({ window: 0 }).ok, false);
});

test('mostly "no" at the bottom of the band raises the floor one step', () => {
  let s = gate();
  for (let i = 0; i < 7; i++) s = answer(s, { score: 0.25 + i * 0.01, yes: i === 0, at: i + 1 });
  assert.equal(s.floor, 0.2, 'not before a full window');
  s = answer(s, { score: 0.4, yes: false, at: 8 });
  assert.equal(s.floor, 0.25);
  assert.deepEqual(s.changes, [{ at: 8, from: 0.2, to: 0.25, reason: 'mostly no at the bottom of the confirm band' }]);
  assert.equal(route(s, 0.22), 'drop');
});

test('only answers since the last change count, so one bad patch moves the floor once', () => {
  let s = gate();
  for (let i = 0; i < 8; i++) s = answer(s, { score: 0.3, yes: false, at: i + 1 });
  assert.equal(s.floor, 0.25);
  s = answer(s, { score: 0.3, yes: false, at: 9 });
  assert.equal(s.floor, 0.25);
});

test('mostly "yes" keeps the floor', () => {
  let s = gate();
  for (let i = 0; i < 20; i++) s = answer(s, { score: 0.3, yes: i % 3 !== 0, at: i + 1 });
  assert.equal(s.floor, 0.2);
});

test('the floor never passes maxFloor', () => {
  let s = gate(), t = 1;
  for (let r = 0; r < 20; r++) for (let i = 0; i < 8; i++) s = answer(s, { score: 0.65, yes: false, at: t++ });
  assert.equal(s.floor, 0.6);
});

test('a miss lowers the floor one step, never below the missed score or minFloor', () => {
  let s = gate();
  s = recordMiss(s, { score: 0.1, at: 5 }).state;
  assert.equal(s.floor, 0.15);
  s = recordMiss(s, { score: 0.13, at: 6 }).state;
  assert.equal(s.floor, 0.13);
  for (let i = 0; i < 5; i++) s = recordMiss(s, { score: 0, at: 7 + i }).state;
  assert.equal(s.floor, 0.05);
  assert.equal(recordMiss(gate(), { score: 0.5, at: 1 }).state.floor, 0.2, 'a miss above the floor changes nothing');
});

test('answers outside the band and history beyond keep are ignored or trimmed', () => {
  let s = gate({ keep: 5 });
  for (let i = 0; i < 10; i++) s = answer(s, { score: 0.95, yes: false, at: i + 1 });
  assert.equal(s.floor, 0.2);
  assert.equal(s.answers.length, 5);
});

test('arguments are never changed', () => {
  const s = gate(), before = JSON.stringify(s);
  answer(s, { score: 0.3, yes: false, at: 1 });
  recordMiss(s, { score: 0.1, at: 1 });
  assert.equal(JSON.stringify(s), before);
});

test('bad answers are refused', () => {
  const s = gate();
  assert.equal(recordAnswer(s, { score: 0.3, yes: 'no', at: 1 }).ok, false);
  assert.equal(recordAnswer(s, { score: 2, yes: true, at: 1 }).ok, false);
  assert.equal(recordAnswer(s, { score: 0.3, yes: true, at: -1 }).ok, false);
  assert.equal(recordMiss(s, null).ok, false);
});
