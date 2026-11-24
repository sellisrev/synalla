// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
// Factory build admission_daily_2 (local model "daily", gate PASS), hand-reviewed; one fix by review:
// a policy naming only perDay.A kept no limit for B (now starts from the defaults); type annotations added for tsc.
// See factory_v4/RESULTS.md.

export const CONTACT_LEVELS = Object.freeze(['verified', 'trusted', 'contact_ring1', 'contact_ring2', 'self']);

export const DEFAULT_POLICY = Object.freeze({
  perDay: Object.freeze({ A: 100, B: 5 }),
  knockType: 'synalla.knock',
  maxSenders: 10000,
});

export function emptyState() {
  return { version: 1, day: -1, counts: [] as [string, number][] };
}

const HEX64 = /^[0-9a-f]{64}$/;

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function copyState(st: { version: number; day: number; counts: [string, number][] }) {
  return { version: st.version, day: st.day, counts: st.counts.map(e => [e[0], e[1]] as [string, number]) };
}

function isValidState(s: unknown): s is { version: 1; day: number; counts: [string, number][] } {
  if (s == null || typeof s !== 'object' || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (!isTime(o.day) && o.day !== -1) return false;
  if (!Array.isArray(o.counts)) return false;
  let prev = '';
  for (const entry of o.counts) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const sender = entry[0];
    const n = entry[1];
    if (typeof sender !== 'string' || !HEX64.test(sender)) return false;
    if (sender <= prev) return false;
    if (!isTime(n) || n < 1) return false;
    prev = sender;
  }
  return true;
}

function validatePolicy(p: unknown) {
  if (p == null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) throw new TypeError('policy');
  const o = p as Record<string, unknown>;

  let perDay: { A: number; B: number } = DEFAULT_POLICY.perDay;
  if ('perDay' in o && o.perDay !== undefined) {
    const pd = o.perDay;
    if (pd == null || typeof pd !== 'object' || Array.isArray(pd)) throw new TypeError('perDay');
    const pdObj = pd as Record<string, unknown>;
    perDay = { ...DEFAULT_POLICY.perDay };
    if ('A' in pdObj && pdObj.A !== undefined) {
      if (!isTime(pdObj.A)) throw new TypeError('perDay.A');
      perDay.A = pdObj.A;
    }
    if ('B' in pdObj && pdObj.B !== undefined) {
      if (!isTime(pdObj.B)) throw new TypeError('perDay.B');
      perDay.B = pdObj.B;
    }
  }

  let knockType: string = DEFAULT_POLICY.knockType;
  if ('knockType' in o && o.knockType !== undefined) {
    const kt = o.knockType;
    if (typeof kt !== 'string' || kt.length === 0) throw new TypeError('knockType');
    knockType = kt;
  }

  let maxSenders: number = DEFAULT_POLICY.maxSenders;
  if ('maxSenders' in o && o.maxSenders !== undefined) {
    if (!isTime(o.maxSenders)) throw new TypeError('maxSenders');
    maxSenders = o.maxSenders as number;
  }

  return { perDay, knockType, maxSenders };
}

function validateInput(i: unknown): boolean {
  if (i == null || typeof i !== 'object' || Array.isArray(i)) return false;
  const s = i as Record<string, unknown>;
  const tier = s.tier as string;
  const dt = s.dinaTrust as string;
  const tp = s.type as string;
  const sender = s.sender as string;
  const now = s.now;
  if (!['A', 'B', 'C', 'D'].includes(tier)) return false;
  if (typeof dt !== 'string' || dt.length > 32) return false;
  if (typeof tp !== 'string' || tp.length < 1 || tp.length > 100) return false;
  if (typeof sender !== 'string' || !HEX64.test(sender)) return false;
  if (!isTime(now)) return false;
  return true;
}

export function admit(
  input: unknown,
  state: unknown,
  policy?: unknown,
): { decision: { route: string; senderTrust: string; reasons: string[] }; state: { version: number; day: number; counts: [string, number][] } } {
  const rawPol = validatePolicy(policy);
  const pol: { perDay: Record<string, number>; knockType: string; maxSenders: number } = rawPol || DEFAULT_POLICY;

  if (!isValidState(state)) throw new TypeError('state');

  if (!validateInput(input)) {
    return {
      decision: { route: 'drop', senderTrust: 'unknown', reasons: ['bad input'] },
      state: copyState(state as { version: number; day: number; counts: [string, number][] }),
    };
  }

  const i = input as { tier: 'A' | 'B' | 'C' | 'D'; dinaTrust: string; type: string; sender: string; now: number };

  const day = Math.floor(i.now / 86400);
  let working: { version: number; day: number; counts: [string, number][] };
  if (day > (state as { day: number }).day) {
    working = { version: 1, day, counts: [] };
  } else {
    working = copyState(state as { version: number; day: number; counts: [string, number][] });
  }

  // Rule 5
  if (i.dinaTrust.trim().toLowerCase() === 'blocked') {
    return { decision: { route: 'drop', senderTrust: 'blocked', reasons: ['blocked contact'] }, state: working };
  }

  // Rule 6
  if (CONTACT_LEVELS.includes(i.dinaTrust)) {
    return { decision: { route: 'dina', senderTrust: i.dinaTrust, reasons: ['existing contact'] }, state: working };
  }

  // Rule 7
  if (i.tier === 'D') {
    return { decision: { route: 'drop', senderTrust: 'unknown', reasons: ['tier D: no contact, vouch or proof'] }, state: working };
  }

  // Rule 8
  if (i.type === pol.knockType) {
    return { decision: { route: 'knock', senderTrust: 'unknown', reasons: ['knock: the gate decides'] }, state: working };
  }

  // Rule 8b
  if (i.tier === 'C') {
    return { decision: { route: 'drop', senderTrust: 'unknown', reasons: ['tier C may only knock'] }, state: working };
  }

  // Rule 9
  const limit = i.tier === 'A' ? pol.perDay.A! : pol.perDay.B!;
  const entry = working.counts.find(e => e[0] === i.sender);
  const used = entry ? entry[1] : 0;
  if (used >= limit) {
    return { decision: { route: 'drop', senderTrust: 'unknown', reasons: ['daily limit for tier ' + i.tier + ' reached'] }, state: working };
  }

  // Rule 9b
  if (!entry && working.counts.length >= pol.maxSenders) {
    return { decision: { route: 'drop', senderTrust: 'unknown', reasons: ['too many senders today'] }, state: working };
  }

  // Rule 10 - tier A or B
  const newCounts = working.counts.slice();
  if (entry) {
    const idx = newCounts.indexOf(entry);
    newCounts[idx] = [entry[0], entry[1] + 1];
  } else {
    let pos = newCounts.length;
    for (let k = 0; k < newCounts.length; k++) {
      if (i.sender < newCounts[k]![0]) { pos = k; break; }
    }
    newCounts.splice(pos, 0, [i.sender, 1]);
  }
  working.counts = newCounts;

  if (i.tier === 'A') {
    return { decision: { route: 'dina', senderTrust: 'contact_ring2', reasons: ['tier A: vouched'] }, state: working };
  }

  return { decision: { route: 'dina', senderTrust: 'unknown', reasons: ['tier B: held for you to accept'] }, state: working };
}
