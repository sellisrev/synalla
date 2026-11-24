// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Ed25519 keys and did:key identifiers (pilot plan W4): what the network code needs from Dina's crypto, so the shared
// network package and the daemon do not depend on Dina. Same encoding as Dina's `identity/did.ts`:
// did:key:z + base58btc(0xed 0x01 + 32-byte public key); checked against Dina in the bridge's tests.

import { ed25519 } from '@noble/curves/ed25519.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MULTICODEC = [0xed, 0x01];

export function base58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] as number;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => ALPHABET[d]).join('');
}

export function base58decode(s: string): Uint8Array {
  if (typeof s !== 'string') throw new TypeError('base58 text must be a string');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const v = ALPHABET.indexOf(s[i] as string);
    if (v < 0) throw new TypeError(`not a base58 character: ${s[i]}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] as number) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

const bytes32 = (k: unknown, what: string): Uint8Array => {
  if (!(k instanceof Uint8Array) || k.length !== 32) throw new TypeError(`${what} must be 32 bytes`);
  return k;
};

export function edPublicKey(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(bytes32(secretKey, 'secret key'));
}

export function edSign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, bytes32(secretKey, 'secret key'));
}

/** False (never throws) for a bad signature, key or message. */
export function edVerify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try { return ed25519.verify(signature, message, bytes32(publicKey, 'public key')); } catch { return false; }
}

export function didKey(publicKey: Uint8Array): string {
  return 'did:key:z' + base58encode(new Uint8Array([...MULTICODEC, ...bytes32(publicKey, 'public key')]));
}

export function didKeyPublicKey(did: string): Uint8Array {
  if (typeof did !== 'string' || !did.startsWith('did:key:z')) throw new TypeError('not a did:key (expected did:key:z...)');
  const raw = base58decode(did.slice('did:key:z'.length));
  if (raw.length !== 34 || raw[0] !== MULTICODEC[0] || raw[1] !== MULTICODEC[1]) throw new TypeError('not an Ed25519 did:key');
  return raw.slice(2);
}
