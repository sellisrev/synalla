import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from '../src/event.js';
import { createInvite, redeemInvite, acceptRedemption, createVouch, createUnvouch, VouchGraph } from '../src/vouch.js';
import { admissionTier } from '../src/trust.js';

const T0 = 1_800_000_000;
const DAY = 86400;
const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };

test('invite -> redemption -> vouch', () => {
  const a = person(), b = person();
  const { code, invite } = createInvite(a.sk, { scope: 'pay-product-fr', createdAt: T0 });
  const red = redeemInvite({ invite, code, inviteeSk: b.sk, createdAt: T0 + 10 });
  const v = acceptRedemption({ invite, code, redemption: red, issuerSk: a.sk, now: T0 + 20 });
  assert.equal(v.pubkey, a.pk);
  assert.deepEqual(v.tags.find(t => t[0] === 'p'), ['p', b.pk]);
  assert.deepEqual(v.tags.find(t => t[0] === 'scope'), ['scope', 'pay-product-fr']);
});

test('redemption is bound to the invitee key: a copied proof does not work for another key', () => {
  const a = person(), b = person(), thief = person();
  const { code, invite } = createInvite(a.sk, { createdAt: T0 });
  const red = redeemInvite({ invite, code, inviteeSk: b.sk, createdAt: T0 });
  // thief re-signs b's proof under its own key
  const forged = redeemInvite({ invite, code: 'wrong', inviteeSk: thief.sk, createdAt: T0 });
  forged.tags = red.tags; // tampering breaks the signature
  assert.throws(() => acceptRedemption({ invite, code, redemption: forged, issuerSk: a.sk, now: T0 }), /invalid redemption/);
  const wrongCode = redeemInvite({ invite, code: 'nope', inviteeSk: thief.sk, createdAt: T0 });
  assert.throws(() => acceptRedemption({ invite, code, redemption: wrongCode, issuerSk: a.sk, now: T0 }), /bad proof/);
});

test('expired and used-up invites are refused', () => {
  const a = person(), b = person();
  const { code, invite } = createInvite(a.sk, { createdAt: T0, expiresAt: T0 + DAY });
  const red = redeemInvite({ invite, code, inviteeSk: b.sk, createdAt: T0 });
  assert.throws(() => acceptRedemption({ invite, code, redemption: red, issuerSk: a.sk, now: T0 + 2 * DAY }), /expired/);
  assert.throws(() => acceptRedemption({ invite, code, redemption: red, issuerSk: a.sk, now: T0, usedCount: 1 }), /already used/);
});

test('graph is order independent and latest vouch/unvouch wins', () => {
  const a = person(), b = person();
  const evs = [createVouch(a.sk, b.pk, { createdAt: T0 }), createUnvouch(a.sk, b.pk, { createdAt: T0 + 5 })];
  const g1 = new VouchGraph().addAll(evs);
  const g2 = new VouchGraph().addAll([...evs].reverse());
  assert.deepEqual(g1.edges(), []);
  assert.deepEqual(g2.edges(), []);
  const g3 = new VouchGraph().addAll([...evs, createVouch(a.sk, b.pk, { createdAt: T0 + 9 })]);
  assert.equal(g3.edges().length, 1);
});

test('forged vouches are ignored', () => {
  const a = person(), b = person();
  const v = createVouch(a.sk, b.pk, { createdAt: T0 });
  v.tags[0][1] = person().pk;
  const g = new VouchGraph();
  assert.equal(g.add(v), false);
  assert.equal(g.edges().length, 0);
});

