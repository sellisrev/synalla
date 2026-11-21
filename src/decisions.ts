// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Remembered decisions: the owner's yes / no / not now on offers, applied to similar offers later.
// A "no" stands for years and covers similar offers, so the owner never has to repeat it.
// Built by a local model (Qwen3.6-35B-A3B through OpenCode) against a written contract with hidden tests,
// then reviewed; see docs/design.md. Pure: no I/O, no clock, arguments never changed.

import type { Result } from './result.ts';

export type Verdict = 'yes' | 'no' | 'not_now';
export type Scope =
  | { level: 'offer'; offerId: string }
  | { level: 'seller_category'; seller: string; category: string }
  | { level: 'seller'; seller: string }
  | { level: 'topic'; category: string; topics: string[] }
  | { level: 'category'; category: string };
export interface Decision { id: string; verdict: Verdict; scope: Scope; at: number; until: number | null; liftedAt: number | null; note: string }
export interface DecisionMemory { version: 1; next: number; decisions: Decision[] }
export interface CheckedOffer { id: string; seller: string; category: string; topics: string[] }
export interface OfferCheck { show: boolean; decision: string | null; verdict: Verdict | null; level: Scope['level'] | null; until: number | null }

function isValidSegment(s: unknown): boolean {
  return typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s);
}
function isValidCategory(c: unknown): c is string {
  if (typeof c !== 'string') return false;
  var segs = c.split('/');
  if (segs.length < 1 || segs.length > 4) return false;
  for (var i = 0; i < segs.length; i++) { if (!isValidSegment(segs[i])) return false; }
  return true;
}
function isValidSeller(s: unknown): boolean {
  return typeof s === 'string' && s.length === 64 && /^[0-9a-f]{64}$/.test(s);
}
function isValidOfferId(id: unknown): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
function isValidTopics(t: unknown): boolean {
  return Array.isArray(t) && t.length >= 1 && t.length <= 8 && t.every(function(t: unknown) { return isValidSegment(t); });
}
function coversCategory(parent: string, child: string): boolean {
  if (parent === child) return true;
  return child.startsWith(parent + '/');
}
function copyScope(s: Scope): Scope {
  var c: Record<string, unknown> = {};
  var src = s as unknown as Record<string, unknown>;
  for (var k in src) { if (src.hasOwnProperty(k)) { var v = src[k]; c[k] = Array.isArray(v) ? v.slice() : v; } }
  return c as unknown as Scope;
}
function copyDecision(d: Decision): Decision {
  var c: Record<string, unknown> = {};
  var src = d as unknown as Record<string, unknown>;
  for (var k in src) { if (src.hasOwnProperty(k)) { c[k] = k === 'scope' ? copyScope(d.scope) : src[k]; } }
  return c as unknown as Decision;
}
function createMemory(): DecisionMemory { return { version: 1, next: 1, decisions: [] }; }
function recordDecision(memory: DecisionMemory, raw: unknown): Result<{ memory: DecisionMemory; decision: Decision }> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['input must be a plain object'] };
  // checked key by key below; typed as the shape it must have so the checks read naturally
  var input = raw as { verdict: Verdict; scope: Record<string, any> & { level: Scope['level'] }; at: number; until?: number | null; note?: unknown };
  var keys = Object.keys(input);
  var allowed = ['verdict', 'scope', 'at', 'until', 'note'];
  var keySet: Record<string, boolean> = {};
  for (var i = 0; i < keys.length; i++) {
    if (allowed.indexOf(keys[i]!) === -1) return { ok: false, errors: ['unexpected key: ' + keys[i]] };
    keySet[keys[i]!] = true;
  }
  if (!keySet.verdict) return { ok: false, errors: ['missing required key: verdict'] };
  if (!keySet.scope) return { ok: false, errors: ['missing required key: scope'] };
  if (!keySet.at) return { ok: false, errors: ['missing required key: at'] };
  var errors: string[] = [];
  if (input.verdict !== 'yes' && input.verdict !== 'no' && input.verdict !== 'not_now') {
    errors.push('verdict must be yes, no, or not_now');
  }
  var validKeys: Record<string, string[]> = {
    offer: ['level', 'offerId'], seller_category: ['level', 'seller', 'category'],
    seller: ['level', 'seller'], topic: ['level', 'category', 'topics'], category: ['level', 'category']
  };
  if (typeof input.scope !== 'object' || input.scope === null || Array.isArray(input.scope)) {
    errors.push('scope must be a plain object');
  } else {
    var scopeKeys = Object.keys(input.scope);
    var expectedKeys = validKeys[input.scope.level];
    if (!expectedKeys) { errors.push('invalid scope level: ' + input.scope.level); }
    else if (scopeKeys.length !== expectedKeys.length) { errors.push('scope must have exactly: ' + expectedKeys.join(', ')); }
    else { for (var j = 0; j < scopeKeys.length; j++) { if (expectedKeys.indexOf(scopeKeys[j]!) === -1) { errors.push('unexpected scope key: ' + scopeKeys[j]); } } }
    if (input.scope.level === 'offer') { if (!isValidOfferId(input.scope.offerId)) errors.push('scope.offerId must be a valid offer id'); }
    else if (input.scope.level === 'seller_category') {
      if (!isValidSeller(input.scope.seller)) errors.push('scope.seller must be a 64-char hex string');
      if (!isValidCategory(input.scope.category)) errors.push('scope.category must be a valid category');
    }
    else if (input.scope.level === 'seller') { if (!isValidSeller(input.scope.seller)) errors.push('scope.seller must be a 64-char hex string'); }
    else if (input.scope.level === 'topic') {
      if (!isValidCategory(input.scope.category)) errors.push('scope.category must be a valid category');
      if (!isValidTopics(input.scope.topics)) errors.push('scope.topics must be 1-8 valid segments');
    }
    else if (input.scope.level === 'category') { if (!isValidCategory(input.scope.category)) errors.push('scope.category must be a valid category'); }
  }
  if (!Number.isSafeInteger(input.at) || input.at < 0) { errors.push('at must be a safe integer >= 0'); }
  if ('until' in input) {
    if (input.until !== null && (!Number.isSafeInteger(input.until) || (input.until as number) < 0 || (input.until as number) <= input.at)) { errors.push('until must be null or a time strictly greater than at'); }
  }
  if (input.note !== undefined && typeof input.note !== 'string') { errors.push('note must be a string'); }
  else if (typeof input.note === 'string' && input.note.length > 280) { errors.push('note must be at most 280 characters'); }
  if (errors.length > 0) return { ok: false, errors: errors };
  var defaults: Record<Verdict, number> = { no: 5 * 365 * 86400, not_now: 90 * 86400, yes: 365 * 86400 };
  var until = input.until !== undefined ? input.until : input.at + defaults[input.verdict];
  var scope!: Scope;
  if (input.scope.level === 'offer') { scope = { level: 'offer', offerId: input.scope.offerId }; }
  else if (input.scope.level === 'seller_category') { scope = { level: 'seller_category', seller: input.scope.seller, category: input.scope.category }; }
  else if (input.scope.level === 'seller') { scope = { level: 'seller', seller: input.scope.seller }; }
  else if (input.scope.level === 'topic') {
    var deduped = Array.from(new Set<string>(input.scope.topics));
    deduped.sort(); var topic = { level: 'topic', category: input.scope.category } as Scope & { level: 'topic' }; topic.topics = deduped; scope = topic;
  }
  else if (input.scope.level === 'category') { scope = { level: 'category', category: input.scope.category }; }
  var decision: Decision = { id: 'd' + memory.next, verdict: input.verdict, scope: scope, at: input.at, until: until, liftedAt: null, note: input.note !== undefined ? input.note as string : '' };
  var newDecisions: Decision[] = [];
  for (var i = 0; i < memory.decisions.length; i++) { newDecisions[i] = copyDecision(memory.decisions[i]!); }
  newDecisions.push(decision);
  var newMemory: DecisionMemory = { version: 1, next: memory.next + 1, decisions: newDecisions };
  return { ok: true, memory: newMemory, decision: copyDecision(decision) };
}
function liftDecision(memory: DecisionMemory, id: string, at: number): Result<{ memory: DecisionMemory }> {
  if (!Number.isSafeInteger(at) || at < 0) return { ok: false, errors: ['at must be a safe integer >= 0'] };
  var decision: Decision | null = null, decisionIdx = -1;
  for (var i = 0; i < memory.decisions.length; i++) { if (memory.decisions[i]!.id === id) { decision = memory.decisions[i]!; decisionIdx = i; break; } }
  if (!decision) return { ok: false, errors: ['decision not found: ' + id] };
  if (at < decision.at) return { ok: false, errors: ['at must be >= decision.at'] };
  if (decision.liftedAt !== null) return { ok: false, errors: ['decision already lifted'] };
  var newDecisions: Decision[] = [];
  for (var i = 0; i < memory.decisions.length; i++) {
    if (i === decisionIdx) { var newD = copyDecision(memory.decisions[i]!); newD.liftedAt = at; newDecisions[i] = newD; }
    else { newDecisions[i] = copyDecision(memory.decisions[i]!); }
  }
  return { ok: true, memory: { version: 1, next: memory.next, decisions: newDecisions } };
}
function activeDecisions(memory: DecisionMemory, at: number): Decision[] {
  var result: Decision[] = [];
  for (var i = 0; i < memory.decisions.length; i++) {
    var d = memory.decisions[i]!;
    if (d.at <= at && (d.until === null || at < d.until) && (d.liftedAt === null || at < d.liftedAt)) { result.push(copyDecision(d)); }
  }
  return result;
}
function checkOffer(memory: DecisionMemory, raw: unknown, at: number): Result<OfferCheck> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['offer must be a plain object'] };
  var offer = raw as CheckedOffer; // checked field by field below
  if (typeof offer.id !== 'string') return { ok: false, errors: ['offer.id must be a string'] };
  if (typeof offer.seller !== 'string') return { ok: false, errors: ['offer.seller must be a string'] };
  if (!isValidCategory(offer.category)) return { ok: false, errors: ['offer.category must be a valid category'] };
  if (!Array.isArray(offer.topics) || !offer.topics.every(function(t: unknown) { return typeof t === 'string'; })) return { ok: false, errors: ['offer.topics must be an array of strings'] };
  if (!Number.isSafeInteger(at) || at < 0) return { ok: false, errors: ['at must be a safe integer >= 0'] };
  var active = activeDecisions(memory, at);
  if (active.length === 0) return { ok: true, show: true, decision: null, verdict: null, level: null, until: null };
  function appliesTo(decision: Decision, offer: CheckedOffer): boolean {
    var s = decision.scope;
    if (s.level === 'offer') return s.offerId === offer.id;
    if (s.level === 'seller_category') return s.seller === offer.seller && coversCategory(s.category, offer.category);
    if (s.level === 'seller') return s.seller === offer.seller;
    if (s.level === 'topic') {
      if (!coversCategory(s.category, offer.category)) return false;
      for (var i = 0; i < s.topics.length; i++) { if (offer.topics.indexOf(s.topics[i]!) === -1) return false; }
      return true;
    }
    if (s.level === 'category') return coversCategory(s.category, offer.category);
    return false;
  }
  function compareDecisions(a: Decision, b: Decision): number {
    var lo: Record<Scope['level'], number> = { offer: 5, seller_category: 4, seller: 3, topic: 2, category: 1 };
    var al = lo[a.scope.level], bl = lo[b.scope.level];
    if (al !== bl) return al - bl;
    var ac = 'category' in a.scope ? a.scope.category : '', bc = 'category' in b.scope ? b.scope.category : '';
    var as = ac ? ac.split('/').length : 0, bs = bc ? bc.split('/').length : 0;
    if (as !== bs) return as - bs;
    var at2 = 'topics' in a.scope ? a.scope.topics.length : 0, bt = 'topics' in b.scope ? b.scope.topics.length : 0;
    if (at2 !== bt) return at2 - bt;
    if (a.at !== b.at) return a.at - b.at;
    return parseInt(a.id.substring(1)) - parseInt(b.id.substring(1));
  }
  var matching: Decision[] = [];
  for (var i = 0; i < active.length; i++) { if (appliesTo(active[i]!, offer)) matching.push(active[i]!); }
  if (matching.length === 0) return { ok: true, show: true, decision: null, verdict: null, level: null, until: null };
  var sorted = matching.slice().sort(compareDecisions);
  var strongest = sorted[sorted.length - 1]!;
  return { ok: true, show: strongest.verdict === 'yes', decision: strongest.id, verdict: strongest.verdict, level: strongest.scope.level, until: strongest.until };
}
export { createMemory, recordDecision, liftDecision, activeDecisions, checkOffer };
