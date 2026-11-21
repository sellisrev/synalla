// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

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

/** A signed Nostr event (NIP-01). */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** What a caller gives signEvent: kind is required, the rest has defaults (created_at: now, tags: [], content: ''). */
export interface EventTemplate {
  kind: number;
  tags?: string[][];
  content?: string;
  created_at?: number | undefined;
}

/** The fields eventId hashes. */
export type UnsignedEvent = Pick<NostrEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>;

export function generateSecretKey(): string {
  return bytesToHex(schnorr.utils.randomSecretKey());
}

export function getPublicKey(secretKeyHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(secretKeyHex)));
}

export function eventId(e: UnsignedEvent): string {
  const serial = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  return bytesToHex(sha256(enc.encode(serial)));
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Sign an event template {kind, tags, content, created_at?}. Throws a TypeError on a malformed template. */
export function signEvent(template: EventTemplate, secretKeyHex: string): NostrEvent {
  const e: UnsignedEvent = {
    pubkey: getPublicKey(secretKeyHex),
    created_at: template.created_at ?? nowSeconds(),
    kind: template.kind,
    tags: template.tags ?? [],
    content: template.content ?? '',
  };
  checkShape({ ...e, id: '0'.repeat(64), sig: '0'.repeat(128) });
  const id = eventId(e);
  return Object.assign(e, { id, sig: bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(secretKeyHex))) });
}

function checkShape(e: unknown): asserts e is NostrEvent {
  if (!e || typeof e !== 'object') throw new TypeError('event must be an object');
  const x = e as Record<string, unknown>;
  if (!HEX64.test(String(x.pubkey))) throw new TypeError('pubkey must be 64 lowercase hex');
  if (!HEX64.test(String(x.id))) throw new TypeError('id must be 64 lowercase hex');
  if (!HEX128.test(String(x.sig))) throw new TypeError('sig must be 128 lowercase hex');
  if (!Number.isInteger(x.created_at) || (x.created_at as number) < 0) throw new TypeError('created_at must be a non-negative integer');
  if (!Number.isInteger(x.kind) || (x.kind as number) < 0 || (x.kind as number) > 65535) throw new TypeError('kind must be an integer 0..65535');
  if (!Array.isArray(x.tags) || !x.tags.every((t: unknown) => Array.isArray(t) && t.every(v => typeof v === 'string'))) {
    throw new TypeError('tags must be an array of string arrays');
  }
  if (typeof x.content !== 'string') throw new TypeError('content must be a string');
}

/** True only if the event is well formed, its id matches its content and the signature is valid. */
export function verifyEvent(e: unknown): e is NostrEvent {
  try {
    checkShape(e);
    if (eventId(e) !== e.id) return false;
    return schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

/** First value of the first tag with this name, or undefined. */
export function tagValue(e: Pick<NostrEvent, 'tags'>, name: string): string | undefined {
  const t = e.tags.find(t => t[0] === name);
  return t ? t[1] : undefined;
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(enc.encode(text)));
}

export function randomHex(bytes = 32): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}
