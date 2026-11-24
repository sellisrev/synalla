// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Golden vectors: one fixed walk through every public function, plus seeded random inputs for the pure validators.
// Randomness (keys, nonces, invite codes, signature aux bytes) and the clock are replaced by seeded stand-ins, so the
// walk gives the same outputs on every run. test/golden.test.js replays it against the recorded file; any port of
// the library (the TypeScript one first) must reproduce every entry, including the order randomness is drawn in.
//
// run(lib) takes the library module as an argument, so the same walk can be pointed at src/index.js or a port.

export const T0 = 1_800_000_000;
const S64 = c => c.repeat(64);

function prng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Replace crypto.getRandomValues and Date.now with seeded versions while fn runs. */
export async function deterministic(seed, fn) {
  const rnd = prng(seed);
  const c = globalThis.crypto;
  const realRandom = c.getRandomValues, realNow = Date.now;
  c.getRandomValues = arr => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rnd() * 256);
    return arr;
  };
  Date.now = () => T0 * 1000 + 123;
  try { return await fn(rnd); } finally { c.getRandomValues = realRandom; Date.now = realNow; }
}

/** JSON-safe snapshot: bytes as hex, Maps and Sets as arrays, class instances with their class name. */
export function snap(v, seen = new WeakSet()) {
  if (v === undefined) return { $undefined: true };
  if (typeof v === 'number' && !Number.isFinite(v)) return { $number: String(v) };
  if (typeof v === 'bigint') return { $bigint: String(v) };
  if (typeof v === 'function') return { $function: true };
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return { $cycle: true };
  seen.add(v);
  try {
    if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('hex') };
    if (v instanceof Map) return { $map: [...v].map(([k, x]) => [snap(k, seen), snap(x, seen)]) };
    if (v instanceof Set) return { $set: [...v].map(x => snap(x, seen)) };
    if (Array.isArray(v)) return v.map(x => snap(x, seen));
    const out = {};
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) out.$class = proto.constructor?.name ?? '?';
    for (const k of Object.keys(v)) out[k] = snap(v[k], seen);
    return out;
  } finally { seen.delete(v); }
}

