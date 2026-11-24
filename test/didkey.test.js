// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58encode, base58decode, edPublicKey, edSign, edVerify, didKey, didKeyPublicKey } from '../src/didkey.js';

const hex = h => Uint8Array.from(Buffer.from(h, 'hex'));
const toHex = b => Buffer.from(b).toString('hex');

test('base58: the standard test values, leading zeros, round trip, bad characters', () => {
  assert.equal(base58encode(Buffer.from('Hello World!')), '2NEpo7TZRRrLZSi2U');
  assert.equal(base58encode(new Uint8Array([0, 0, 1])), '112');
  assert.equal(base58encode(new Uint8Array([])), '');
  assert.deepEqual([...base58decode('112')], [0, 0, 1]);
  assert.equal(Buffer.from(base58decode('2NEpo7TZRRrLZSi2U')).toString(), 'Hello World!');
  for (let n = 0; n < 50; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) % 256);
    assert.deepEqual([...base58decode(base58encode(b))], [...b]);
  }
  assert.throws(() => base58decode('0OIl'), /not a base58 character: 0/);
  assert.throws(() => base58decode(5), TypeError);
});

test('Ed25519: RFC 8032 test vector 1', () => {
  const sk = hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  assert.equal(toHex(edPublicKey(sk)), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const sig = edSign(sk, new Uint8Array([]));
  assert.equal(toHex(sig), 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
  assert.equal(edVerify(edPublicKey(sk), new Uint8Array([]), sig), true);
  assert.equal(edVerify(edPublicKey(sk), new Uint8Array([1]), sig), false);
  assert.equal(edVerify(new Uint8Array(3), new Uint8Array([]), sig), false, 'bad key: false, no throw');
  assert.throws(() => edSign(new Uint8Array(31), new Uint8Array([])), /secret key must be 32 bytes/);
});

test('did:key: Ed25519 multicodec, round trip, refusals', () => {
  const pk = hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const did = didKey(pk);
  assert.match(did, /^did:key:z6Mk/);
  assert.deepEqual([...didKeyPublicKey(did)], [...pk]);
  assert.throws(() => didKeyPublicKey('did:web:example.com'), /not a did:key/);
  assert.throws(() => didKeyPublicKey('did:key:z' + base58encode(new Uint8Array([0xe7, 0x01, ...pk]))), /not an Ed25519 did:key/);
  assert.throws(() => didKeyPublicKey('did:key:z' + base58encode(new Uint8Array([0xed, 0x01, 1, 2]))), /not an Ed25519 did:key/);
  assert.throws(() => didKey(new Uint8Array(31)), /public key must be 32 bytes/);
});

test('guards found by mutation testing (24 Nov 2026)', () => {
  assert.throws(() => edPublicKey(new Uint8Array(31)), /secret key must be 32 bytes/);
  assert.throws(() => base58decode(null), { message: 'base58 text must be a string' });
  assert.throws(() => didKeyPublicKey(5), /not a did:key/);
  const pk = edPublicKey(new Uint8Array(32).fill(7));
  assert.throws(() => didKeyPublicKey('did:key:z' + base58encode(new Uint8Array([0xed, 0x02, ...pk]))), /not an Ed25519 did:key/);
});
