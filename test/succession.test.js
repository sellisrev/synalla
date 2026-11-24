// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// The W2 recovery rule (decision 3): boundary tests for each rule, then property tests over random worlds with an
// attacker (thief holding the old key, colluding contacts, strangers, forged claims) and every input order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { succession, HOLD, CONTACT_MIN_AGE } from '../src/succession.js';

const DAY = 86400;
const T = 1_800_000_000;
const OLD = 'old', NEW = 'new';
const claim = (id, next, seenAt = T, old = OLD) => ({ type: 'claim', id, old, next, seenAt });
const att = (id, c, attester, seenAt = T + 10, channel = 'phone', cites = []) => ({ type: 'attest', id, claim: c, attester, channel, seenAt, cites });
const deny = (id, c, seenAt = T + 5, old = OLD) => ({ type: 'deny', id, claim: c, old, seenAt });
const peer = (contacts, extra = {}) => ({ contacts: new Map(contacts.map(k => [k, T - 30 * DAY])), now: T + 10 * DAY, ...extra });

test('nothing held: normal, old key trusted', () => {
  const r = succession(OLD, [], peer(['a']));
  assert.equal(r.state, 'normal'); assert.equal(r.oldKeyTrusted, true); assert.equal(r.effective, false);
});

test('a claim nobody counts for is only a warning: the old key stays trusted', () => {
  const r = succession(OLD, [claim('c', NEW), att('x', 'c', 'stranger')], peer(['a']));
  assert.equal(r.state, 'claimed'); assert.equal(r.oldKeyTrusted, true);
});

test('1 counting attester suspends, 2 accept, with the 72-hour hold', () => {
  const s1 = succession(OLD, [claim('c', NEW), att('1', 'c', 'a')], peer(['a', 'b']));
  assert.equal(s1.state, 'suspended'); assert.equal(s1.oldKeyTrusted, false);
  const st = [claim('c', NEW), att('1', 'c', 'a', T + 10), att('2', 'c', 'b', T + 20)];
  const early = succession(OLD, st, peer(['a', 'b'], { now: T + 20 + HOLD - 1 }));
  assert.equal(early.state, 'accepted'); assert.equal(early.successor, NEW);
  assert.equal(early.acceptedAt, T + 20); assert.equal(early.effectiveAt, T + 20 + HOLD); assert.equal(early.effective, false);
  assert.equal(succession(OLD, st, peer(['a', 'b'], { now: T + 20 + HOLD })).effective, true);
});

test('what counts: contact age (exact 14-day boundary), channel, old/new keys, one count per attester', () => {
  const contacts = new Map([['a', T - CONTACT_MIN_AGE], ['b', T - CONTACT_MIN_AGE + 1], [OLD, T - 99 * DAY], [NEW, T - 99 * DAY], ['c', T - 99 * DAY]]);
  const st = [claim('c', NEW), att('1', 'c', 'a'), att('2', 'c', 'b'), att('3', 'c', OLD), att('4', 'c', NEW),
    att('5', 'c', 'c', T + 10, 'email'), att('6', 'c', 'a', T + 30)];
  const r = succession(OLD, st, { contacts, now: T });
  assert.deepEqual(r.claims[0].counting, ['a']);
  assert.equal(r.state, 'suspended');
});

test('statements about other keys or unknown claims are ignored', () => {
  const st = [claim('c', NEW, T, 'someone-else'), att('1', 'c', 'a'), att('2', 'c', 'b'), deny('d', 'zzz')];
  assert.equal(succession(OLD, st, peer(['a', 'b'])).state, 'normal');
  assert.equal(succession(OLD, [claim('c', OLD)], peer([])).state, 'normal', 'a claim naming the old key as its own successor is void');
});

test('a denial by the old key disputes; 3 attesters who cite it settle', () => {
  const base = [claim('c', NEW), deny('d', 'c', T + 5), att('1', 'c', 'a'), att('2', 'c', 'b')];
  assert.equal(succession(OLD, base, peer(['a', 'b', 'e'])).state, 'disputed');
  assert.equal(succession(OLD, [claim('c', NEW), deny('d', 'c'), att('1', 'c', 'a')], peer(['a'])).state, 'disputed');
  const notCiting = [...base, att('3', 'c', 'e', T + 50)];
  assert.equal(succession(OLD, notCiting, peer(['a', 'b', 'e'])).state, 'disputed');
  const citing = [claim('c', NEW), deny('d', 'c', T + 5),
    att('1', 'c', 'a', T + 10, 'phone', ['d']), att('2', 'c', 'b', T + 20, 'signal', ['d']), att('3', 'c', 'e', T + 30, 'in_person', ['d'])];
  const r = succession(OLD, citing, peer(['a', 'b', 'e']));
  assert.equal(r.state, 'accepted'); assert.equal(r.acceptedAt, T + 30); assert.equal(r.claims[0].settled, true);
  // Later denials by the old key do not reopen a settled claim.
  assert.equal(succession(OLD, [...citing, deny('d2', 'c', T + 999)], peer(['a', 'b', 'e'])).state, 'accepted');
});

