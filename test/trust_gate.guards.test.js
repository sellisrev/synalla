// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// Pins each admission rule in trust.js and each policy path in gate.js at its exact boundary, with the exact reason
// the owner sees. Found by mutation testing (21 Nov 2026): these rules could be deleted or shifted by one without any
// test failing, because the older tests reach them only through paths where another rule gives the same answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';
import { admissionTier, followedByFollows, TIER_ACTION, DEFAULT_POLICY } from '../src/trust.js';
import { createKnock, KNOCK_KIND } from '../src/knock.js';
import { Gate, DEFAULT_GATE_POLICY } from '../src/gate.js';

const T0 = 1_800_000_000;
const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const owner = person(), contact = person(), sender = person();

// A graph stub isolates trust.js from vouch.js: it reports a fixed hop count and a removed set.
const graph = (hops, removed = []) => ({ hops: () => hops, removed: new Set(removed) });
const tier = (p) => admissionTier({ owner: owner.pk, sender: sender.pk, ...p });

// ---- admissionTier ------------------------------------------------------------------------------------------------

test('admissionTier: a removed sender is tier D even when a direct contact (contacts skip the graph)', () => {
  const r = tier({ contacts: [sender.pk], graph: graph(0, [sender.pk]), proofs: { personhood: true, deposit: true } });
  assert.deepEqual(r, { tier: 'D', action: 'drop', reasons: ['sender was removed from the network'] });
});

test('admissionTier: the owner and direct contacts are tier A, with the reason shown', () => {
  assert.deepEqual(admissionTier({ owner: owner.pk, sender: owner.pk, graph: graph(Infinity) }),
    { tier: 'A', action: 'inbox', reasons: ['existing contact'] });
  assert.deepEqual(tier({ contacts: [contact.pk, sender.pk], graph: graph(Infinity) }),
    { tier: 'A', action: 'inbox', reasons: ['existing contact'] });
  assert.equal(tier({ contacts: [contact.pk], graph: graph(Infinity) }).tier, 'D', 'other contacts do not admit the sender');
});

test('admissionTier: vouch hops at each boundary (default maxHopsA 1, maxHopsB 2)', () => {
  assert.deepEqual(tier({ graph: graph(1) }), { tier: 'A', action: 'inbox', reasons: ['vouched within 1 hop(s) of you or your contacts'] });
  assert.deepEqual(tier({ graph: graph(2) }), { tier: 'B', action: 'knock_card', reasons: ['vouched 2 hops away'] });
  assert.equal(tier({ graph: graph(3) }).tier, 'D');
  assert.equal(tier({}).tier, 'D', 'no graph: no vouch path');
});

test('admissionTier: owner policy moves the hop boundaries', () => {
  assert.equal(tier({ graph: graph(2), policy: { maxHopsA: 2 } }).tier, 'A');
  assert.equal(tier({ graph: graph(3), policy: { maxHopsB: 3 } }).tier, 'B');
  assert.equal(tier({ graph: graph(1), policy: { maxHopsA: 0 } }).tier, 'B');
});

test('admissionTier: personhood plus an account exactly minAccountAgeDays old is tier B; one day younger is C', () => {
  const at = (days) => tier({ graph: graph(Infinity), proofs: { personhood: true, accountAgeDays: days } });
  assert.deepEqual(at(365), { tier: 'B', action: 'knock_card', reasons: ['one-person proof and an aged account'] });
  assert.deepEqual(at(364), { tier: 'C', action: 'requests', reasons: ['one-person proof only'] });
  assert.equal(tier({ graph: graph(Infinity), proofs: { accountAgeDays: 9999 } }).tier, 'D', 'age alone is nothing');
});

test('admissionTier: tier B lists every reason that applies, in order', () => {
  assert.deepEqual(tier({ graph: graph(2), proofs: { personhood: true, accountAgeDays: 400 } }).reasons,
    ['vouched 2 hops away', 'one-person proof and an aged account']);
});

