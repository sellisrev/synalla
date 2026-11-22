// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Asking around: publish a need that says what is wanted but not who wants it, check the offers that come back,
// and rank them against limits only the owner knows (budget, must-have topics, past refusals).
// Built by a local model in the Synalla software factory from a written spec, then reviewed and fixed by hand.
// Self-contained by contract (test/askaround.test.js 'file constraints'): no imports, so the result type is repeated here.
type Result<T extends object> = ({ ok: true } & T) | { ok: false; errors: string[] };

export interface Need {
  category: string; topics: string[]; at: number; region?: string; days?: number; note?: string; private?: string[]; budget?: number;
}
export interface RequestTemplate { kind: 8446; created_at: number; tags: string[][]; content: string }
export interface AskRequest { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content?: string; sig?: string }
export interface Offer {
  id: string; seller: string; created_at: number; type: 'sale' | 'service' | 'job' | 'tender'; title: string; category: string;
  topics: string[]; price: number; currency: string; url: string | null;
}
export type RejectReason = 'bad_signature' | 'wrong_kind' | 'not_for_request' | 'own_request' | 'bad_content' | 'wrong_category' | 'expired' | 'out_of_time' | 'superseded';
export interface Rejected { index: number; id: string | null; reason: RejectReason }
export interface CollectOptions { now: number; verify: (event: unknown) => boolean }
export interface RankLimits { budget?: number | null; currency?: string | null; wantTopics?: string[]; mustTopics?: string[] }
export interface RankOptions { top?: number; isSuppressed?: ((offer: Offer) => boolean) | null }
export type Fit = 'within_budget' | 'no_budget' | 'over_budget';
export interface Ranked { id: string; fit: Fit; score: number; offer: Offer }
export interface Excluded { id: string; reason: 'declined_before' | 'currency' | 'missing_topic' }

type Loose = Record<string, any>; // unchecked input: every field is read through a check below

function isPlain(c: unknown): c is Loose { return c !== null && typeof c === 'object' && (Object.getPrototypeOf(c) === Object.prototype || Object.getPrototypeOf(c) === null); }
function isStr(c: unknown): c is string { return typeof c === 'string'; }
function isNum(c: unknown): c is number { return typeof c === 'number' && isFinite(c); }
function isInt(c: unknown): c is number { return Number.isSafeInteger(c); }
function isTime(c: unknown): c is number { return isInt(c) && c >= 0; }
function seg(c: unknown): c is string { return isStr(c) && /^[a-z0-9-]{1,32}$/.test(c); }
function isCat(c: unknown): c is string { if (!isStr(c)) return false; const p = c.split('/'); return p.length >= 1 && p.length <= 4 && p.every(seg); }
function tidy(a: string[]): string[] { const s = [...new Set(a)]; s.sort(); return s; }