test('a settled claim takes effect 72 hours after its last conflict or third fresh attestation', () => {
  const st = [claim('c', NEW), att('1', 'c', 'a', T + 10, 'phone', ['d']), att('2', 'c', 'b', T + 20, 'phone', ['d']),
    att('3', 'c', 'e', T + 30, 'phone', ['d']), deny('d', 'c', T + 100)];
  const r = succession(OLD, st, peer(['a', 'b', 'e']));
  assert.equal(r.acceptedAt, T + 100);
});

test('rival claims: both at 2 disputed; one settled wins; both settled disputed; a rival at 1 does not block', () => {
  const two = [claim('c', NEW), claim('f', 'fake'), att('1', 'c', 'a'), att('2', 'c', 'b'), att('3', 'f', 'x'), att('4', 'f', 'y')];
  const p = peer(['a', 'b', 'e', 'x', 'y', 'z']);
  assert.equal(succession(OLD, two, p).state, 'disputed');
  const oneRival = [claim('c', NEW), claim('f', 'fake'), att('1', 'c', 'a'), att('2', 'c', 'b'), att('3', 'f', 'x')];
  assert.equal(succession(OLD, oneRival, p).successor, NEW);
  const settled = [claim('c', NEW), claim('f', 'fake'), att('1', 'c', 'a', T, 'phone', ['f']), att('2', 'c', 'b', T, 'phone', ['f']),
    att('5', 'c', 'e', T, 'phone', ['f']), att('3', 'f', 'x', T, 'phone', ['c']), att('4', 'f', 'y', T, 'phone', ['c'])];
  assert.equal(succession(OLD, settled, p).successor, NEW);
  const both = [...settled, att('6', 'f', 'z', T, 'phone', ['c'])];
  assert.equal(succession(OLD, both, p).state, 'disputed');
});

test("the peer's owner confirming accepts that claim; confirming two rivals disputes", () => {
  const st = [claim('c', NEW), claim('f', 'fake')];
  const r = succession(OLD, st, peer([], { confirmed: new Map([['c', T + 7]]) }));
  assert.equal(r.state, 'accepted'); assert.equal(r.successor, NEW); assert.equal(r.acceptedAt, T + 7);
  assert.equal(succession(OLD, st, peer([], { confirmed: new Map([['c', T], ['f', T]]) })).state, 'disputed');
  assert.equal(succession(OLD, st, peer([], { confirmed: new Map([['nope', T]]) })).state, 'claimed', 'unknown confirmations ignored');
});

test('bad input throws', () => {
  assert.throws(() => succession('', [], peer([])), TypeError);
  assert.throws(() => succession(OLD, [], { contacts: {}, now: T }), TypeError);
  assert.throws(() => succession(OLD, [{ type: 'claim', id: '', old: OLD, next: NEW, seenAt: T }], peer([])), TypeError);
  assert.throws(() => succession(OLD, [{ type: 'claim', id: 'c', old: OLD, next: NEW, seenAt: NaN }], peer([])), TypeError);
});

// ---- property tests -------------------------------------------------------------------------------------------------

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
function shuffle(r, xs) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/**
 * A random world. The real owner lost every device and claims NEW. Honest contacts attest only the real claim, citing
 * the conflicts they know of. The attacker holds `colluders` of the peer's contacts, any number of strangers, may forge
 * claims, and if `thief` also holds the old key (so may deny the real claim). Otherwise the real owner still has a live
 * device with the old key and denies every forged claim when `ownerAlert`.
 */
