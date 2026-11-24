// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// The home's gate: what happens to an incoming knock, decided by code before any model sees it.
//
// Order of checks (first failure wins):
//   1. well formed and signed, a knock, not seen before, not too large
//   2. sender tier (src/trust.js); removed senders are dropped
//   3. body: known category, only its fields, short note, no links, contacts or handles
//   4. category needs a higher tier than the sender has -> dropped
//   5. rate limits: per sender per day, and a shared daily cap for tier C
// The result is a fixed-form card. The free-text note is returned separately, so that only
// a quarantined reader (no tools, no memory writes) or the owner ever reads it.
// Every decision is appended to the log the owner can read.

import { verifyEvent, tagValue } from './event.ts';
import { admissionTier, TIER_ACTION, DEFAULT_POLICY } from './trust.ts';
import { KNOCK_KIND, DEFAULT_CATEGORIES, lintKnockBody, tierAtLeast } from './knock.ts';
import type { KnockCategories } from './knock.ts';
import type { Proofs, Tier, TrustPolicy } from './trust.ts';
import type { VouchGraph } from './vouch.ts';

const DAY = 86400;

export interface GatePolicy extends TrustPolicy {
  maxEventBytes: number;
  /** Knocks older than this (seconds) are refused, so seen ids older than it can be forgotten (pilot plan W3). */
  maxAgeSeconds: number;
  /** Knocks dated further ahead than this (seconds) are refused. */
  maxFutureSeconds: number;
  perSenderPerDay: Record<Tier, number>;
  categories: KnockCategories;
}
export type GatePolicyInput = Partial<Omit<GatePolicy, 'perSenderPerDay'>> & { perSenderPerDay?: Partial<Record<Tier, number>> };

export interface KnockCard {
  id: string; sender: string; tier: Tier; why: string[]; category: string;
  fields: Record<string, string>; hasNote: boolean; at: number;
}
export interface GateDecision {
  action: string;
  tier: Tier | undefined;
  reasons: string[];
  card?: KnockCard;
  note?: string;
}
export interface GateLogEntry {
  at: number; id: string | null; sender: string | null; action: string; tier: Tier | null; reasons: string[]; category: string | null;
}

export const DEFAULT_GATE_POLICY: Readonly<GatePolicy> = Object.freeze({
  ...DEFAULT_POLICY,
  maxEventBytes: 4096,
  maxAgeSeconds: 10 * DAY, // the homes' replay window (pilot plan W3)
  maxFutureSeconds: 300,
  perSenderPerDay: { A: 50, B: 3, C: 1, D: 0 },
  categories: DEFAULT_CATEGORIES,
});

/** What a gate keeps across restarts: seen knock ids with their date, and today's counters. */
export interface GateSnapshot { version: 1; seen: [string, number][]; counts: [string, number][] }

export class Gate {
  owner: string;
  contacts: Set<string>;
  graph: Pick<VouchGraph, 'hops' | 'removed'> | null | undefined;
  proofsFor: (pubkey: string) => Proofs | null | undefined;
  policy: GatePolicy;
  /** Seen knock ids and their created_at; ids older than the age window are forgotten. */
  seen: Map<string, number>;
  counts: Map<string, number>;
  #prunedDay = -1;
  log: GateLogEntry[];

  /** proofsFor returns proofs already verified by the home for a sender (none by default). */
  constructor({ owner, contacts = [], graph, proofsFor = () => ({}), policy = {} }: {
    owner: string; contacts?: Iterable<string>; graph?: Pick<VouchGraph, 'hops' | 'removed'> | null | undefined;
    proofsFor?: (pubkey: string) => Proofs | null | undefined; policy?: GatePolicyInput;
  }) {
    this.owner = owner;
    this.contacts = new Set(contacts);
    this.graph = graph;
    this.proofsFor = proofsFor;
    this.policy = {
      ...DEFAULT_GATE_POLICY, ...policy,
      perSenderPerDay: { ...DEFAULT_GATE_POLICY.perSenderPerDay, ...(policy.perSenderPerDay ?? {}) },
      categories: { ...DEFAULT_GATE_POLICY.categories, ...(policy.categories ?? {}) },
    };
    this.seen = new Map();
    this.counts = new Map(); // `${day}|${sender}` -> n, and `${day}|tierC` -> n
    this.log = [];
  }

  /** e: an incoming event, already unsealed by the transport; now: seconds. */
  receive(e: unknown, now: number = Math.floor(Date.now() / 1000)): GateDecision {
    const decision = this.#decide(e, now);
    const ev = e as { id?: unknown; pubkey?: unknown } | null | undefined;
    this.log.push({
      at: now, id: typeof ev?.id === 'string' ? ev.id : null, sender: typeof ev?.pubkey === 'string' ? ev.pubkey : null,
      action: decision.action, tier: decision.tier ?? null, reasons: decision.reasons,
      category: decision.card?.category ?? null,
    });
    return decision;
  }

