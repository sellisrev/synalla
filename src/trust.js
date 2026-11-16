// Admission tiers: what a home does with a first contact, decided by code before any model reads it.
//
//   A  contact, or vouched for by the owner or a contact      -> inbox
//   B  two vouch hops away, or personhood proof + aged account -> knock card, body opens on accept
//   C  personhood proof, a refundable deposit, or followed by  -> requests folder, low daily cap
//      several accounts the owner follows on Nostr
//   D  nothing                                                -> dropped, header logged
//
// There is no global score: each home computes tiers from its own contacts and the vouches it accepts.
// Thresholds are the owner's to change; the defaults are strict.
//
// Existing Nostr follow lists (kind 3) can add one capped signal: a sender followed by several
// of the people the owner follows reaches tier C, never higher on that alone. Follows are cheap
// to fake, but faking this one means getting accounts the owner chose to follow to follow you.

import { verifyEvent } from './event.js';

export const TIER_ACTION = Object.freeze({ A: 'inbox', B: 'knock_card', C: 'requests', D: 'drop' });

export const DEFAULT_POLICY = Object.freeze({
  maxHopsA: 1, // vouch hops from {owner, contacts} that still count as tier A
  maxHopsB: 2,
  dailyCapC: 3, // tier C knocks shown per day, across all senders
  minAccountAgeDays: 365, // for an "aged account" proof to count
  minFollowedBy: 3, // people the owner follows who must follow the sender for the follow signal
});

/**
 * How many of the accounts the owner follows also follow the sender, from signed kind-3 events.
 * Only the latest valid follow list per author counts.
 * @param {object[]} followLists kind-3 events (the owner's and the owner's follows')
 * @returns {number}
 */
export function followedByFollows(followLists, owner, sender) {
  const latest = new Map();
  for (const e of followLists) {
    if (e?.kind !== 3 || !verifyEvent(e)) continue;
    const prev = latest.get(e.pubkey);
    if (!prev || e.created_at > prev.created_at || (e.created_at === prev.created_at && e.id > prev.id)) latest.set(e.pubkey, e);
  }
  const follows = e => new Set((e?.tags ?? []).filter(t => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? '')).map(t => t[1]));
  const mine = follows(latest.get(owner));
  mine.delete(sender);
  mine.delete(owner);
  let n = 0;
  for (const f of mine) if (follows(latest.get(f)).has(sender)) n++;
  return n;
}

/**
 * @param {object} p
 * @param {string} p.owner            owner's public key
 * @param {Iterable<string>} p.contacts public keys the owner already talks to
 * @param {import('./vouch.js').VouchGraph} p.graph
 * @param {string} p.sender
 * @param {{personhood?:boolean, accountAgeDays?:number, deposit?:boolean, followedBy?:number}} [p.proofs]
 *        followedBy: result of followedByFollows() for this sender.
 *        Verified proofs only. Verifying them (zk-email, passport proofs, ecash) is outside this module.
 * @param {object} [p.policy]
 * @returns {{tier:'A'|'B'|'C'|'D', action:string, reasons:string[]}}
 */
export function admissionTier({ owner, contacts = [], graph, sender, proofs = {}, policy = {} }) {
  const pol = { ...DEFAULT_POLICY, ...policy };
  const contactSet = new Set(contacts);
  const reasons = [];
  if (graph?.removed?.has(sender)) return result('D', ['sender was removed from the network']);
  if (sender === owner || contactSet.has(sender)) return result('A', ['existing contact']);

  const hops = graph ? graph.hops([owner, ...contactSet], sender, pol.maxHopsB) : Infinity;
  if (hops <= pol.maxHopsA) return result('A', [`vouched within ${hops} hop(s) of you or your contacts`]);
  if (hops <= pol.maxHopsB) reasons.push(`vouched ${hops} hops away`);

  const aged = (proofs.accountAgeDays ?? 0) >= pol.minAccountAgeDays;
  if (proofs.personhood && aged) reasons.push('one-person proof and an aged account');
  if (reasons.length) return result('B', reasons);

  if (proofs.personhood) return result('C', ['one-person proof only']);
  if (proofs.deposit) return result('C', ['refundable deposit only']);
  if ((proofs.followedBy ?? 0) >= pol.minFollowedBy) return result('C', [`followed by ${proofs.followedBy} accounts you follow`]);
  return result('D', ['no contact, vouch or proof']);

  function result(tier, why) {
    return { tier, action: TIER_ACTION[tier], reasons: why };
  }
}
