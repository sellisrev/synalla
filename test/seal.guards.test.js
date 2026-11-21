// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// Each guard in seal.js gets a hostile input that only that guard can stop, and the test pins the exact refusal.
// seal.test.js proves the happy path and that bad input fails somehow; this file proves *which* check refuses it, so
// deleting or weakening any single guard fails a test (found by mutation testing, 21 Nov 2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCipheriv } from 'node:crypto';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, concatBytes } from '@noble/hashes/utils.js';
import {
  getConversationKey, getMessageKeys, calcPaddedLen, encrypt, decrypt,
  makeRumor, giftWrap, unwrap, SEAL_KIND, WRAP_KIND,
} from '../src/seal.js';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';

const V = JSON.parse(readFileSync(new URL('./vectors/nip44.vectors.json', import.meta.url))).v2;
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// ---- NIP-44 decryption: each official invalid vector is refused by the guard its note names --------------------

const EXPECTED = {
  'unknown encryption version': /^unknown encryption version$/,
  'unknown encryption version 0': /^unknown encryption version 0$/,
  'invalid base64': /^invalid base64$/,
  'invalid MAC': /^invalid MAC$/,
  'invalid padding': /^invalid padding$/,
  'invalid payload length: 0': /^unknown encryption version$/, // empty payload: NIP-44 reads it as a missing version
  'invalid payload length: 4': /^invalid payload size$/,
  'invalid payload length: 48': /^invalid payload size$/,
  'invalid payload length: 92': /^invalid payload size$/,
};

test('NIP-44 invalid decrypt vectors are refused by the guard their note names', () => {
  assert.equal(V.invalid.decrypt.length, 12);
  for (const v of V.invalid.decrypt) {
    const want = EXPECTED[v.note];
    assert.ok(want, `no expectation for vector note "${v.note}"`);
    assert.throws(() => decrypt(v.payload, hexToBytes(v.conversation_key)), (e) => want.test(e.message), v.note);
  }
});

// A well-formed v2 payload built by hand, so each test can break exactly one thing in it.
function chacha20(key, nonce12, data) {
  const c = createCipheriv('chacha20', key, concatBytes(new Uint8Array(4), nonce12));
  return new Uint8Array(c.update(data));
}
function buildPayload(paddedPlaintext, ck, { version = 2, nonce = new Uint8Array(32).fill(7), tamperMac = false } = {}) {
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(ck, nonce);
  const ct = chacha20(chachaKey, chachaNonce, paddedPlaintext);
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ct));
  if (tamperMac) mac[0] ^= 1;
  return b64(concatBytes(new Uint8Array([version]), nonce, ct, mac));
}
function padded(bytes) {
  const out = new Uint8Array(2 + calcPaddedLen(bytes.length));
  new DataView(out.buffer).setUint16(0, bytes.length);
  out.set(bytes, 2);
  return out;
}
const ck = hexToBytes('c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d');

test('decrypt: a hand-built valid payload opens (the base for the tampered cases below)', () => {
  assert.equal(decrypt(buildPayload(padded(new TextEncoder().encode('hello')), ck), ck), 'hello');
});

test('decrypt: invalid UTF-8 inside a valid MAC is refused, never decoded with replacement characters', () => {
  assert.throws(() => decrypt(buildPayload(padded(new Uint8Array([0x68, 0xff, 0xfe])), ck), ck), TypeError);
});

test('decrypt: version byte other than 2 is refused after base64 decoding', () => {
  assert.throws(() => decrypt(buildPayload(padded(new Uint8Array([0x61])), ck, { version: 1 }), ck), { message: /^unknown encryption version 1$/ });
});

test('decrypt: one flipped MAC bit is refused', () => {
  assert.throws(() => decrypt(buildPayload(padded(new Uint8Array([0x61])), ck, { tamperMac: true }), ck), { message: /^invalid MAC$/ });
});

test('decrypt: zero declared length, or padding of the wrong size for the length, is refused', () => {
  const z = padded(new Uint8Array([0x61]));
  new DataView(z.buffer).setUint16(0, 0); // zero-length message
  assert.throws(() => decrypt(buildPayload(z, ck), ck), { message: /^invalid padding$/ });
  const big = new Uint8Array(2 + 64); // 1-byte message padded to 64 instead of 32
  new DataView(big.buffer).setUint16(0, 1);
  big[2] = 0x61;
  assert.throws(() => decrypt(buildPayload(big, ck), ck), { message: /^invalid padding$/ });
});

