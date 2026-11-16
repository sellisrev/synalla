import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from '../src/event.js';
import { createInboxList, readInboxList, deliveryPlan } from '../src/inbox.js';

const sk = generateSecretKey(), pk = getPublicKey(sk);

test('newest valid list wins; others are ignored', () => {
  const a = createInboxList(sk, ['wss://a.example', 'wss://b.example/'], { createdAt: 100 });
  const b = createInboxList(sk, ['wss://c.example'], { createdAt: 200 });
  const other = createInboxList(generateSecretKey(), ['wss://evil.example'], { createdAt: 300 });
  const forged = structuredClone(b); forged.created_at = 400;
  assert.deepEqual(readInboxList([a, b, other, forged], pk).relays, ['wss://c.example']);
  assert.deepEqual(readInboxList([a], pk).relays, ['wss://a.example', 'wss://b.example']);
  assert.equal(readInboxList([other], pk), null);
});

test('only wss URLs without credentials, at most 8', () => {
  assert.throws(() => createInboxList(sk, ['ws://plain.example']), /wss/);
  assert.throws(() => createInboxList(sk, ['https://x.example']), /wss/);
  assert.throws(() => createInboxList(sk, ['wss://u:p@x.example']), /credentials/);
  assert.throws(() => createInboxList(sk, []), /at least one/);
  assert.throws(() => createInboxList(sk, Array.from({ length: 9 }, (_, i) => `wss://r${i}.example`)), /at most/);
});

test('delivery plan prefers relays that have not failed and always uses at least two', () => {
  const inbox = readInboxList([createInboxList(sk, ['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example'])], pk);
  assert.deepEqual(deliveryPlan(inbox, { copies: 3, failing: ['wss://a.example/'] }), ['wss://b.example', 'wss://c.example', 'wss://d.example']);
  assert.equal(deliveryPlan(inbox, { copies: 1 }).length, 2);
  assert.deepEqual(deliveryPlan(null), []);
});
