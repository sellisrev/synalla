// Sealed mail: NIP-44 v2 encryption and NIP-59 gift wrap, as used by NIP-17 private messages.
//
// A message to an agent is wrapped twice:
//   rumor  the event itself (any of Synalla's events, signed or not)
//   seal   kind 13, signed by the real sender, content = NIP-44(rumor) to the recipient
//   wrap   kind 1059, signed by a one-time key, content = NIP-44(seal), tagged with the recipient
// Relays see the recipient key, size and an imprecise time, never the sender or the content.
//
// NIP-44 has no forward secrecy: if a key leaks, every message sealed to it can be read.
// Use this for first contact and short exchanges; long conversations belong in MLS.

import { createCipheriv, timingSafeEqual } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { extract, expand } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey, signEvent, verifyEvent, eventId, nowSeconds } from './event.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const SALT = enc.encode('nip44-v2');
export const SEAL_KIND = 13;
export const WRAP_KIND = 1059;

// ---- NIP-44 v2 ------------------------------------------------------------------------------

export function getConversationKey(secretKeyHex, publicKeyHex) {
  const shared = secp256k1.getSharedSecret(hexToBytes(secretKeyHex), hexToBytes('02' + publicKeyHex));
  return extract(sha256, shared.subarray(1, 33), SALT);
}

export function getMessageKeys(conversationKey, nonce) {
  if (conversationKey.length !== 32) throw new Error('conversation key must be 32 bytes');
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const keys = expand(sha256, conversationKey, nonce, 76);
  return { chachaKey: keys.subarray(0, 32), chachaNonce: keys.subarray(32, 44), hmacKey: keys.subarray(44, 76) };
}

export function calcPaddedLen(len) {
  if (!Number.isInteger(len) || len < 1) throw new Error('expected a positive integer');
  if (len <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function pad(text) {
  const bytes = enc.encode(text);
  const len = bytes.length;
  if (len < 1 || len > 65535) throw new Error('plaintext must be 1 to 65535 bytes');
  const out = new Uint8Array(2 + calcPaddedLen(len));
  out[0] = len >> 8;
  out[1] = len & 0xff;
  out.set(bytes, 2);
  return out;
}

function unpad(padded) {
  const len = (padded[0] << 8) | padded[1];
  const body = padded.subarray(2, 2 + len);
  if (len === 0 || body.length !== len || padded.length !== 2 + calcPaddedLen(len)) throw new Error('invalid padding');
  return dec.decode(body);
}

function chacha20(key, nonce12, data) {
  const iv = new Uint8Array(16);
  iv.set(nonce12, 4); // OpenSSL's chacha20 IV: 32-bit little-endian counter (0), then the 96-bit nonce
  const c = createCipheriv('chacha20', key, iv);
  return new Uint8Array(Buffer.concat([c.update(data), c.final()]));
}

function hmacAad(key, message, aad) {
  if (aad.length !== 32) throw new Error('AAD associated data must be 32 bytes');
  return hmac(sha256, key, concatBytes(aad, message));
}

export function encrypt(plaintext, conversationKey, nonce = globalThis.crypto.getRandomValues(new Uint8Array(32))) {
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext));
  const mac = hmacAad(hmacKey, ciphertext, nonce);
  return Buffer.from(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac)).toString('base64');
}

export function decrypt(payload, conversationKey) {
  if (typeof payload !== 'string') throw new Error('payload must be a string');
  const plen = payload.length;
  if (plen === 0 || payload[0] === '#') throw new Error('unknown encryption version');
  if (plen < 132 || plen > 87472) throw new Error('invalid payload size');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error('invalid base64');
  const data = new Uint8Array(Buffer.from(payload, 'base64'));
  const dlen = data.length;
  if (dlen < 99 || dlen > 65603) throw new Error('invalid data size');
  if (data[0] !== 2) throw new Error(`unknown encryption version ${data[0]}`);
  const nonce = data.subarray(1, 33);
  const ciphertext = data.subarray(33, dlen - 32);
  const mac = data.subarray(dlen - 32);
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);
  const expected = hmacAad(hmacKey, ciphertext, nonce);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) throw new Error('invalid MAC');
  return unpad(chacha20(chachaKey, chachaNonce, ciphertext));
}

// ---- NIP-59 gift wrap -----------------------------------------------------------------------

const TWO_DAYS = 2 * 86400;
function fuzzyTime(now) {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return now - (r[0] % TWO_DAYS);
}

/** Turn an event template into a rumor: an event with an id and the sender's key, without a signature. */
export function makeRumor(template, senderPubkey) {
  const r = {
    pubkey: senderPubkey,
    created_at: template.created_at ?? nowSeconds(),
    kind: template.kind,
    tags: template.tags ?? [],
    content: template.content ?? '',
  };
  r.id = eventId(r);
  return r;
}

/**
 * Seal and wrap an event for one recipient.
 * @param {object} inner         a rumor (from makeRumor) or an already signed event
 * @param {string} senderSk
 * @param {string} recipientPubkey
 */
export function giftWrap(inner, senderSk, recipientPubkey, { now = nowSeconds() } = {}) {
  if (inner.pubkey !== getPublicKey(senderSk)) throw new Error('inner event must carry the sender key');
  const seal = signEvent({
    kind: SEAL_KIND,
    created_at: fuzzyTime(now),
    tags: [],
    content: encrypt(JSON.stringify(inner), getConversationKey(senderSk, recipientPubkey)),
  }, senderSk);
  const oneTime = generateSecretKey();
  return signEvent({
    kind: WRAP_KIND,
    created_at: fuzzyTime(now),
    tags: [['p', recipientPubkey]],
    content: encrypt(JSON.stringify(seal), getConversationKey(oneTime, recipientPubkey)),
  }, oneTime);
}

/**
 * Open a gift wrap addressed to us. Throws on anything that doesn't check out.
 * @returns {{sender:string, inner:object, signedInner:boolean}}
 */
export function unwrap(wrap, recipientSk) {
  if (!verifyEvent(wrap) || wrap.kind !== WRAP_KIND) throw new Error('not a valid gift wrap');
  const seal = JSON.parse(decrypt(wrap.content, getConversationKey(recipientSk, wrap.pubkey)));
  if (!verifyEvent(seal) || seal.kind !== SEAL_KIND) throw new Error('not a valid seal');
  if (seal.tags.length) throw new Error('seal must have no tags');
  const inner = JSON.parse(decrypt(seal.content, getConversationKey(recipientSk, seal.pubkey)));
  if (!inner || inner.pubkey !== seal.pubkey) throw new Error('inner event claims another sender');
  if (inner.id !== eventId(inner)) throw new Error('inner event id does not match');
  const signedInner = typeof inner.sig === 'string';
  if (signedInner && !verifyEvent(inner)) throw new Error('inner event signature invalid');
  return { sender: seal.pubkey, inner, signedInner };
}