export async function run(lib) {
  const out = [];
  const call = (name, fn) => {
    let r;
    try { r = { value: snap(fn()) }; } catch (e) { r = { throws: `${e?.constructor?.name}: ${e?.message}` }; }
    out.push({ name, ...r });
    return r.value;
  };
  const live = (name, fn) => { // like call, but returns the live value for later steps
    let v;
    try { v = fn(); out.push({ name, value: snap(v) }); } catch (e) { out.push({ name, throws: `${e?.constructor?.name}: ${e?.message}` }); }
    return v;
  };

  await deterministic(1, async rnd => {
    const L = lib;
    // ---- constants ----
    for (const k of ['KIND', 'SCHEMA_BASE', 'DEFAULT_LINK_BASE', 'DEFAULT_GATE_POLICY', 'INBOX_LIST_KIND', 'KNOCK_KIND',
      'DEFAULT_CATEGORIES', 'NOTE_MAX', 'MIN_K', 'SEAL_KIND', 'WRAP_KIND', 'TIER_ACTION', 'DEFAULT_POLICY']) call('const ' + k, () => L[k]);
    call('exports', () => Object.keys(L).sort());

    // ---- event ----
    const person = name => { const sk = live(`generateSecretKey ${name}`, () => L.generateSecretKey()); return { sk, pk: live(`getPublicKey ${name}`, () => L.getPublicKey(sk)) }; };
    const owner = person('owner'), friend = person('friend'), vouched = person('vouched'), twoHop = person('twoHop'),
      stranger = person('stranger'), human = person('human'), seller = person('seller'), convener = person('convener');
    call('nowSeconds', () => L.nowSeconds());
    call('randomHex default', () => L.randomHex());
    call('randomHex 5', () => L.randomHex(5));
    call('sha256Hex', () => L.sha256Hex('Synalla é ✓'));
    const ev1 = live('signEvent', () => L.signEvent({ kind: 1, tags: [['t', 'x'], ['e', 'y', 'z']], content: 'hello', created_at: T0 }, owner.sk));
    call('signEvent default time', () => L.signEvent({ kind: 1 }, owner.sk));
    call('eventId', () => L.eventId(ev1));
    call('verifyEvent good', () => L.verifyEvent(ev1));
    call('verifyEvent tampered', () => L.verifyEvent({ ...ev1, content: 'x' }));
    call('verifyEvent bad sig', () => L.verifyEvent({ ...ev1, sig: '0'.repeat(128) }));
    call('verifyEvent junk', () => L.verifyEvent(null));
    call('tagValue', () => [L.tagValue(ev1, 'e'), L.tagValue(ev1, 'nope')]);
    for (const [i, t] of [{ kind: -1 }, { kind: 70000 }, { kind: 1, tags: [[1]] }, { kind: 1, content: 5 }, { kind: 1, created_at: -1 }].entries())
      call(`signEvent bad ${i}`, () => L.signEvent(t, owner.sk));

    // ---- vouch ----
    const inv = live('createInvite', () => L.createInvite(owner.sk, { scope: 'general', createdAt: T0, maxUses: 2 }));
    call('createInvite defaults', () => L.createInvite(owner.sk, { createdAt: T0 }));
    call('redemptionProof', () => L.redemptionProof(inv?.code ?? 'c', friend.pk));
    const red = live('redeemInvite', () => L.redeemInvite({ invite: inv.invite, code: inv.code, inviteeSk: friend.sk, createdAt: T0 + 5 }));
    const accepted = live('acceptRedemption', () => L.acceptRedemption({ invite: inv.invite, code: inv.code, redemption: red, issuerSk: owner.sk, now: T0 + 6 }));
    call('acceptRedemption used up', () => L.acceptRedemption({ invite: inv.invite, code: inv.code, redemption: red, issuerSk: owner.sk, usedCount: 2, now: T0 + 6 }));
    call('acceptRedemption wrong code', () => L.acceptRedemption({ invite: inv.invite, code: 'x', redemption: red, issuerSk: owner.sk, now: T0 + 6 }));
    call('acceptRedemption expired', () => L.acceptRedemption({ invite: inv.invite, code: inv.code, redemption: red, issuerSk: owner.sk, now: T0 + 400 * 86400 }));
    const v1 = live('createVouch', () => L.createVouch(friend.sk, vouched.pk, { createdAt: T0 }));
    const v2 = live('createVouch 2', () => L.createVouch(vouched.sk, twoHop.pk, { createdAt: T0, scope: 'work' }));
    const v3 = live('createVouch 3', () => L.createVouch(stranger.sk, human.pk, { createdAt: T0 + 1 }));
    const un = live('createUnvouch', () => L.createUnvouch(stranger.sk, human.pk, { createdAt: T0 + 2, reason: 'spam' }));
    const graph = live('VouchGraph', () => new L.VouchGraph());
    call('VouchGraph.addAll', () => graph.addAll([accepted, v1, v2, v3, un].filter(Boolean)));
    call('VouchGraph.add junk', () => graph.add({ kind: 1 }));
    call('VouchGraph.edges', () => graph.edges());
    call('VouchGraph.activeEdges', () => graph.activeEdges());
    call('VouchGraph.strikes', () => graph.strikes());
    call('VouchGraph.hops', () => [graph.hops([owner.pk], friend.pk), graph.hops([owner.pk], vouched.pk), graph.hops([owner.pk], twoHop.pk), graph.hops([owner.pk], human.pk), graph.hops([owner.pk], twoHop.pk, 2)]);
    call('VouchGraph.inviteTree', () => graph.inviteTree([owner.pk]));
    const g2 = live('VouchGraph opts', () => new L.VouchGraph({ suspensionSeconds: 10, maxStrikes: 1 }).addAll([accepted, v1, v2].filter(Boolean)));
    call('VouchGraph.removeMember', () => { g2.removeMember(vouched.pk, T0 + 100); return [g2.activeEdges(), g2.strikes(), g2.hops([owner.pk], twoHop.pk)]; });

    // ---- trust ----
    const fl = (p, list, at = T0) => L.signEvent({ kind: 3, created_at: at, tags: list.map(x => ['p', x.pk]) }, p.sk);
    const follows = [fl(owner, [friend, vouched, twoHop]), fl(friend, [stranger, human]), fl(vouched, [stranger]), fl(vouched, [human], T0 - 5),
      fl(twoHop, [stranger, owner]), { ...fl(seller, [stranger]), sig: '0'.repeat(128) }, L.signEvent({ kind: 1, tags: [['p', stranger.pk]] }, friend.sk)];
    call('followedByFollows', () => [stranger, human, seller, owner, friend].map(x => L.followedByFollows(follows, owner.pk, x.pk)));
    call('admissionTier followedBy', () => [2, 3].map(followedBy => L.admissionTier({ owner: owner.pk, graph, sender: stranger.pk, proofs: { followedBy, accountAgeDays: 400 } })));
    for (const [name, sender, proofs] of [['contact', friend.pk, {}], ['vouched', vouched.pk, {}], ['twoHop', twoHop.pk, {}], ['human', human.pk, { personhood: true }],
      ['deposit', stranger.pk, { deposit: true }], ['stranger', stranger.pk, {}], ['owner', owner.pk, {}]])
      call('admissionTier ' + name, () => L.admissionTier({ owner: owner.pk, contacts: [friend.pk], graph, sender, proofs }));
    call('admissionTier policy', () => L.admissionTier({ owner: owner.pk, graph, sender: twoHop.pk, policy: { maxHops: 1 } }));

    // ---- knock + gate ----
    call('lintKnockBody', () => ['', 'see https://x.io', 'mail a@b.fr', 'call 06 12 34 56 78', 'message me on Telegram', 'ping @cryptoking99', 'x'.repeat(281), 'Would you compare QA pay bands, 50000-60000?']
      .map(note => L.lintKnockBody({ category: 'question', fields: { topic: 'QA pay' }, note })));
    call('lintKnockBody fields', () => [L.lintKnockBody({ category: 'question', fields: { iban: 'x' } }), L.lintKnockBody({ category: 'nope' }), L.lintKnockBody({ category: 'question', fields: ['x'] })]);
    const knock = (p, note = '', extra = {}) => L.createKnock(p.sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note }, { createdAt: T0, ...extra });
    const k1 = live('createKnock', () => knock(friend, 'hello'));
    call('createKnock recipient', () => knock(friend, '', { recipient: owner.pk }));
    call('createKnock refused', () => knock(friend, 'https://evil.example'));
    call('isKnock', () => [L.isKnock(k1), L.isKnock(ev1), L.isKnock({ ...k1, sig: '0'.repeat(128) })]);
    call('tierAtLeast', () => ['A', 'B', 'C', 'D'].flatMap(t => ['A', 'B', 'C', 'D'].map(m => L.tierAtLeast(t, m))));
    const gate = live('Gate', () => new L.Gate({ owner: owner.pk, contacts: [friend.pk], graph, policy: { dailyCapC: 2, perSenderPerDay: { A: 3 } },
      proofsFor: pk => (pk === human.pk ? { personhood: true } : {}) }));
    for (const [i, [p, note, dt]] of [[friend, 'hi', 0], [vouched, '', 1], [twoHop, 'Hello, same team', 2], [human, '', 3], [stranger, '', 4], [human, '', 5], [human, '', 6],
      [friend, '', 7], [friend, '', 8], [friend, '', 9], [twoHop, '', 86400 + 10]].entries())
      call(`Gate.receive ${i}`, () => gate.receive(knock(p, note, { createdAt: T0 + dt }), T0 + dt));
    call('Gate.receive not a knock', () => gate.receive(ev1, T0));
    call('Gate.receive default time', () => gate.receive(knock(friend), undefined));
    call('Gate.log', () => gate.log);

    // ---- seal ----
    const ck = live('getConversationKey', () => L.getConversationKey(owner.sk, friend.pk));
    call('getConversationKey symmetric', () => Buffer.from(L.getConversationKey(friend.sk, owner.pk)).equals(Buffer.from(ck)));
    call('getMessageKeys', () => L.getMessageKeys(ck, new Uint8Array(32).fill(1)));
    call('calcPaddedLen', () => [1, 2, 31, 32, 33, 64, 65, 100, 255, 256, 257, 1000, 65535].map(n => L.calcPaddedLen(n)));
    call('calcPaddedLen bad', () => L.calcPaddedLen(0));
    const ct = live('encrypt', () => L.encrypt('bonjour é', ck));
    call('encrypt fixed nonce', () => L.encrypt('x'.repeat(300), ck, new Uint8Array(32).fill(9)));
    call('decrypt', () => L.decrypt(ct, ck));
    call('decrypt tampered', () => L.decrypt(ct.slice(0, -4) + 'AAA=', ck));
    call('encrypt empty', () => L.encrypt('', ck));
    const rumor = live('makeRumor', () => L.makeRumor({ kind: 14, content: 'secret note', tags: [['p', friend.pk]], created_at: T0 }, owner.pk));
    call('makeRumor default time', () => L.makeRumor({ kind: 14 }, owner.pk));
    const wrap = live('giftWrap', () => L.giftWrap(rumor, owner.sk, friend.pk, { now: T0 }));
    call('giftWrap signed inner', () => L.unwrap(L.giftWrap(ev1, owner.sk, friend.pk, { now: T0 }), friend.sk));
    call('giftWrap wrong sender', () => L.giftWrap(rumor, friend.sk, owner.pk, { now: T0 }));
    call('unwrap', () => L.unwrap(wrap, friend.sk));
    call('unwrap wrong recipient', () => L.unwrap(wrap, stranger.sk));
    call('unwrap tampered', () => L.unwrap({ ...wrap, content: wrap.content.slice(1) }, friend.sk));

    // ---- offers ----
    const off = live('createOffer', () => L.createOffer(seller.sk, { type: 'job', title: 'QA lead', role: 'QA', region: 'Lyon', payMin: 50000, payMax: 60000, currency: 'EUR', period: 'year', expiresAt: T0 + 30 * 86400 }, { createdAt: T0 }));
    const offAd = live('createOffer public ad', () => L.createOffer(seller.sk, { type: 'job', title: 'PM', role: 'PM', payMin: 4000, currency: 'EUR', period: 'month', source: { kind: 'public_ad', url: 'https://jobs.example/1', retrievedAt: '2026-11-01' } }, { createdAt: T0 }));
    const offHour = live('createOffer hourly', () => L.createOffer(seller.sk, { type: 'service', title: 'Tutor', payMin: 30, payMax: 40, currency: 'EUR', period: 'hour' }, { createdAt: T0 }));
    const offNoPay = live('createOffer no pay', () => L.createOffer(seller.sk, { type: 'sale', title: 'Books' }, { createdAt: T0 }));
    for (const [i, o] of [{ type: 'x', title: 't' }, { type: 'job' }, { type: 'job', title: 't', payMin: 2, payMax: 1 }, { type: 'job', title: 't', source: { kind: 'public_ad' } }].entries())
      call(`createOffer bad ${i}`, () => L.createOffer(seller.sk, o, { createdAt: T0 }));
    call('readOffer', () => [L.readOffer(off), L.readOffer(offAd), L.readOffer(ev1), L.readOffer({ ...off, content: 'x' })]);
    const limitsSet = [{}, { floor: 55000, currency: 'EUR', period: 'year' }, { floor: 45000 }, { floor: 70000 }, { floor: 40000, period: 'month' }, { roles: ['PM'] }, { regions: ['Paris'] }, { floor: 50000, currency: 'USD' }];
    for (const [i, lim] of limitsSet.entries()) call(`judgeOffer ${i}`, () => [off, offAd, offHour, offNoPay].map(o => L.judgeOffer(lim, o, { now: T0 })));
    call('judgeOffer expired', () => L.judgeOffer({}, off, { now: T0 + 31 * 86400 }));
    call('judgeOffer default clock', () => L.judgeOffer({}, off));
    call('judgeOffer invalid', () => L.judgeOffer({}, ev1, { now: T0 }));

    // ---- inbox ----
    const ib = live('createInboxList', () => L.createInboxList(owner.sk, ['wss://a.example', 'wss://b.example/', 'WSS://C.example', 'wss://a.example'], { createdAt: 100 }));
    const ib2 = live('createInboxList newer', () => L.createInboxList(owner.sk, ['wss://d.example'], { createdAt: 200 }));
    call('createInboxList bad', () => L.createInboxList(owner.sk, ['http://x.example'], { createdAt: 1 }));
    const inbox = live('readInboxList', () => L.readInboxList([ib, ib2, ev1].filter(Boolean), owner.pk));
    call('readInboxList older first', () => L.readInboxList([ib2, ib].filter(Boolean), owner.pk));
    call('readInboxList other key', () => L.readInboxList([ib].filter(Boolean), friend.pk));
    call('deliveryPlan', () => [L.deliveryPlan(L.readInboxList([ib], owner.pk)), L.deliveryPlan(L.readInboxList([ib], owner.pk), { copies: 1, failing: ['wss://a.example/'] }), L.deliveryPlan(inbox), L.deliveryPlan(null),
      L.deliveryPlan({ relays: ['wss://1.example', 'wss://2.example', 'wss://3.example', 'wss://4.example', 'wss://5.example'] }), L.deliveryPlan({ relays: ['wss://1.example', 'wss://2.example', 'wss://3.example'] }, { copies: 0, failing: ['wss://1.example'] })]);

    // ---- circle ----
    const circle = live('createCircle', () => L.createCircle(convener.sk, { scope: 'pay-product-fr-2027', size: 3, createdAt: T0 }));
    call('createCircle base', () => L.createCircle(convener.sk, { scope: 's', size: 1, createdAt: T0, expiresAt: T0 + 100, base: 'https://example.org/join' }));
    call('parseInviteLink', () => (circle ?? []).map(c => L.parseInviteLink(c.link)));
    call('parseInviteLink junk', () => ['synalla://join', 'synalla://join#xyz', 'https://x/#a.b'].map(l => { try { return L.parseInviteLink(l); } catch (e) { return 'throws ' + e.message; } }));
    call('inviteLink', () => L.inviteLink(circle[0].invite, circle[0].code, { base: 'https://example.org/join' }));
    call('circle join', () => {
      const p = L.parseInviteLink(circle[1].link);
      const r = L.redeemInvite({ invite: p.invite, code: p.code, inviteeSk: human.sk, createdAt: T0 + 5 });
      return L.acceptRedemption({ invite: circle[1].invite, code: circle[1].code, redemption: r, issuerSk: convener.sk, now: T0 + 6 });
    });

    // ---- pool ----
    const Q = { id: 'q-test', attributes: { role: ['QA', 'PM'], region: ['Lyon', 'Paris'] }, attributeOrder: ['role', 'region'], broadenOrder: ['region', 'role'], k: 5, minDistinct: 2 };
    call('normaliseQuestion', () => L.normaliseQuestion(Q));
    call('normaliseQuestion bad', () => [{ ...Q, k: 4 }, { ...Q, attributes: {} }, { ...Q, attributeOrder: ['x'] }].map(q => { try { return L.normaliseQuestion(q); } catch (e) { return 'throws ' + e.message; } }));
    const store = live('RecordStore', () => new L.RecordStore({ ...Q, rounding: 1000 }));
    let n = 0;
    const key = () => `record-key-${String(++n).padStart(8, '0')}`;
    const keys = [];
    const plan = [['QA', 'Lyon', 6], ['QA', 'Paris', 3], ['PM', 'Lyon', 5], ['PM', 'Paris', 2]];
    call('RecordStore.upsert', () => plan.flatMap(([role, region, c]) => Array.from({ length: c }, () => {
      const k = key(); keys.push(k); return store.upsert(k, { role, region }, 38000 + Math.floor(rnd() * 40000));
    })));
    call('RecordStore.upsert bad', () => [['short', { role: 'QA', region: 'Lyon' }, 1], [key(), { role: 'Dev', region: 'Lyon' }, 1], [key(), { role: 'QA', region: 'Lyon', name: 'x' }, 1], [key(), { role: 'QA', region: 'Lyon' }, -1]]
      .map(a => { try { return store.upsert(...a); } catch (e) { return 'throws ' + e.message; } }));
    call('RecordStore.all', () => store.all());
    call('canonical', () => [L.canonical({}), L.canonical({ region: 'Lyon', role: 'QA' })]);
    call('matches', () => [L.matches({ role: 'QA' }, { role: 'QA', region: 'Lyon' }), L.matches({ role: 'PM' }, { role: 'QA' }), L.matches({}, {})]);
    call('groupLabel', () => [L.groupLabel(Q, {}), L.groupLabel(Q, { role: 'QA' }), L.groupLabel(Q, { region: 'Lyon', role: 'QA' })]);
    call('ladder', () => [L.ladder(Q, { role: 'QA', region: 'Lyon' }), L.ladder(Q, { role: 'PM' })]);
    call('progressCard', () => [L.progressCard(Q, store.all(), { role: 'QA', region: 'Lyon' }), L.progressCard(Q, store.all(), { role: 'PM', region: 'Paris' }), L.progressCard(Q, [], { role: 'QA' })]);
    call('rank', () => [[[1, 0], [0, 1]], [[1, 1], [1, 1]], [[2, 4], [1, 2], [0, 3]], [], [[0, 0]]].map(m => L.rank(m)));
    call('rank random', () => Array.from({ length: 40 }, () => {
      const r = 1 + Math.floor(rnd() * 6), c = 1 + Math.floor(rnd() * 6);
      return L.rank(Array.from({ length: r }, () => Array.from({ length: c }, () => (rnd() < 0.5 ? 1 : 0))));
    }));
    call('differencingCheck', () => [L.differencingCheck([['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e', 'f']], 5), L.differencingCheck([['a', 'b', 'c', 'd', 'e']], 5), L.differencingCheck([], 5)]);
    const r1 = live('publishRound 1', () => L.publishRound(Q, store.all(), [], { round: 1, at: '2026-11-21' }));
    call('publishRound default at', () => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(L.publishRound(Q, store.all(), []).release?.at)); // real clock: format only
    store.upsert(key(), { role: 'QA', region: 'Paris' }, 61000);
    store.delete(keys[0]);
    store.upsert(keys[1], { role: 'QA', region: 'Lyon' }, 99000);
    const r2 = live('publishRound 2', () => L.publishRound(Q, store.all(), [{ round: 1, rows: r1.privateRows }], { at: '2026-11-22' }));
    call('personalView', () => [L.personalView(Q, store.all(), r2.release, { role: 'QA', region: 'Paris' }, 71000), L.personalView(Q, store.all(), r1.release, { role: 'PM', region: 'Lyon' }, 30000)]);
    call('progressCardSvg', () => [L.progressCardSvg(L.progressCard(Q, store.all(), { role: 'QA', region: 'Lyon' })), L.progressCardSvg(L.progressCard(Q, [], { role: 'QA' }), { title: 'Pay "& <stuff>"', footer: 'At ' })]);

    // ---- wants ----
    call('wantScore', () => [{ housing: 0.7, none: 0.3 }, { housing: 1 }, { none: 1.2 }, { none: 0 }, { none: 1 }, null, { none: NaN }].map(p => L.wantScore(p)));
    call('createWantGate bad', () => [{ floor: 0.95 }, { act: 0.5, maxFloor: 0.6 }, { nope: 1 }, { window: 0 }, { step: 0 }, null, []].map(o => L.createWantGate(o)));
    let ws = live('createWantGate', () => L.createWantGate().state);
    call('routeWant', () => [0.95, 0.9, 0.89, 0.2, 0.19, 0, 1, NaN, -1].map(x => L.routeWant(ws, x)));
    call('recordAnswer stream', () => Array.from({ length: 60 }, (_, i) => {
      const r = L.recordAnswer(ws, { score: Math.round(rnd() * 100) / 100, yes: rnd() < 0.4, at: i + 1 });
      if (r.ok) ws = r.state;
      return [r.ok, ws.floor];
    }));
    call('recordMiss stream', () => [0.1, 0.5, 0.13, 0, 0, 0.3].map((score, i) => { const r = L.recordMiss(ws, { score, at: 100 + i }); if (r.ok) ws = r.state; return ws.floor; }));
    call('want state', () => ws);
    call('recordAnswer bad', () => [null, { score: 2, yes: true, at: 1 }, { score: 0.5, yes: 1, at: 1 }, { score: 0.5, yes: true, at: -1 }].map(a => L.recordAnswer(ws, a)));
    call('recordMiss bad', () => [null, { score: -1, at: 1 }, { score: 0.5, at: 1.5 }].map(a => L.recordMiss(ws, a)));

    // ---- decisions: a seeded stream of records, lifts and checks; inputs are valid unless one corruption is drawn ----
    const pick = a => a[Math.floor(rnd() * a.length)];
    const maybeBad = (p, good, bad) => (rnd() < p ? pick(bad) : pick(good)); // mostly good values, sometimes a bad one
    const cats = ['books', 'books/children', 'books/children/reading-method', 'games', 'games/board'];
    const badCats = ['Bad', 'a/b/c/d/e', '', 5];
    const topics = ['phonics', 'age-5', 'age-6', 'dice'];
    const sellers = [L.getPublicKey(seller.sk), owner.pk, stranger.pk];
    let mem = live('createMemory', () => L.createMemory());
    const steps = [];
    for (let i = 0; i < 200; i++) {
      const t = 1000 + i * 1000;
      const roll = rnd();
      if (roll < 0.4) {
        const level = maybeBad(0.05, ['offer', 'seller_category', 'seller', 'topic', 'category'], ['bogus']);
        const scope = { offer: { offerId: maybeBad(0.1, ['o1', 'o2', 'o3'], ['bad id', '']) },
          seller_category: { seller: maybeBad(0.1, sellers, ['nothex', S64('A')]), category: maybeBad(0.1, cats, badCats) },
          seller: { seller: maybeBad(0.1, sellers, ['nothex']) },
          topic: { category: maybeBad(0.1, cats, badCats), topics: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => maybeBad(0.05, topics, ['x!'])) },
          category: { category: maybeBad(0.1, cats, badCats) }, bogus: {} }[level];
        const input = { verdict: maybeBad(0.05, ['yes', 'no', 'not_now'], ['maybe']), scope: { level, ...scope }, at: t };
        if (rnd() < 0.3) input.until = maybeBad(0.3, [null, t + 5000, t + 50000], [t - 1, t]);
        if (rnd() < 0.2) input.note = maybeBad(0.3, ['', 'not for me'], [5, 'x'.repeat(281)]);
        const r = L.recordDecision(mem, input);
        if (r.ok) mem = r.memory;
        steps.push(['record', snap(r)]);
      } else if (roll < 0.5) {
        const r = L.liftDecision(mem, 'd' + (1 + Math.floor(rnd() * mem.next)), maybeBad(0.2, [t], [t - 100000, -1]));
        if (r.ok) mem = r.memory;
        steps.push(['lift', snap(r)]);
      } else {
        const o = { id: pick(['o1', 'o2', 'o3', 'o4']), seller: pick(sellers), category: pick(cats), topics: Array.from({ length: Math.floor(rnd() * 3) }, () => pick(topics)) };
        steps.push(['check', snap(L.checkOffer(mem, o, t)), snap(L.activeDecisions(mem, t).map(d => d.id))]);
      }
    }
    call('decisions stream', () => steps);
    call('decisions memory', () => mem);

    // ---- askaround: buildRequest on seeded inputs, then a collect + rank round ----
    const notes = ['', 'For a beginner reader', 'Lou likes dragons', 'two books, 3 cards'];
    const badNotes = ['see www.x.fr', 'mail lou@mail.xyz', '@lou_m', 'call 06 12 34 56 78', 'https://a.b', 'x'.repeat(201)];
    call('buildRequest stream', () => Array.from({ length: 120 }, () => {
      const nd = { category: maybeBad(0.08, cats, badCats), topics: maybeBad(0.08, [['phonics'], ['age-5', 'phonics', 'age-5'], topics], [[], ['x!'], [...topics, 'a', 'b']]),
        at: maybeBad(0.05, [1000, 0, T0], [-1, 1.5]) };
      if (rnd() < 0.5) nd.region = maybeBad(0.15, ['FR', 'AT-9', 'US-CA1'], ['fr', 'FRA']);
      if (rnd() < 0.5) nd.days = maybeBad(0.15, [1, 14, 90], [0, 91, 2.5]);
      if (rnd() < 0.7) nd.note = maybeBad(0.25, notes, badNotes);
      if (rnd() < 0.4) nd.private = maybeBad(0.1, [['Lou'], ['dragons', 'xy'], ['zebra']], [[5], 'Lou']);
      if (rnd() < 0.4) nd.budget = maybeBad(0.1, [30, 0, 12.5, 3], [-1, Infinity]);
      if (rnd() < 0.03) nd.extra = 1;
      return L.buildRequest(nd);
    }));
    const tpl = L.buildRequest({ category: 'books/children', topics: ['phonics', 'age-5'], region: 'FR', at: T0, note: 'For a beginner reader', budget: 30 }).template;
    const req = live('ask request', () => L.signEvent(tpl, owner.sk));
    const sellersN = Array.from({ length: 10 }, (_, i) => person('ask seller ' + i));
    const askEvents = [];
    for (let i = 0; i < 50; i++) {
      const s = pick(sellersN);
      const body = { type: maybeBad(0.05, ['sale', 'service', 'job', 'tender'], ['gift']), title: maybeBad(0.05, ['Phonics set', 'Reading cards'], ['', 'x'.repeat(121)]),
        category: maybeBad(0.1, ['books/children', 'books/children/reading-method', 'books/children'], ['books', 'games', 'Bad']),
        topics: Array.from({ length: Math.floor(rnd() * 4) }, () => maybeBad(0.05, topics, ['x!'])), price: maybeBad(0.05, [10, 25, 30, 45, 12.5], [-1]),
        currency: maybeBad(0.1, ['EUR', 'EUR', 'USD'], ['eur']) };
      if (rnd() < 0.3) body.url = maybeBad(0.2, ['https://shop.example/1'], ['http://x']);
      const tags = [['e', maybeBad(0.05, [req.id], ['other'])]];
      if (rnd() < 0.3) tags.push(['expiration', String(maybeBad(0.4, [T0 + 86400 * 30], [T0 + 10, 'soon']))]);
      const e = L.signEvent({ kind: maybeBad(0.03, [8443], [1]), created_at: T0 + maybeBad(0.05, [0, 60, 120, 120, 180], [-10, 2000]), tags,
        content: rnd() < 0.03 ? 'not json' : JSON.stringify(body) }, s.sk);
      askEvents.push(rnd() < 0.03 ? { ...e, sig: '0'.repeat(128) } : e);
    }
    askEvents.push(L.signEvent({ kind: 8443, created_at: T0, tags: [['e', req.id]], content: '{}' }, owner.sk));
    askEvents.push(askEvents[3], 'junk');
    const col = live('collectOffers', () => L.collectOffers(req, askEvents, { now: T0 + 600, verify: L.verifyEvent }));
    call('collectOffers bad', () => [L.collectOffers(null, [], {}), L.collectOffers({ ...req, kind: 1 }, [], { now: 1, verify: L.verifyEvent }), L.collectOffers(req, null, { now: 1, verify: L.verifyEvent }), L.collectOffers(req, [], { now: 1 })]);
    for (const [i, [limits, options]] of [[{}, undefined], [{ budget: 30, currency: 'EUR', wantTopics: ['phonics', 'age-5'] }, { top: 3 }], [{ mustTopics: ['phonics'] }, { isSuppressed: o => o.price === 45 }],
      [{ budget: -1 }, undefined], [{}, { top: 0 }], [{}, { isSuppressed: 'x' }], [{ budget: 0 }, { top: 50, isSuppressed: null }]].entries())
      call(`rankOffers ${i}`, () => L.rankOffers(col?.offers ?? [], limits, options));

    // ---- succession (W2 recovery, added 24 Nov 2026) ----
    for (const k of ['ACCEPT_AT', 'SETTLE_AT', 'HOLD', 'CONTACT_MIN_AGE', 'CHANNELS']) call('const ' + k, () => L[k]);
    const D = 86400, OLD = owner.pk, NEXT = human.pk, FAKE = stranger.pk;
    const contacts = new Map([[friend.pk, T0 - 30 * D], [vouched.pk, T0 - 30 * D], [seller.pk, T0 - 30 * D], [convener.pk, T0 - 3 * D]]);
    const claimR = { type: 'claim', id: 'R', old: OLD, next: NEXT, seenAt: T0 };
    const claimF = { type: 'claim', id: 'F', old: OLD, next: FAKE, seenAt: T0 + 60 };
    const att = (id, c, who, cites = [], channel = 'phone', at = T0 + 100) => ({ type: 'attest', id, claim: c, attester: who.pk, channel, seenAt: at, cites });
    const deny = (id, c, at = T0 + 50) => ({ type: 'deny', id, claim: c, old: OLD, seenAt: at });
    const view = (now, extra = {}) => ({ contacts, now, ...extra });
    const cases = [
      ['nothing', [], view(T0)],
      ['bare claim', [claimR, att('a0', 'R', stranger)], view(T0)],
      ['one attester', [claimR, att('a1', 'R', friend)], view(T0)],
      ['too-new contact and bad channel', [claimR, att('a1', 'R', convener), att('a2', 'R', friend, [], 'email')], view(T0)],
      ['accepted in hold', [claimR, att('a1', 'R', friend), att('a2', 'R', vouched, [], 'signal', T0 + 200)], view(T0 + 1000)],
      ['accepted effective', [claimR, att('a1', 'R', friend), att('a2', 'R', vouched, [], 'signal', T0 + 200)], view(T0 + 4 * D)],
      ['denied', [claimR, deny('d1', 'R'), att('a1', 'R', friend), att('a2', 'R', vouched)], view(T0 + D)],
      ['settled', [claimR, deny('d1', 'R'), att('a1', 'R', friend, ['d1']), att('a2', 'R', vouched, ['d1']), att('a3', 'R', seller, ['d1'], 'in_person')], view(T0 + 5 * D)],
      ['rivals', [claimR, claimF, att('a1', 'R', friend), att('a2', 'R', vouched), att('f1', 'F', seller), att('f2', 'F', convener)], view(T0 + D)],
      ['owner confirmed', [claimR, claimF], view(T0 + D, { confirmed: new Map([['F', T0 + 70]]) })],
    ];
    for (const [name, st, v] of cases) {
      call(`succession ${name}`, () => L.succession(OLD, st, v));
      call(`succession ${name} reversed`, () => L.succession(OLD, [...st].reverse(), v));
    }
    call('succession bad', () => [() => L.succession('', [], view(T0)), () => L.succession(OLD, [null], view(T0)), () => L.succession(OLD, [], null)]
      .map(f => { try { f(); return 'no throw'; } catch (e) { return `${e.constructor.name}: ${e.message}`; } }));
  });
  return out;
}
