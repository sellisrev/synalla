import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, signEvent, verifyEvent, eventId } from '../src/event.js';

test('BIP340 test vector 0: public key from secret key', () => {
  // https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv (index 0)
  const sk = '0000000000000000000000000000000000000000000000000000000000000003';
  assert.equal(getPublicKey(sk), 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
});

test('signed event verifies and has the NIP-01 id', () => {
  const sk = generateSecretKey();
  const e = signEvent({ kind: 1, created_at: 1700000000, tags: [['t', 'x']], content: 'hello' }, sk);
  assert.equal(e.pubkey, getPublicKey(sk));
  assert.equal(e.id, eventId(e));
  assert.ok(verifyEvent(e));
});

test('any change breaks verification', () => {
  const sk = generateSecretKey();
  const e = signEvent({ kind: 1, created_at: 1700000000, content: 'hello' }, sk);
  for (const mutate of [
    x => { x.content = 'hellO'; },
    x => { x.kind = 2; },
    x => { x.created_at += 1; },
    x => { x.tags = [['p', 'a']]; },
    x => { x.pubkey = getPublicKey(generateSecretKey()); },
    x => { x.sig = x.sig.slice(0, -1) + (x.sig.endsWith('0') ? '1' : '0'); },
  ]) {
    const c = structuredClone(e);
    mutate(c);
    assert.equal(verifyEvent(c), false);
  }
});

test('malformed events are rejected, not thrown', () => {
  assert.equal(verifyEvent(null), false);
  assert.equal(verifyEvent({}), false);
  assert.equal(verifyEvent({ id: 'x', pubkey: 'y', sig: 'z', kind: 1, tags: [], content: '', created_at: 1 }), false);
});
