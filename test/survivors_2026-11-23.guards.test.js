// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Guard tests for the real gaps found by the full Stryker run of 23 Nov 2026 (see test/MUTATION.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, collectOffers, rankOffers } from '../src/askaround.ts';
import { parseInviteLink } from '../src/circle.ts';
import { verify } from './fixtures/askaround/scenarios.mjs';

const S = c => c.repeat(64);
const need = (o = {}) => ({ category: 'books/children', topics: ['reading-method', 'age-5'], at: 1000, ...o });

test('buildRequest: a private term is not matched across two fields', () => {
  // note ends "ab", category starts "books": joined without a separator they would read "abbooks".
  const r = buildRequest(need({ note: 'Gift ab', private: ['abbooks'] }));
  assert.equal(r.ok, true);
});

const REQ = { id: 'req1', pubkey: S('f'), kind: 8443 + 3, created_at: 5000, tags: [['category', 'books']], content: '{}', sig: 'x' };
const body = { type: 'sale', title: 'Phonics set', category: 'books/children', topics: ['phonics'], price: 20, currency: 'EUR' };
const ev = (id, pubkey) => ({ id, pubkey, kind: 8443, created_at: 6000, tags: [['e', 'req1']], content: JSON.stringify(body), sig: 'ok:' + id });

test('collectOffers: offers come out sorted by id whatever the input order', () => {
  const r = collectOffers(REQ, [ev('c3', S('c')), ev('a1', S('a')), ev('b2', S('b'))], { now: 5000 + 86400, verify });
  assert.equal(r.ok, true);
  assert.deepEqual(r.offers.map(o => o.id), ['a1', 'b2', 'c3']);
});

const offer = (id, o = {}) => ({ id, seller: S('a'), created_at: 6000, type: 'sale', title: 't', category: 'books', topics: ['x'], price: 10, currency: 'EUR', ...o });

test('rankOffers: excluded offers are listed in id order whatever the input order', () => {
  const r = rankOffers([offer('c3', { currency: 'USD' }), offer('a1', { currency: 'USD' }), offer('b2', { currency: 'USD' })], { currency: 'EUR' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.excluded.map(e => e.id), ['a1', 'b2', 'c3']);
});

const link = p => 'synalla://join#' + Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
const good = { v: 1, i: S('1'), p: S('2'), c: '0123456789abcdef0123456789abcdef', s: 'pay', x: 2_000_000_000 };

test('parseInviteLink: a malformed invite code is refused', () => {
  assert.equal(parseInviteLink(link(good)).code, good.c);
  for (const c of ['xyz', '0123456789ABCDEF0123456789ABCDEF', 12345, undefined]) {
    assert.throws(() => parseInviteLink(link({ ...good, c })), /code is malformed/);
  }
});
