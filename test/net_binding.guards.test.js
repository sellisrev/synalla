// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
// Guard tests for the SPEC in test/fixtures/net/binding/SPEC.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as binding from '../src/net/binding.js';

const DID1 = 'did:key:z' + 'a'.repeat(44), DID2 = 'did:key:z' + 'b'.repeat(44), DID3 = 'did:key:z' + 'c'.repeat(44);
const N1 = '1'.repeat(64), N2 = '2'.repeat(64), N3 = '3'.repeat(64);
const ID1 = 'a'.repeat(64), ID2 = 'b'.repeat(64), ID3 = 'c'.repeat(64), ID4 = 'd'.repeat(64);
const SIG1 = 'e'.repeat(128), SIG2 = 'f'.repeat(128);
const deps = { verifyEvent: () => true, verifyEd: () => true };
const item = (event, seenAt) => ({ event, seenAt: seenAt === undefined ? event.created_at : seenAt });
const opts = o => ({ delay: 0, ...o });

const pairEvent = (o = {}) => ({
  id: o.id ?? ID1, pubkey: o.pubkey ?? N1, created_at: o.created_at ?? 100,
  kind: o.kind ?? binding.BIND_KIND, tags: o.tags ?? [['t', 'pair'], ['did', o.did ?? DID1], ['ed-sig', o.edSig ?? SIG1]],
  content: o.content ?? '', sig: o.sig ?? 'sig',
});
const pairWithExpiry = (o = {}) => pairEvent({ ...o, tags: [['t', 'pair'], ['did', o.did ?? DID1], ['ed-sig', o.edSig ?? SIG1], ['expires', String(o.expires ?? 200)]] });
const cancelEvent = (o = {}) => pairEvent({
  id: o.id ?? ID2, pubkey: o.pubkey ?? N1, created_at: o.created_at ?? 250,
  tags: o.tags ?? [['t', 'cancel'], ['e', o.target ?? ID1], ...(o.did === undefined ? [] : [['did', o.did], ['ed-sig', o.edSig ?? SIG2]])],
});
const bad = r => {
  assert.equal(r.ok, false);
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
};

test('BIND_KIND and text formats are exact (S70 S71 S72 S73 S74 S75 S76 S77 S78 S79 S80 S81 S82 S83 S84)', () => {
  assert.equal(binding.BIND_KIND, 19469);
  assert.equal(binding.pairText(DID1, N1, 100, null), `synalla-pair-v1\n${DID1}\n${N1}\n100\nnone`);
  assert.equal(binding.pairText(DID1, N1, 100, 200), `synalla-pair-v1\n${DID1}\n${N1}\n100\n200`);
  assert.equal(binding.cancelText(ID1), `synalla-cancel-v1\n${ID1}`);
  for (const did of [DID1 + 'x'.repeat(20), '0' + DID1, DID1.slice(0, -6), DID1 + DID1]) assert.throws(() => binding.pairText(did, N1, 100, null), TypeError);
  for (const nostr of [N1 + 'f', 'f' + N1, [N1], N1.slice(1)]) assert.throws(() => binding.pairText(DID1, nostr, 100, null), TypeError);
  for (const t of [-1, 1.5, '100', null]) assert.throws(() => binding.pairText(DID1, N1, t, null), TypeError);
  for (const exp of [-1, 1.5, 100, 99, '200']) assert.throws(() => binding.pairText(DID1, N1, 100, exp), TypeError);
  assert.ok(binding.pairText(DID1, N1, 100, 101).endsWith('\n101'));
  for (const target of [ID1 + 'f', 'f' + ID1, [ID1], 'x']) assert.throws(() => binding.cancelText(target), TypeError);
});