export function buildRequest(need: unknown): Result<{ template: RequestTemplate }> {
  if (!isPlain(need)) return { ok: false, errors: ['need not plain'] };
  const allowed = new Set(['category','topics','region','at','days','note','private','budget']);
  for (const k of Object.keys(need)) { if (!allowed.has(k)) return { ok: false, errors: ['unknown key'] }; }
  const has = (k: string): boolean => k in need;
  if (!has('category') || !has('topics') || !has('at')) return { ok: false, errors: ['missing required key'] };
  if (!isCat(need.category)) return { ok: false, errors: ['invalid category'] };
  if (!Array.isArray(need.topics) || need.topics.length < 1 || need.topics.length > 5 || !need.topics.every(seg))
    return { ok: false, errors: ['invalid topics'] };
  if (has('region') && !(isStr(need.region) && /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(need.region))) return { ok: false, errors: ['invalid region'] };
  if (!isTime(need.at)) return { ok: false, errors: ['invalid at'] };
  if (has('days') && (!isInt(need.days) || need.days < 1 || need.days > 90)) return { ok: false, errors: ['invalid days'] };
  if (has('note') && (!isStr(need.note) || need.note.length > 200)) return { ok: false, errors: ['invalid note'] };
  if (has('private') && (!Array.isArray(need.private) || !need.private.every(isStr))) return { ok: false, errors: ['invalid private'] };
  if (has('budget') && (!isNum(need.budget) || need.budget < 0)) return { ok: false, errors: ['invalid budget'] };
  const note = has('note') ? need.note : '';
  if (/https?:\/\//i.test(note) || /www\./i.test(note) || /\b[a-z0-9-]+\.(com|net|org|io|fr|de|at|uk|eu|me|app|ly)\b/i.test(note)
      || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(note) || /(^|\s)@[A-Za-z0-9_]{2,}/.test(note))
    return { ok: false, errors: ['unsafe note'] };
  for (const n of note.match(/[+(]?\d(?:[\d\s().-]*\d)?/g) || []) if (n.match(/\d/g).length >= 9) return { ok: false, errors: ['long number'] };
  const region = has('region') ? need.region : null;
  const days = has('days') ? need.days : 14;
  const joined = [note, need.category, ...need.topics, region].join('\n').toLowerCase();
  if (has('private')) {
    for (const p of need.private) { const pl = p.toLowerCase(); if (pl.length >= 3 && joined.includes(pl)) return { ok: false, errors: ['private term found'] }; }
  }
  if (has('budget') && need.budget > 0 && joined.includes(String(need.budget))) return { ok: false, errors: ['budget in text'] };
  const topics = tidy(need.topics);
  const tags: string[][] = [['category', need.category], ...topics.map(t => ['t', t])];
  if (region !== null) tags.push(['g', region]);
  tags.push(['expiration', String(need.at + days * 86400)]);
  const content = JSON.stringify({ v: 1, category: need.category, topics, region, note });
  return { ok: true, template: { kind: 8446, created_at: need.at, tags, content } };
}

export function collectOffers(request: unknown, events: unknown, options: unknown): Result<{ offers: Offer[]; rejected: Rejected[] }> {
  if (!isPlain(request)) return { ok: false, errors: ['bad request'] };
  if (request.kind !== 8446) return { ok: false, errors: ['wrong kind'] };
  if (!isStr(request.id)) return { ok: false, errors: ['id not string'] };
  if (!isStr(request.pubkey)) return { ok: false, errors: ['pubkey not string'] };
  if (!isTime(request.created_at)) return { ok: false, errors: ['bad created_at'] };
  if (!Array.isArray(request.tags) || !request.tags.every((t: unknown) => Array.isArray(t) && t.every(isStr)))
    return { ok: false, errors: ['bad tags'] };
  const catTag: string[] | undefined = request.tags.find((t: string[]) => t[0] === 'category');
  if (!catTag || !isCat(catTag[1])) return { ok: false, errors: ['bad category tag'] };
  if (!Array.isArray(events)) return { ok: false, errors: ['events not array'] };
  if (!isPlain(options)) return { ok: false, errors: ['bad options'] };
  if (!('now' in options) || !isTime(options.now)) return { ok: false, errors: ['bad now'] };
  if (typeof options.verify !== 'function') return { ok: false, errors: ['no verify'] };
  let offers: Offer[] = [];
  const rejected: Rejected[] = [];
  const sellerMap = new Map<string, { offer: Offer; eventIndex: number }>();
  const supersededIds = new Set<string>();
  const reject = (index: number, ev: unknown, reason: RejectReason): number => rejected.push({ index, id: isPlain(ev) && isStr(ev.id) ? ev.id : null, reason });
  for (let i = 0; i < events.length; i++) {
    const ev: unknown = events[i];
    if (isPlain(ev) && options.verify(ev) === true) {
      // pass
    } else {
      reject(i, ev, 'bad_signature'); continue;
    }
    if (ev.kind !== 8443) {
      reject(i, ev, 'wrong_kind'); continue;
    }
    if (!Array.isArray(ev.tags) || !ev.tags.every((t: unknown) => Array.isArray(t) && t.every(isStr))
        || !ev.tags.some((t: string[]) => t[0] === 'e' && t[1] === request.id)) {
      reject(i, ev, 'not_for_request'); continue;
    }
    if (ev.pubkey === request.pubkey) {
      reject(i, ev, 'own_request'); continue;
    }
    let content: unknown;
    try { content = JSON.parse(ev.content); } catch (_) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!isPlain(content)) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!['sale','service','job','tender'].includes(content.type)) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!isStr(content.title) || content.title.length < 1 || content.title.length > 120) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!isCat(content.category)) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!Array.isArray(content.topics) || content.topics.length > 8 || !content.topics.every(seg)) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!isNum(content.price) || content.price < 0) {
      reject(i, ev, 'bad_content'); continue;
    }
    if (!isStr(content.currency) || !/^[A-Z]{3}$/.test(content.currency)) {
      reject(i, ev, 'bad_content'); continue;
    }
    if ('url' in content && (typeof content.url !== 'string' || content.url.length > 300 || !content.url.startsWith('https://'))) {
      reject(i, ev, 'bad_content'); continue;
    }
    const expTag: string[] | undefined = ev.tags.find((t: string[]) => Array.isArray(t) && t[0] === 'expiration');
    if (expTag) {
      const expVal = Number(expTag[1]);
      if (!isTime(expVal)) {
        reject(i, ev, 'bad_content'); continue;
      }
    }
    const offerCat = content.category;
    const reqCat = catTag[1]!;
    if (offerCat !== reqCat && !offerCat.startsWith(reqCat + '/')) {
      reject(i, ev, 'wrong_category'); continue;
    }
    if (expTag) {
      const expVal = Number(expTag[1]);
      if (expVal <= options.now) {
        reject(i, ev, 'expired'); continue;
      }
    }
    const ca = ev.created_at;
    if (!isTime(ca) || ca < request.created_at || ca > options.now + 300) {
      reject(i, ev, 'out_of_time'); continue;
    }
    const tidied = tidy(content.topics);
    const offer: Offer = {
      id: ev.id, seller: ev.pubkey, created_at: ca,
      type: content.type, title: content.title, category: content.category,
      topics: tidied, price: content.price, currency: content.currency,
      url: 'url' in content ? content.url : null
    };
    const seller = ev.pubkey;
    if (sellerMap.has(seller)) {
      const existing = sellerMap.get(seller)!;
      if (ca > existing.offer.created_at || (ca === existing.offer.created_at && ev.id > existing.offer.id)) {
        rejected.push({ index: existing.eventIndex, id: existing.offer.id, reason: 'superseded' });
        supersededIds.add(existing.offer.id);
        sellerMap.set(seller, { offer, eventIndex: i });
        offers.push(offer);
      } else {
        rejected.push({ index: i, id: ev.id, reason: 'superseded' });
      }
    } else {
      sellerMap.set(seller, { offer, eventIndex: i });
      offers.push(offer);
    }
  }
  offers = offers.filter(o => !supersededIds.has(o.id));
  offers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  rejected.sort((a, b) => a.index - b.index);
  return { ok: true, offers, rejected };
}

