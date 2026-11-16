// Admission tiers: what a home does with a first contact, decided by code before any model reads it.
//
//   A  contact, or vouched for by the owner or a contact      -> inbox
//   B  two vouch hops away, or personhood proof + aged account -> knock card, body opens on accept
//   C  personhood proof only, or a refundable deposit only    -> requests folder, low daily cap
//   D  nothing                                                -> dropped, header logged
//
// There is no global score: each home computes tiers from its own contacts and the vouches it accepts.
// Thresholds are the owner's to change; the defaults are strict.

export const TIER_ACTION = Object.freeze({ A: 'inbox', B: 'knock_card', C: 'requests', D: 'drop' });

export const DEFAULT_POLICY = Object.freeze({
  maxHopsA: 1, // vouch hops from {owner, contacts} that still count as tier A
  maxHopsB: 2,
  dailyCapC: 3, // tier C knocks shown per day, across all senders
  minAccountAgeDays: 365, // for an "aged account" proof to count
});

/**
 * @param {object} p
 * @param {string} p.owner            owner's public key
 * @param {Iterable<string>} p.contacts public keys the owner already talks to
 * @param {import('./vouch.js').VouchGraph} p.graph
 * @param {string} p.sender
 * @param {{personhood?:boolean, accountAgeDays?:number, deposit?:boolean}} [p.proofs]
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
  return result('D', ['no contact, vouch or proof']);

  function result(tier, why) {
    return { tier, action: TIER_ACTION[tier], reasons: why };
  }
}
