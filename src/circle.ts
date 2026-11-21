// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// A convener's kit: invite links for a circle, and progress cards people can post.
//
// A link carries everything the invitee's agent needs to redeem: the invite id, the convener's
// key, the one-time code, the scope and the expiry. They sit in the URL fragment (after #),
// which browsers never send to a server, so whatever page hosts the link never sees the code.

import { createInvite } from './vouch.ts';
import { tagValue } from './event.ts';
import type { NostrEvent } from './event.ts';

/** What progressCardSvg reads from a progress card (pool.ts progressCard). */
export interface CardFigures { label: string; count: number; k: number; unlocked: boolean; needed: number }
export interface ParsedInvite { invite: { id: string; pubkey: string }; code: string; scope: string; expiresAt: number }
export interface CircleInvite { code: string; invite: NostrEvent; link: string }

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');
const HEX64 = /^[0-9a-f]{64}$/;

export const DEFAULT_LINK_BASE = 'synalla://join';

export function inviteLink(invite: Pick<NostrEvent, 'id' | 'pubkey' | 'tags'>, code: string, { base = DEFAULT_LINK_BASE }: { base?: string | undefined } = {}): string {
  const payload = {
    v: 1,
    i: invite.id,
    p: invite.pubkey,
    c: code,
    s: tagValue(invite, 'scope'),
    x: Number(tagValue(invite, 'expiration')),
  };
  return `${base}#${b64url(JSON.stringify(payload))}`;
}

export function parseInviteLink(link: unknown): ParsedInvite {
  const hash = String(link).split('#')[1];
  if (!hash) throw new Error('link has no invite');
  let p: { v?: unknown; i?: string; p?: string; c?: unknown; s?: unknown; x?: unknown };
  try { p = JSON.parse(unb64url(hash)); } catch { throw new Error('invite is unreadable'); }
  if (p.v !== 1) throw new Error('unknown invite version');
  if (!HEX64.test(String(p.i)) || !HEX64.test(String(p.p))) throw new Error('invite ids are malformed');
  if (typeof p.c !== 'string' || !/^[0-9a-f]{32}$/.test(p.c)) throw new Error('invite code is malformed');
  return { invite: { id: p.i as string, pubkey: p.p as string }, code: p.c, scope: String(p.s ?? ''), expiresAt: Number(p.x) };
}

/**
 * Create a batch of single-use invites for one circle. The convener's home keeps the result
 * (it holds the codes) and hands out only the links.
 */
export function createCircle(convenerSk: string, { scope, size = 10, expiresAt, createdAt, base }:
  { scope?: string; size?: number; expiresAt?: number | undefined; createdAt?: number | undefined; base?: string | undefined } = {}): CircleInvite[] {
  if (!scope) throw new TypeError('scope required (usually the question id)');
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new RangeError('size must be 1..500');
  return Array.from({ length: size }, () => {
    const { code, invite } = createInvite(convenerSk, { scope, expiresAt, createdAt, maxUses: 1 });
    return { code, invite, link: inviteLink(invite, code, { base }) };
  });
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ESC[c]!);

/**
 * A 1200x627 SVG card (the size LinkedIn previews use) from a progress card.
 * It shows the group and its progress only: never who shares it or whether they took part.
 */
export function progressCardSvg(card: CardFigures, { title = 'Where does your pay stand?', footer = 'Nobody sees your number. Results unlock at ' }: { title?: string; footer?: string } = {}): string {
  const pct = Math.min(1, card.count / card.k);
  const barW = 960;
  const status = card.unlocked ? 'Unlocked' : `${card.needed} more to unlock`;
  // shrink long labels to fit the 960 px text column (bold sans is about 0.6 em per character)
  const labelSize = Math.max(28, Math.min(58, Math.floor(barW / (0.6 * Math.max(1, [...card.label].length)))));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627" role="img" aria-label="${esc(`${card.label}: ${card.count} of ${card.k}. ${status}`)}">
  <rect width="1200" height="627" fill="#f7f5f0"/>
  <text x="120" y="150" font-family="Georgia, serif" font-size="44" fill="#1f2a37">${esc(title)}</text>
  <text x="120" y="250" font-family="Helvetica, Arial, sans-serif" font-size="${labelSize}" font-weight="700" fill="#1f2a37">${esc(card.label)}</text>
  <rect x="120" y="320" width="${barW}" height="40" rx="20" fill="#e3ded3"/>
  <rect x="120" y="320" width="${Math.round(barW * pct)}" height="40" rx="20" fill="#2f6f5e"/>
  <text x="120" y="430" font-family="Helvetica, Arial, sans-serif" font-size="48" fill="#1f2a37">${esc(`${card.count} of ${card.k}`)}</text>
  <text x="1080" y="430" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="#2f6f5e">${esc(status)}</text>
  <text x="120" y="540" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#5b6470">${esc(`${footer}${card.k} people.`)}</text>
</svg>
`;
}
