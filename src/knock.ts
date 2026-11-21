// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// First contact between strangers is a typed knock, not free text.
//
// A knock names a category from an open list, carries the structured fields that category
// defines, and at most a short plain note with no links, media or contact details. The category
// sets how much trust the sender needs. The recipient's gate (src/gate.js) decides what happens
// to it before any model reads it.

import { signEvent, verifyEvent } from './event.ts';
import { KIND } from './kinds.ts';

export const KNOCK_KIND = KIND.KNOCK;

import type { NostrEvent } from './event.ts';
import type { Tier } from './trust.ts';

export interface KnockCategory { minTier: Tier; fields: Record<string, number> }
export type KnockCategories = Readonly<Record<string, KnockCategory>>;
export interface KnockBody { category: string; fields?: Record<string, string>; note?: string }

const TIER_RANK: Record<Tier, number> = { A: 3, B: 2, C: 1, D: 0 };

/**
 * Default categories. `minTier` is the lowest sender tier whose knock is shown at all.
 * Owners can override any entry in their policy.
 */
export const DEFAULT_CATEGORIES: KnockCategories = Object.freeze({
  question: { minTier: 'C', fields: { topic: 64 } },
  hobby_partner: { minTier: 'C', fields: { activity: 64, area: 64 } },
  job_interest: { minTier: 'B', fields: { role: 64, region: 64, payBand: 32 } },
  purchase_interest: { minTier: 'B', fields: { item: 64, area: 64, priceBand: 32 } },
  service_offer: { minTier: 'B', fields: { service: 64, area: 64 } },
  meet_in_person: { minTier: 'A', fields: { purpose: 64, area: 64 } },
  childcare_or_tutoring: { minTier: 'A', fields: { service: 64, area: 64 } },
});

export const NOTE_MAX = 280;

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ly|me|app|xyz|ru|cn|info|biz|link|click|top|fr|de|at|uk)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RUN = /[+(]?\d[\d\s().-]{6,}\d/g;
function looksLikePhone(t: string): boolean {
  // 9+ digits that start like a phone number (+, 0 or a bracket) or come in 3+ groups.
  // "50000-60000" (a pay band) is not a phone number; "06 12 34 56 78" is.
  for (const m of t.match(PHONE_RUN) ?? []) {
    const digits = m.replace(/\D/g, '').length;
    const groups = m.split(/[\s().-]+/).filter(Boolean).length;
    if (digits >= 9 && (/^[+(0]/.test(m) || groups >= 3)) return true;
  }
  return false;
}
const HANDLE = /\b(on|via|over|sur|par)\s+(telegram|whatsapp|signal|wechat|snapchat|kik|instagram|discord|line)\b|(^|\s)@[a-z0-9_]{3,}/i;

/** Problems with a knock body, in plain words. Empty when the body is acceptable. */
export function lintKnockBody(input: unknown, categories: KnockCategories = DEFAULT_CATEGORIES): string[] {
  const problems: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['body must be an object'];
  const body = input as { category?: unknown; fields?: unknown; note?: unknown };
  const allowedKeys = new Set(['category', 'fields', 'note']);
  for (const k of Object.keys(body)) if (!allowedKeys.has(k)) problems.push(`unexpected field ${k}`);
  const cat = categories[body.category as string];
  if (!cat) return [...problems, `unknown category ${String(body.category)}`];
  const fields = (body.fields ?? {}) as Record<string, unknown>;
  if (typeof fields !== 'object' || Array.isArray(fields)) problems.push('fields must be an object');
  for (const [k, v] of Object.entries(fields)) {
    if (!(k in cat.fields)) problems.push(`field ${k} is not part of ${body.category}`);
    else if (typeof v !== 'string') problems.push(`field ${k} must be text`);
    else if (v.length > cat.fields[k]!) problems.push(`field ${k} is too long`);
  }
  const texts = [body.note ?? '', ...Object.values(fields).filter(v => typeof v === 'string')];
  if (body.note != null && typeof body.note !== 'string') problems.push('note must be text');
  if (typeof body.note === 'string' && body.note.length > NOTE_MAX) problems.push(`note longer than ${NOTE_MAX} characters`);
  for (const t of texts) {
    if (typeof t !== 'string') continue;
    if (LINK.test(t)) problems.push('contains a link');
    if (EMAIL.test(t)) problems.push('contains an email address');
    if (looksLikePhone(t)) problems.push('contains a phone number');
    if (HANDLE.test(t)) problems.push('asks to move to another app or handle');
  }
  return [...new Set(problems)];
}

export function createKnock(sk: string, { category, fields = {}, note = '' }: KnockBody,
  { recipient, createdAt, categories }: { recipient?: string | undefined; createdAt?: number | undefined; categories?: KnockCategories | undefined } = {}): NostrEvent {
  const body = { category, fields, note };
  const problems = lintKnockBody(body, categories);
  if (problems.length) throw new Error(`knock refused before sending: ${problems.join('; ')}`);
  const tags: string[][] = [['category', category]];
  if (recipient) tags.push(['p', recipient]);
  return signEvent({ kind: KNOCK_KIND, created_at: createdAt, tags, content: JSON.stringify(body) }, sk);
}

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

export function isKnock(e: unknown): e is NostrEvent {
  return verifyEvent(e) && e.kind === KNOCK_KIND;
}

