// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// Circle entries, structured asks and the answer check (pilot plan W4), each rule at its boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from '../src/event.js';
import { KIND } from '../src/kinds.js';
import {
  CIRCLE_V, ENTRY_TYPES, LIMITS, entryProblems, askProblems, entryText, askRumor, answerRumor, answerAllowed,
  readEntry, readAsk, candidates,
} from '../src/entries.js';

const T = 1_800_000_000;
const pk = getPublicKey(generateSecretKey());
const entry = (o = {}) => ({ v: CIRCLE_V, id: 'phonics-cards', type: 'lend', topic: 'children-books', tags: ['phonics', 'age-5'], text: 'I can lend our phonics cards.', expires: T + 100, ...o });
const ask = (o = {}) => ({ v: CIRCLE_V, type: 'lend', topic: 'children-books', tags: ['phonics'], at: T, ...o });
const ASK_ID = 'a'.repeat(64);

test('constants', () => {
  assert.equal(CIRCLE_V, 'circle/1');
  assert.deepEqual([...ENTRY_TYPES], ['help', 'intro', 'lend', 'recommend', 'offer']);
  assert.deepEqual({ ...LIMITS }, { topic: 64, tag: 32, tags: 8, text: 500, id: 64 });
});

test('a valid entry has no problems; each field is checked at its boundary', () => {
  assert.deepEqual(entryProblems(entry(), T), []);
  const p = (o, now = T) => entryProblems(entry(o), now);
  assert.deepEqual(p({ v: 'circle/2' }), ['v must be circle/1']);
  assert.deepEqual(p({ id: 'Bad Id' }), ['id must be a short slug']);
  assert.deepEqual(p({ id: 'x'.repeat(64) }), []);
  assert.deepEqual(p({ id: 'x'.repeat(65) }), ['id must be a short slug']);
  assert.deepEqual(p({ type: 'sell' }), ['type must be one of help, intro, lend, recommend, offer']);
  assert.deepEqual(p({ topic: 't'.repeat(64) }), []);
  assert.deepEqual(p({ topic: 't'.repeat(65) }), ['topic must be a vocabulary slug']);
  assert.deepEqual(p({ topic: 'two--dashes' }), ['topic must be a vocabulary slug']);
  assert.deepEqual(p({ tags: Array.from({ length: 8 }, (_, i) => `t${i}`) }), []);
  assert.deepEqual(p({ tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }), ['at most 8 tags']);
  assert.deepEqual(p({ tags: ['x'.repeat(33)] }), ['tags must be lowercase words joined by dashes, at most 32 characters']);
  assert.deepEqual(p({ tags: ['x'.repeat(32)] }), []);
  assert.deepEqual(p({ tags: ['a', 'a'] }), ['tags must not repeat']);
  assert.deepEqual(p({ tags: 'phonics' }), ['tags must be a list']);
  assert.deepEqual(p({ text: 'x'.repeat(500) }), []);
  assert.deepEqual(p({ text: 'x'.repeat(501) }), ['text must be 1 to 500 characters']);
  assert.deepEqual(p({ text: '   ' }), ['text must be 1 to 500 characters']);
  assert.deepEqual(p({ text: 5 }), ['text must be 1 to 500 characters']);
  assert.deepEqual(p({}, T + 99), []);
  assert.deepEqual(p({}, T + 100), ['entry has expired']);
  assert.deepEqual(p({ expires: 1.5 }), ['expires must be a time in seconds']);
  assert.deepEqual(p({ expires: 0 }), ['expires must be a time in seconds']);
  assert.deepEqual(p({ extra: 1 }), ['entry has exactly v, id, type, topic, tags, text, expires']);
  assert.deepEqual(entryProblems(null, T), ['entry must be an object']);
  assert.deepEqual(entryProblems([], T), ['entry must be an object']);
});

test('an ask has no free text; each field is checked', () => {
  assert.deepEqual(askProblems(ask()), []);
  assert.deepEqual(askProblems(ask({ note: 'my landlord is…' })), ['ask has exactly v, type, topic, tags, at (no free text)']);
  assert.deepEqual(askProblems(ask({ v: 'x' })), ['v must be circle/1']);
  assert.deepEqual(askProblems(ask({ type: 'x' })), ['type must be one of help, intro, lend, recommend, offer']);
  assert.deepEqual(askProblems(ask({ topic: 'Bad Topic' })), ['topic must be a vocabulary slug']);
  assert.deepEqual(askProblems(ask({ tags: ['A'] })), ['tags must be lowercase words joined by dashes, at most 32 characters']);
  assert.deepEqual(askProblems(ask({ at: 0 })), ['at must be a time in seconds']);
  assert.deepEqual(askProblems('x'), ['ask must be an object']);
  assert.deepEqual(askProblems([]), ['ask must be an object']);
});

test('entryText is canonical: the same entry gives the same bytes whatever the key order', () => {
  const e = entry();
  const shuffled = { expires: e.expires, text: e.text, tags: e.tags, topic: e.topic, type: e.type, id: e.id, v: e.v };
  assert.equal(entryText(shuffled), entryText(e));
  assert.equal(entryText(e), '{"v":"circle/1","id":"phonics-cards","type":"lend","topic":"children-books","tags":["phonics","age-5"],"text":"I can lend our phonics cards.","expires":1800000100}');
});