test('hops and tiers', () => {
  const owner = person(), friend = person(), x = person(), y = person(), z = person();
  const g = new VouchGraph().addAll([
    createVouch(friend.sk, x.pk, { createdAt: T0 }),
    createVouch(x.sk, y.pk, { createdAt: T0 }),
    createVouch(y.sk, z.pk, { createdAt: T0 }),
  ]);
  const base = { owner: owner.pk, contacts: [friend.pk], graph: g };
  assert.equal(admissionTier({ ...base, sender: friend.pk }).tier, 'A');
  assert.equal(admissionTier({ ...base, sender: x.pk }).tier, 'A');
  assert.equal(admissionTier({ ...base, sender: y.pk }).tier, 'B');
  assert.equal(admissionTier({ ...base, sender: z.pk }).tier, 'D');
  assert.equal(admissionTier({ ...base, sender: z.pk, proofs: { personhood: true } }).tier, 'C');
  assert.equal(admissionTier({ ...base, sender: z.pk, proofs: { deposit: true } }).tier, 'C');
  assert.equal(admissionTier({ ...base, sender: z.pk, proofs: { personhood: true, accountAgeDays: 400 } }).tier, 'B');
  assert.equal(admissionTier({ ...base, sender: z.pk, proofs: { accountAgeDays: 4000 } }).tier, 'D');
});

test('removing a member strikes and suspends the voucher; two strikes cut their branch', () => {
  const owner = person(), v = person(), bad1 = person(), bad2 = person(), good = person(), later = person();
  const g = new VouchGraph({ suspensionSeconds: 30 * DAY, maxStrikes: 2 }).addAll([
    createVouch(owner.sk, v.pk, { createdAt: T0 }),
    createVouch(v.sk, good.pk, { createdAt: T0 }),
    createVouch(v.sk, bad1.pk, { createdAt: T0 }),
    createVouch(v.sk, bad2.pk, { createdAt: T0 }),
    createVouch(v.sk, later.pk, { createdAt: T0 + 10 * DAY }),
  ]);
  assert.equal(g.hops([owner.pk], good.pk), 2);
  g.removeMember(bad1.pk, T0 + 5 * DAY);
  // one strike: earlier vouches still count, the vouch made during suspension does not
  assert.equal(g.hops([owner.pk], good.pk), 2);
  assert.equal(g.hops([owner.pk], later.pk), Infinity);
  assert.equal(g.hops([owner.pk], bad1.pk), Infinity);
  g.removeMember(bad2.pk, T0 + 6 * DAY);
  // two strikes: nothing vouched by v counts any more, but v itself is still vouched by owner
  assert.equal(g.hops([owner.pk], v.pk), 1);
  assert.equal(g.hops([owner.pk], good.pk), Infinity);
  assert.equal(admissionTier({ owner: owner.pk, graph: g, sender: bad1.pk }).tier, 'D');
});

import { signEvent as _sign } from '../src/event.js';
import { followedByFollows } from '../src/trust.js';

test('follow lists give a capped tier-C signal', () => {
  const owner = person(), sender = person();
  const friends = [person(), person(), person(), person()];
  const fl = (p, follows, t = T0) => _sign({ kind: 3, created_at: t, tags: follows.map(f => ['p', f.pk]), content: '' }, p.sk);
  const lists = [fl(owner, friends), fl(friends[0], [sender]), fl(friends[1], [sender]), fl(friends[2], [sender, owner])];
  assert.equal(followedByFollows(lists, owner.pk, sender.pk), 3);
  assert.equal(admissionTier({ owner: owner.pk, sender: sender.pk, proofs: { followedBy: 3 } }).tier, 'C');
  assert.equal(admissionTier({ owner: owner.pk, sender: sender.pk, proofs: { followedBy: 2 } }).tier, 'D');
  // a newer list from friends[2] that drops the sender wins
  assert.equal(followedByFollows([...lists, fl(friends[2], [owner], T0 + 1)], owner.pk, sender.pk), 2);
  // forged lists and lists from accounts the owner doesn't follow don't count
  const forged = fl(friends[3], [sender]); forged.tags.push(['p', person().pk]);
  const stranger = person();
  assert.equal(followedByFollows([...lists, forged, fl(stranger, [sender])], owner.pk, sender.pk), 3);
});