test('admissionTier: tier C paths and their reasons; the follow signal needs exactly minFollowedBy', () => {
  const c = (proofs) => tier({ graph: graph(Infinity), proofs });
  assert.deepEqual(c({ deposit: true }), { tier: 'C', action: 'requests', reasons: ['refundable deposit only'] });
  assert.deepEqual(c({ followedBy: 3 }), { tier: 'C', action: 'requests', reasons: ['followed by 3 accounts you follow'] });
  assert.deepEqual(c({ followedBy: 2 }), { tier: 'D', action: 'drop', reasons: ['no contact, vouch or proof'] });
  assert.equal(tier({ graph: graph(Infinity), proofs: { followedBy: 2 }, policy: { minFollowedBy: 2 } }).tier, 'C');
});

test('admissionTier: every tier maps to its fixed action', () => {
  assert.deepEqual(TIER_ACTION, { A: 'inbox', B: 'knock_card', C: 'requests', D: 'drop' });
  assert.equal(DEFAULT_POLICY.minAccountAgeDays, 365);
});

// ---- followedByFollows --------------------------------------------------------------------------------------------

const follows = (who, pks, createdAt = T0) => signEvent({ kind: 3, created_at: createdAt, tags: pks.map(p => ['p', p]), content: '' }, who.sk);

test('followedByFollows: counts the owner\'s follows that follow the sender', () => {
  const f1 = person(), f2 = person(), f3 = person();
  const lists = [follows(owner, [f1.pk, f2.pk, f3.pk]), follows(f1, [sender.pk]), follows(f2, [sender.pk]), follows(f3, [])];
  assert.equal(followedByFollows(lists, owner.pk, sender.pk), 2);
});

test('followedByFollows: only the latest list per author counts; on equal time the higher id wins', () => {
  const f = person();
  const older = [follows(owner, [f.pk], T0), follows(f, [sender.pk], T0)];
  const newer = follows(f, [], T0 + 1);
  assert.equal(followedByFollows([...older, newer], owner.pk, sender.pk), 0, 'newer list without the sender wins');
  assert.equal(followedByFollows([newer, ...older], owner.pk, sender.pk), 0, 'order of arrival does not matter');
  const a = follows(f, [sender.pk], T0 + 5), b = follows(f, [], T0 + 5);
  const want = a.id > b.id ? 1 : 0;
  assert.equal(followedByFollows([follows(owner, [f.pk]), a, b], owner.pk, sender.pk), want);
  assert.equal(followedByFollows([follows(owner, [f.pk]), b, a], owner.pk, sender.pk), want);
});

test('followedByFollows: ignores unsigned, forged and non-kind-3 lists, and malformed tags', () => {
  const f = person();
  const forged = { ...follows(f, [sender.pk]), sig: '0'.repeat(128) };
  const notKind3 = signEvent({ kind: 1, created_at: T0, tags: [['p', sender.pk]], content: '' }, f.sk);
  const own = follows(owner, [f.pk]);
  assert.equal(followedByFollows([own, forged], owner.pk, sender.pk), 0);
  assert.equal(followedByFollows([own, notKind3], owner.pk, sender.pk), 0);
  assert.equal(followedByFollows([own, null, undefined, follows(f, [sender.pk])], owner.pk, sender.pk), 1);
  const badTags = signEvent({ kind: 3, created_at: T0, content: '',
    tags: [['e', sender.pk], ['p', sender.pk.toUpperCase()], ['p', sender.pk + '00'], ['p']] }, f.sk);
  assert.equal(followedByFollows([own, badTags], owner.pk, sender.pk), 0);
});

test('followedByFollows: neither the sender nor the owner counts as one of the owner\'s follows', () => {
  // sender follows themselves; owner's list includes sender and owner: neither inflates the count
  const lists = [follows(owner, [sender.pk, owner.pk]), follows(sender, [sender.pk]), follows(owner, [sender.pk, owner.pk], T0 - 1)];
  assert.equal(followedByFollows(lists, owner.pk, sender.pk), 0);
});

// ---- Gate policy paths ----------------------------------------------------------------------------------------------

const knock = (sk, note = '') => createKnock(sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note }, { createdAt: T0 });

