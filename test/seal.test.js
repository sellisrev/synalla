// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  getConversationKey, getMessageKeys, calcPaddedLen, encrypt, decrypt,
  makeRumor, giftWrap, unwrap, SEAL_KIND, WRAP_KIND,
} from '../src/seal.js';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';
import { createKnock } from '../src/knock.js';

// Official vectors from https://github.com/paulmillr/nip44 ; sha256 as published in NIP-44:
// 269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040
const raw = readFileSync(new URL('./vectors/nip44.vectors.json', import.meta.url));
const V = JSON.parse(raw).v2;

test('vector file is the published one', () => {
  assert.equal(bytesToHex(sha256(raw)), '269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040');
});

test('NIP-44 valid: conversation keys', () => {
  for (const v of V.valid.get_conversation_key) {
    assert.equal(bytesToHex(getConversationKey(v.sec1, v.pub2)), v.conversation_key);
  }
});

test('NIP-44 valid: message keys', () => {
  const ck = hexToBytes(V.valid.get_message_keys.conversation_key);
  for (const v of V.valid.get_message_keys.keys) {
    const k = getMessageKeys(ck, hexToBytes(v.nonce));
    assert.equal(bytesToHex(k.chachaKey), v.chacha_key);
    assert.equal(bytesToHex(k.chachaNonce), v.chacha_nonce);
    assert.equal(bytesToHex(k.hmacKey), v.hmac_key);
  }
});

test('NIP-44 valid: padded lengths', () => {
  for (const [len, padded] of V.valid.calc_padded_len) assert.equal(calcPaddedLen(len), padded);
});

test('NIP-44 valid: encrypt and decrypt', () => {
  for (const v of V.valid.encrypt_decrypt) {
    const ck = getConversationKey(v.sec1, getPublicKey(v.sec2));
    assert.equal(bytesToHex(ck), v.conversation_key);
    const ck2 = getConversationKey(v.sec2, getPublicKey(v.sec1));
    assert.equal(bytesToHex(ck2), v.conversation_key);
    assert.equal(encrypt(v.plaintext, ck, hexToBytes(v.nonce)), v.payload);
    assert.equal(decrypt(v.payload, ck), v.plaintext);
  }
});

test('NIP-44 valid: long messages', () => {
  for (const v of V.valid.encrypt_decrypt_long_msg) {
    const plaintext = v.pattern.repeat(v.repeat);
    assert.equal(bytesToHex(sha256(new TextEncoder().encode(plaintext))), v.plaintext_sha256);
    const ck = hexToBytes(v.conversation_key);
    const payload = encrypt(plaintext, ck, hexToBytes(v.nonce));
    assert.equal(bytesToHex(sha256(new TextEncoder().encode(payload))), v.payload_sha256);
    assert.equal(decrypt(payload, ck), plaintext);
  }
});

test('NIP-44 invalid: message lengths', () => {
  const ck = new Uint8Array(32).fill(1);
  for (const len of V.invalid.encrypt_msg_lengths) assert.throws(() => encrypt('a'.repeat(len), ck));
});

test('NIP-44 invalid: conversation keys', () => {
  for (const v of V.invalid.get_conversation_key) assert.throws(() => getConversationKey(v.sec1, v.pub2), Error, v.note);
});

test('NIP-44 invalid: decrypt', () => {
  for (const v of V.invalid.decrypt) assert.throws(() => decrypt(v.payload, hexToBytes(v.conversation_key)), Error, v.note);
});

const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };

test('gift wrap round trip hides the sender from the outer layer', () => {
  const alice = person(), bob = person();
  const rumor = makeRumor({ kind: 14, tags: [['p', bob.pk]], content: 'hello Bob' }, alice.pk);
  const wrap = giftWrap(rumor, alice.sk, bob.pk);
  assert.equal(wrap.kind, WRAP_KIND);
  assert.notEqual(wrap.pubkey, alice.pk);
  assert.deepEqual(wrap.tags, [['p', bob.pk]]);
  assert.equal(JSON.stringify(wrap).includes(alice.pk), false);
  const { sender, inner, signedInner } = unwrap(wrap, bob.sk);
  assert.equal(sender, alice.pk);
  assert.equal(inner.content, 'hello Bob');
  assert.equal(signedInner, false);
});

test('a signed knock travels inside a gift wrap and stays verifiable', () => {
  const alice = person(), bob = person();
  const knock = createKnock(alice.sk, { category: 'question', fields: { topic: 'QA pay' } }, { recipient: bob.pk });
  const { inner, signedInner } = unwrap(giftWrap(knock, alice.sk, bob.pk), bob.sk);
  assert.equal(signedInner, true);
  assert.deepEqual(inner, knock);
});

test('wrong recipient, tampering and impersonation fail', () => {
  const alice = person(), bob = person(), eve = person();
  const wrap = giftWrap(makeRumor({ kind: 14, content: 'hi' }, alice.pk), alice.sk, bob.pk);
  assert.throws(() => unwrap(wrap, eve.sk), /MAC/);
  const t = structuredClone(wrap);
  t.content = t.content.slice(0, 10) + (t.content[10] === 'A' ? 'B' : 'A') + t.content.slice(11);
  assert.throws(() => unwrap(t, bob.sk));
  // Eve seals a rumor that claims to be from Alice
  assert.throws(() => giftWrap(makeRumor({ kind: 14, content: 'x' }, alice.pk), eve.sk, bob.pk), /sender key/);
  // ...or builds the layers by hand
  const rumor = makeRumor({ kind: 14, content: 'x' }, alice.pk);
  const seal = signEvent({ kind: SEAL_KIND, tags: [], content: encrypt(JSON.stringify(rumor), getConversationKey(eve.sk, bob.pk)) }, eve.sk);
  const one = generateSecretKey();
  const forged = signEvent({ kind: WRAP_KIND, tags: [['p', bob.pk]], content: encrypt(JSON.stringify(seal), getConversationKey(one, bob.pk)) }, one);
  assert.throws(() => unwrap(forged, bob.sk), /another sender/);
});

test('seal and wrap times are fuzzed into the past two days', () => {
  const alice = person(), bob = person();
  const now = 1_800_000_000;
  const wrap = giftWrap(makeRumor({ kind: 14, content: 'hi', created_at: now }, alice.pk), alice.sk, bob.pk, { now });
  assert.ok(wrap.created_at <= now && wrap.created_at > now - 2 * 86400);
});