test('decrypt: payload size bounds are exact', () => {
  assert.throws(() => decrypt('A'.repeat(131), ck), { message: /^invalid payload size$/ });
  assert.throws(() => decrypt('A'.repeat(87473), ck), { message: /^invalid payload size$/ });
  // 132 and 87472 characters pass the size guard and fail later (base64/data checks), never on size
  assert.throws(() => decrypt('A'.repeat(132), ck), (e) => e.message !== 'invalid payload size');
  assert.throws(() => decrypt('A'.repeat(87472), ck), (e) => e.message !== 'invalid payload size');
});

test('decrypt: base64 is checked over the whole payload, start to end', () => {
  const good = buildPayload(padded(new Uint8Array([0x61])), ck);
  assert.throws(() => decrypt('!' + good.slice(1), ck), { message: /^invalid base64$/ });
  assert.throws(() => decrypt(good.slice(0, -1) + '!', ck), { message: /^invalid base64$/ });
});

test('decrypt: non-string payload is refused', () => {
  assert.throws(() => decrypt(42, ck), { message: /^payload must be a string$/ });
});

// ---- key and length guards ----------------------------------------------------------------------------------------

test('getMessageKeys: conversation key and nonce must be exactly 32 bytes', () => {
  assert.throws(() => getMessageKeys(new Uint8Array(31), new Uint8Array(32)), { message: /^conversation key must be 32 bytes$/ });
  assert.throws(() => getMessageKeys(new Uint8Array(32), new Uint8Array(33)), { message: /^nonce must be 32 bytes$/ });
  assert.doesNotThrow(() => getMessageKeys(new Uint8Array(32), new Uint8Array(32)));
});

test('calcPaddedLen: spec values at powers of two and just above them (worked by hand from NIP-44)', () => {
  // len <= 32 -> 32; else nextPower = 2^(floor(log2(len-1))+1); chunk = 32 if nextPower <= 256 else nextPower/8;
  // padded = chunk * (floor((len-1)/chunk) + 1)
  const cases = [[1, 32], [32, 32], [33, 64], [64, 64], [65, 96], [128, 128], [129, 160], [256, 256], [257, 320],
    [512, 512], [513, 640], [1024, 1024], [1025, 1280], [65535, 65536]];
  for (const [len, want] of cases) assert.equal(calcPaddedLen(len), want, `len ${len}`);
  for (const bad of [0, -1, 1.5, NaN]) assert.throws(() => calcPaddedLen(bad), { message: /^expected a positive integer$/ });
});

test('encrypt: plaintext length bounds are exact (1 and 65535 bytes pass, 0 and 65536 fail)', () => {
  const n = new Uint8Array(32);
  assert.throws(() => encrypt('', ck, n), { message: /^plaintext must be 1 to 65535 bytes$/ });
  assert.throws(() => encrypt('a'.repeat(65536), ck, n), { message: /^plaintext must be 1 to 65535 bytes$/ });
  assert.equal(decrypt(encrypt('a', ck, n), ck), 'a');
  assert.equal(decrypt(encrypt('a'.repeat(65535), ck, n), ck).length, 65535);
});

// ---- NIP-59 gift wrap: each unwrap guard has its own hostile input -------------------------------------------------

const alice = generateSecretKey(), bob = generateSecretKey(), mallory = generateSecretKey();
const A = getPublicKey(alice), B = getPublicKey(bob);
const NOW = 1_800_000_000;

function sealFor(inner, senderSk, recipientPk, over = {}) {
  return signEvent({ kind: SEAL_KIND, created_at: NOW, tags: [],
    content: encrypt(JSON.stringify(inner), getConversationKey(senderSk, recipientPk)), ...over }, senderSk);
}
function wrapFor(seal, recipientPk, over = {}) {
  const one = generateSecretKey();
  return signEvent({ kind: WRAP_KIND, created_at: NOW, tags: [['p', recipientPk]],
    content: encrypt(JSON.stringify(seal), getConversationKey(one, recipientPk)), ...over }, one);
}
const rumor = () => makeRumor({ kind: 14, created_at: NOW, content: 'hi', tags: [] }, A);

