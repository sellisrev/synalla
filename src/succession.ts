// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Recovery by social attestation (pilot plan W2, decision 3, 24 Nov 2026), as a pure state machine.
//
// A member who loses every device makes a new key and publishes a successor CLAIM naming the old key. People who know
// them check over a channel they recorded earlier and publish ATTESTATIONS. The old key can publish a DENIAL. Each peer
// decides for itself from the statements it holds and its own contact list; there is no global order and no server.
//
// This module is the executable form of the rule. Signatures, wire format and storage are checked elsewhere: inputs
// here are statements already verified to be signed by the key they name (claim by `next`, attestation by `attester`,
// denial by `old`), each with the time this peer first saw it (`seenAt`, local clock, seconds).
//
// Rule, for one old key at one peer:
//   - An attestation COUNTS if its attester is one of the peer's direct contacts (hop 0: added or vouched for by the
//     peer's owner), that relationship was first seen at least 14 days before the claim was first seen, the channel is
//     phone, signal or in_person, and the attester is neither the old nor the new key. One count per attester.
//   - A claim nobody counted for leaves the old key trusted; the owner only sees a warning ("claimed"). So a forged
//     claim costs a warning, never a lock-out.
//   - 1 counting attester: SUSPENDED (old key no longer trusted, new key not yet).
//   - 2 counting attesters: ACCEPTED, unless there is a conflict: a denial of that claim by the old key, or a rival
//     claim for the same old key that also has 2 counting attesters. Then DISPUTED.
//   - A claim is SETTLED by 3 counting attesters whose attestations each cite a conflict this peer holds (they checked
//     knowing about it). A settled claim is accepted despite conflicts; two settled rivals stay disputed.
//   - The peer's own owner may confirm a claim directly (their own channel check): that claim is accepted. Two owner
//     confirmations for rival claims: disputed.
//   - A denial of a claim with 1 counting attester makes it disputed (the owner is asked to call).
//   - Acceptance takes effect (tier transfer, DID remap, vouch-move prompt) only 72 hours after it happened, by this
//     peer's clock. A denial at any time still makes the claim disputed unless it is settled.
// The result depends only on the set of statements and their seenAt times, never on the order they are passed in.

