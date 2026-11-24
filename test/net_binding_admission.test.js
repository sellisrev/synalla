// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial
//
// binding.ts and admission.ts, moved from the bridge into the protocol library (pilot plan W4: the network code the
// daemon and the home share). Their factory kits' recorded scenarios still hold: admission's golden as recorded, and
// binding's re-recorded from the factory reference with the final kind 19469 (the only change since the kit).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as binding from '../src/net/binding.js';
import * as admission from '../src/net/admission.js';
import * as bk from './fixtures/net/binding/scenarios.mjs';
import * as ak from './fixtures/net/admission/scenarios.mjs';

const golden = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

for (const [name, impl, kit, file] of [['binding', binding, bk, './fixtures/net/binding/golden.json'], ['admission', admission, ak, './fixtures/net/admission/golden.json']]) {
  for (const seed of kit.GOLDEN_SEEDS) {
    test(`${name}: golden scenario ${seed}`, () => {
      const g = golden(file)[seed];
      const got = JSON.parse(JSON.stringify(kit.runScenario(impl, kit.makeScenario(seed))));
      for (let i = 0; i < g.length; i++) assert.deepEqual(got[i], g[i], `step ${i}`);
      assert.equal(got.length, g.length);
    });
  }
}

test('binding kind is the final 19469', () => assert.equal(binding.BIND_KIND, 19469));