export function rankOffers(offers: unknown, limits: unknown, options?: unknown): Result<{ ranked: Ranked[]; excluded: Excluded[]; more: number }> {
  if (!Array.isArray(offers)) return { ok: false, errors: ['offers not array'] };
  for (const o of offers) if (!isPlain(o) || !Array.isArray(o.topics)) return { ok: false, errors: ['bad offer'] };
  if (!isPlain(limits)) return { ok: false, errors: ['bad limits'] };
  let budget: number | null = null;
  if ('budget' in limits && limits.budget !== undefined && limits.budget !== null) {
    if (!isNum(limits.budget) || limits.budget < 0) return { ok: false, errors: ['bad budget'] };
    budget = limits.budget;
  }
  let currency: string | null = null;
  if ('currency' in limits && limits.currency !== undefined && limits.currency !== null) {
    if (!isStr(limits.currency) || !/^[A-Z]{3}$/.test(limits.currency)) return { ok: false, errors: ['bad currency'] };
    currency = limits.currency;
  }
  let wantTopics: string[] = [];
  if ('wantTopics' in limits && limits.wantTopics !== undefined) {
    if (!Array.isArray(limits.wantTopics) || limits.wantTopics.length > 20 || !limits.wantTopics.every(seg))
      return { ok: false, errors: ['bad wantTopics'] };
    wantTopics = limits.wantTopics;
  }
  let mustTopics: string[] = [];
  if ('mustTopics' in limits && limits.mustTopics !== undefined) {
    if (!Array.isArray(limits.mustTopics) || limits.mustTopics.length > 20 || !limits.mustTopics.every(seg))
      return { ok: false, errors: ['bad mustTopics'] };
    mustTopics = limits.mustTopics;
  }
  let top = 5;
  let isSuppressed: ((offer: Offer) => boolean) | null = null;
  if (options !== undefined) {
    if (!isPlain(options)) return { ok: false, errors: ['bad options'] };
    if ('top' in options && options.top !== undefined) {
      if (!isInt(options.top) || options.top < 1 || options.top > 50) return { ok: false, errors: ['bad top'] };
      top = options.top;
    }
    if ('isSuppressed' in options && options.isSuppressed !== undefined) {
      if (typeof options.isSuppressed !== 'function' && options.isSuppressed !== null) return { ok: false, errors: ['bad isSuppressed'] };
      isSuppressed = options.isSuppressed;
    }
  }
  const sorted = ([...offers] as Offer[]).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const result: Ranked[] = [];
  const excluded: Excluded[] = [];
  for (const offer of sorted) {
    if (isSuppressed != null) {
      const copy = { ...offer, topics: [...offer.topics] };
      if (isSuppressed(copy) === true) { excluded.push({ id: offer.id, reason: 'declined_before' }); continue; }
    }
    if (currency !== null && offer.currency !== currency) { excluded.push({ id: offer.id, reason: 'currency' }); continue; }
    if (!mustTopics.every(t => offer.topics.includes(t))) { excluded.push({ id: offer.id, reason: 'missing_topic' }); continue; }
    let fit: Fit;
    if (budget === null) fit = 'no_budget';
    else if (offer.price <= budget) fit = 'within_budget';
    else fit = 'over_budget';
    const score = [...new Set(wantTopics)].filter(t => offer.topics.includes(t)).length;
    const entry = { id: offer.id, fit, score, offer: { ...offer, topics: [...offer.topics] } };
    result.push(entry);
  }
  result.sort((a, b) => {
    const fitOrder: Record<Fit, number> = { within_budget: 0, no_budget: 1, over_budget: 2 };
    if (fitOrder[a.fit] !== fitOrder[b.fit]) return fitOrder[a.fit] - fitOrder[b.fit];
    if (b.score !== a.score) return b.score - a.score;
    if (a.offer.price !== b.offer.price) return a.offer.price - b.offer.price;
    if (b.offer.created_at !== a.offer.created_at) return b.offer.created_at - a.offer.created_at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const ranked = result.slice(0, top);
  const more = result.length > top ? result.length - top : 0;
  return { ok: true, ranked, excluded, more };
}
