// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// Each check in invite redemption and each rule of the vouch graph, at its exact boundary, with an input only that
// rule can stop. Found by mutation testing (21 Nov 2026): every redemption check could be deleted without a test
// failing, because the older tests reached each refusal only through a path where another check also fired.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';
import { KIND } from '../src/kinds.js';
import {
  createInvite, redeemInvite, redemptionProof, acceptRedemption, createVouch, createUnvouch, VouchGraph,
} from '../src/vouch.js';

const T0 = 1_800_000_000;
const DAY = 86400;
const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };

// ---- invite redemption ----------------------------------------------------------------------------------------------

function flow(opts = {}) {
  const issuer = person(), invitee = person();
  const { code, invite } = createInvite(issuer.sk, { createdAt: T0, ...opts });
  const redemption = redeemInvite({ invite, code, inviteeSk: invitee.sk, createdAt: T0 + 1 });
  return { issuer, invitee, code, invite, redemption };
}
const accept = (f, over = {}) => acceptRedemption({ invite: f.invite, code: f.code, redemption: f.redemption, issuerSk: f.issuer.sk, now: T0 + 2, ...over });

test('acceptRedemption: the happy path gives a vouch with the invite scope and a link to the invite', () => {
  const f = flow({ scope: 'pay-pool' });
  const v = accept(f);
  assert.equal(v.kind, KIND.VOUCH);
  assert.equal(v.pubkey, f.issuer.pk);
  assert.deepEqual(v.tags, [['p', f.invitee.pk], ['scope', 'pay-pool'], ['invite', f.invite.id]]);
  assert.equal(v.created_at, T0 + 2);
});

test('acceptRedemption: a correctly signed event that is not an invite is refused', () => {
  const f = flow();
  const notInvite = signEvent({ kind: KIND.VOUCH, created_at: T0, tags: f.invite.tags, content: '' }, f.issuer.sk);
  assert.throws(() => accept(f, { invite: notInvite }), { message: 'invalid invite' });
  assert.throws(() => accept(f, { invite: { ...f.invite, content: 'x' } }), { message: 'invalid invite' });
});

test('acceptRedemption: a forged or wrong-kind redemption is refused', () => {
  const f = flow();
  assert.throws(() => accept(f, { redemption: { ...f.redemption, content: 'x' } }), { message: 'invalid redemption' });
  const wrongKind = signEvent({ kind: KIND.VOUCH, created_at: T0, tags: f.redemption.tags, content: '' }, f.invitee.sk);
  assert.throws(() => accept(f, { redemption: wrongKind }), { message: 'invalid redemption' });
});

test('acceptRedemption: a code that does not hash to the invite is refused before anything else about it', () => {
  const f = flow();
  assert.throws(() => accept(f, { code: f.code.replace(/.$/, c => (c === '0' ? '1' : '0')) }), { message: 'code does not match invite' });
});

test('acceptRedemption: a valid redemption of another invite by the same issuer is refused', () => {
  const f = flow();
  const other = createInvite(f.issuer.sk, { createdAt: T0 });
  // same code checks out against `other` only if we pass other's code; build a redemption of `other`, present it for f.invite
  const r2 = redeemInvite({ invite: other.invite, code: f.code, inviteeSk: f.invitee.sk, createdAt: T0 + 1 });
  assert.throws(() => accept(f, { redemption: r2 }), { message: 'redemption is for another invite' });
});

test('acceptRedemption: a proof made for another key is refused', () => {
  const f = flow();
  const thief = person();
  const stolen = signEvent({ kind: KIND.REDEEM, created_at: T0 + 1, content: '',
    tags: [['e', f.invite.id], ['p', f.issuer.pk], ['proof', redemptionProof(f.code, f.invitee.pk)]] }, thief.sk);
  assert.throws(() => accept(f, { redemption: stolen }), { message: 'bad proof of code' });
});

test('acceptRedemption: expiry is inclusive: accepted at the expiration second, refused one second later', () => {
  const f = flow({ expiresAt: T0 + 100 });
  assert.equal(accept(f, { now: T0 + 100 }).kind, KIND.VOUCH);
  assert.throws(() => accept(f, { now: T0 + 101 }), { message: 'invite expired' });
  const d = flow();
  assert.equal(accept(d, { now: T0 + 14 * DAY }).kind, KIND.VOUCH, 'default lifetime is 14 days');
  assert.throws(() => accept(d, { now: T0 + 14 * DAY + 1 }), { message: 'invite expired' });
});

