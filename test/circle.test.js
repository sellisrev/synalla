// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from '../src/event.js';
import { redeemInvite, acceptRedemption, VouchGraph } from '../src/vouch.js';
import { createCircle, parseInviteLink, inviteLink, progressCardSvg } from '../src/circle.js';
import { progressCard } from '../src/pool.js';

const T0 = 1_800_000_000;

test('a circle of links can be redeemed from the link alone', () => {
  const convenerSk = generateSecretKey();
  const circle = createCircle(convenerSk, { scope: 'pay-product-fr-2027', size: 3, createdAt: T0 });
  assert.equal(circle.length, 3);
  assert.equal(new Set(circle.map(c => c.code)).size, 3);
  const graph = new VouchGraph();
  for (const { link, invite, code } of circle) {
    assert.ok(link.startsWith('synalla://join#'));
    const parsed = parseInviteLink(link);
    assert.equal(parsed.code, code);
    assert.equal(parsed.scope, 'pay-product-fr-2027');
    assert.equal(parsed.expiresAt, T0 + 14 * 86400);
    const sk = generateSecretKey();
    const red = redeemInvite({ invite: parsed.invite, code: parsed.code, inviteeSk: sk, createdAt: T0 + 5 });
    graph.add(acceptRedemption({ invite, code, redemption: red, issuerSk: convenerSk, now: T0 + 6 }));
    assert.equal(graph.hops([getPublicKey(convenerSk)], getPublicKey(sk)), 1);
  }
});

test('the code sits in the fragment, so a hosting page never receives it', () => {
  const [c] = createCircle(generateSecretKey(), { scope: 's', size: 1, createdAt: T0 });
  const link = inviteLink(c.invite, c.code, { base: 'https://example.org/join' });
  const url = new URL(link);
  assert.equal(url.search, '');
  assert.ok(!url.pathname.includes(c.code));
  assert.ok(url.hash.length > 1);
});

test('malformed links are refused', () => {
  assert.throws(() => parseInviteLink('synalla://join'), /no invite/);
  assert.throws(() => parseInviteLink('synalla://join#!!!'), /unreadable|version|malformed/);
  const bad = Buffer.from(JSON.stringify({ v: 1, i: 'x', p: 'y', c: 'z' })).toString('base64url');
  assert.throws(() => parseInviteLink(`synalla://join#${bad}`), /malformed/);
});

test('progress card SVG shows the group only and escapes text', () => {
  const card = { label: 'QA <script> & co', count: 9, k: 15, needed: 6, unlocked: false };
  const svg = progressCardSvg(card);
  assert.ok(svg.includes('QA &lt;script&gt; &amp; co'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('9 of 15'));
  assert.ok(svg.includes('6 more to unlock'));
  const q = { id: 'q', attributes: { role: ['QA'] }, broadenOrder: [], k: 5 };
  const real = progressCardSvg(progressCard(q, [], { role: 'QA' }));
  assert.ok(!/[0-9a-f]{64}/.test(real));
});