test('unwrap: a hand-built wrap opens (the base for the hostile cases below)', () => {
  const r = unwrap(wrapFor(sealFor(rumor(), alice, B), B), bob);
  assert.equal(r.sender, A);
  assert.equal(r.inner.content, 'hi');
  assert.equal(r.signedInner, false);
});

test('unwrap: wrap with a broken signature is refused', () => {
  const w = wrapFor(sealFor(rumor(), alice, B), B);
  w.sig = w.sig.slice(0, -1) + (w.sig.endsWith('0') ? '1' : '0');
  assert.throws(() => unwrap(w, bob), { message: /^not a valid gift wrap$/ });
});

test('unwrap: correctly signed event of the wrong kind is refused as a wrap', () => {
  assert.throws(() => unwrap(wrapFor(sealFor(rumor(), alice, B), B, { kind: 1 }), bob), { message: /^not a valid gift wrap$/ });
});

test('unwrap: seal with a broken signature is refused', () => {
  const s = sealFor(rumor(), alice, B);
  s.sig = s.sig.slice(0, -1) + (s.sig.endsWith('0') ? '1' : '0');
  assert.throws(() => unwrap(wrapFor(s, B), bob), { message: /^not a valid seal$/ });
});

test('unwrap: correctly signed seal of the wrong kind is refused', () => {
  assert.throws(() => unwrap(wrapFor(sealFor(rumor(), alice, B, { kind: 14 }), B), bob), { message: /^not a valid seal$/ });
});

test('unwrap: seal carrying tags is refused (tags would leak metadata)', () => {
  assert.throws(() => unwrap(wrapFor(sealFor(rumor(), alice, B, { tags: [['p', B]] }), B), bob), { message: /^seal must have no tags$/ });
});

test('unwrap: inner event naming another sender than the seal is refused', () => {
  const forged = makeRumor({ kind: 14, created_at: NOW, content: 'I am Alice', tags: [] }, A);
  assert.throws(() => unwrap(wrapFor(sealFor(forged, mallory, B), B), bob), { message: /^inner event claims another sender$/ });
});

test('unwrap: inner event whose id does not match its content is refused', () => {
  const r = rumor();
  r.content = 'changed after the id was computed';
  assert.throws(() => unwrap(wrapFor(sealFor(r, alice, B), B), bob), { message: /^inner event id does not match$/ });
});

test('unwrap: signed inner event with a bad signature is refused; a good one is reported as signed', () => {
  const good = signEvent({ kind: 14, created_at: NOW, content: 'signed', tags: [] }, alice);
  assert.equal(unwrap(wrapFor(sealFor(good, alice, B), B), bob).signedInner, true);
  const bad = { ...good, sig: good.sig.slice(0, -1) + (good.sig.endsWith('0') ? '1' : '0') };
  assert.throws(() => unwrap(wrapFor(sealFor(bad, alice, B), B), bob), { message: /^inner event signature invalid$/ });
});

test('giftWrap: refuses an inner event that does not carry the sender key', () => {
  assert.throws(() => giftWrap(makeRumor({ kind: 14, content: 'x' }, B), alice, B), { message: /^inner event must carry the sender key$/ });
});

test('giftWrap: wrap and seal timestamps are randomised into the past two days, never the real send time', () => {
  const stamps = new Set();
  for (let i = 0; i < 20; i++) {
    const w = giftWrap(rumor(), alice, B, { now: NOW });
    const seal = JSON.parse(decrypt(w.content, getConversationKey(bob, w.pubkey)));
    for (const t of [w.created_at, seal.created_at]) {
      assert.ok(t <= NOW && t > NOW - 2 * 86400, `timestamp ${t} outside the two-day window`);
      stamps.add(t);
    }
  }
  assert.ok(stamps.size > 30, `only ${stamps.size} distinct timestamps in 40: not randomised`);
});

test('makeRumor: defaults are empty tags and empty content, kept when given', () => {
  const r = makeRumor({ kind: 14, created_at: NOW }, A);
  assert.deepEqual(r.tags, []);
  assert.equal(r.content, '');
  const t = makeRumor({ kind: 14, created_at: NOW, tags: [['x', '1']], content: 'c' }, A);
  assert.deepEqual(t.tags, [['x', '1']]);
  assert.equal(t.content, 'c');
  assert.equal(t.created_at, NOW);
});
