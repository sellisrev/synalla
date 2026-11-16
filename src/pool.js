// Group answers that unlock at a threshold: the first use of the network, and its cold-start engine.
//
// A question ("where does my fixed pay stand among people like me?") defines attributes,
// a ladder of nested groups from narrow to broad, and a minimum group size k.
// Before a group reaches k, the only thing shown is progress ("9 of 15, 6 more to unlock"),
// which anyone can share without revealing that they took part. People whose narrow group is
// still locked are shown the narrowest broader group that is published, so the first
// contributors get something back while their own group fills.
//
// Publication rule (counts and sums cannot be differenced down to fewer than k people):
// results come out in rounds. Every published group, in this round and all earlier ones, is a
// set of record versions. Split all records into "atoms" (records that belong to exactly the
// same published sets). An atom smaller than k is "small". A round may publish a group only if,
// after adding it, no linear combination of published sets isolates small atoms, that is:
//     rank(M) == rank(M restricted to the large atoms)
// where M is the sets-by-atoms incidence matrix. This blocks subtraction between nested or
// overlapping groups, and between rounds (a single join, leave or edit creates a small atom).
//
// Limits (see docs/limits.md): quartiles are not linear, so the rule is a proxy for them;
// progress counts are public and exact; record keys are not authenticated here.

export const MIN_K = 5; // hard floor: no caller can publish a group smaller than this

/**
 * @typedef {{[attr:string]: string}} GroupSpec   attribute -> value; a missing attribute means "any"
 * @typedef {{key:string, version:number, attrs:{[attr:string]:string}, value:number}} PoolRecord
 * @typedef {{
 *   id:string, title?:string, valueLabel?:string,
 *   attributes:{[attr:string]: string[]},
 *   attributeOrder?:string[], broadenOrder:string[],
 *   k?:number, minDistinct?:number, rounding?:number, valueMin?:number, valueMax?:number
 * }} Question
 */

export function normaliseQuestion(q) {
  if (!q || typeof q.id !== 'string' || !q.id) throw new TypeError('question.id required');
  if (!q.attributes || typeof q.attributes !== 'object') throw new TypeError('question.attributes required');
  const attributeOrder = q.attributeOrder ?? Object.keys(q.attributes);
  const broadenOrder = q.broadenOrder ?? [];
  for (const a of broadenOrder) if (!(a in q.attributes)) throw new TypeError(`broadenOrder names unknown attribute ${a}`);
  const k = q.k ?? 15;
  if (!Number.isInteger(k) || k < MIN_K) throw new RangeError(`k must be an integer >= ${MIN_K}`);
  return {
    title: q.id, valueLabel: 'value', minDistinct: 3, rounding: 1, valueMin: 0, valueMax: Number.MAX_SAFE_INTEGER,
    ...q, attributeOrder, broadenOrder, k,
  };
}

/** Records keyed by a random record key. Upserting bumps the version; deleting removes it. */
export class RecordStore {
  constructor(question) {
    this.q = normaliseQuestion(question);
    this.records = new Map();
  }

