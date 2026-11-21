// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// offers.js: each rule that matches an offer against the owner's private limits, at its exact boundary, with values
// worked out by hand. circle.js: each invite-link refusal with its own message, size limits, and the progress card's
// drawn values. Found by mutation testing (21 Nov 2026): offers.js scored 56% and circle.js 58%.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';
import { KIND } from '../src/kinds.js';
import { createOffer, readOffer, judgeOffer } from '../src/offers.js';
import { createCircle, parseInviteLink, inviteLink, progressCardSvg, DEFAULT_LINK_BASE } from '../src/circle.js';

const sk = generateSecretKey(), pk = getPublicKey(sk);
const T0 = 1_800_000_000;
const job = (o = {}, opts = { createdAt: T0 }) => createOffer(sk, { type: 'job', title: 'QA lead', ...o }, opts);

// ---- createOffer / readOffer ----------------------------------------------------------------------------------------

test('createOffer: refuses each invalid input with its own message; equal min and max pay is fine', () => {
  assert.throws(() => job({ type: 'gig' }), { message: 'type must be one of job, sale, tender, service' });
  assert.throws(() => job({ title: '' }), { message: 'title required' });
  assert.throws(() => job({ payMin: 2, payMax: 1 }), { message: 'payMin > payMax' });
  assert.doesNotThrow(() => job({ payMin: 2, payMax: 2 }));
  assert.doesNotThrow(() => job({ payMin: 2 }), 'only a minimum');
  assert.doesNotThrow(() => job({ payMax: 1 }), 'only a maximum');
  assert.throws(() => job({ source: { kind: 'public_ad' } }), { message: 'a derived offer must keep its source url' });
  for (const type of ['job', 'sale', 'tender', 'service']) assert.doesNotThrow(() => job({ type }), type);
});

test('createOffer: tags carry type, source and only the optional fields that are given', () => {
  assert.deepEqual(job().tags, [['type', 'job'], ['source', 'direct']]);
  assert.deepEqual(job({ role: 'QA', region: 'Lyon', expiresAt: T0 + 9 }).tags,
    [['type', 'job'], ['source', 'direct'], ['t', 'QA'], ['g', 'Lyon'], ['expiration', String(T0 + 9)]]);
  const ad = job({ source: { kind: 'public_ad', url: 'https://jobs.example/1' } });
  assert.deepEqual(ad.tags, [['type', 'job'], ['source', 'public_ad']]);
  assert.deepEqual(JSON.parse(job().content).source, { kind: 'direct' });
});

test('readOffer: returns the body with derived flag, signer and id; refuses forged, wrong-kind and non-JSON events', () => {
  const ad = job({ source: { kind: 'public_ad', url: 'https://jobs.example/1' } });
  const r = readOffer(ad);
  assert.deepEqual([r.derived, r.signer, r.id, r.title, r.source.url], [true, pk, ad.id, 'QA lead', 'https://jobs.example/1']);
  assert.equal(readOffer(job()).derived, false);
  assert.equal(readOffer({ ...ad, content: ad.content + ' ' }), null);
  assert.equal(readOffer(signEvent({ kind: 1, created_at: T0, tags: [], content: ad.content }, sk)), null);
  assert.equal(readOffer(signEvent({ kind: KIND.OFFER, created_at: T0, tags: [], content: 'not json' }, sk)), null);
});

// ---- judgeOffer -----------------------------------------------------------------------------------------------------

const judge = (limits, o, opts = { now: T0 }) => judgeOffer(limits, job(o), opts);

test('judgeOffer: invalid events are reported as such', () => {
  assert.deepEqual(judgeOffer({}, { ...job(), sig: '0'.repeat(128) }), { fit: 'invalid', reasons: ['bad signature or format'] });
});

test('judgeOffer: expiry is inclusive; no expiration means never expired; default time is now in seconds', () => {
  assert.equal(judge({ floor: 1 }, { payMin: 5, expiresAt: T0 }).fit, 'above_floor');
  assert.deepEqual(judge({ floor: 1 }, { payMin: 5, expiresAt: T0 - 1 }), { fit: 'not_relevant', reasons: ['expired'] });
  assert.equal(judge({ floor: 1 }, { payMin: 5 }, { now: T0 * 100 }).fit, 'above_floor');
  const inAnHour = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(judgeOffer({ floor: 1 }, job({ payMin: 5, expiresAt: inAnHour })).fit, 'above_floor');
});

test('judgeOffer: role and region filters apply only when set, in that order, after expiry', () => {
  assert.deepEqual(judge({ roles: ['PM'] }, { role: 'QA' }), { fit: 'not_relevant', reasons: ['other role'] });
  assert.deepEqual(judge({ regions: ['Paris'] }, { region: 'Lyon' }), { fit: 'not_relevant', reasons: ['other region'] });
  assert.deepEqual(judge({ roles: ['PM'], regions: ['Paris'] }, { role: 'QA', region: 'Lyon' }).reasons, ['other role']);
  assert.deepEqual(judge({ roles: ['PM'] }, { role: 'QA', expiresAt: T0 - 1 }).reasons, ['expired']);
  assert.equal(judge({ roles: [], regions: [] }, { role: 'QA', region: 'Lyon' }).fit, 'no_pay_stated', 'empty lists filter nothing');
  assert.equal(judge({ roles: ['QA'], regions: ['Lyon'], floor: 1 }, { role: 'QA', region: 'Lyon', payMin: 2 }).fit, 'above_floor');
});

