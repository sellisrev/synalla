// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// event.js: every shape rule is tested with an event whose id and signature are valid, so only the shape check can
// reject it. knock.js: the category table is pinned, and the privacy lint is tested at its exact boundaries.
// Found by mutation testing (21 Nov 2026): the whole shape check could be deleted without a test failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey, signEvent, verifyEvent, eventId, nowSeconds } from '../src/event.js';
import { createKnock, lintKnockBody, isKnock, DEFAULT_CATEGORIES, NOTE_MAX, KNOCK_KIND } from '../src/knock.js';

const sk = generateSecretKey(), pk = getPublicKey(sk);
const T0 = 1_800_000_000;

/** Sign anything, bypassing signEvent's checks: valid id and signature over whatever fields are given. */
function signRaw(fields) {
  const e = { pubkey: pk, created_at: T0, kind: 1, tags: [], content: '', ...fields };
  e.id = eventId(e);
  e.sig = bytesToHex(schnorr.sign(hexToBytes(e.id), hexToBytes(sk)));
  return e;
}

// ---- event.js ------------------------------------------------------------------------------------------------------

test('verifyEvent: a raw-signed well-formed event verifies (the base for the cases below)', () => {
  assert.equal(verifyEvent(signRaw({})), true);
});

test('verifyEvent: correctly signed but malformed events are rejected by the shape check', () => {
  const cases = {
    'negative created_at': { created_at: -1 },
    'fractional created_at': { created_at: 1.5 },
    'negative kind': { kind: -1 },
    'kind above 65535': { kind: 65536 },
    'fractional kind': { kind: 1.5 },
    'tags not an array': { tags: 'p' },
    'tag not an array': { tags: ['p'] },
    'tag with a number': { tags: [['p', 5]] },
    'content not a string': { content: 5 },
  };
  for (const [name, f] of Object.entries(cases)) assert.equal(verifyEvent(signRaw(f)), false, name);
});

test('verifyEvent: uppercase hex in pubkey or sig is rejected even though the signature math accepts it', () => {
  const e = signRaw({});
  assert.equal(verifyEvent({ ...e, sig: e.sig.toUpperCase() }), false, 'uppercase sig');
  const up = { pubkey: pk.toUpperCase(), created_at: T0, kind: 1, tags: [], content: '' };
  up.id = eventId(up);
  up.sig = bytesToHex(schnorr.sign(hexToBytes(up.id), hexToBytes(sk)));
  assert.equal(schnorr.verify(hexToBytes(up.sig), hexToBytes(up.id), hexToBytes(up.pubkey)), true, 'test setup: math accepts it');
  assert.equal(verifyEvent(up), false, 'uppercase pubkey');
});

test('verifyEvent: limits are inclusive: kind 0 and 65535, created_at 0 verify', () => {
  for (const f of [{ kind: 0 }, { kind: 65535 }, { created_at: 0 }]) assert.equal(verifyEvent(signRaw(f)), true, JSON.stringify(f));
});

test('signEvent: refuses malformed templates with the exact reason', () => {
  const bad = [
    [{ kind: 65536 }, 'kind must be an integer 0..65535'],
    [{ kind: -1 }, 'kind must be an integer 0..65535'],
    [{ kind: 1, created_at: -1 }, 'created_at must be a non-negative integer'],
    [{ kind: 1, created_at: 1.5 }, 'created_at must be a non-negative integer'],
    [{ kind: 1, tags: [['p', 5]] }, 'tags must be an array of string arrays'],
    [{ kind: 1, tags: 'p' }, 'tags must be an array of string arrays'],
    [{ kind: 1, content: 5 }, 'content must be a string'],
  ];
  for (const [t, msg] of bad) assert.throws(() => signEvent(t, sk), { name: 'TypeError', message: msg }, JSON.stringify(t));
});

test('signEvent: defaults are now, no tags and empty content', () => {
  const before = Math.floor(Date.now() / 1000);
  const e = signEvent({ kind: 1 }, sk);
  assert.ok(e.created_at >= before && e.created_at <= before + 5);
  assert.deepEqual([e.tags, e.content], [[], '']);
});

test('nowSeconds: is the current time in seconds', () => {
  assert.ok(Math.abs(nowSeconds() - Date.now() / 1000) < 5);
});

// ---- knock.js: category table ---------------------------------------------------------------------------------------

test('DEFAULT_CATEGORIES: minimum tiers and field limits are exactly the documented ones', () => {
  // Changing who may knock about what is a policy decision: it must show up as a change to this test.
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)), {
    question: { minTier: 'C', fields: { topic: 64 } },
    hobby_partner: { minTier: 'C', fields: { activity: 64, area: 64 } },
    job_interest: { minTier: 'B', fields: { role: 64, region: 64, payBand: 32 } },
    purchase_interest: { minTier: 'B', fields: { item: 64, area: 64, priceBand: 32 } },
    service_offer: { minTier: 'B', fields: { service: 64, area: 64 } },
    meet_in_person: { minTier: 'A', fields: { purpose: 64, area: 64 } },
    childcare_or_tutoring: { minTier: 'A', fields: { service: 64, area: 64 } },
  });
  assert.equal(NOTE_MAX, 280);
});

// ---- knock.js: body structure -----------------------------------------------------------------------------------------

