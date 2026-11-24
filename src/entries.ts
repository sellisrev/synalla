// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Circle entries and structured asks (pilot plan W4), the `circle/1` shapes of kinds 8443 and 8446.
//
// An entry is something the owner can help with, introduce, lend, recommend or offer. Its text is written or approved
// by the owner when it joins the shareable list, never generated at send time. An ask is structured: a type, a topic
// and tags from the published vocabulary, no free text, so it carries nothing from the asker's memory.
// An answer is one entry from the shareable list, sent unchanged: the outgoing check refuses any answer whose content
// is not byte-for-byte a stored entry, or whose tags are not exactly the answer template (the `e` tag naming the ask).
// Entries, asks and answers travel as unsigned rumors inside a seal (the seal tells only the recipient who sent them).

import { makeRumor } from './seal.ts';
import { KIND } from './kinds.ts';
import type { Rumor } from './seal.ts';

export const CIRCLE_V = 'circle/1';
export const ENTRY_TYPES = ['help', 'intro', 'lend', 'recommend', 'offer'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const LIMITS = Object.freeze({ topic: 64, tag: 32, tags: 8, text: 500, id: 64 });

export interface Entry { v: typeof CIRCLE_V; id: string; type: EntryType; topic: string; tags: string[]; text: string; expires: number }
export interface Ask { v: typeof CIRCLE_V; type: EntryType; topic: string; tags: string[]; at: number }

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isSlug = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max && SLUG.test(s);
const isTime = (t: unknown): t is number => Number.isSafeInteger(t) && (t as number) > 0;

function tagProblems(tags: unknown): string[] {
  if (!Array.isArray(tags)) return ['tags must be a list'];
  const out: string[] = [];
  if (tags.length > LIMITS.tags) out.push(`at most ${LIMITS.tags} tags`);
  if (tags.some(t => !isSlug(t, LIMITS.tag))) out.push(`tags must be lowercase words joined by dashes, at most ${LIMITS.tag} characters`);
  if (new Set(tags).size !== tags.length) out.push('tags must not repeat');
  return out;
}

/** What is wrong with an entry (empty when it is valid). `now` in seconds. */
export function entryProblems(e: unknown, now: number): string[] {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['entry must be an object'];
  const x = e as Record<string, unknown>;
  const out: string[] = [];
  const keys = Object.keys(x).sort().join(',');
  if (keys !== 'expires,id,tags,text,topic,type,v') out.push('entry has exactly v, id, type, topic, tags, text, expires');
  if (x['v'] !== CIRCLE_V) out.push(`v must be ${CIRCLE_V}`);
  if (!isSlug(x['id'], LIMITS.id)) out.push('id must be a short slug');
  if (!(ENTRY_TYPES as readonly unknown[]).includes(x['type'])) out.push(`type must be one of ${ENTRY_TYPES.join(', ')}`);
  if (!isSlug(x['topic'], LIMITS.topic)) out.push('topic must be a vocabulary slug');
  out.push(...tagProblems(x['tags']));
  if (typeof x['text'] !== 'string' || !x['text'].trim() || x['text'].length > LIMITS.text) out.push(`text must be 1 to ${LIMITS.text} characters`);
  if (!isTime(x['expires'])) out.push('expires must be a time in seconds');
  else if ((x['expires'] as number) <= now) out.push('entry has expired');
  return out;
}

/** What is wrong with an ask (empty when it is valid). */
export function askProblems(a: unknown): string[] {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['ask must be an object'];
  const x = a as Record<string, unknown>;
  const out: string[] = [];
  if (Object.keys(x).sort().join(',') !== 'at,tags,topic,type,v') out.push('ask has exactly v, type, topic, tags, at (no free text)');
  if (x['v'] !== CIRCLE_V) out.push(`v must be ${CIRCLE_V}`);
  if (!(ENTRY_TYPES as readonly unknown[]).includes(x['type'])) out.push(`type must be one of ${ENTRY_TYPES.join(', ')}`);
  if (!isSlug(x['topic'], LIMITS.topic)) out.push('topic must be a vocabulary slug');
  out.push(...tagProblems(x['tags']));
  if (!isTime(x['at'])) out.push('at must be a time in seconds');
  return out;
}

/** The canonical text of an entry: keys in a fixed order, so the same entry is always the same bytes. */
export function entryText(e: Entry): string {
  return JSON.stringify({ v: e.v, id: e.id, type: e.type, topic: e.topic, tags: e.tags, text: e.text, expires: e.expires });
}

/** An ask as an unsigned rumor (kind 8446), to be sealed and wrapped per recipient. */
export function askRumor(a: Ask, senderPubkey: string): Rumor {
  const p = askProblems(a);
  if (p.length) throw new TypeError(`ask refused: ${p.join('; ')}`);
  return makeRumor({ kind: KIND.REQUEST, created_at: a.at, tags: [], content: JSON.stringify({ v: a.v, type: a.type, topic: a.topic, tags: a.tags, at: a.at }) }, senderPubkey);
}

/** An answer to an ask: one stored entry, unchanged, as an unsigned rumor (kind 8443) naming the ask. */
export function answerRumor(askId: string, e: Entry, senderPubkey: string, now: number): Rumor {
  if (!/^[0-9a-f]{64}$/.test(askId)) throw new TypeError('ask id must be 64 hex characters');
  const p = entryProblems(e, now);
  if (p.length) throw new TypeError(`entry refused: ${p.join('; ')}`);
  return makeRumor({ kind: KIND.OFFER, created_at: now, tags: [['e', askId]], content: entryText(e) }, senderPubkey);
}

/**
 * The outgoing check for answers: true only if the rumor is kind 8443, its tags are exactly [['e', askId]], and its
 * content is byte-for-byte the canonical text of one of the owner's stored entries.
 */
export function answerAllowed(r: Pick<Rumor, 'kind' | 'tags' | 'content'>, askId: string, stored: readonly Entry[]): boolean {
  if (r.kind !== KIND.OFFER) return false;
  if (!Array.isArray(r.tags) || r.tags.length !== 1) return false;
  const t = r.tags[0];
  if (!Array.isArray(t) || t.length !== 2 || t[0] !== 'e' || t[1] !== askId) return false;
  return stored.some(e => entryText(e) === r.content);
}

/** Read a received entry: the parsed entry if valid now, else null. */
export function readEntry(content: unknown, now: number): Entry | null {
  if (typeof content !== 'string') return null;
  let x: unknown;
  try { x = JSON.parse(content); } catch { return null; }
  return entryProblems(x, now).length === 0 ? (x as Entry) : null;
}

/** Read a received ask: the parsed ask if valid, else null. */
export function readAsk(content: unknown): Ask | null {
  if (typeof content !== 'string') return null;
  let x: unknown;
  try { x = JSON.parse(content); } catch { return null; }
  return askProblems(x).length === 0 ? (x as Ask) : null;
}

/**
 * The owner's entries that could answer an ask, best first: same type and topic required; more shared tags first;
 * ties by id. Expired entries are left out. The host agent may then rank them; the owner picks.
 */
export function candidates(a: Ask, entries: readonly Entry[], now: number): Entry[] {
  const want = new Set(a.tags);
  return entries
    .filter(e => e.type === a.type && e.topic === a.topic && e.expires > now)
    .map(e => ({ e, shared: e.tags.filter(t => want.has(t)).length }))
    .sort((x, y) => y.shared - x.shared || (x.e.id < y.e.id ? -1 : x.e.id > y.e.id ? 1 : 0))
    .map(x => x.e);
}