test('judgeOffer: no floor, no pay and a currency mismatch are each reported, after the public-ad note', () => {
  const ad = { source: { kind: 'public_ad', url: 'https://jobs.example/1' } };
  assert.deepEqual(judge({}, { payMin: 5, ...ad }), { fit: 'no_pay_stated', reasons: ['taken from a public ad', 'no floor set'] });
  assert.deepEqual(judge({ floor: 5 }, {}), { fit: 'no_pay_stated', reasons: ['offer states no pay'] });
  assert.deepEqual(judge({ floor: 5, currency: 'EUR' }, { payMin: 9, currency: 'USD' }), { fit: 'no_pay_stated', reasons: ['different currency (USD)'] });
  assert.equal(judge({ floor: 5, currency: 'EUR' }, { payMin: 9 }).fit, 'above_floor', 'offer without currency is compared');
  assert.equal(judge({ floor: 5 }, { payMin: 9, currency: 'USD' }).fit, 'above_floor', 'limits without currency compare');
  assert.deepEqual(judge({ floor: 5 }, { payMin: 9, ...ad }), { fit: 'above_floor', reasons: ['taken from a public ad'] });
});

test('judgeOffer: pay at, straddling and below the floor, with only a minimum or only a maximum', () => {
  assert.deepEqual(judge({ floor: 50000 }, { payMin: 50000, payMax: 60000 }), { fit: 'above_floor', reasons: [] });
  assert.deepEqual(judge({ floor: 50000 }, { payMin: 49999, payMax: 50000 }), { fit: 'straddles_floor', reasons: [] });
  assert.deepEqual(judge({ floor: 50000 }, { payMin: 40000, payMax: 49999 }), { fit: 'below_floor', reasons: [] });
  assert.equal(judge({ floor: 50000 }, { payMax: 50000 }).fit, 'straddles_floor', 'only a maximum');
  assert.equal(judge({ floor: 50000 }, { payMax: 49999 }).fit, 'below_floor');
  assert.equal(judge({ floor: 50000 }, { payMin: 50000 }).fit, 'above_floor', 'only a minimum');
  assert.equal(judge({ floor: 50000 }, { payMin: 49999 }).fit, 'below_floor', 'only a minimum, below: max is the min');
});

test('judgeOffer: monthly and hourly pay are converted to a year (x12, x1607 hours) on both sides', () => {
  assert.equal(judge({ floor: 60000 }, { payMin: 5000, period: 'month' }).fit, 'above_floor'); // 60000
  assert.equal(judge({ floor: 60000 }, { payMin: 4999, period: 'month' }).fit, 'below_floor'); // 59988
  assert.equal(judge({ floor: 32140 }, { payMin: 20, period: 'hour' }).fit, 'above_floor'); // 20 x 1607 = 32140
  assert.equal(judge({ floor: 32141 }, { payMin: 20, period: 'hour' }).fit, 'below_floor');
  assert.equal(judge({ floor: 5000, period: 'month' }, { payMin: 60000 }).fit, 'above_floor'); // floor 60000/yr
  assert.equal(judge({ floor: 5001, period: 'month' }, { payMin: 60000 }).fit, 'below_floor');
});

// ---- circle.js --------------------------------------------------------------------------------------------------------

const hex = (n, c = 'a') => c.repeat(n);
const link = (p) => `${DEFAULT_LINK_BASE}#${Buffer.from(JSON.stringify(p)).toString('base64url')}`;
const good = { v: 1, i: hex(64), p: hex(64, 'b'), c: hex(32, 'c'), s: 'scope', x: T0 };

test('parseInviteLink: each malformed part is refused with its own message', () => {
  assert.deepEqual(parseInviteLink(link(good)), { invite: { id: hex(64), pubkey: hex(64, 'b') }, code: hex(32, 'c'), scope: 'scope', expiresAt: T0 });
  assert.throws(() => parseInviteLink('synalla://join'), { message: 'link has no invite' });
  assert.throws(() => parseInviteLink('synalla://join#'), { message: 'link has no invite' });
  assert.throws(() => parseInviteLink(`${DEFAULT_LINK_BASE}#${Buffer.from('{oops').toString('base64url')}`), { message: 'invite is unreadable' });
  assert.throws(() => parseInviteLink(link({ ...good, v: 2 })), { message: 'unknown invite version' });
  assert.throws(() => parseInviteLink(link({ ...good, i: hex(63) })), { message: 'invite ids are malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, p: hex(64, 'B') })), { message: 'invite ids are malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, i: 'x' + hex(64) })), { message: 'invite ids are malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, p: hex(64, 'b') + 'x' })), { message: 'invite ids are malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, c: 5 })), { message: 'invite code is malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, c: hex(31, 'c') })), { message: 'invite code is malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, c: 'x' + hex(32, 'c') })), { message: 'invite code is malformed' });
  assert.throws(() => parseInviteLink(link({ ...good, c: hex(32, 'c') + 'x' })), { message: 'invite code is malformed' });
  assert.equal(parseInviteLink(link({ ...good, s: undefined })).scope, '', 'missing scope reads as empty');
});