test('askRumor: kind 8446, unsigned, no tags, the ask as content; refused when invalid', () => {
  const r = askRumor(ask(), pk);
  assert.equal(r.kind, KIND.REQUEST); assert.equal(r.pubkey, pk); assert.equal(r.created_at, T);
  assert.deepEqual(r.tags, []); assert.equal(r.sig, undefined); assert.match(r.id, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(r.content), ask());
  assert.throws(() => askRumor(ask({ note: 'x' }), pk), /ask refused: ask has exactly/);
});

test('answerRumor and answerAllowed: only a stored entry, unchanged, with exactly the answer tag', () => {
  const stored = [entry(), entry({ id: 'other', text: 'Something else.' })];
  const r = answerRumor(ASK_ID, stored[0], pk, T);
  assert.equal(r.kind, KIND.OFFER); assert.deepEqual(r.tags, [['e', ASK_ID]]); assert.equal(r.content, entryText(stored[0]));
  assert.equal(answerAllowed(r, ASK_ID, stored), true);
  assert.equal(answerAllowed({ ...r, content: r.content.replace('lend', 'help') }, ASK_ID, stored), false, 'edited content');
  assert.equal(answerAllowed({ ...r, content: r.content + ' ' }, ASK_ID, stored), false, 'one byte more');
  assert.equal(answerAllowed(r, 'b'.repeat(64), stored), false, 'another ask');
  assert.equal(answerAllowed({ ...r, tags: [['e', ASK_ID], ['p', pk]] }, ASK_ID, stored), false, 'extra tag');
  assert.equal(answerAllowed({ ...r, tags: [['e', ASK_ID, 'relay']] }, ASK_ID, stored), false, 'tag with a third field');
  assert.equal(answerAllowed({ ...r, tags: [['p', ASK_ID]] }, ASK_ID, stored), false, 'wrong tag name');
  assert.equal(answerAllowed({ ...r, tags: [] }, ASK_ID, stored), false, 'no tag');
  assert.equal(answerAllowed({ ...r, tags: 'e' }, ASK_ID, stored), false, 'tags not a list');
  assert.equal(answerAllowed({ ...r, tags: ['e'] }, ASK_ID, stored), false, 'tag not a list');
  assert.equal(answerAllowed({ ...r, kind: KIND.REQUEST }, ASK_ID, stored), false, 'wrong kind');
  assert.equal(answerAllowed(r, ASK_ID, []), false, 'nothing stored');
  assert.throws(() => answerRumor('nothex', stored[0], pk, T), /ask id must be 64 hex/);
  assert.throws(() => answerRumor(ASK_ID, stored[0], pk, T + 100), /entry refused: entry has expired/);
});

test('readEntry and readAsk accept only valid content', () => {
  assert.deepEqual(readEntry(entryText(entry()), T), entry());
  assert.equal(readEntry(entryText(entry()), T + 100), null);
  assert.equal(readEntry('{', T), null);
  assert.equal(readEntry(5, T), null);
  assert.deepEqual(readAsk(JSON.stringify(ask())), ask());
  assert.equal(readAsk(JSON.stringify(ask({ note: 'x' }))), null);
  assert.equal(readAsk('nope'), null);
  assert.equal(readAsk(null), null);
});

test('candidates: same type and topic, unexpired, most shared tags first, ties by id', () => {
  const es = [
    entry({ id: 'b', tags: ['phonics'] }), entry({ id: 'a', tags: ['phonics'] }), entry({ id: 'c', tags: ['phonics', 'age-5'] }),
    entry({ id: 'd', tags: [] }), entry({ id: 'e', type: 'help' }), entry({ id: 'f', topic: 'other' }), entry({ id: 'g', expires: T }),
  ];
  assert.deepEqual(candidates(ask({ tags: ['phonics', 'age-5'] }), es, T).map(e => e.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(candidates(ask({ tags: [] }), es, T).map(e => e.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(candidates(ask({ tags: [] }), es, T - 1).map(e => e.id), ['a', 'b', 'c', 'd', 'g']);
});

test('guards found by mutation testing (24 Nov 2026)', () => {
  assert.deepEqual(entryProblems(entry({ id: ['abc'] }), T), ['id must be a short slug'], 'a list that prints as a slug is not a slug');
  assert.deepEqual(entryProblems(entry({ tags: ['ok', 'BAD'] }), T), ['tags must be lowercase words joined by dashes, at most 32 characters']);
  assert.deepEqual(entryProblems('entry', T), ['entry must be an object']);
  assert.throws(() => askRumor(ask({ note: 'x', at: 0 }), pk), { message: 'ask refused: ask has exactly v, type, topic, tags, at (no free text); at must be a time in seconds' });
  assert.throws(() => answerRumor(ASK_ID, entry({ text: '', expires: T }), pk, T), { message: 'entry refused: text must be 1 to 500 characters; entry has expired' });
  assert.throws(() => answerRumor('z' + 'a'.repeat(64), entry(), pk, T), /ask id must be 64 hex/);
  assert.throws(() => answerRumor('a'.repeat(64) + 'z', entry(), pk, T), /ask id must be 64 hex/);
});
