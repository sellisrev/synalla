// Signed offers, and judging them privately against the owner's limits.
//
// Cold start: a lone agent still has work to do. It can read public offers (job ads with a
// pay range, tenders, listings) and judge each one against limits only its owner knows,
// before any counterpart is on the network. Offers taken from a public source are marked
// as derived and keep their source, so they are never shown as if a person or company had
// published them on the network.

import { signEvent, verifyEvent, tagValue } from './event.js';
import { KIND } from './kinds.js';

const OFFER_TYPES = ['job', 'sale', 'tender', 'service'];

/**
 * @param {string} sk  signer: the company itself, or whoever derived the offer from a public ad
 * @param {{type:string, title:string, role?:string, region?:string, payMin?:number, payMax?:number,
 *          currency?:string, period?:'year'|'month'|'hour', expiresAt?:number,
 *          source?:{kind:'direct'|'public_ad', url?:string, retrievedAt?:string}}} o
 */
export function createOffer(sk, o, { createdAt } = {}) {
  if (!OFFER_TYPES.includes(o.type)) throw new RangeError(`type must be one of ${OFFER_TYPES.join(', ')}`);
  if (!o.title) throw new TypeError('title required');
  if (o.payMin != null && o.payMax != null && o.payMin > o.payMax) throw new RangeError('payMin > payMax');
  const source = o.source ?? { kind: 'direct' };
  if (source.kind === 'public_ad' && !source.url) throw new TypeError('a derived offer must keep its source url');
  const tags = [['type', o.type], ['source', source.kind]];
  if (o.role) tags.push(['t', o.role]);
  if (o.region) tags.push(['g', o.region]);
  if (o.expiresAt) tags.push(['expiration', String(o.expiresAt)]);
  const content = JSON.stringify({ ...o, source });
  return signEvent({ kind: KIND.OFFER, created_at: createdAt, tags, content }, sk);
}

export function readOffer(e) {
  if (!verifyEvent(e) || e.kind !== KIND.OFFER) return null;
  try {
    const body = JSON.parse(e.content);
    return { ...body, derived: tagValue(e, 'source') === 'public_ad', signer: e.pubkey, id: e.id };
  } catch {
    return null;
  }
}

const PER_YEAR = { year: 1, month: 12, hour: 1607 }; // 1607 h: French legal working year (35 h week)

/**
 * Judge an offer against private limits. Pure rules, no model, nothing leaves the home.
 * @param {{floor?:number, currency?:string, period?:'year'|'month'|'hour', roles?:string[], regions?:string[]}} limits
 * @returns {{fit:'above_floor'|'straddles_floor'|'below_floor'|'no_pay_stated'|'not_relevant'|'invalid', reasons:string[]}}
 */
export function judgeOffer(limits, offerEvent, { now } = {}) {
  const o = readOffer(offerEvent);
  if (!o) return { fit: 'invalid', reasons: ['bad signature or format'] };
  const reasons = [];
  const exp = Number(tagValue(offerEvent, 'expiration'));
  if (exp && (now ?? Math.floor(Date.now() / 1000)) > exp) return { fit: 'not_relevant', reasons: ['expired'] };
  if (limits.roles?.length && !limits.roles.includes(o.role)) return { fit: 'not_relevant', reasons: ['other role'] };
  if (limits.regions?.length && !limits.regions.includes(o.region)) return { fit: 'not_relevant', reasons: ['other region'] };
  if (o.derived) reasons.push('taken from a public ad');
  if (limits.floor == null) return { fit: 'no_pay_stated', reasons: [...reasons, 'no floor set'] };
  if (o.payMin == null && o.payMax == null) return { fit: 'no_pay_stated', reasons: [...reasons, 'offer states no pay'] };
  if (limits.currency && o.currency && limits.currency !== o.currency) {
    return { fit: 'no_pay_stated', reasons: [...reasons, `different currency (${o.currency})`] };
  }
  const f = (v, period) => v * PER_YEAR[period ?? 'year'];
  const floor = f(limits.floor, limits.period);
  const lo = o.payMin != null ? f(o.payMin, o.period) : null;
  const hi = o.payMax != null ? f(o.payMax, o.period) : lo;
  if (lo != null && lo >= floor) return { fit: 'above_floor', reasons };
  if (hi != null && hi >= floor) return { fit: 'straddles_floor', reasons };
  return { fit: 'below_floor', reasons };
}
