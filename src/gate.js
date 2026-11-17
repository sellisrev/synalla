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

import { verifyEvent, tagValue } from './event.js';
import { admissionTier, TIER_ACTION, DEFAULT_POLICY } from './trust.js';
import { KNOCK_KIND, DEFAULT_CATEGORIES, lintKnockBody, tierAtLeast } from './knock.js';

const DAY = 86400;

export const DEFAULT_GATE_POLICY = Object.freeze({
  ...DEFAULT_POLICY,
  maxEventBytes: 4096,
  perSenderPerDay: { A: 50, B: 3, C: 1, D: 0 },
  categories: DEFAULT_CATEGORIES,
});

export class Gate {
  /**
   * @param {{owner:string, contacts?:Iterable<string>, graph?:import('./vouch.js').VouchGraph,
   *          proofsFor?:(pubkey:string)=>object, policy?:object}} opts
   *   proofsFor returns proofs already verified by the home for a sender (none by default).
   */
  constructor({ owner, contacts = [], graph, proofsFor = () => ({}), policy = {} }) {
    this.owner = owner;
    this.contacts = new Set(contacts);
    this.graph = graph;
    this.proofsFor = proofsFor;
    this.policy = {
      ...DEFAULT_GATE_POLICY, ...policy,
      perSenderPerDay: { ...DEFAULT_GATE_POLICY.perSenderPerDay, ...(policy.perSenderPerDay ?? {}) },
      categories: { ...DEFAULT_GATE_POLICY.categories, ...(policy.categories ?? {}) },
    };
    this.seen = new Set();
    this.counts = new Map(); // `${day}|${sender}` -> n, and `${day}|tierC` -> n
    this.log = [];
  }

  /**
   * @param {object} e   an incoming event, already unsealed by the transport
   * @param {number} now seconds
   * @returns {{action:'inbox'|'knock_card'|'requests'|'drop', tier?:string, reasons:string[],
   *            card?:object, note?:string}}
   */
  receive(e, now = Math.floor(Date.now() / 1000)) {
    const decision = this.#decide(e, now);
    this.log.push({
      at: now, id: typeof e?.id === 'string' ? e.id : null, sender: typeof e?.pubkey === 'string' ? e.pubkey : null,
      action: decision.action, tier: decision.tier ?? null, reasons: decision.reasons,
      category: decision.card?.category ?? null,
    });
    return decision;
  }

  #decide(e, now) {
    const drop = (reasons, tier) => ({ action: 'drop', tier, reasons });
    let size;
    try { size = Buffer.byteLength(JSON.stringify(e)); } catch { return drop(['not serialisable']); }
    if (size > this.policy.maxEventBytes) return drop([`larger than ${this.policy.maxEventBytes} bytes`]);
    if (!verifyEvent(e)) return drop(['bad signature or format']);
    if (e.kind !== KNOCK_KIND) return drop([`kind ${e.kind} is not a knock`]);
    const to = tagValue(e, 'p');
    if (to && to !== this.owner) return drop(['addressed to someone else']);
    if (this.seen.has(e.id)) return drop(['duplicate']);
    this.seen.add(e.id);

    const t = admissionTier({
      owner: this.owner, contacts: this.contacts, graph: this.graph, sender: e.pubkey,
      proofs: this.proofsFor(e.pubkey) ?? {}, policy: this.policy,
    });
    if (t.tier === 'D') return drop(t.reasons, 'D');

    let body;
    try { body = JSON.parse(e.content); } catch { return drop(['content is not JSON'], t.tier); }
    const problems = lintKnockBody(body, this.policy.categories);
    if (problems.length) return drop(problems, t.tier);
    if (tagValue(e, 'category') !== body.category) return drop(['category tag does not match body'], t.tier);
    const cat = this.policy.categories[body.category];
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
}
