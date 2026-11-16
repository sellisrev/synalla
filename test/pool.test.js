import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecordStore, progressCard, publishRound, personalView, rank, differencingCheck, ladder, MIN_K,
} from '../src/pool.js';

const Q = {
  id: 'q-test',
  attributes: { role: ['QA', 'PM'], region: ['Lyon', 'Paris'] },
  attributeOrder: ['role', 'region'],
  broadenOrder: ['region', 'role'],
  k: 5,
  minDistinct: 2,
};

let n = 0;
const key = () => `record-key-${String(++n).padStart(8, '0')}`;
function fill(store, count, attrs, base = 40000) {
  const keys = [];
  for (let i = 0; i < count; i++) { const k = key(); store.upsert(k, attrs, base + i * 1000); keys.push(k); }
  return keys;
}

// float rank for cross-checking the exact one on small 0/1 matrices
function floatRank(M) {
  const m = M.map(r => r.slice());
  let r = 0;
  for (let c = 0; c < (m[0]?.length ?? 0) && r < m.length; c++) {
    let p = r; while (p < m.length && Math.abs(m[p][c]) < 1e-9) p++;
    if (p === m.length) continue;
    [m[r], m[p]] = [m[p], m[r]];
    for (let i = 0; i < m.length; i++) if (i !== r) { const f = m[i][c] / m[r][c]; for (let j = c; j < m[0].length; j++) m[i][j] -= f * m[r][j]; }
    r++;
  }
  return r;
}

test('exact rank matches float rank on random 0/1 matrices', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let t = 0; t < 300; t++) {
    const rows = 1 + Math.floor(rnd() * 7), cols = 1 + Math.floor(rnd() * 7);
    const M = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rnd() < 0.5 ? 1 : 0)));
    assert.equal(rank(M), floatRank(M), JSON.stringify(M));
  }
});

test('k below the hard floor is refused', () => {
  assert.throws(() => new RecordStore({ ...Q, k: MIN_K - 1 }), /k must be/);
});

test('records are validated and rounded', () => {
  const s = new RecordStore({ ...Q, rounding: 1000 });
  assert.throws(() => s.upsert('short', { role: 'QA', region: 'Lyon' }, 1), /16\+/);
  assert.throws(() => s.upsert(key(), { role: 'Dev', region: 'Lyon' }, 1), /role/);
  assert.throws(() => s.upsert(key(), { role: 'QA', region: 'Lyon', name: 'x' }, 1), /unknown attribute/);
  const r = s.upsert(key(), { role: 'QA', region: 'Lyon' }, 41499);
  assert.equal(r.value, 41000);
});

test('ladder goes from narrow to broad', () => {
  assert.deepEqual(ladder(Q, { role: 'QA', region: 'Lyon' }), [{ role: 'QA', region: 'Lyon' }, { role: 'QA' }, {}]);
});

test('progress card never mentions the person sharing it', () => {
  const s = new RecordStore(Q);
  fill(s, 3, { role: 'QA', region: 'Lyon' });
  const c = progressCard(Q, s.all(), { role: 'QA', region: 'Lyon' });
  assert.equal(c.text, 'QA · Lyon: 3 of 5, 2 more to unlock');
  assert.equal(c.unlocked, false);
});

test('first round publishes broad groups; one later join cannot be differenced out', () => {
  const s = new RecordStore(Q);
  fill(s, 6, { role: 'QA', region: 'Lyon' });
  const r1 = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  // {} , {role:QA}, {QA,Lyon} all have the same 6 people: one set, published three times
  assert.equal(r1.release.groups.length, 3);
  const history = [{ round: 1, rows: r1.privateRows }];
  fill(s, 1, { role: 'QA', region: 'Paris' });
  const r2 = publishRound(Q, s.all(), history, { round: 2, at: 'x' });
  // Everyone (7) and QA (7) would reveal the newcomer against round 1's 6; QA·Lyon is unchanged
  const fresh = r2.release.groups.filter(g => g.asOfRound === undefined).map(g => g.label);
  assert.ok(!fresh.includes('Everyone'));
  assert.ok(!fresh.includes('QA'));
  assert.ok(fresh.includes('QA · Lyon'));
  assert.ok(r2.release.waiting.some(w => w.label === 'Everyone'));
  // the blocked groups keep showing round 1's result, unchanged
  const everyone = r2.release.groups.find(g => g.label === 'Everyone');
  assert.equal(everyone.asOfRound, 1);
  assert.equal(everyone.count, 6);
  assert.deepEqual({ ...everyone, asOfRound: undefined, spec: undefined },
    { ...r1.release.groups.find(g => g.label === 'Everyone'), asOfRound: undefined, spec: undefined });
});

test('a value edit between rounds is blocked until enough other changes happen', () => {
  const s = new RecordStore(Q);
  const keys = fill(s, 6, { role: 'QA', region: 'Lyon' });
  const r1 = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  s.upsert(keys[0], { role: 'QA', region: 'Lyon' }, 99000);
  const r2 = publishRound(Q, s.all(), [{ round: 1, rows: r1.privateRows }], { round: 2, at: 'x' });
  assert.equal(r2.release.groups.filter(g => g.asOfRound === undefined).length, 0);
  assert.ok(r2.release.groups.every(g => g.asOfRound === 1 && g.q3 < 99000));
});

