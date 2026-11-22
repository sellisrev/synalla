// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Event kinds are part of the wire protocol: once events are on relays, a changed number silently splits the network.
// These numbers are final (22 Nov 2026). Changing one must be a deliberate protocol change, made here too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIND } from '../src/kinds.js';
import { buildRequest, collectOffers } from '../src/askaround.js';

test('every Synalla kind has its final number', () => {
  assert.deepEqual({ ...KIND }, {
    INVITE: 8436, REDEEM: 8437, VOUCH: 8438, UNVOUCH: 8439, QUESTION: 8440, RECORD: 8441,
    RELEASE: 8442, OFFER: 8443, ACK: 8444, KNOCK: 8445, REQUEST: 8446,
  });
});

test('kinds are distinct, regular (stored by relays) and inside the reserved block 8436-8447', () => {
  const v = Object.values(KIND);
  assert.equal(new Set(v).size, v.length);
  for (const k of v) assert.ok(Number.isInteger(k) && k >= 8436 && k <= 8447, String(k));
});

test('askaround uses the same numbers as kinds.ts (it may not import them)', () => {
  const r = buildRequest({ category: 'books', topics: ['phonics'], at: 1000 });
  assert.equal(r.template.kind, KIND.REQUEST);
  const req = { id: 'r1', pubkey: 'f'.repeat(64), kind: KIND.REQUEST, created_at: 5000, tags: [['category', 'books']], content: '{}', sig: 'x' };
  const offer = { id: 'o1', pubkey: 'a'.repeat(64), kind: KIND.OFFER, created_at: 6000, tags: [['e', 'r1']], sig: 'ok',
    content: JSON.stringify({ type: 'sale', title: 'Phonics set', category: 'books', topics: ['phonics'], price: 20, currency: 'EUR' }) };
  const got = collectOffers(req, [offer], { now: 5000 + 86400, verify: () => true });
  assert.deepEqual(got.rejected, []);
  assert.equal(got.offers.length, 1);
});

test('the event docs list the same numbers', () => {
  const doc = fs.readFileSync(path.join(import.meta.dirname, '..', 'schemas', 'events.md'), 'utf8');
  for (const [name, k] of Object.entries(KIND)) assert.match(doc, new RegExp(`^\| ${k} \| ${name} \|`, 'm'), name);
});