test('acceptRedemption: use count is checked against max_uses exactly', () => {
  const f = flow({ maxUses: 2 });
  assert.equal(accept(f, { usedCount: 1 }).kind, KIND.VOUCH);
  assert.throws(() => accept(f, { usedCount: 2 }), { message: 'invite already used' });
});

test('acceptRedemption: the issuer cannot redeem their own invite to vouch for themselves', () => {
  const issuer = person();
  const { code, invite } = createInvite(issuer.sk, { createdAt: T0 });
  const self = redeemInvite({ invite, code, inviteeSk: issuer.sk, createdAt: T0 + 1 });
  assert.throws(() => acceptRedemption({ invite, code, redemption: self, issuerSk: issuer.sk, now: T0 + 2 }), { message: 'cannot vouch for yourself' });
});

test('createVouch: the invite link is present only when given', () => {
  const a = person(), b = person();
  assert.deepEqual(createVouch(a.sk, b.pk, { createdAt: T0 }).tags, [['p', b.pk], ['scope', 'general']]);
});

// ---- VouchGraph.add ---------------------------------------------------------------------------------------------------

test('add: refuses forged, wrong-kind, subject-less and self vouches, and records them as rejected', () => {
  const a = person(), b = person();
  const g = new VouchGraph();
  const forged = { ...createVouch(a.sk, b.pk, { createdAt: T0 }), content: 'x' };
  const wrongKind = signEvent({ kind: 1, created_at: T0, tags: [['p', b.pk]], content: '' }, a.sk);
  const noSubject = signEvent({ kind: KIND.VOUCH, created_at: T0, tags: [], content: '' }, a.sk);
  const self = createVouch(a.sk, a.pk, { createdAt: T0 });
  assert.deepEqual([forged, wrongKind, noSubject, self].map(e => g.add(e)), [false, false, false, false]);
  assert.deepEqual(g.rejected, [forged.id, wrongKind.id, noSubject.id, self.id]);
  assert.equal(g.add(null), false);
  assert.deepEqual(g.rejected.at(-1), null);
  assert.deepEqual(g.edges(), []);
  assert.equal(g.add(createVouch(a.sk, b.pk, { createdAt: T0 })), true);
});

test('add: latest wins; on equal time the higher id wins, whatever the arrival order', () => {
  const a = person(), b = person();
  const v = createVouch(a.sk, b.pk, { createdAt: T0 });
  const u = createUnvouch(a.sk, b.pk, { createdAt: T0 + 1 });
  for (const order of [[v, u], [u, v]]) assert.equal(new VouchGraph().addAll(order).edges().length, 0);
  let x, y;
  for (let i = 0; i < 200; i++) { // equal-time pair; check both id orders give the same, id-decided answer
    x = createVouch(a.sk, b.pk, { createdAt: T0 + 5, scope: `s${i}` });
    y = createUnvouch(a.sk, b.pk, { createdAt: T0 + 5, reason: `r${i}` });
    if (x.id > y.id) break;
  }
  assert.ok(x.id > y.id, 'test setup: need the vouch to have the higher id');
  for (const order of [[x, y], [y, x]]) assert.equal(new VouchGraph().addAll(order).edges().length, 1);
});

test('add: an older event never replaces a newer one, even with a higher id', () => {
  // The id only breaks ties at equal time. Found by the TS mutation run (22 Nov 2026): the test above killed the
  // "id decides at any time" mutant only when random ids happened to fall the right way.
  const a = person(), b = person();
  const u = createUnvouch(a.sk, b.pk, { createdAt: T0 + 1 });
  let v;
  for (let i = 0; i < 200; i++) {
    v = createVouch(a.sk, b.pk, { createdAt: T0, scope: `s${i}` });
    if (v.id > u.id) break;
  }
  assert.ok(v.id > u.id, 'test setup: need the older vouch to have the higher id');
  for (const order of [[v, u], [u, v]]) assert.equal(new VouchGraph().addAll(order).edges().length, 0);
});

// ---- removals, strikes, suspensions ---------------------------------------------------------------------------------

