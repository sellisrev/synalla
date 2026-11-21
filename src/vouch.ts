// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Invites that become vouches, and the web of trust they build.
//
// Cold start: a new key has no history, so nobody can tell it from a spammer.
// Every invite therefore doubles as a signed vouch. Whoever invites someone vouches
// for them, and pays a price if that person is later removed (as in Lobsters' invite tree).
//
// Flow:
//   1. createInvite()      issuer keeps the invite event, shares the code (link, QR)
//   2. redeemInvite()      invitee signs a redemption that proves the code, bound to its key
//   3. acceptRedemption()  issuer's home checks it and signs a VOUCH for the invitee
// Only VOUCH and UNVOUCH events need to be shared with third parties.

import { signEvent, verifyEvent, tagValue, sha256Hex, randomHex, nowSeconds, getPublicKey } from './event.ts';
import type { NostrEvent } from './event.ts';
import { KIND } from './kinds.ts';

const DAY = 86400;

export interface VouchEdge { issuer: string; subject: string; at: number }
export interface Strike { count: number; suspensions: [number, number][] }
export interface InviteTreeNode { key: string; children: InviteTreeNode[] }
interface LatestEntry { type: 'vouch' | 'unvouch'; at: number; id: string }

export function createInvite(issuerSk: string, { scope = 'general', expiresAt, maxUses = 1, createdAt }: { scope?: string; expiresAt?: number | undefined; maxUses?: number; createdAt?: number | undefined } = {}): { code: string; invite: NostrEvent } {
  const code = randomHex(16);
  const created_at = createdAt ?? nowSeconds();
  const invite = signEvent({
    kind: KIND.INVITE,
    created_at,
    tags: [
      ['h', sha256Hex(code)],
      ['scope', scope],
      ['max_uses', String(maxUses)],
      ['expiration', String(expiresAt ?? created_at + 14 * DAY)],
    ],
    content: '',
  }, issuerSk);
  return { code, invite };
}

export function redemptionProof(code: string, inviteePubkey: string): string {
  return sha256Hex(`${code}:${inviteePubkey}`);
}

export function redeemInvite({ invite, code, inviteeSk, createdAt }: { invite: Pick<NostrEvent, 'id' | 'pubkey'>; code: string; inviteeSk: string; createdAt?: number | undefined }): NostrEvent {
  return signEvent({
    kind: KIND.REDEEM,
    created_at: createdAt,
    tags: [['e', invite.id], ['p', invite.pubkey], ['proof', redemptionProof(code, getPublicKey(inviteeSk))]],
    content: '',
  }, inviteeSk);
}

/** Issuer side. Checks a redemption against the issuer's own invite and code; returns a VOUCH signed by the issuer. */
export function acceptRedemption({ invite, code, redemption, issuerSk, usedCount = 0, now }:
  { invite: unknown; code: string; redemption: unknown; issuerSk: string; usedCount?: number; now?: number | undefined }): NostrEvent {
  const t = now ?? nowSeconds();
  if (!verifyEvent(invite) || invite.kind !== KIND.INVITE) throw new Error('invalid invite');
  if (!verifyEvent(redemption) || redemption.kind !== KIND.REDEEM) throw new Error('invalid redemption');
  if (sha256Hex(code) !== tagValue(invite, 'h')) throw new Error('code does not match invite');
  if (tagValue(redemption, 'e') !== invite.id) throw new Error('redemption is for another invite');
  if (tagValue(redemption, 'proof') !== redemptionProof(code, redemption.pubkey)) throw new Error('bad proof of code');
  if (t > Number(tagValue(invite, 'expiration'))) throw new Error('invite expired');
  if (usedCount >= Number(tagValue(invite, 'max_uses'))) throw new Error('invite already used');
  if (redemption.pubkey === invite.pubkey) throw new Error('cannot vouch for yourself');
  return createVouch(issuerSk, redemption.pubkey, { scope: tagValue(invite, 'scope'), via: invite.id, createdAt: t });
}

export function createVouch(issuerSk: string, subjectPubkey: string, { scope = 'general', via, createdAt }: { scope?: string | undefined; via?: string | undefined; createdAt?: number | undefined } = {}): NostrEvent {
  const tags: string[][] = [['p', subjectPubkey], ['scope', scope]];
  if (via) tags.push(['invite', via]);
  return signEvent({ kind: KIND.VOUCH, created_at: createdAt, tags, content: '' }, issuerSk);
}

export function createUnvouch(issuerSk: string, subjectPubkey: string, { reason = '', createdAt }: { reason?: string; createdAt?: number | undefined } = {}): NostrEvent {
  return signEvent({ kind: KIND.UNVOUCH, created_at: createdAt, tags: [['p', subjectPubkey]], content: reason }, issuerSk);
}

/**
 * The web of trust as one home sees it. Deterministic: same events in any order give the same graph.
 *
 * Accountability rules (defaults are deliberately strict):
 *  - When a member is removed, every key that vouched for them gets a strike, and cannot vouch
 *    for anyone new during `suspensionSeconds` after the removal.
 *  - A voucher with `maxStrikes` strikes or more loses all vouching weight: their whole branch
 *    no longer counts as vouched through them.
 */