test('createCircle: scope required; size 1 to 500 inclusive, integers only; links use the given base', () => {
  const conv = generateSecretKey();
  assert.throws(() => createCircle(conv, { size: 1 }), { message: 'scope required (usually the question id)' });
  for (const bad of [0, 501, 1.5, '3']) assert.throws(() => createCircle(conv, { scope: 's', size: bad }), { message: 'size must be 1..500' }, String(bad));
  assert.equal(createCircle(conv, { scope: 's', size: 1, createdAt: T0 }).length, 1);
  assert.equal(createCircle(conv, { scope: 's', createdAt: T0 }).length, 10, 'default size');
  const [c] = createCircle(conv, { scope: 's', size: 1, createdAt: T0, base: 'https://x.example/j' });
  assert.ok(c.link.startsWith('https://x.example/j#'));
  assert.deepEqual(Object.keys(c).sort(), ['code', 'invite', 'link']);
});

test('createCircle: the 500 limit holds at 500', () => {
  assert.equal(createCircle(generateSecretKey(), { scope: 's', size: 500, createdAt: T0 }).length, 500);
});

test('progressCardSvg: bar width is count/k of 960 px, capped at full; label size clamps between 28 and 58', () => {
  const svg = (card) => progressCardSvg({ needed: 0, unlocked: false, ...card });
  const bar = (s) => Number(s.match(/<rect x="120" y="320" width="(\d+)" height="40" rx="20" fill="#2f6f5e"/)[1]);
  const size = (s) => Number(s.match(/font-size="(\d+)" font-weight="700"/)[1]);
  assert.equal(bar(svg({ label: 'QA', count: 9, k: 15 })), 576);
  assert.equal(bar(svg({ label: 'QA', count: 20, k: 15 })), 960);
  assert.equal(bar(svg({ label: 'QA', count: 0, k: 15 })), 0);
  assert.equal(size(svg({ label: 'QA', count: 1, k: 5 })), 58, 'short label: capped at 58');
  assert.equal(size(svg({ label: 'x'.repeat(30), count: 1, k: 5 })), 53, '960 / (0.6 x 30) = 53.3');
  assert.equal(size(svg({ label: 'x'.repeat(100), count: 1, k: 5 })), 28, 'long label: floor of 28');
  assert.equal(size(svg({ label: '😀'.repeat(30), count: 1, k: 5 })), 53, 'characters, not UTF-16 units');
  assert.equal(size(svg({ label: '', count: 1, k: 5 })), 58, 'empty label does not divide by zero');
  assert.ok(svg({ label: 'QA', count: 5, k: 5, unlocked: true }).includes('>Unlocked<'));
});

test('judgeOffer: with a floor of 0, an offer stating only a maximum straddles (no minimum is not a minimum of 0)', () => {
  assert.equal(judge({ floor: 0 }, { payMax: 10 }).fit, 'straddles_floor');
  assert.equal(judge({ floor: 0 }, { payMin: 0 }).fit, 'above_floor');
});

test('progressCardSvg: the public wording is exactly the reviewed one', () => {
  const s = progressCardSvg({ label: 'QA', count: 9, k: 15, needed: 6, unlocked: false });
  assert.ok(s.includes('>Where does your pay stand?<'));
  assert.ok(s.includes('>Nobody sees your number. Results unlock at 15 people.<'));
  assert.ok(s.includes('aria-label="QA: 9 of 15. 6 more to unlock"'));
  const custom = progressCardSvg({ label: 'QA', count: 1, k: 5, needed: 4, unlocked: false }, { title: 'T', footer: 'F ' });
  assert.ok(custom.includes('>T<') && custom.includes('>F 5 people.<'));
});

test('progressCardSvg: quotes in a label cannot break out of the aria-label attribute', () => {
  const s = progressCardSvg({ label: `QA" onload="x' y`, count: 9, k: 15, needed: 6, unlocked: false });
  assert.ok(!s.includes('" onload="'), 'double quote escaped');
  assert.ok(s.includes('QA&quot; onload=&quot;x&#39; y'));
});

test('progressCardSvg: the visible count text is drawn, not only the hidden label', () => {
  assert.ok(progressCardSvg({ label: 'QA', count: 9, k: 15, needed: 6, unlocked: false }).includes('>9 of 15<'));
});