test('removeMember: the earliest removal time is kept', () => {
  const g = new VouchGraph();
  g.removeMember('k', T0 + 10);
  g.removeMember('k', T0 + 20);
  g.removeMember('k', T0 + 5);
  assert.equal(g.removed.get('k'), T0 + 5);
});

test('defaults: 90-day suspension, two strikes', () => {
  const g = new VouchGraph();
  assert.deepEqual([g.suspensionSeconds, g.maxStrikes], [90 * DAY, 2]);
});

test('strikes: a vouch made at the removal second counts; one made after does not', () => {
  const a = person(), bad = person();
  const at = (t) => { const g = new VouchGraph().addAll([createVouch(a.sk, bad.pk, { createdAt: t })]); g.removeMember(bad.pk, T0); return g.strikes(); };
  assert.equal(at(T0).get(a.pk)?.count, 1);
  assert.equal(at(T0 + 1).get(a.pk), undefined);
});

test('activeEdges: edges from or to a removed member carry no trust', () => {
  const a = person(), b = person(), c = person();
  const g = new VouchGraph().addAll([createVouch(a.sk, b.pk, { createdAt: T0 }), createVouch(b.sk, c.pk, { createdAt: T0 })]);
  g.removeMember(b.pk, T0 + 1);
  assert.deepEqual(g.activeEdges(), []);
});

test('activeEdges: a struck voucher\'s new vouches are suspended for exactly [removal, removal + suspension)', () => {
  const a = person(), bad = person(), n1 = person(), n2 = person(), n3 = person(), old = person();
  const g = new VouchGraph({ suspensionSeconds: 100, maxStrikes: 5 }).addAll([
    createVouch(a.sk, bad.pk, { createdAt: T0 - 50 }),
    createVouch(a.sk, old.pk, { createdAt: T0 - 1 }), // before the window: kept
    createVouch(a.sk, n1.pk, { createdAt: T0 }), // window start: suspended
    createVouch(a.sk, n2.pk, { createdAt: T0 + 99 }), // last second inside: suspended
    createVouch(a.sk, n3.pk, { createdAt: T0 + 100 }), // window end: kept
  ]);
  g.removeMember(bad.pk, T0);
  const subjects = g.activeEdges().map(e => e.subject).sort();
  assert.deepEqual(subjects, [old.pk, n3.pk].sort());
});

test('activeEdges: reaching maxStrikes cuts every vouch of that voucher; one fewer does not', () => {
  const a = person(), x = person(), y = person(), keep = person();
  const graph = (maxStrikes) => {
    const g = new VouchGraph({ suspensionSeconds: 1, maxStrikes }).addAll([
      createVouch(a.sk, x.pk, { createdAt: T0 }), createVouch(a.sk, y.pk, { createdAt: T0 }), createVouch(a.sk, keep.pk, { createdAt: T0 }),
    ]);
    g.removeMember(x.pk, T0 + 10);
    g.removeMember(y.pk, T0 + 10);
    return g.activeEdges().map(e => e.subject);
  };
  assert.deepEqual(graph(2), []);
  assert.deepEqual(graph(3), [keep.pk]);
});

// ---- edges, hops, inviteTree ----------------------------------------------------------------------------------------

test('edges: sorted by issuer then subject, the same for any arrival order', () => {
  const ps = [person(), person(), person(), person()];
  const vs = [];
  for (const i of ps) for (const s of ps) if (i !== s) vs.push(createVouch(i.sk, s.pk, { createdAt: T0 }));
  const want = vs.map(v => ({ issuer: v.pubkey, subject: v.tags[0][1], at: T0 }))
    .sort((a, b) => (a.issuer + a.subject < b.issuer + b.subject ? -1 : 1));
  assert.deepEqual(new VouchGraph().addAll(vs).edges(), want);
  assert.deepEqual(new VouchGraph().addAll([...vs].reverse()).edges(), want);
});

