import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, signEvent } from '../src/event.js';
import { createVouch, VouchGraph } from '../src/vouch.js';
import { createKnock, lintKnockBody, KNOCK_KIND } from '../src/knock.js';
import { Gate } from '../src/gate.js';

const T0 = 1_800_000_000;
const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };

function setup(policy) {
  const owner = person(), friend = person(), vouched = person(), twoHop = person(), stranger = person(), human = person();
  const graph = new VouchGraph().addAll([
    createVouch(friend.sk, vouched.pk, { createdAt: T0 }),
    createVouch(vouched.sk, twoHop.pk, { createdAt: T0 }),
  ]);
  const gate = new Gate({
    owner: owner.pk, contacts: [friend.pk], graph, policy,
    proofsFor: pk => (pk === human.pk ? { personhood: true } : {}),
  });
  return { owner, friend, vouched, twoHop, stranger, human, gate, graph };
}

const q = (sk, note = '', extra = {}) => createKnock(sk, { category: 'question', fields: { topic: 'QA pay in Lyon' }, note }, { createdAt: T0, ...extra });

test('lint catches links, contacts and off-network handles, not ordinary text', () => {
  const lint = note => lintKnockBody({ category: 'question', fields: {}, note });
  assert.deepEqual(lint('Would you compare QA pay bands, 50000-60000, with me?'), []);
  assert.deepEqual(lint('I want to signal interest in your offer'), []);
  assert.ok(lint('see https://x.io').includes('contains a link'));
  assert.ok(lint('see bit.ly/abc').includes('contains a link'));
  assert.ok(lint('mail me a@b.fr').includes('contains an email address'));
  assert.ok(lint('call 06 12 34 56 78').includes('contains a phone number'));
  assert.ok(lint('call +43 660 1234567').includes('contains a phone number'));
  assert.ok(lint('message me on Telegram').includes('asks to move to another app or handle'));
  assert.ok(lint('ping @cryptoking99').includes('asks to move to another app or handle'));
  assert.ok(lint('x'.repeat(281)).some(p => /longer than/.test(p)));
  assert.ok(lintKnockBody({ category: 'question', fields: { iban: 'x' } })[0].startsWith('field iban'));
  assert.ok(lintKnockBody({ category: 'nope' })[0].startsWith('unknown category'));
  assert.throws(() => createKnock(person().sk, { category: 'question', note: 'https://evil.example' }), /refused before sending/);
});

test('tiers route knocks: contact and vouched to inbox, two hops to a card, unknown dropped', () => {
  const s = setup();
  assert.equal(s.gate.receive(q(s.friend.sk), T0).action, 'inbox');
  assert.equal(s.gate.receive(q(s.vouched.sk), T0).action, 'inbox');
  assert.equal(s.gate.receive(q(s.twoHop.sk), T0).action, 'knock_card');
  assert.equal(s.gate.receive(q(s.human.sk), T0).action, 'requests');
  assert.equal(s.gate.receive(q(s.stranger.sk), T0).action, 'drop');
  assert.equal(s.gate.log.length, 5);
});

test('the note is returned apart from the card', () => {
  const s = setup();
  const d = s.gate.receive(q(s.twoHop.sk, 'Hello, same team different company'), T0);
  assert.equal(d.card.hasNote, true);
  assert.equal(JSON.stringify(d.card).includes('Hello'), false);
  assert.equal(d.note, 'Hello, same team different company');
});

test('categories need enough trust', () => {
  const s = setup();
  const k = createKnock(s.twoHop.sk, { category: 'meet_in_person', fields: { purpose: 'coffee', area: 'Lyon 3e' } }, { createdAt: T0 });
  const d = s.gate.receive(k, T0);
  assert.equal(d.action, 'drop');
  assert.match(d.reasons[0], /needs tier A/);
  const k2 = createKnock(s.friend.sk, { category: 'meet_in_person', fields: { purpose: 'coffee', area: 'Lyon 3e' } }, { createdAt: T0 });
  assert.equal(s.gate.receive(k2, T0).action, 'inbox');
});

test('forged, oversized, duplicate, misaddressed and non-knock events are dropped', () => {
  const s = setup();
  const k = q(s.friend.sk);
  assert.equal(s.gate.receive(k, T0).action, 'inbox');
  assert.deepEqual(s.gate.receive(k, T0).reasons, ['duplicate']);
  const forged = structuredClone(q(s.friend.sk, 'hi'));
  forged.content = forged.content.replace('hi', 'yo');
  assert.deepEqual(s.gate.receive(forged, T0).reasons, ['bad signature or format']);
  const big = signEvent({ kind: KNOCK_KIND, created_at: T0, tags: [['category', 'question']], content: 'x'.repeat(5000) }, s.friend.sk);
  assert.match(s.gate.receive(big, T0).reasons[0], /larger than/);
  const other = q(s.friend.sk, '', { recipient: person().pk });
  assert.deepEqual(s.gate.receive(other, T0).reasons, ['addressed to someone else']);
  const note = signEvent({ kind: 1, created_at: T0, content: 'hi' }, s.friend.sk);
  assert.match(s.gate.receive(note, T0).reasons[0], /not a knock/);
  // body that bypassed the sender-side lint
  const raw = signEvent({ kind: KNOCK_KIND, created_at: T0, tags: [['category', 'question']], content: JSON.stringify({ category: 'question', note: 'go to www.win.top' }) }, s.friend.sk);
  assert.deepEqual(s.gate.receive(raw, T0).reasons, ['contains a link']);
  const mismatch = signEvent({ kind: KNOCK_KIND, created_at: T0, tags: [['category', 'hobby_partner']], content: JSON.stringify({ category: 'question' }) }, s.friend.sk);
  assert.deepEqual(s.gate.receive(mismatch, T0).reasons, ['category tag does not match body']);
});

test('rate limits per sender and a shared cap for tier C', () => {
  const s = setup({ dailyCapC: 2 });
  const ok = [0, 1, 2, 3].map(i => s.gate.receive(q(s.twoHop.sk, `n${'abcd'[i]}`), T0).action);
  assert.deepEqual(ok, ['knock_card', 'knock_card', 'knock_card', 'drop']);
  // next day the budget is back
  assert.equal(s.gate.receive(q(s.twoHop.sk, 'next day'), T0 + 86400).action, 'knock_card');
  // tier C: one per sender per day, two in total per day
  const humans = [s.human, person(), person()];
  const g = new Gate({ owner: s.owner.pk, graph: s.graph, policy: { dailyCapC: 2 }, proofsFor: () => ({ personhood: true }) });
  const r = humans.map(h => g.receive(q(h.sk), T0).action);
  assert.deepEqual(r, ['requests', 'requests', 'drop']);
  assert.equal(g.receive(q(humans[0].sk, 'again'), T0).action, 'drop');
});

test('a removed sender is dropped even if they are still vouched', () => {
  const s = setup();
  s.graph.removeMember(s.vouched.pk, T0);
  assert.equal(s.gate.receive(q(s.vouched.sk), T0 + 1).action, 'drop');
});