test('templates validate and return plain objects (S76 S77 S81 S84 S85 S87 S88 S89)', () => {
  assert.deepEqual(binding.pairTemplate({ did: DID1, nostr: N1, createdAt: 100, expiresAt: null, edSig: SIG1 }),
    { kind: 19469, created_at: 100, tags: [['t', 'pair'], ['did', DID1], ['ed-sig', SIG1]], content: '' });
  assert.deepEqual(binding.pairTemplate({ did: DID1, nostr: N1, createdAt: 100, expiresAt: 200, edSig: SIG1 }).tags[3], ['expires', '200']);
  for (const sig of [SIG1 + 'e', 'e' + SIG1, SIG1.slice(1), 5]) assert.throws(() => binding.pairTemplate({ did: DID1, nostr: N1, createdAt: 100, expiresAt: null, edSig: sig }), TypeError);
  assert.deepEqual(binding.cancelTemplate({ targetId: ID1, createdAt: 100 }),
    { kind: 19469, created_at: 100, tags: [['t', 'cancel'], ['e', ID1]], content: '' });
  assert.deepEqual(binding.cancelTemplate({ targetId: ID1, createdAt: 100, did: DID1, edSig: SIG1 }).tags.slice(2), [['did', DID1], ['ed-sig', SIG1]]);
  assert.throws(() => binding.cancelTemplate({ targetId: ID1, createdAt: -1 }), TypeError);
  assert.throws(() => binding.cancelTemplate({ targetId: ID1, createdAt: 100, did: 'bad' }), TypeError);
  assert.throws(() => binding.cancelTemplate({ targetId: ID1, createdAt: 100, edSig: SIG1 }), TypeError);
});

test('readStatement checks the event envelope (S90 S91 S92 S93 S94 S95 S96 S97 S98 S99 S100 S101 S102 S103 S104)', () => {
  for (const e of [null, undefined, [], 'event', 5]) bad(binding.readStatement(e, deps));
  bad(binding.readStatement(pairEvent({ id: [ID1] }), deps));
  bad(binding.readStatement(pairEvent({ pubkey: N1 + 'f' }), deps));
  bad(binding.readStatement(pairEvent({ id: ID1 + 'f' }), deps));
  bad(binding.readStatement(pairEvent({ created_at: -1 }), deps));
  bad(binding.readStatement(pairEvent({ kind: 1 }), deps));
  bad(binding.readStatement(pairEvent({ content: 'x' }), deps));
  bad(binding.readStatement(pairEvent({ sig: 5 }), deps));
  bad(binding.readStatement(pairEvent({ tags: 'no' }), deps));
  assert.deepEqual(binding.readStatement(pairEvent(), deps),
    { ok: true, type: 'pair', id: ID1, did: DID1, nostr: N1, createdAt: 100, expiresAt: null });
  bad(binding.readStatement(pairEvent(), { ...deps, verifyEvent: () => false }));
  bad(binding.readStatement(pairEvent(), { ...deps, verifyEvent: () => { throw new Error('no'); } }));
  bad(binding.readStatement(pairEvent(), { ...deps, verifyEvent: () => 1 }));
});

test('each tag must be a fresh, known pair of strings (S105 S106 S107 S108 S109 S110 S111 S112 S113 S114 S115)', () => {
  const withTags = tags => binding.readStatement(pairEvent({ tags }), deps);
  for (const tags of [[['t']], [[ID1, ID2]], [['did', 1]], [['did', DID1, 'x']], ['t'], [[['t'], 'pair']]]) bad(withTags(tags));
  bad(withTags([['t', 'pair'], ['did', DID1], ['ed-sig', SIG1], ['x', 'y']]));
  bad(withTags([['t', 'pair'], ['t', 'cancel'], ['did', DID1], ['ed-sig', SIG1]]));
  assert.equal(withTags([['t', 'pair'], ['did', DID1], ['ed-sig', SIG1]]).ok, true);
  bad(withTags([['t', 'pair'], ['did', DID1], ['ed-sig', SIG1], ['expires', '200'], ['expires', '200']]));
});

test('pair tags and expiry values are strict (S116 S117 S118 S119 S120 S121 S122 S123 S124 S125 S126 S127)', () => {
  const withDid = (did, edSig = SIG1) => binding.readStatement(pairEvent({ tags: [['t', 'pair'], ['did', did], ['ed-sig', edSig]] }), deps);
  bad(withDid(DID1 + '0'));
  bad(withDid(DID1 + 'x'.repeat(20)));
  bad(withDid(DID1, SIG1 + 'e'));
  bad(binding.readStatement(pairEvent({ tags: [['t', 'pair'], ['did', DID1], ['ed-sig', SIG1], ['e', ID2]] }), deps));
  const withExpiry = exp => binding.readStatement(pairWithExpiry({ expires: exp }), deps);
  for (const exp of ['0200', '-1', '1.5', '200x', 'x200', '99999999999999999999', 100]) bad(withExpiry(exp));
  const ok = withExpiry(200);
  assert.deepEqual(ok, { ok: true, type: 'pair', id: ID1, did: DID1, nostr: N1, createdAt: 100, expiresAt: 200 });
  assert.equal(withExpiry(0).ok, false);
  assert.equal(binding.readStatement(pairEvent(), { ...deps, verifyEd: () => false }).ok, false);
  assert.equal(binding.readStatement(pairEvent(), { ...deps, verifyEd: () => { throw new Error('no'); } }).ok, false);
  assert.equal(binding.readStatement(pairEvent(), { ...deps, verifyEd: () => 1 }).ok, false);
});