function world(r) {
  const honest = Array.from({ length: Math.floor(r() * 6) }, (_, i) => `h${i}`);
  const colluders = Array.from({ length: Math.floor(r() * 4) }, (_, i) => `x${i}`);
  const strangers = ['s0', 's1'];
  const thief = r() < 0.5, ownerAlert = !thief && r() < 0.7;
  const contacts = new Map();
  for (const k of [...honest, ...colluders]) contacts.set(k, r() < 0.85 ? T - 60 * DAY : T - Math.floor(r() * 13) * DAY);
  const st = [];
  const real = r() < 0.8; if (real) st.push(claim('R', NEW, T));
  const forged = Array.from({ length: Math.floor(r() * 3) }, (_, i) => `F${i}`);
  for (const f of forged) st.push(claim(f, `fake${f}`, T + Math.floor(r() * DAY)));
  let n = 0; const id = p => `${p}${n++}`;
  if (thief && real) for (let i = Math.floor(r() * 3); i > 0; i--) st.push(deny(id('dR'), 'R', T + Math.floor(r() * 5 * DAY)));
  if (ownerAlert) for (const f of forged) st.push(deny(id('dF'), f, T + DAY + Math.floor(r() * DAY)));
  const conflictsOf = c => st.filter(s => (s.type === 'deny' && s.claim === c) || (s.type === 'claim' && s.id !== c)).map(s => s.id);
  if (real) for (const h of honest) if (r() < 0.8) {
    const cites = r() < 0.6 ? conflictsOf('R') : [];
    st.push(att(id('a'), 'R', h, T + Math.floor(r() * 4 * DAY), pick(r, ['phone', 'signal', 'in_person']), cites));
  }
  const targets = [...forged, ...(real ? ['R'] : [])];
  for (const x of [...colluders, ...strangers]) for (const f of forged) if (r() < 0.8) {
    st.push(att(id('a'), f, x, T + Math.floor(r() * 4 * DAY), pick(r, ['phone', 'signal', 'email']), r() < 0.7 ? conflictsOf(f) : []));
  }
  if (targets.length && r() < 0.3) st.push(att(id('a'), pick(r, targets), pick(r, colluders.length ? colluders : strangers), T + 3 * DAY, 'phone', []));
  const confirmed = r() < 0.1 && real ? new Map([['R', T + 2 * DAY]]) : undefined;
  return { st, honest, colluders, thief, ownerAlert, real, forged, peer: { contacts, now: T + Math.floor(r() * 8 * DAY), ...(confirmed ? { confirmed } : {}) } };
}

const eligible = (w, k) => (w.peer.contacts.get(k) ?? Infinity) <= T - CONTACT_MIN_AGE;

test('properties hold over 20,000 random worlds and input orders', () => {
  const r = rng(20261124);
  for (let i = 0; i < 20000; i++) {
    const w = world(r);
    const out = succession(OLD, w.st, w.peer);
    const ctx = () => JSON.stringify({ i, out, w: { ...w, peer: { ...w.peer, contacts: [...w.peer.contacts] } } });

    // Order never matters.
    assert.deepEqual(succession(OLD, shuffle(r, w.st), w.peer), out, ctx());

    // Accepted needs 2 counting attesters or the owner's own confirmation; effective exactly after the hold.
    if (out.state === 'accepted') {
      const s = out.claims.find(c => c.id === out.claim);
      assert.ok(s.counting.length >= 2 || w.peer.confirmed?.has(out.claim), ctx());
      assert.equal(out.effective, w.peer.now >= out.acceptedAt + HOLD, ctx());
    } else assert.equal(out.effective, false, ctx());

    // A forged successor is accepted only with 2+ colluding contacts old enough to count; if the real owner denied it
    // from a live device, only with 3+.
    if (out.state === 'accepted' && out.successor !== NEW) {
      const k = w.colluders.filter(x => eligible(w, x)).length;
      assert.ok(k >= (w.ownerAlert ? 3 : 2), ctx());
    }

    // Forged claims with no counting attester never cost the owner their old key.
    if (!w.peer.confirmed && out.claims.every(c => c.counting.length === 0)) assert.ok(['normal', 'claimed'].includes(out.state), ctx());

    // A thief's denials cannot block recovery once 3 eligible honest contacts attested citing them, unless the
    // attacker also has a settled forged claim.
    if (w.thief && w.real && !w.peer.confirmed) {
      const fresh = out.claims.find(c => c.id === 'R')?.fresh.filter(h => w.honest.includes(h)) ?? [];
      const forgedSettled = out.claims.some(c => c.id !== 'R' && c.settled);
      if (fresh.length >= 3 && !forgedSettled) assert.equal(out.successor, NEW, ctx());
    }
  }
});
