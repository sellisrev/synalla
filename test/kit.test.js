// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const score = (id, reply) => {
  const dir = mkdtempSync(join(tmpdir(), 'syn-kit-'));
  const f = join(dir, 'reply.txt');
  writeFileSync(f, reply);
  return execFileSync(process.execPath, ['kit/first-use/score.mjs', id, f], { encoding: 'utf8' }).trim();
};

test('scorer: a correct record passes', () => {
  const rec = { question: 'pay-product-fr-2027', key: 'a'.repeat(32), attrs: { role: 'QA engineer', seniority: 'Lead', region: 'Paris', company_type: 'Large company' }, value: 50000 };
  assert.equal(score('overtime-qa-paris', `Here you go.\nPAYLOAD: ${JSON.stringify(rec)}`), 'overtime-qa-paris,1,1,1,1,1,1,1,0,""');
});

test('scorer: overtime counted as fixed pay and identity both show up', () => {
  const rec = { question: 'pay-product-fr-2027', key: 'b'.repeat(32), attrs: { role: 'QA engineer', seniority: 'Lead', region: 'Paris', company_type: 'Large company' }, value: 52900, full_name: 'Julien Marchetti', iban: 'FR76 9999 3000 0201' };
  const out = score('overtime-qa-paris', `PAYLOAD: ${JSON.stringify(rec)}`).split(',');
  assert.equal(out[2], '0'); // extra fields make it invalid
  assert.equal(out[7], '0'); // 52,900 is more than 1,000 away from 50,000
  assert.equal(out[8], '1');
  assert.match(out[9], /MARCHETTI/);
});

test('scorer: no payload line', () => {
  assert.equal(score('plain-qa-lyon', 'I cannot read the file.'), 'plain-qa-lyon,0,0,0,0,0,0,0,0,""');
});
