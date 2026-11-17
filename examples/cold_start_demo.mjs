// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// A simulated cold start, with synthetic people and synthetic pay. Nothing leaves this process.
//
//   node examples/cold_start_demo.mjs [weeks] [seed]
//
// Day 0: one person, no network. Their agent already judges public job ads against a floor only
// they know (single-player value). Then three conveners (a QA meetup organiser, a PM community
// lead, a design-school alumni lead) start invite chains. Every invite is a vouch. Each week,
// new people contribute, a round is published, and everyone sees either a result or progress.

import { readFileSync } from 'node:fs';
import {
  generateSecretKey, getPublicKey, randomHex,
  createInvite, redeemInvite, acceptRedemption, VouchGraph, admissionTier,
  RecordStore, publishRound, progressCard, personalView, ladder,
  createOffer, judgeOffer,
} from '../src/index.js';

const WEEKS = Number(process.argv[2] ?? 8);
let seed = Number(process.argv[3] ?? 11);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = a => a[Math.floor(rnd() * a.length)];
const Q = JSON.parse(readFileSync(new URL('./questions/pay_product_fr.json', import.meta.url)));
const DAY = 86400;
const T0 = 1_800_000_000;

const PAY = { // synthetic medians, not real data
  'Product designer': 46000, 'Product manager': 55000, 'QA engineer': 44000,
};
const SEN = { Junior: 0.75, Mid: 1, Senior: 1.25, Lead: 1.5 };
const REG = { Paris: 1.12, Lyon: 1, 'Other France': 0.93 };
const CO = { Startup: 0.97, 'Scale-up': 1.05, 'Large company': 1.02 };
const synthPay = a => Math.round(PAY[a.role] * SEN[a.seniority] * REG[a.region] * CO[a.company_type] * (0.85 + rnd() * 0.3));

// ---- Day 0: one person, nobody else ----------------------------------------------------------
console.log('\n=== Day 0: a single agent, no network ===');
const deriver = generateSecretKey(); // whoever turned public ads into signed offers; marked as derived
const ads = [
  ['Senior QA engineer', 'QA engineer', 'Lyon', 48000, 56000],
  ['QA lead', 'QA engineer', 'Lyon', 58000, 66000],
  ['QA engineer', 'QA engineer', 'Paris', 42000, 50000],
  ['Product manager', 'Product manager', 'Lyon', 52000, 62000],
].map(([title, role, region, payMin, payMax], i) => createOffer(deriver, {
  type: 'job', title, role, region, payMin, payMax, currency: 'EUR', period: 'year',
  source: { kind: 'public_ad', url: `https://example.org/ads/${i}`, retrievedAt: '2026-11-16' },
}, { createdAt: T0 }));
const myLimits = { floor: 55000, currency: 'EUR', roles: ['QA engineer'], regions: ['Lyon'] }; // stays at home
for (const ad of ads) {
  const { fit, reasons } = judgeOffer(myLimits, ad, { now: T0 });
  console.log(`  ${JSON.parse(ad.content).title.padEnd(22)} ${fit.padEnd(16)} ${reasons.join('; ')}`);
}

// ---- Invite chains ---------------------------------------------------------------------------
const people = []; // {sk, pk, attrs, key, joinedWeek, by}
const graph = new VouchGraph();
const store = new RecordStore(Q);

function join(attrs, week, by) {
  const sk = generateSecretKey();
  const p = { sk, pk: getPublicKey(sk), attrs, key: randomHex(16), joinedWeek: week, by };
  if (by) {
    const t = T0 + week * 7 * DAY;
    const { code, invite } = createInvite(by.sk, { scope: Q.id, createdAt: t });
    const red = redeemInvite({ invite, code, inviteeSk: sk, createdAt: t + 60 });
    graph.add(acceptRedemption({ invite, code, redemption: red, issuerSk: by.sk, now: t + 120 }));
  }
  store.upsert(p.key, attrs, synthPay(attrs));
  people.push(p);
  return p;
}