export class VouchGraph {
  suspensionSeconds: number;
  maxStrikes: number;
  latest: Map<string, LatestEntry>;
  removed: Map<string, number>;
  rejected: (string | null)[];

  constructor({ suspensionSeconds = 90 * DAY, maxStrikes = 2 }: { suspensionSeconds?: number; maxStrikes?: number } = {}) {
    this.suspensionSeconds = suspensionSeconds;
    this.maxStrikes = maxStrikes;
    this.latest = new Map(); // "issuer>subject" -> {type:'vouch'|'unvouch', at, id}
    this.removed = new Map(); // pubkey -> removal time
    this.rejected = []; // events that failed verification
  }

  add(e: unknown): boolean {
    if (!verifyEvent(e) || (e.kind !== KIND.VOUCH && e.kind !== KIND.UNVOUCH)) {
      this.rejected.push((e as { id?: string } | null | undefined)?.id ?? null);
      return false;
    }
    const subject = tagValue(e, 'p');
    if (!subject || subject === e.pubkey) {
      this.rejected.push(e.id);
      return false;
    }
    const key = `${e.pubkey}>${subject}`;
    const entry: LatestEntry = { type: e.kind === KIND.VOUCH ? 'vouch' : 'unvouch', at: e.created_at, id: e.id };
    const prev = this.latest.get(key);
    // Latest wins; ties broken by event id so order of arrival never matters.
    if (!prev || entry.at > prev.at || (entry.at === prev.at && entry.id > prev.id)) this.latest.set(key, entry);
    return true;
  }

  addAll(events: Iterable<unknown>): this {
    for (const e of events) this.add(e);
    return this;
  }

  /** Remove a member (decided by the community's registry or by the owner's own policy). */
  removeMember(pubkey: string, at: number): void {
    const prev = this.removed.get(pubkey);
    if (prev === undefined || at < prev) this.removed.set(pubkey, at);
  }

  /** Vouch edges in force: [{issuer, subject, at}] */
  edges(): VouchEdge[] {
    const out: VouchEdge[] = [];
    for (const [key, v] of this.latest) {
      if (v.type !== 'vouch') continue;
      const [issuer = '', subject = ''] = key.split('>');
      out.push({ issuer, subject, at: v.at });
    }
    return out.sort((a, b) => (a.issuer + a.subject < b.issuer + b.subject ? -1 : 1));
  }

  /** Strikes per voucher, and the suspension windows that come with them. */
  strikes(): Map<string, Strike> {
    const s = new Map<string, Strike>(); // issuer -> {count, suspendedUntil}
    for (const { issuer, subject, at } of this.edges()) {
      const removedAt = this.removed.get(subject);
      if (removedAt === undefined || at > removedAt) continue; // vouched after removal: not a strike, and ignored below
      const cur: Strike = s.get(issuer) ?? { count: 0, suspensions: [] };
      cur.count += 1;
      cur.suspensions.push([removedAt, removedAt + this.suspensionSeconds]);
      s.set(issuer, cur);
    }
    return s;
  }

  /** Edges that carry trust after applying removals, strikes and suspensions. */
  activeEdges(): VouchEdge[] {
    const strikes = this.strikes();
    return this.edges().filter(({ issuer, subject, at }) => {
      if (this.removed.has(issuer) || this.removed.has(subject)) return false;
      const st = strikes.get(issuer);
      if (!st) return true;
      if (st.count >= this.maxStrikes) return false;
      return !st.suspensions.some(([from, to]) => at >= from && at < to);
    });
  }

  /**
   * Fewest vouch hops from any key in `roots` to `target` (0 if target is a root).
   * Returns Infinity when unreachable within maxHops.
   */
  hops(roots: Iterable<string>, target: string, maxHops = 3): number {
    if (this.removed.has(target)) return Infinity;
    const start = [...roots].filter(r => !this.removed.has(r));
    if (start.includes(target)) return 0;
    const adj = this.adjacency();
    const seen = new Set(start);
    let frontier = start;
    for (let d = 1; d <= maxHops; d++) {
      const next: string[] = [];
      for (const k of frontier) {
        for (const s of adj.get(k) ?? []) {
          if (seen.has(s)) continue;
          if (s === target) return d;
          seen.add(s);
          next.push(s);
        }
      }
      frontier = next;
    }
    return Infinity;
  }

  /** Who vouched for whom, as a forest from the given roots (for display or audit). */
  inviteTree(roots: Iterable<string>): InviteTreeNode[] {
    const adj = this.adjacency();
    const seen = new Set<string>();
    const build = (k: string): InviteTreeNode => {
      seen.add(k);
      return { key: k, children: (adj.get(k) ?? []).filter(c => !seen.has(c)).map(build) };
    };
    return [...roots].map(build);
  }

  /** issuer -> subjects, over the active edges, in edge order. */
  private adjacency(): Map<string, string[]> {
    const adj = new Map<string, string[]>();
    for (const { issuer, subject } of this.activeEdges()) {
      const list = adj.get(issuer);
      if (list) list.push(subject); else adj.set(issuer, [subject]);
    }
    return adj;
  }
}
