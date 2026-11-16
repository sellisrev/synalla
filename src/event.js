// Signed events in the Nostr NIP-01 format.
// An agent's address is its public key (32-byte x-only secp256k1, hex).
// Every object in Synalla (invite, vouch, question, record) is one of these events,
// so it can travel over Nostr relays, email or files without changing shape.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const enc = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export function generateSecretKey() {
  return bytesToHex(schnorr.utils.randomSecretKey());
}

export function getPublicKey(secretKeyHex) {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(secretKeyHex)));
}

export function eventId(e) {
  const serial = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  return bytesToHex(sha256(enc.encode(serial)));
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Sign an event template {kind, tags, content, created_at?}.
 * @returns {{id:string,pubkey:string,created_at:number,kind:number,tags:string[][],content:string,sig:string}}
 */
export function signEvent(template, secretKeyHex) {
  const e = {
    pubkey: getPublicKey(secretKeyHex),
    created_at: template.created_at ?? nowSeconds(),
    kind: template.kind,
    tags: template.tags ?? [],
    content: template.content ?? '',
  };
  checkShape({ ...e, id: '0'.repeat(64), sig: '0'.repeat(128) });
  e.id = eventId(e);
  e.sig = bytesToHex(schnorr.sign(hexToBytes(e.id), hexToBytes(secretKeyHex)));
  return e;
}

function checkShape(e) {
  if (!e || typeof e !== 'object') throw new TypeError('event must be an object');
  if (!HEX64.test(e.pubkey)) throw new TypeError('pubkey must be 64 lowercase hex');
  if (!HEX64.test(e.id)) throw new TypeError('id must be 64 lowercase hex');
  if (!HEX128.test(e.sig)) throw new TypeError('sig must be 128 lowercase hex');
  if (!Number.isInteger(e.created_at) || e.created_at < 0) throw new TypeError('created_at must be a non-negative integer');
  if (!Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) throw new TypeError('kind must be an integer 0..65535');
  if (!Array.isArray(e.tags) || !e.tags.every(t => Array.isArray(t) && t.every(x => typeof x === 'string'))) {
    throw new TypeError('tags must be an array of string arrays');
  }
  if (typeof e.content !== 'string') throw new TypeError('content must be a string');
}

/** True only if the event is well formed, its id matches its content and the signature is valid. */
export function verifyEvent(e) {
  try {
    checkShape(e);
    if (eventId(e) !== e.id) return false;
    return schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

/** First value of the first tag with this name, or undefined. */
export function tagValue(e, name) {
  const t = e.tags.find(t => t[0] === name);
  return t ? t[1] : undefined;
}

export function sha256Hex(text) {
  return bytesToHex(sha256(enc.encode(text)));
}

export function randomHex(bytes = 32) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}