test('a leaver is masked when at least k others joined', () => {
  const s = new RecordStore(Q);
  const keys = fill(s, 6, { role: 'QA', region: 'Lyon' });
  const r1 = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  s.delete(keys[0]);
  fill(s, 5, { role: 'QA', region: 'Lyon' }, 60000);
  const r2 = publishRound(Q, s.all(), [{ round: 1, rows: r1.privateRows }], { round: 2, at: 'x' });
  assert.ok(r2.release.groups.some(g => g.label === 'QA · Lyon' && g.count === 10));
});

test('overlapping groups cannot be combined down to one person (inclusion-exclusion)', () => {
  // everyone 46, QA 30, Lyon 30, QA·Lyon 15 would give 46 - 30 - 30 + 15 = 1
  const sets = [];
  const ids = i => `p${i}`;
  const all = Array.from({ length: 46 }, (_, i) => ids(i));
  const qa = all.slice(0, 30), lyon = [...all.slice(0, 15), ...all.slice(30, 45)], both = all.slice(0, 15);
  sets.push(all, qa, lyon);
  assert.equal(differencingCheck(sets, 15).safe, true);
  sets.push(both);
  assert.equal(differencingCheck(sets, 15).safe, false);
});

test('uniform values are withheld', () => {
  const s = new RecordStore(Q);
  for (let i = 0; i < 6; i++) s.upsert(key(), { role: 'PM', region: 'Paris' }, 50000);
  const r = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  assert.equal(r.release.groups.length, 0);
  assert.ok(r.release.waiting.every(w => /uniform/.test(w.reason)));
});

test('personal view falls back to the narrowest published group and shows locked progress', () => {
  const s = new RecordStore(Q);
  fill(s, 6, { role: 'QA', region: 'Lyon' });
  fill(s, 2, { role: 'QA', region: 'Paris' }, 70000);
  const { release } = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  const v = personalView(Q, s.all(), release, { role: 'QA', region: 'Paris' }, 71000);
  assert.equal(v.result.label, 'QA');
  assert.equal(v.locked[0].text, 'QA · Paris: 2 of 5, 3 more to unlock');
  assert.equal(v.position, 'top quarter');
});

// Independent attacker: over all published rows across rounds, try every combination with
// coefficients in {-1, 0, 1}. No combination may single out between 1 and k-1 records.
function attackerFinds(rows, k) {
  const ids = [...new Set(rows.flat())];
  const vec = rows.map(r => ids.map(id => (r.includes(id) ? 1 : 0)));
  const n = vec.length;
  for (let code = 1; code < 3 ** n; code++) {
    let c = code; const coef = [];
    for (let i = 0; i < n; i++) { coef.push((c % 3) - 1); c = Math.floor(c / 3); }
    const sum = ids.map((_, j) => coef.reduce((acc, a, i) => acc + a * vec[i][j], 0));
    const support = sum.filter(x => x !== 0).length;
    if (support > 0 && support < k) return { coef, support };
  }
  return null;
}

test('randomised multi-round scenarios resist a brute-force differencing attacker', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = a => a[Math.floor(rnd() * a.length)];
  let checked = 0, multi = 0;
  for (let trial = 0; trial < 60; trial++) {
    const s = new RecordStore(Q);
    const history = [];
    const live = [];
    for (let round = 1; round <= 6; round++) {
      const adds = Math.floor(rnd() * 16);
      for (let i = 0; i < adds; i++) {
        const k = key(); live.push(k);
        s.upsert(k, { role: pick(['QA', 'PM']), region: pick(['Lyon', 'Paris']) }, 30000 + Math.floor(rnd() * 50) * 1000);
      }
      if (live.length && rnd() < 0.4) s.delete(live.splice(Math.floor(rnd() * live.length), 1)[0]);
      if (live.length && rnd() < 0.4) { const k = pick(live); const r = s.records.get(k); if (r) s.upsert(k, r.attrs, r.value + 1000); }
      const { privateRows } = publishRound(Q, s.all(), history, { round, at: 'x' });
      history.push({ round, rows: privateRows });
      const rows = history.flatMap(h => h.rows.map(r => r.members));
      if (rows.length <= 9) {
        assert.equal(attackerFinds(rows, Q.k), null, `trial ${trial} round ${round}`);
        checked++;
        if (new Set(rows.map(r => [...r].sort().join())).size >= 3) multi++;
      }
    }
  }
  assert.ok(checked >= 100 && multi >= 40, `too few meaningful checks: ${checked} checked, ${multi} with 3+ distinct sets`);
});

test('a group below k is never published, whatever else is published', () => {
  const s = new RecordStore(Q);
  fill(s, 4, { role: 'PM', region: 'Lyon' });
  const r = publishRound(Q, s.all(), [], { round: 1, at: 'x' });
  assert.equal(r.release.groups.length, 0);
});