const conveners = [
  join({ role: 'QA engineer', seniority: 'Senior', region: 'Lyon', company_type: 'Scale-up' }, 0, null),
  join({ role: 'Product manager', seniority: 'Mid', region: 'Paris', company_type: 'Startup' }, 0, null),
  join({ role: 'Product designer', seniority: 'Mid', region: 'Paris', company_type: 'Scale-up' }, 0, null),
];
const roots = conveners.map(c => c.pk);

// A colleague is usually in the same role and region (the atomic network), sometimes not.
function colleagueOf(p) {
  const a = { ...p.attrs };
  if (rnd() < 0.15) a.role = pick(Object.keys(PAY));
  if (rnd() < 0.2) a.region = pick(Q.attributes.region);
  a.seniority = pick(Q.attributes.seniority);
  a.company_type = rnd() < 0.6 ? p.attrs.company_type : pick(Q.attributes.company_type);
  return a;
}

const history = [];
let spammer = null;
for (let week = 1; week <= WEEKS; week++) {
  // Each person invites 0-2 colleagues in the weeks after joining; enthusiasm fades with time.
  for (const p of [...people]) {
    const age = week - p.joinedWeek;
    const invites = rnd() < 0.55 / age ? (rnd() < 0.4 ? 2 : 1) : 0;
    for (let i = 0; i < invites; i++) join(colleagueOf(p), week, p);
  }
  if (week === 3) { // someone invites a key that turns out to be abusive
    spammer = join({ role: 'QA engineer', seniority: 'Junior', region: 'Lyon', company_type: 'Startup' }, week, pick(people));
  }
  if (week === 4 && spammer) {
    graph.removeMember(spammer.pk, T0 + week * 7 * DAY);
    store.delete(spammer.key);
  }

  const { release, privateRows } = publishRound(Q, store.all(), history, { round: week, at: `week ${week}` });
  history.push({ round: week, rows: privateRows });

  console.log(`\n=== Week ${week}: ${store.all().length} records, ${graph.activeEdges().length} vouches in force ===`);
  console.log(`  published: ${release.groups.length ? release.groups.map(g => `${g.label} (n=${g.count}, median ${g.median}${g.asOfRound ? `, as of week ${g.asOfRound}` : ''})`).join('; ') : 'nothing yet'}`);
  if (release.waiting.length) console.log(`  waiting:   ${release.waiting.map(w => w.label).join('; ')}`);
  const c = conveners[0];
  const v = personalView(Q, store.all(), release, c.attrs, store.records.get(c.key).value);
  console.log(`  QA convener sees: ${v.result ? `${v.result.label}, ${v.position}${v.result.asOfRound ? ` (week ${v.result.asOfRound} result)` : ''}` : 'no result yet'}`);
  for (const l of v.locked) console.log(`    share card: "${l.text}"`);
}

// ---- Trust after the cold start --------------------------------------------------------------
console.log('\n=== Admission, as one convener\'s home sees it ===');
const invited = people.find(p => p.by === conveners[0]);
const invitedByInvited = people.find(p => p.by === invited);
const farther = people.find(p => p.by && p.by.by && p.by.by.by === conveners[0]);
const stranger = getPublicKey(generateSecretKey());
for (const [name, pk] of [
  ['invited by convener', invited?.pk], ['2 invites away', invitedByInvited?.pk], ['3 invites away', farther?.pk],
  ['removed key', spammer?.pk], ['unknown key', stranger]]) {
  if (!pk) continue;
  const t = admissionTier({ owner: conveners[0].pk, contacts: [], graph, sender: pk });
  console.log(`  ${name.padEnd(22)} tier ${t.tier} -> ${t.action} (${t.reasons.join('; ')})`);
}
const covered = new Set(people.filter(p => graph.hops(roots, p.pk, 10) < Infinity).map(p => p.pk)).size;
console.log(`  ${covered} of ${people.length} people are reachable through vouches from the three conveners`);
console.log('\nAll people and pay in this demo are synthetic.');