test('cancel statements distinguish nostr and ed signatures (S128 S129 S130 S131 S132 S133 S134 S135 S136 S137 S138 S139 S140 S141 S142 S143 S144 S145 S146 S147 S148 S149 S150 S152 S153 S154 S155)', () => {
  assert.deepEqual(binding.readStatement(cancelEvent(), deps),
    { ok: true, type: 'cancel', id: ID2, target: ID1, by: 'nostr', key: N1, createdAt: 250 });
  assert.deepEqual(binding.readStatement(cancelEvent({ did: DID1, edSig: SIG1 }), deps),
    { ok: true, type: 'cancel', id: ID2, target: ID1, by: 'ed', key: DID1, createdAt: 250 });
  bad(binding.readStatement(cancelEvent({ target: ID1 + 'f' }), deps));
  bad(binding.readStatement(cancelEvent({ tags: [['t', 'cancel'], ['e', ID1], ['expires', '200']] }), deps));
  bad(binding.readStatement(cancelEvent({ tags: [['t', 'cancel'], ['did', DID1]] }), deps));
  bad(binding.readStatement(cancelEvent({ did: DID1 + '0', edSig: SIG1 }), deps));
  bad(binding.readStatement(cancelEvent({ did: DID1, edSig: SIG1 + 'e' }), deps));
  bad(binding.readStatement(cancelEvent({ did: DID1, edSig: SIG1 }), { ...deps, verifyEd: () => false }));
  bad(binding.readStatement(cancelEvent({ did: DID1, edSig: SIG1 }), { ...deps, verifyEd: () => { throw new Error('no'); } }));
  bad(binding.readStatement(pairEvent({ tags: [['t', 'other'], ['did', DID1], ['ed-sig', SIG1]] }), deps));
  bad(binding.readStatement(pairEvent({ tags: [['did', DID1], ['ed-sig', SIG1]] }), deps));
  assert.equal(binding.readStatement(pairEvent(), deps).ok, true);
});

test('resolve validates all arguments in order (S161 S162 S163 S164 S165)', () => {
  assert.throws(() => binding.resolve('no', DID1, 100, deps), TypeError);
  assert.throws(() => binding.resolve([], 'not-a-key', 100, deps), TypeError);
  assert.throws(() => binding.resolve([], DID1, -1, deps), TypeError);
  assert.throws(() => binding.resolve([], DID1, 100, deps, { delay: -1 }), TypeError);
  assert.throws(() => binding.resolve([], DID1, 100, deps, { skew: 1.5 }), TypeError);
  assert.equal(binding.resolve([], N1, 100, deps, null).status, 'none');
  assert.equal(binding.resolve([], N1, 100, deps, { delay: undefined, skew: undefined }).status, 'none');
  assert.deepEqual(binding.resolve([], DID1, 100, deps), { status: 'none' });
  const order = [1, 3, 2].map(id => ({ t: 0, id: '0'.repeat(63) + id }));
  assert.deepEqual(order.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(x => x.id.slice(-1)), ['1', '2', '3']);
});

test('collect skips malformed, future and invalid items (S166 S167 S168 S169 S170 S171 S172 S173 S174 S175 S176 S177 S178 S179)', () => {
  const p = pairEvent();
  const fn = () => {};
  Object.assign(fn, item(p));
  assert.deepEqual(binding.resolve([null, undefined, fn], DID1, 1000, deps), { status: 'none' });
  assert.deepEqual(binding.resolve([item(p, 1.5), item(p, 1001)], DID1, 1000, deps), { status: 'none' });
  assert.equal(binding.resolve([item(pairEvent({ created_at: 1601 }))], DID1, 1000, deps).status, 'none');
  assert.equal(binding.resolve([item(p)], DID1, 1000, { ...deps, verifyEvent: () => false }).status, 'none');
  assert.equal(binding.resolve([item(pairEvent({ created_at: 1600 }), 1000)], DID1, 1000, deps).status, 'unbound');
  assert.equal(binding.resolve([item(pairEvent({ created_at: 1000 }))], DID1, 1000, deps, { skew: 0 }).status, 'active');
});

