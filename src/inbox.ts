// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Where to reach an agent: its signed inbox list (NIP-17, kind 10050).
//
// The address is the public key and never changes. The inbox list names the relays that hold
// sealed mail for that key; when a relay dies, the owner signs a new list and the address still
// works. Senders drop each message at several listed relays, because retention is only a promise.

import { signEvent, verifyEvent } from './event.ts';
import type { NostrEvent } from './event.ts';

export interface InboxList { relays: string[]; listId: string; at: number }

export const INBOX_LIST_KIND = 10050;
const MAX_RELAYS = 8;

function normaliseRelay(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`not a URL: ${url}`); }
  if (u.protocol !== 'wss:') throw new Error(`inbox relays must use wss:// (${url})`);
  if (u.username || u.password) throw new Error('relay URLs must not carry credentials');
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

export function createInboxList(sk: string, relays: string[], { createdAt }: { createdAt?: number | undefined } = {}): NostrEvent {
  const list = [...new Set(relays.map(normaliseRelay))];
  if (list.length === 0) throw new Error('at least one relay');
  if (list.length > MAX_RELAYS) throw new Error(`at most ${MAX_RELAYS} relays`);
  return signEvent({ kind: INBOX_LIST_KIND, created_at: createdAt, tags: list.map(r => ['relay', r]), content: '' }, sk);
}

/** The newest valid inbox list signed by `pubkey` among `events`, as relay URLs (or null). */
export function readInboxList(events: Iterable<unknown>, pubkey: string): InboxList | null {
  let best: NostrEvent | null = null;
  for (const e of events) {
    const x = e as { kind?: unknown; pubkey?: unknown } | null | undefined;
    if (x?.kind !== INBOX_LIST_KIND || x.pubkey !== pubkey || !verifyEvent(e)) continue;
    if (!best || e.created_at > best.created_at || (e.created_at === best.created_at && e.id > best.id)) best = e;
  }
  if (!best) return null;
  const relays: string[] = [];
  for (const t of best.tags) {
    if (t[0] !== 'relay') continue;
    try { relays.push(normaliseRelay(t[1] as string)); } catch { /* skip bad entries */ }
  }
  return { relays: [...new Set(relays)].slice(0, MAX_RELAYS), listId: best.id, at: best.created_at };
}

/** Pick the relays a sender writes to: up to `copies`, avoiding ones the sender has seen fail. */
export function deliveryPlan(inbox: Pick<InboxList, 'relays'> | null | undefined, { copies = 3, failing = [] }: { copies?: number; failing?: string[] } = {}): string[] {
  if (!inbox?.relays?.length) return [];
  const bad = new Set(failing.map(normaliseRelay));
  const good = inbox.relays.filter(r => !bad.has(r));
  return [...good, ...inbox.relays.filter(r => bad.has(r))].slice(0, Math.max(2, copies));
}