const DAY = 86400;
export const CONTACT_MIN_AGE = 14 * DAY;
export const HOLD = 72 * 3600;
export const ACCEPT_AT = 2;
export const SETTLE_AT = 3;
export const CHANNELS = ['phone', 'signal', 'in_person'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Claim { type: 'claim'; id: string; old: string; next: string; seenAt: number }
export interface Attestation {
  type: 'attest'; id: string; claim: string; attester: string; channel: string; seenAt: number;
  /** Ids of conflicting statements (denials, rival claims) the attester knew of when checking. */
  cites?: readonly string[];
}
export interface Denial { type: 'deny'; id: string; claim: string; old: string; seenAt: number }
export type Statement = Claim | Attestation | Denial;

export interface PeerView {
  /** Direct contacts of this peer's owner (hop 0), with the time each relationship was first seen locally. */
  contacts: ReadonlyMap<string, number>;
  /** Claim ids this peer's owner confirmed by their own channel check, with the confirmation time. */
  confirmed?: ReadonlyMap<string, number>;
  now: number;
}

export type SuccessionState = 'normal' | 'claimed' | 'suspended' | 'accepted' | 'disputed';

export interface ClaimStatus { id: string; next: string; counting: string[]; fresh: string[]; denied: boolean; settled: boolean }

export interface Succession {
  old: string;
  state: SuccessionState;
  /** May this peer still send shareable lists and answers to the old key? */
  oldKeyTrusted: boolean;
  successor?: string;
  claim?: string;
  acceptedAt?: number;
  effectiveAt?: number;
  /** Accepted and the 72-hour hold has passed: side effects may run. */
  effective: boolean;
  claims: ClaimStatus[];
}

function isChannel(c: string): c is Channel { return (CHANNELS as readonly string[]).includes(c); }

/** k-th smallest (1-based) of a list, or undefined. */
function kth(values: number[], k: number): number | undefined {
  return [...values].sort((a, b) => a - b)[k - 1];
}

function check(st: Statement): void {
  if (st === null || typeof st !== 'object') throw new TypeError('statement must be an object');
  if (typeof st.id !== 'string' || st.id === '') throw new TypeError('statement id must be a non-empty string');
  if (!Number.isFinite(st.seenAt)) throw new TypeError('seenAt must be a finite number');
}

/** The succession state of one old key at one peer. */
export function succession(old: string, statements: readonly Statement[], peer: PeerView): Succession {
  if (typeof old !== 'string' || old === '') throw new TypeError('old must be a non-empty string');
  if (!peer || !(peer.contacts instanceof Map) || !Number.isFinite(peer.now)) throw new TypeError('bad peer view');
  for (const st of statements) check(st);

  // Claims for this old key, one per id; the earliest sighting wins if an id repeats.
  const claims = new Map<string, Claim>();
  for (const st of statements) {
    if (st.type !== 'claim' || st.old !== old || st.next === old) continue;
    const prev = claims.get(st.id);
    if (!prev || st.seenAt < prev.seenAt) claims.set(st.id, st);
  }
  const denials = statements.filter((s): s is Denial => s.type === 'deny' && s.old === old && claims.has(s.claim));
  const deniedClaims = new Set(denials.map(d => d.claim));

  // Counting attesters per claim: one record per attester, with the earliest sighting of any of its attestations for
  // that claim and the union of what they cite.
  interface Counted { attester: string; seenAt: number; cites: Set<string> }
  const counting = new Map<string, Map<string, Counted>>();
  for (const c of claims.values()) counting.set(c.id, new Map());
  for (const st of statements) {
    if (st.type !== 'attest') continue;
    const c = claims.get(st.claim);
    if (!c || st.attester === c.old || st.attester === c.next || !isChannel(st.channel)) continue;
    const since = peer.contacts.get(st.attester);
    if (since === undefined || since > c.seenAt - CONTACT_MIN_AGE) continue;
    const m = counting.get(c.id) as Map<string, Counted>;
    const prev = m.get(st.attester) ?? { attester: st.attester, seenAt: Infinity, cites: new Set<string>() };
    for (const x of st.cites ?? []) prev.cites.add(x);
    prev.seenAt = Math.min(prev.seenAt, st.seenAt);
    m.set(st.attester, prev);
  }
  const count = (id: string) => (counting.get(id) as Map<string, Counted>).size;

  // Conflicts of a claim: denials of it, and rival claims that reached the acceptance threshold.
  const conflictIds = (c: Claim): Set<string> => {
    const ids = new Set(denials.filter(d => d.claim === c.id).map(d => d.id));
    for (const r of claims.values()) if (r.id !== c.id && count(r.id) >= ACCEPT_AT) ids.add(r.id);
    return ids;
  };

  const statuses: ClaimStatus[] = [];
  const freshTimes = new Map<string, number[]>();
  for (const c of [...claims.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const conflicts = conflictIds(c);
    const atts = [...(counting.get(c.id) as Map<string, Counted>).values()];
    const fresh = atts.filter(a => [...a.cites].some(x => conflicts.has(x)));
    freshTimes.set(c.id, fresh.map(a => a.seenAt));
    statuses.push({
      id: c.id, next: c.next,
      counting: atts.map(a => a.attester).sort(),
      fresh: fresh.map(a => a.attester).sort(),
      denied: deniedClaims.has(c.id),
      settled: fresh.length >= SETTLE_AT,
    });
  }
  const byId = new Map(statuses.map(s => [s.id, s]));
  const base = { old, claims: statuses, effective: false };

  const accept = (c: Claim, at: number): Succession => {
    const effectiveAt = at + HOLD;
    return { ...base, state: 'accepted', oldKeyTrusted: false, successor: c.next, claim: c.id, acceptedAt: at, effectiveAt, effective: peer.now >= effectiveAt };
  };
  const disputed = (): Succession => ({ ...base, state: 'disputed', oldKeyTrusted: false });

  // 1. The peer's own owner confirmed.
  const confirmed = [...(peer.confirmed ?? new Map<string, number>()).entries()].filter(([id]) => claims.has(id));
  if (confirmed.length === 1) {
    const [id, at] = confirmed[0] as [string, number];
    return accept(claims.get(id) as Claim, at);
  }
  if (confirmed.length > 1) return disputed();

  // 2. Claims at the acceptance threshold.
  const candidates = [...claims.values()].filter(c => count(c.id) >= ACCEPT_AT);
  if (candidates.length > 0) {
    const settled = candidates.filter(c => (byId.get(c.id) as ClaimStatus).settled);
    if (settled.length > 1) return disputed();
    if (settled.length === 1) {
      const c = settled[0] as Claim;
      const conflictTimes = [...conflictIds(c)].map(id => denials.find(d => d.id === id)?.seenAt ?? (claims.get(id) as Claim).seenAt);
      const at = Math.max(kth(freshTimes.get(c.id) as number[], SETTLE_AT) as number, ...conflictTimes);
      return accept(c, at);
    }
    if (candidates.length > 1) return disputed();
    const c = candidates[0] as Claim;
    if (deniedClaims.has(c.id)) return disputed();
    const times = [...(counting.get(c.id) as Map<string, Counted>).values()].map(a => a.seenAt);
    return accept(c, kth(times, ACCEPT_AT) as number);
  }

  // 3. Below the threshold.
  const started = [...claims.values()].filter(c => count(c.id) >= 1);
  if (started.some(c => deniedClaims.has(c.id))) return disputed();
  if (started.length > 0) return { ...base, state: 'suspended', oldKeyTrusted: false };
  if (claims.size > 0) return { ...base, state: 'claimed', oldKeyTrusted: true };
  return { ...base, state: 'normal', oldKeyTrusted: true };
}