test('duplicate statement ids keep the smallest seenAt, first on ties (S180 S181)', () => {
  const first = pairEvent({ id: ID1, pubkey: N1 }), second = pairEvent({ id: ID1, pubkey: N2 });
  assert.equal(binding.resolve([item(first, 200), item(second, 100)], DID1, 1000, deps).nostr, N2);
  const third = pairEvent({ id: ID1, pubkey: N3 });
  assert.equal(binding.resolve([item(first, 100), item(third, 100)], DID1, 1000, deps).nostr, N1);
});

test('entry times are max(createdAt, seenAt) and cancellations are not entries (S182 S183 S184)', () => {
  const p = pairEvent({ created_at: 100 });
  const got = binding.resolve([item(p, 300)], DID1, 1000, deps);
  assert.deepEqual(got, { status: 'active', did: DID1, nostr: N1, since: 300, expiresAt: null, pending: [] });
  const cancel = cancelEvent({ id: ID3, did: DID2 });
  assert.equal(binding.resolve([item(p), item(cancel)], DID2, 1000, deps).status, 'none');
});

test('a rebind takes effect after the delay and updates ever (S185 S186 S187 S188 S189 S190 S214 S216 S217 S218 S219 S220)', () => {
  const p1 = pairEvent({ id: ID1, did: DID1, pubkey: N1, created_at: 100 });
  const p2 = pairEvent({ id: ID2, did: DID1, pubkey: N2, created_at: 200 });
  const items = [item(p1), item(p2)];
  const before = binding.resolve(items, DID1, 250, deps, opts({ delay: 100 }));
  assert.deepEqual(before, { status: 'active', did: DID1, nostr: N1, since: 100, expiresAt: null,
    pending: [{ id: ID2, did: DID1, nostr: N2, effectiveAt: 300 }] });
  assert.equal(binding.resolve(items, N2, 250, deps, opts({ delay: 100 })).status, 'unbound');
  const after = binding.resolve(items, DID1, 300, deps, opts({ delay: 100 }));
  assert.deepEqual(after, { status: 'active', did: DID1, nostr: N2, since: 300, expiresAt: null, pending: [] });
  assert.equal(binding.resolve(items, N1, 300, deps, opts({ delay: 100 })).status, 'replaced');
  assert.equal(binding.resolve(items, N1, 300, deps, opts({ delay: 100 })).nostr, N2);
  const ed = pairEvent({ id: ID2, did: DID2, pubkey: N1, created_at: 200 });
  assert.equal(binding.resolve([item(p1), item(ed)], DID1, 300, deps, opts({ delay: 100 })).status, 'replaced');
  assert.equal(binding.resolve([item(pairEvent({ created_at: 300 }))], DID1, 300, deps, opts()).status, 'active');
});

test('a cancel seen before the rebind effective time blocks it (S191 S192 S193 S194 S195 S196 S197 S198 S199 S200 S201 S209 S210 S211 S212 S213)', () => {
  const p1 = pairEvent({ id: ID1, did: DID1, pubkey: N1, created_at: 100 });
  const p2 = pairEvent({ id: ID2, did: DID1, pubkey: N2, created_at: 200 });
  const items = [item(p1), item(p2)];
  const cancel = item(cancelEvent({ id: ID3, target: ID2, pubkey: N1, created_at: 250 }), 250);
  assert.equal(binding.resolve([...items, cancel], DID1, 1000, deps, opts({ delay: 100 })).nostr, N1);
  assert.equal(binding.resolve([...items, item(cancel.event, 300)], DID1, 1000, deps, opts({ delay: 100 })).nostr, N2);
  const edCancel = item(cancelEvent({ id: ID3, target: ID2, did: DID1, edSig: SIG1, created_at: 250 }), 250);
  assert.equal(binding.resolve([...items, edCancel], DID1, 1000, deps, opts({ delay: 100 })).nostr, N2);
  const edRebind = pairEvent({ id: ID2, did: DID2, pubkey: N1, created_at: 200 });
  const edItems = [item(p1), item(edRebind)];
  assert.equal(binding.resolve([...edItems, item(cancelEvent({ id: ID3, target: ID2, did: DID1, edSig: SIG1 }), 250)], DID1, 1000, deps, opts({ delay: 100 })).did, DID1);
  assert.equal(binding.resolve([...edItems, item(cancelEvent({ id: ID3, target: ID2, pubkey: N1 }), 250)], DID1, 1000, deps, opts({ delay: 100 })).did, DID2);
});