const lint = (body) => lintKnockBody(body);
const q = (extra = {}) => ({ category: 'question', fields: { topic: 'pay' }, ...extra });

test('lintKnockBody: a body that is not a plain object gets exactly one problem', () => {
  for (const b of [null, undefined, 'text', 5, ['question']]) assert.deepEqual(lint(b), ['body must be an object'], String(b));
});

test('lintKnockBody: structure problems, each with its own message', () => {
  assert.deepEqual(lint(q()), []);
  assert.deepEqual(lint(q({ extra: 1 })), ['unexpected field extra']);
  assert.deepEqual(lint({ category: 'question', fields: ['x'] }), ['fields must be an object', 'field 0 is not part of question']);
  assert.deepEqual(lint({ category: 'question', fields: 'x' }), ['fields must be an object', 'field 0 is not part of question']);
  assert.deepEqual(lint(q({ fields: { area: 'x' } })), ['field area is not part of question']);
  assert.deepEqual(lint(q({ fields: { topic: 5 } })), ['field topic must be text']);
  assert.deepEqual(lint(q({ note: 5 })), ['note must be text']);
  assert.deepEqual(lint({ category: 'nope' }), ['unknown category nope']);
  assert.deepEqual(lint({ category: 'question' }), [], 'fields are optional');
});

test('lintKnockBody: length limits are inclusive (64 and 280 pass, 65 and 281 fail)', () => {
  assert.deepEqual(lint(q({ fields: { topic: 'a'.repeat(64) } })), []);
  assert.deepEqual(lint(q({ fields: { topic: 'a'.repeat(65) } })), ['field topic is too long']);
  assert.deepEqual(lint(q({ note: 'a'.repeat(280) })), []);
  assert.deepEqual(lint(q({ note: 'a'.repeat(281) })), ['note longer than 280 characters']);
});

test('lintKnockBody: field values are scanned too, and non-text values do not break the scan', () => {
  assert.deepEqual(lint(q({ fields: { topic: 'mail me a@b.co' } })), ['contains an email address']);
  assert.deepEqual(lint({ category: 'job_interest', fields: { role: 5, region: 'see www.x.top' } }),
    ['field role must be text', 'contains a link']);
});

// ---- knock.js: privacy lint, exact boundaries ---------------------------------------------------------------------

const flags = (text) => lint(q({ note: text }));

test('lint: phone numbers are caught; pay bands and short numbers are not', () => {
  const phones = ['+33 6 12 34 56 78', '06 12 34 56 78', '0612345678', '(01) 234-5678', '+3361234567',
    '123 456 789', /* 9 digits in 3 groups */ '1 234 567 89' /* exactly 9 digits */];
  for (const p of phones) assert.deepEqual(flags(`call ${p}`), ['contains a phone number'], p);
  const notPhones = ['50000-60000', '12 34 56 78', '123456789', '2026', '40 to 50k'];
  for (const p of notPhones) assert.deepEqual(flags(`about ${p}`), [], p);
});

test('lint: links over http and https, www, and bare domains are caught; ordinary words are not', () => {
  for (const t of ['see http://x.example', 'see https://x.example', 'see www.example', 'see example.com', 'see Example.FR'])
    assert.deepEqual(flags(t), ['contains a link'], t);
  assert.deepEqual(flags('see the commons'), []);
});

test('lint: email addresses are caught', () => {
  assert.deepEqual(flags('write to a@b.co'), ['contains an email address']);
  assert.deepEqual(flags('meet at 5 @ the station'), []);
});

test('lint: requests to move to another app, and @handles of 3+ characters, are caught', () => {
  for (const t of ['ping me on telegram', 'via  WhatsApp', 'sur signal', '@abc', 'or @abc_1'])
    assert.deepEqual(flags(t), ['asks to move to another app or handle'], t);
  for (const t of ['@ab', 'mail@abc', 'telegram is nice', 'on the line'])
    assert.ok(!flags(t).includes('asks to move to another app or handle'), t);
});

test('lint: each kind of problem is reported once even when it appears several times', () => {
  assert.deepEqual(flags('www.a www.b www.c'), ['contains a link']);
});

// ---- knock.js: isKnock --------------------------------------------------------------------------------------------

test('isKnock: true only for a valid signed event of the knock kind', () => {
  const k = createKnock(sk, { category: 'question', fields: { topic: 'x' } }, { createdAt: T0 });
  assert.equal(isKnock(k), true);
  assert.equal(isKnock(signRaw({ kind: 1 })), false);
  assert.equal(isKnock(signRaw({ kind: KNOCK_KIND })), true);
  assert.equal(isKnock({ ...k, content: k.content + ' ' }), false);
});

// Found by the TS mutation run (22 Nov 2026): the default note and the problem separator were not pinned.
test('createKnock: a missing note is sent as an empty note; all problems are listed, joined by "; "', () => {
  const k = createKnock(sk, { category: 'question', fields: { topic: 'x' } }, { createdAt: T0 });
  assert.equal(JSON.parse(k.content).note, '');
  assert.throws(() => createKnock(sk, { category: 'question', fields: { topic: 'x' }, note: 'mail a@b.example or call +33 6 12 34 56 78' }, { createdAt: T0 }),
    { message: 'knock refused before sending: contains an email address; contains a phone number' });
});