  upsert(key, attrs, value) {
    if (typeof key !== 'string' || key.length < 16) throw new TypeError('record key must be a string of 16+ chars');
    for (const [a, allowed] of Object.entries(this.q.attributes)) {
      if (!allowed.includes(attrs?.[a])) throw new RangeError(`attribute ${a} must be one of ${allowed.join(', ')}`);
    }
    for (const a of Object.keys(attrs)) if (!(a in this.q.attributes)) throw new RangeError(`unknown attribute ${a}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('value must be a finite number');
    if (value < this.q.valueMin || value > this.q.valueMax) throw new RangeError('value out of range');
    const rounded = Math.round(value / this.q.rounding) * this.q.rounding;
    const prev = this.records.get(key);
    const rec = { key, version: (prev?.version ?? 0) + 1, attrs: { ...attrs }, value: rounded };
    this.records.set(key, rec);
    return rec;
  }

  delete(key) {
    return this.records.delete(key);
  }

  all() {
    return [...this.records.values()];
  }
}

export function canonical(spec) {
  return JSON.stringify(Object.keys(spec).sort().map(k => [k, spec[k]]));
}

export function matches(spec, attrs) {
  return Object.entries(spec).every(([a, v]) => attrs[a] === v);
}

export function groupLabel(q, spec) {
  const parts = q.attributeOrder.filter(a => a in spec).map(a => spec[a]);
  return parts.length ? parts.join(' · ') : 'Everyone';
}

/** Groups containing these attributes, narrowest first. */
export function ladder(question, attrs) {
  const q = normaliseQuestion(question);
  const spec = {};
  for (const a of q.attributeOrder) spec[a] = attrs[a];
  const out = [{ ...spec }];
  for (const a of q.broadenOrder) {
    delete spec[a];
    out.push({ ...spec });
  }
  return out;
}

/** Progress toward unlocking one group. Safe to share: it never says who took part. */
export function progressCard(question, records, spec) {
  const q = normaliseQuestion(question);
  const count = records.filter(r => matches(spec, r.attrs)).length;
  const needed = Math.max(0, q.k - count);
  const label = groupLabel(q, spec);
  const text = needed > 0
    ? `${label}: ${count} of ${q.k}, ${needed} more to unlock`
    : `${label}: unlocked (${count} people)`;
  return { label, count, k: q.k, needed, unlocked: needed === 0, text };
}

function quantile(sorted, p) {
  // nearest-rank
  const i = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[i];
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return { count: s.length, q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75) };
}

const ident = r => `${r.key}@${r.version}`;

/** Exact rank over the rationals (fraction-free Gaussian elimination with BigInt). */
export function rank(matrix) {
  const m = matrix.map(row => row.map(x => BigInt(x)));
  const rows = m.length;
  const cols = rows ? m[0].length : 0;
  let r = 0;
  let prevPivot = 1n;
  for (let c = 0; c < cols && r < rows; c++) {
    let p = r;
    while (p < rows && m[p][c] === 0n) p++;
    if (p === rows) continue;
    [m[r], m[p]] = [m[p], m[r]];
    for (let i = r + 1; i < rows; i++) {
      for (let j = c + 1; j < cols; j++) m[i][j] = (m[r][c] * m[i][j] - m[i][c] * m[r][j]) / prevPivot;
      m[i][c] = 0n;
    }
    prevPivot = m[r][c];
    r++;
  }
  return r;
}

/**
 * Can these published sets (arrays of record identities) be combined to isolate fewer than k records?
 * @returns {{safe:boolean, smallAtoms:number}}
 */
export function differencingCheck(sets, k) {
  const sig = new Map(); // identity -> bitstring of membership
  sets.forEach((set, i) => {
    for (const id of set) {
      const cur = sig.get(id) ?? Array(sets.length).fill(0);
      cur[i] = 1;
      sig.set(id, cur);
    }
  });
  const atoms = new Map(); // signature -> size
  for (const bits of sig.values()) {
    const key = bits.join('');
    atoms.set(key, (atoms.get(key) ?? 0) + 1);
  }
  const atomKeys = [...atoms.keys()];
  const M = sets.map((_, i) => atomKeys.map(a => Number(a[i])));
  const large = atomKeys.map((a, j) => (atoms.get(a) >= k ? j : -1)).filter(j => j >= 0);
  const smallAtoms = atomKeys.length - large.length;
  if (smallAtoms === 0) return { safe: true, smallAtoms };
  const ML = M.map(row => large.map(j => row[j]));
  const safe = rank(M) === (large.length ? rank(ML) : 0);
  return { safe, smallAtoms };
}

/**
 * Run one publication round.
 * @param {Question} question
 * @param {PoolRecord[]} records
 * @param {{round:number, rows:{spec:GroupSpec, members:string[], stats:object, round:number}[]}[]} history
 *        private state from earlier rounds
 * @returns {{release:object, privateRows:{spec:GroupSpec, members:string[], stats:object, round:number}[]}}
 *   `release` is public. `privateRows` must be kept by the collector, never published:
 *   it is needed to check the next round.
 */
export function publishRound(question, records, history = [], { round, at } = {}) {
  const q = normaliseQuestion(question);
  const roundNo = round ?? (history.length ? Math.max(...history.map(h => h.round)) + 1 : 1);
  const pastRows = history.flatMap(h => h.rows);
  const pastByMembership = new Map(pastRows.map(r => [[...r.members].sort().join('|'), r]));

  // Candidate groups: every rung of every contributor's ladder.
  const cands = new Map();
  for (const r of records) for (const spec of ladder(q, r.attrs)) cands.set(canonical(spec), spec);
  const ordered = [...cands.values()].map(spec => {
    const members = records.filter(r => matches(spec, r.attrs));
    return { spec, members };
  }).sort((a, b) =>
    Object.keys(a.spec).length - Object.keys(b.spec).length || // broad first: everyone gets something
    b.members.length - a.members.length ||
    (canonical(a.spec) < canonical(b.spec) ? -1 : 1));

  const accepted = []; // {spec, members, stats, round}
  const published = [];
  const waiting = [];
  for (const { spec, members } of ordered) {
    const label = groupLabel(q, spec);
    if (members.length < q.k) continue; // locked: only its progress card is shown
    if (new Set(members.map(m => m.value)).size < q.minDistinct) {
      waiting.push({ label, reason: 'values too uniform to publish' });
      continue;
    }
    const ids = members.map(ident);
    const memKey = [...ids].sort().join('|');
    const repeat = pastByMembership.get(memKey);
    const sets = [...pastRows.map(r => r.members), ...accepted.map(a => a.members)];
    if (!repeat) sets.push(ids);
    const { safe } = differencingCheck(sets, q.k);
    if (!safe) {
      waiting.push({ label, reason: 'waiting for more changes before the next release' });
      continue;
    }
    const st = stats(members.map(m => m.value));
    if (!repeat) accepted.push({ spec, members: ids, stats: st, round: roundNo });
    published.push({ spec, label, ...st });
  }

  // A group that was published before and can't be refreshed this round keeps its last result,
  // marked with the round it dates from. This reveals nothing new: it was already public.
  const fresh = new Set(published.map(g => canonical(g.spec)));
  const latest = new Map();
  for (const r of pastRows) {
    if (!r.stats) continue;
    const c = canonical(r.spec);
    if (!latest.has(c) || latest.get(c).round < r.round) latest.set(c, r);
  }
  for (const [c, r] of latest) {
    if (fresh.has(c)) continue;
    published.push({ spec: r.spec, label: groupLabel(q, r.spec), ...r.stats, asOfRound: r.round });
  }

  const release = {
    question: q.id,
    round: roundNo,
    at: at ?? new Date().toISOString(),
    k: q.k,
    groups: published,
    waiting, // groups with at least k people that this round cannot publish yet
    note: 'People who joined, not the whole market. Results come out in rounds.',
  };
  return { release, privateRows: accepted };
}

/**
 * What one contributor sees: the narrowest published group they belong to, plus progress on
 * the narrower groups that are still locked (the reason to invite colleagues).
 */
export function personalView(question, records, release, attrs, ownValue) {
  const q = normaliseQuestion(question);
  const rungs = ladder(q, attrs);
  const byKey = new Map(release.groups.map(g => [canonical(g.spec), g]));
  const best = rungs.map(s => byKey.get(canonical(s))).find(Boolean) ?? null;
  const locked = [];
  for (const s of rungs) {
    if (byKey.has(canonical(s))) break;
    const card = progressCard(q, records, s);
    if (card.unlocked) card.text = `${card.label}: ${card.count} people, result due in a coming round`;
    locked.push(card);
  }
  let position = null;
  if (best && typeof ownValue === 'number') {
    position = ownValue < best.q1 ? 'bottom quarter'
      : ownValue < best.median ? 'second quarter'
        : ownValue < best.q3 ? 'third quarter' : 'top quarter';
  }
  return { result: best, position, locked };
}