test('hops: removed target is unreachable; removed roots do not count; a root is 0 hops', () => {
  const r = person(), m = person(), t = person();
  const g = new VouchGraph().addAll([createVouch(r.sk, m.pk, { createdAt: T0 }), createVouch(m.sk, t.pk, { createdAt: T0 })]);
  assert.equal(g.hops([r.pk], t.pk), 2);
  assert.equal(g.hops([r.pk, t.pk], t.pk), 0);
  assert.equal(g.hops([r.pk], t.pk, 1), Infinity, 'maxHops is respected');
  const removedRoot = new VouchGraph().addAll([createVouch(r.sk, m.pk, { createdAt: T0 })]);
  removedRoot.removeMember(r.pk, T0 + 1);
  assert.equal(removedRoot.hops([r.pk], m.pk), Infinity);
  assert.equal(removedRoot.hops([r.pk], r.pk), Infinity, 'a removed root is not even 0 hops from itself');
});

test('hops: cycles do not loop and the shortest path wins', () => {
  const a = person(), b = person(), c = person(), d = person();
  const g = new VouchGraph().addAll([
    createVouch(a.sk, b.pk, { createdAt: T0 }), createVouch(b.sk, a.pk, { createdAt: T0 }),
    createVouch(b.sk, c.pk, { createdAt: T0 }), createVouch(c.sk, b.pk, { createdAt: T0 }),
    createVouch(c.sk, d.pk, { createdAt: T0 }), createVouch(a.sk, c.pk, { createdAt: T0 }),
  ]);
  assert.equal(g.hops([a.pk], d.pk, 10), 2);
  assert.equal(g.hops([a.pk], person().pk, 10), Infinity);
});

test('inviteTree: a forest from the roots, each key once, removed branches left out', () => {
  const r = person(), a = person(), b = person(), c = person(), gone = person();
  const g = new VouchGraph().addAll([
    createVouch(r.sk, a.pk, { createdAt: T0 }), createVouch(r.sk, b.pk, { createdAt: T0 }),
    createVouch(a.sk, c.pk, { createdAt: T0 }), createVouch(b.sk, c.pk, { createdAt: T0 }),
    createVouch(c.sk, r.pk, { createdAt: T0 }), createVouch(r.sk, gone.pk, { createdAt: T0 }),
  ]);
  g.removeMember(gone.pk, T0 + 1);
  const tree = g.inviteTree([r.pk]);
  const keys = [];
  const walk = n => { keys.push(n.key); n.children.forEach(walk); };
  tree.forEach(walk);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].key, r.pk);
  assert.deepEqual([...keys].sort(), [r.pk, a.pk, b.pk, c.pk].sort(), 'each key exactly once; cycle back to r ignored');
  assert.deepEqual(tree[0].children.map(n => n.key).sort(), [a.pk, b.pk].sort());
  assert.deepEqual(new VouchGraph().inviteTree([r.pk]), [{ key: r.pk, children: [] }]);
});

test('redeemInvite: the redemption names the invite, addresses the issuer and carries the key-bound proof', () => {
  const f = flow();
  assert.deepEqual(f.redemption.tags, [['e', f.invite.id], ['p', f.issuer.pk], ['proof', redemptionProof(f.code, f.invitee.pk)]]);
  assert.equal(f.redemption.kind, KIND.REDEEM);
});

test('removeMember: the earliest time is kept whatever the order of calls', () => {
  const g = new VouchGraph();
  g.removeMember('k', T0 + 10);
  g.removeMember('k', T0 + 5);
  g.removeMember('k', T0 + 20);
  assert.equal(g.removed.get('k'), T0 + 5);
});

test('activeEdges: a vouch inside any one of several suspension windows is suspended', () => {
  const a = person(), bad1 = person(), bad2 = person(), n = person();
  const g = new VouchGraph({ suspensionSeconds: 100, maxStrikes: 5 }).addAll([
    createVouch(a.sk, bad1.pk, { createdAt: T0 - 10 }), createVouch(a.sk, bad2.pk, { createdAt: T0 - 10 }),
    createVouch(a.sk, n.pk, { createdAt: T0 + 50 }), // inside window 1 only
  ]);
  g.removeMember(bad1.pk, T0);
  g.removeMember(bad2.pk, T0 + 1000);
  assert.deepEqual(g.activeEdges().map(e => e.subject), []);
});

test('createUnvouch: without a reason the content is empty', () => {
  // Found by the TS mutation run (22 Nov 2026): the default reason was not pinned.
  const a = person(), b = person();
  assert.equal(createUnvouch(a.sk, b.pk, { createdAt: T0 }).content, '');
});
