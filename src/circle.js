// A convener's kit: invite links for a circle, and progress cards people can post.
//
// A link carries everything the invitee's agent needs to redeem: the invite id, the convener's
// key, the one-time code, the scope and the expiry. They sit in the URL fragment (after #),
// which browsers never send to a server, so whatever page hosts the link never sees the code.

import { createInvite } from './vouch.js';
import { tagValue } from './event.js';

const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = s => Buffer.from(s, 'base64url').toString('utf8');
const HEX64 = /^[0-9a-f]{64}$/;

export const DEFAULT_LINK_BASE = 'synallagma://join';

export function inviteLink(invite, code, { base = DEFAULT_LINK_BASE } = {}) {
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

/** @returns {{invite:{id:string,pubkey:string}, code:string, scope:string, expiresAt:number}} */
export function parseInviteLink(link) {
  const hash = String(link).split('#')[1];
  if (!hash) throw new Error('link has no invite');
  let p;
  try { p = JSON.parse(unb64url(hash)); } catch { throw new Error('invite is unreadable'); }
  if (p.v !== 1) throw new Error('unknown invite version');
  if (!HEX64.test(p.i) || !HEX64.test(p.p)) throw new Error('invite ids are malformed');
  if (typeof p.c !== 'string' || !/^[0-9a-f]{32}$/.test(p.c)) throw new Error('invite code is malformed');
  return { invite: { id: p.i, pubkey: p.p }, code: p.c, scope: String(p.s ?? ''), expiresAt: Number(p.x) };
}

/**
 * Create a batch of single-use invites for one circle. The convener's home keeps the result
 * (it holds the codes) and hands out only the links.
 */
export function createCircle(convenerSk, { scope, size = 10, expiresAt, createdAt, base } = {}) {
  if (!scope) throw new TypeError('scope required (usually the question id)');
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new RangeError('size must be 1..500');
  return Array.from({ length: size }, () => {
    const { code, invite } = createInvite(convenerSk, { scope, expiresAt, createdAt, maxUses: 1 });
    return { code, invite, link: inviteLink(invite, code, { base }) };
  });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A 1200x627 SVG card (the size LinkedIn previews use) from a progress card.
 * It shows the group and its progress only: never who shares it or whether they took part.
 */
export function progressCardSvg(card, { title = 'Where does your pay stand?', footer = 'Nobody sees your number. Results unlock at ' } = {}) {
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