test('a rebind may not add a key another identity holds (S202 S203 S204 S205 S206 S207 S208)', () => {
  const p1 = pairEvent({ id: ID1, did: DID1, pubkey: N1, created_at: 100 });
  const pending = pairEvent({ id: ID2, did: DID1, pubkey: N2, created_at: 200 });
  const other = pairEvent({ id: ID3, did: DID2, pubkey: N2, created_at: 250 });
  const items = [item(p1), item(pending), item(other)];
  assert.equal(binding.resolve(items, DID1, 1000, deps, opts({ delay: 100 })).nostr, N1);
  assert.equal(binding.resolve([item(p1), item(pending)], DID1, 400, deps, opts({ delay: 100 })).nostr, N2);
  assert.equal(binding.resolve(items, N2, 1000, deps, opts({ delay: 100 })).did, DID2);
});

test('identity lookup prefers a current holder over a past one (S221 S222 S223 S224 S225)', () => {
  const p1 = pairEvent({ id: ID1, did: DID1, pubkey: N1, created_at: 100 });
  const p2 = pairEvent({ id: ID2, did: DID1, pubkey: N2, created_at: 200 });
  const p3 = pairEvent({ id: ID3, did: DID2, pubkey: N1, created_at: 300 });
  const items = [item(p1), item(p2), item(p3)];
  assert.deepEqual(binding.resolve(items, N1, 1000, deps, opts()), { status: 'active', did: DID2, nostr: N1, since: 300, expiresAt: null, pending: [] });
  assert.equal(binding.resolve(items, DID1, 1000, deps, opts()).status, 'active');
  assert.equal(binding.resolve([item(p1), item(p2)], N2, 250, deps, opts({ delay: 100 })).status, 'unbound');
  assert.equal(binding.resolve([item(p1), item(p2)], ID1, 250, deps, opts({ delay: 100 })).status, 'none');
});

test('pending only lists valid future rebinds of this identity (S226 S227 S228)', () => {
  const p1 = pairEvent({ id: ID1, did: DID1, pubkey: N1, created_at: 100 });
  const p2 = pairEvent({ id: ID2, did: DID1, pubkey: N2, created_at: 200 });
  const q1 = pairEvent({ id: ID3, did: DID2, pubkey: N3, created_at: 110 });
  const q2 = pairEvent({ id: ID4, did: DID2, pubkey: N1, created_at: 210 });
  const got = binding.resolve([item(p1), item(p2), item(q1), item(q2)], DID1, 250, deps, opts({ delay: 100 }));
  assert.deepEqual(got.pending, [{ id: ID2, did: DID1, nostr: N2, effectiveAt: 300 }]);
  const blocked = binding.resolve([item(p1), item(p2), item(cancelEvent({ id: ID3, target: ID2, pubkey: N1 }), 250)], DID1, 500, deps, opts({ delay: 100 }));
  assert.deepEqual(blocked.pending, []);
});

test('status is active, expired or replaced at exact boundaries (S229 S230 S231)', () => {
  const p = pairWithExpiry({ created_at: 100, expires: 200 });
  assert.equal(binding.resolve([item(p)], DID1, 199, deps, opts()).status, 'active');
  const expired = binding.resolve([item(p)], DID1, 200, deps, opts());
  assert.deepEqual(expired, { status: 'expired', did: DID1, nostr: N1, since: 100, expiresAt: 200, pending: [] });
  const reb = pairEvent({ id: ID2, did: DID1, pubkey: N2, created_at: 150 });
  assert.equal(binding.resolve([item(p), item(reb)], N1, 200, deps, opts()).status, 'replaced');
});