  #decide(e: unknown, now: number): GateDecision {
    const drop = (reasons: string[], tier?: Tier): GateDecision => ({ action: 'drop', tier, reasons });
    let size: number;
    try { size = Buffer.byteLength(JSON.stringify(e)); } catch { return drop(['not serialisable']); }
    if (size > this.policy.maxEventBytes) return drop([`larger than ${this.policy.maxEventBytes} bytes`]);
    if (!verifyEvent(e)) return drop(['bad signature or format']);
    if (e.kind !== KNOCK_KIND) return drop([`kind ${e.kind} is not a knock`]);
    const to = tagValue(e, 'p');
    if (to && to !== this.owner) return drop(['addressed to someone else']);
    if (e.created_at < now - this.policy.maxAgeSeconds) return drop(['too old']);
    if (e.created_at > now + this.policy.maxFutureSeconds) return drop(['dated in the future']);
    this.#prune(now);
    if (this.seen.has(e.id)) return drop(['duplicate']);
    this.seen.set(e.id, e.created_at);

    const t = admissionTier({
      owner: this.owner, contacts: this.contacts, graph: this.graph, sender: e.pubkey,
      proofs: this.proofsFor(e.pubkey) ?? {}, policy: this.policy,
    });
    if (t.tier === 'D') return drop(t.reasons, 'D');

    let body: { category: string; fields?: Record<string, string>; note?: string };
    try { body = JSON.parse(e.content); } catch { return drop(['content is not JSON'], t.tier); }
    const problems = lintKnockBody(body, this.policy.categories);
    if (problems.length) return drop(problems, t.tier);
    if (tagValue(e, 'category') !== body.category) return drop(['category tag does not match body'], t.tier);
    const cat = this.policy.categories[body.category]!; // lintKnockBody refused unknown categories
    if (!tierAtLeast(t.tier, cat.minTier)) {
      return drop([`${body.category} needs tier ${cat.minTier}; sender is tier ${t.tier}`], t.tier);
    }

    const day = Math.floor(now / DAY);
    const senderKey = `${day}|${e.pubkey}`;
    const used = this.counts.get(senderKey) ?? 0;
    if (used >= this.policy.perSenderPerDay[t.tier]) return drop(['sender reached its daily limit'], t.tier);
    if (t.tier === 'C') {
      const cKey = `${day}|tierC`;
      const cUsed = this.counts.get(cKey) ?? 0;
      if (cUsed >= this.policy.dailyCapC) return drop(['daily cap for unvouched senders reached'], t.tier);
      this.counts.set(cKey, cUsed + 1);
    }
    this.counts.set(senderKey, used + 1);

    return {
      action: TIER_ACTION[t.tier],
      tier: t.tier,
      reasons: t.reasons,
      card: {
        id: e.id, sender: e.pubkey, tier: t.tier, why: t.reasons, category: body.category,
        fields: { ...(body.fields ?? {}) }, hasNote: Boolean(body.note), at: e.created_at,
      },
      note: body.note ?? '',
    };
  }

  /** Once a day: forget ids too old to be accepted again, and counters from before yesterday (a clock that steps back a
   *  day must not reset a sender's limit). */
  #prune(now: number): void {
    const day = Math.floor(now / DAY);
    if (day === this.#prunedDay) return;
    this.#prunedDay = day;
    for (const [id, at] of this.seen) if (at < now - this.policy.maxAgeSeconds) this.seen.delete(id);
    for (const k of this.counts.keys()) if (Number(k.slice(0, k.indexOf('|'))) < day - 1) this.counts.delete(k);
  }

  snapshot(): GateSnapshot {
    return { version: 1, seen: [...this.seen], counts: [...this.counts] };
  }

  /** Load a snapshot taken by snapshot(); refuses anything else. */
  restore(s: unknown): void {
    const x = s as Partial<GateSnapshot> | null;
    const pairs = (v: unknown, key: (k: unknown) => boolean) => Array.isArray(v)
      && v.every(e => Array.isArray(e) && e.length === 2 && key(e[0]) && Number.isSafeInteger(e[1]));
    if (!x || x.version !== 1 || !pairs(x.seen, k => typeof k === 'string') || !pairs(x.counts, k => typeof k === 'string' && /^\d+\|/.test(k as string))) {
      throw new TypeError('not a gate snapshot');
    }
    this.seen = new Map(x.seen);
    this.counts = new Map(x.counts);
    this.#prunedDay = -1;
  }
}