test('Gate: a custom per-sender daily limit replaces the default for that tier only', () => {
  const g = new Gate({ owner: owner.pk, contacts: [contact.pk], graph: graph(Infinity), policy: { perSenderPerDay: { A: 2 } } });
  const r = ['a', 'b', 'c'].map(n => g.receive(knock(contact.sk, n), T0).action);
  assert.deepEqual(r, ['inbox', 'inbox', 'drop']);
  assert.equal(g.policy.perSenderPerDay.B, DEFAULT_GATE_POLICY.perSenderPerDay.B, 'other tiers keep their default');
});

test('Gate: a custom category policy is merged over the defaults, not replacing them', () => {
  const g = new Gate({ owner: owner.pk, contacts: [contact.pk], graph: graph(Infinity),
    policy: { categories: { question: { ...DEFAULT_GATE_POLICY.categories.question, minTier: 'A' } } } });
  assert.equal(g.policy.categories.question.minTier, 'A');
  for (const name of Object.keys(DEFAULT_GATE_POLICY.categories)) assert.ok(g.policy.categories[name], `${name} kept`);
});

test('Gate: defaults are no contacts and no proofs', () => {
  const g = new Gate({ owner: owner.pk, graph: graph(Infinity) });
  assert.equal(g.contacts.size, 0);
  assert.deepEqual(g.proofsFor(sender.pk), {});
  assert.equal(g.receive(knock(sender.sk), T0).action, 'drop');
});

test('Gate: without an explicit time, receive counts against today (seconds, not milliseconds)', () => {
  const g = new Gate({ owner: owner.pk, contacts: [contact.pk], graph: graph(Infinity), policy: { perSenderPerDay: { A: 1 } } });
  const nowS = Math.floor(Date.now() / 1000);
  // Knocks dated now: since 24 Nov 2026 the gate refuses knocks dated more than 5 minutes ahead.
  const fresh = note => createKnock(contact.sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note }, { createdAt: nowS });
  assert.equal(g.receive(fresh('one')).action, 'inbox');
  assert.equal(g.receive(fresh('two'), nowS).action, 'drop', 'same day, same budget');
  assert.ok(Math.abs(g.log[0].at - nowS) <= 5, 'logged time is now, in seconds');
});

test('admissionTier: a graph without a removed set is treated as having removed nobody', () => {
  assert.equal(tier({ graph: { hops: () => 1 } }).tier, 'A');
});

// ---- Gate: exact refusals, the card, and the owner's log ------------------------------------------------------------

const gateWith = (policy) => new Gate({ owner: owner.pk, contacts: [contact.pk], graph: graph(Infinity), policy });
const signedKnock = (sk, content, tags = [['category', 'question']]) =>
  signEvent({ kind: KNOCK_KIND, created_at: T0, tags, content }, sk);

test('Gate: a knock addressed to the owner is accepted; addressing is optional', () => {
  const g = gateWith();
  const toOwner = createKnock(contact.sk, { category: 'question', fields: { topic: 't' } }, { createdAt: T0, recipient: owner.pk });
  assert.equal(g.receive(toOwner, T0).action, 'inbox');
});

test('Gate: size limit is exact: maxEventBytes passes, one byte more is refused', () => {
  const base = JSON.stringify({ category: 'question', fields: { topic: 'x' }, note: '' });
  const g = gateWith({ maxEventBytes: 100_000 });
  const probe = signedKnock(contact.sk, base);
  const size = Buffer.byteLength(JSON.stringify(probe));
  assert.equal(gateWith({ maxEventBytes: size }).receive(probe, T0).action, 'inbox');
  assert.deepEqual(gateWith({ maxEventBytes: size - 1 }).receive(probe, T0).reasons, [`larger than ${size - 1} bytes`]);
  assert.equal(g.policy.maxEventBytes, 100_000);
});

test('Gate: an event that cannot be serialised is refused, not thrown', () => {
  const g = gateWith();
  assert.deepEqual(g.receive({ big: 1n }, T0), { action: 'drop', tier: undefined, reasons: ['not serialisable'] });
});

