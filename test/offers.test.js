// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey } from '../src/event.js';
import { createOffer, readOffer, judgeOffer } from '../src/offers.js';

const sk = generateSecretKey();
const job = (o = {}) => createOffer(sk, {
  type: 'job', title: 'Senior QA engineer', role: 'QA engineer', region: 'Lyon',
  payMin: 50000, payMax: 60000, currency: 'EUR', period: 'year',
  source: { kind: 'public_ad', url: 'https://example.org/ad/1', retrievedAt: '2026-11-16' }, ...o,
}, { createdAt: 1_800_000_000 });

test('derived offers keep their source and are marked derived', () => {
  const o = readOffer(job());
  assert.equal(o.derived, true);
  assert.equal(o.source.url, 'https://example.org/ad/1');
  assert.throws(() => createOffer(sk, { type: 'job', title: 'x', source: { kind: 'public_ad' } }), /source url/);
});

test('judging against a private floor', () => {
  const lim = { floor: 52000, currency: 'EUR', roles: ['QA engineer'] };
  assert.equal(judgeOffer(lim, job(), { now: 1 }).fit, 'straddles_floor');
  assert.equal(judgeOffer({ ...lim, floor: 48000 }, job(), { now: 1 }).fit, 'above_floor');
  assert.equal(judgeOffer({ ...lim, floor: 61000 }, job(), { now: 1 }).fit, 'below_floor');
  assert.equal(judgeOffer({ ...lim, roles: ['Product manager'] }, job(), { now: 1 }).fit, 'not_relevant');
  assert.equal(judgeOffer(lim, job({ payMin: undefined, payMax: undefined }), { now: 1 }).fit, 'no_pay_stated');
  assert.equal(judgeOffer({ floor: 4000, period: 'month' }, job(), { now: 1 }).fit, 'above_floor');
  assert.equal(judgeOffer(lim, job({ expiresAt: 10 }), { now: 20 }).fit, 'not_relevant');
});

test('tampered offers are invalid', () => {
  const e = job();
  e.content = e.content.replace('50000', '90000');
  assert.equal(judgeOffer({ floor: 1 }, e).fit, 'invalid');
});
