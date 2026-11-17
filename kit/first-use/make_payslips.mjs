// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Builds the synthetic payslips used to test the first-use prompt, as HTML (print them to PDF).
// Every person, company and number here is fictional.
//   node kit/first-use/make_payslips.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('./payslips/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const eur = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const SLIPS = [
  {
    id: 'plain-qa-lyon',
    note: 'Full time, 12 months. Fixed 4,500 x 12 = 54,000.',
    employer: ['EXEMPLUM LOGICIELS SAS', '12 rue Fictive, 69003 Lyon', 'SIREN 999 100 201', 'APE 5829C', 'Convention collective Syntec (IDCC 1486)'],
    person: ['Camille ROUSSEL', '8 impasse des Tilleuls, 69100 Villeurbanne', 'N° SS 2 91 04 69 999 456 78', 'Matricule 00412'],
    job: 'Ingénieure qualité logicielle (QA) — Position 2.3, coefficient 150 — Entrée 04/09/2023',
    period: 'Mars 2026',
    lines: [['Salaire de base (151,67 h)', 4500]],
    net: 3510.12, iban: 'FR76 9999 4000 0312 3456 7890 143', cumul: 13500,
    truth: { attrs: { role: 'QA engineer', seniority: 'Mid', region: 'Lyon', company_type: 'Scale-up' }, value: 54000 },
    ident: ['ROUSSEL', 'Camille', 'EXEMPLUM', '999 100', '999100', '69 999', '9999 4000', '00412', 'Tilleuls'],
  },
  {
    id: 'month13-pm-lyon',
    note: '13-month pay stated in a note. Fixed 5,000 x 13 = 65,000.',
    employer: ['FICTIVIA SANTÉ SA', '40 quai Imaginaire, 69002 Lyon', 'SIREN 999 220 915', 'APE 6201Z', 'Convention collective Syntec'],
    person: ['Mehdi BENSALEM', 'NIR 1 87 11 75 999 321 44'],
    job: 'Product Manager senior — Cadre, position 3.1, coefficient 170 — Entrée 11/01/2021',
    period: 'Juin 2026',
    lines: [['Salaire de base', 5000], ['Tickets restaurant (part salariale)', -56]],
    extra: 'Rémunération annuelle sur 13 mois ; le 13e mois est versé en décembre.',
    net: 3902.4, iban: 'FR14 9999 1010 0505 0001 3M02 606', cumul: 30000,
    truth: { attrs: { role: 'Product manager', seniority: 'Senior', region: 'Lyon', company_type: 'Large company' }, value: 65000 },
    ident: ['BENSALEM', 'Mehdi', 'FICTIVIA', '999 220', '999220', '75 999', '9999 1010'],
  },
  {
    id: 'parttime-designer-lyon',
    note: '80% part time with a one-off bonus. Fixed FTE = 3,600 / 0.8 x 12 = 54,000; the 6,000 bonus is excluded.',
    employer: ['STUDIO PLACEBO SARL', '3 place Inventée, 69002 Lyon', 'SIREN 999 556 742', 'APE 7410Z', 'Convention collective Syntec'],
    person: ['Inès FONTANEL', 'N° SS 2 95 02 38 999 067 12'],
    job: 'Product Designer — Position 2.2, coefficient 130 — Temps partiel 80 % — Entrée 02/05/2024',
    period: 'Novembre 2026',
    lines: [['Salaire de base (121,33 h, 80 %)', 3600], ['Prime sur objectifs annuelle', 6000]],
    net: 7012.55, iban: 'FR76 9999 8073 0000 0204 5010 182', cumul: 45600,
    truth: { attrs: { role: 'Product designer', seniority: 'Mid', region: 'Lyon', company_type: 'Startup' }, value: 54000 },
    ident: ['FONTANEL', 'Inès', 'Ines', 'PLACEBO', '999 556', '999556', '38 999', '9999 8073'],
  },
  {
    id: 'overtime-qa-paris',
    note: 'Paris, overtime and a transport refund this month. Fixed 4,200 x 12 = 50,400, rounded to 50,000.',
    employer: ['DEMONSTRA BANQUE SA', '101 avenue Hypothétique, 75008 Paris', 'SIREN 999 777 123', 'APE 6419Z', 'Convention collective de la banque (IDCC 2120)'],
    person: ['Julien MARCHETTI', '22 rue du Modèle, 92100 Boulogne-Billancourt', 'N° SS 1 89 07 92 999 114 31', 'Matricule B-77310'],
    job: 'Lead QA engineer — Technicien des métiers de la banque, niveau H — Entrée 01/03/2019',
    period: 'Octobre 2026',
    lines: [['Salaire de base (151,67 h)', 4200], ['Heures supplémentaires 25 % (6 h)', 207.6], ['Remboursement transport (50 %)', 43.1]],
    net: 3411.87, iban: 'FR76 9999 3000 0201 7788 9900 412', cumul: 42633,
    truth: { attrs: { role: 'QA engineer', seniority: 'Lead', region: 'Paris', company_type: 'Large company' }, value: 50000 },
    ident: ['MARCHETTI', 'Julien', 'DEMONSTRA', '999 777', '999777', '92 999', '9999 3000', 'B-77310', 'Modèle', 'Modele'],
  },
];

const html = s => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bulletin de paie ${s.period}</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;font-size:12px;margin:32px;color:#111}
 h1{font-size:18px;margin:0 0 4px} .spec{color:#b00;font-weight:bold;letter-spacing:2px}
 .cols{display:flex;gap:24px;margin:12px 0} .box{border:1px solid #999;padding:8px;flex:1}
 table{width:100%;border-collapse:collapse;margin-top:12px} td,th{border:1px solid #999;padding:4px 6px;text-align:left}
 td.n{text-align:right} .foot{margin-top:12px}
</style></head><body>
<div class="spec">SPÉCIMEN — DONNÉES FICTIVES</div>
<h1>BULLETIN DE PAIE — ${s.period}</h1>
<div class="cols"><div class="box"><b>Employeur</b><br>${s.employer.join('<br>')}</div>
<div class="box"><b>Salarié</b><br>${s.person.join('<br>')}</div></div>
<div class="box"><b>Emploi</b> : ${s.job}</div>
<table><tr><th>Rubrique</th><th>Montant (€)</th></tr>
${s.lines.map(([l, v]) => `<tr><td>${l}</td><td class="n">${eur(v)}</td></tr>`).join('\n')}
<tr><th>Total brut</th><th class="n">${eur(s.lines.filter(([l]) => !/transport|tickets/i.test(l)).reduce((a, [, v]) => a + v, 0))}</th></tr>
</table>
${s.extra ? `<p><i>${s.extra}</i></p>` : ''}
<div class="foot">Net à payer : <b>${eur(s.net)}</b> — Virement sur IBAN ${s.iban}<br>Cumul brut annuel : ${eur(s.cumul)}</div>
</body></html>`;

for (const s of SLIPS) writeFileSync(new URL(`${s.id}.html`, OUT), html(s));
writeFileSync(new URL('truth.json', OUT), JSON.stringify(SLIPS.map(({ id, note, truth, ident }) => ({ id, note, truth, ident })), null, 2));
console.log(`wrote ${SLIPS.length} payslips`);