test('Gate: tier D is refused with the trust reason, before the body is read', () => {
  const g = gateWith();
  assert.deepEqual(g.receive(signedKnock(sender.sk, 'not json'), T0), { action: 'drop', tier: 'D', reasons: ['no contact, vouch or proof'] });
});

test('Gate: content that is not JSON is refused with that reason and the sender tier', () => {
  assert.deepEqual(gateWith().receive(signedKnock(contact.sk, 'not json'), T0), { action: 'drop', tier: 'A', reasons: ['content is not JSON'] });
});

test('Gate: daily limits count per day, not per second, and give their reasons', () => {
  const g = gateWith({ perSenderPerDay: { A: 1 } });
  assert.equal(g.receive(knock(contact.sk, 'one'), T0).action, 'inbox');
  assert.deepEqual(g.receive(knock(contact.sk, 'two'), T0 + 60).reasons, ['sender reached its daily limit']);
  const c = new Gate({ owner: owner.pk, graph: graph(Infinity), policy: { dailyCapC: 1 }, proofsFor: () => ({ deposit: true }) });
  assert.equal(c.receive(knock(person().sk), T0).action, 'requests');
  assert.deepEqual(c.receive(knock(person().sk), T0 + 60).reasons, ['daily cap for unvouched senders reached']);
});

test('Gate: the accepted card carries exactly the knock\'s fixed fields; the note travels apart', () => {
  const k = createKnock(contact.sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note: 'hello' }, { createdAt: T0 });
  const r = gateWith().receive(k, T0 + 5);
  assert.deepEqual(r, {
    action: 'inbox', tier: 'A', reasons: ['existing contact'], note: 'hello',
    card: { id: k.id, sender: contact.pk, tier: 'A', why: ['existing contact'], category: 'question',
      fields: { topic: 'QA pay in Lyon' }, hasNote: true, at: T0 },
  });
  const bare = signedKnock(contact.sk, JSON.stringify({ category: 'question' }));
  const b = gateWith().receive(bare, T0);
  assert.deepEqual([b.card.fields, b.card.hasNote, b.note], [{}, false, '']);
});

test('Gate: every decision is logged for the owner, accepted or dropped, malformed included', () => {
  const g = gateWith();
  const k = knock(contact.sk, 'logged');
  g.receive(k, T0);
  g.receive(k, T0 + 1);
  g.receive(null, T0 + 2);
  g.receive({ id: 7, pubkey: 8 }, T0 + 3);
  assert.deepEqual(g.log, [
    { at: T0, id: k.id, sender: contact.pk, action: 'inbox', tier: 'A', reasons: ['existing contact'], category: 'question' },
    { at: T0 + 1, id: k.id, sender: contact.pk, action: 'drop', tier: null, reasons: ['duplicate'], category: null },
    { at: T0 + 2, id: null, sender: null, action: 'drop', tier: null, reasons: ['bad signature or format'], category: null },
    { at: T0 + 3, id: null, sender: null, action: 'drop', tier: null, reasons: ['bad signature or format'], category: null },
  ]);
});

test('followedByFollows: a newer list wins even when the older one has the higher id (time decides, not id)', () => {
  const f = person();
  let older, newer;
  for (let i = 0; i < 200; i++) { // find a pair where the id order is the opposite of the time order
    older = follows(f, [sender.pk], T0 + i);
    newer = follows(f, [], T0 + i + 1);
    if (older.id > newer.id) break;
  }
  assert.ok(older.id > newer.id, 'test setup: need an older list with the higher id');
  const own = follows(owner, [f.pk]);
  assert.equal(followedByFollows([own, newer, older], owner.pk, sender.pk), 0);
  assert.equal(followedByFollows([own, older, newer], owner.pk, sender.pk), 0);
});

test('Gate: the shared tier C cap resets the next day', () => {
  const c = new Gate({ owner: owner.pk, graph: graph(Infinity), policy: { dailyCapC: 1 }, proofsFor: () => ({ deposit: true }) });
  assert.equal(c.receive(knock(person().sk), T0).action, 'requests');
  assert.equal(c.receive(knock(person().sk), T0 + 1).action, 'drop');
  assert.equal(c.receive(knock(person().sk), T0 + 86400).action, 'requests');
});
