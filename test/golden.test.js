// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Replays the golden walk (test/golden/scenario.mjs) and compares every output with test/golden/golden.json.
// SYNALLA_IMPL=<path to an index module> points the same walk at another build, e.g. the TypeScript port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './golden/scenario.mjs';

const root = path.join(import.meta.dirname, '..');
const own = ['index.ts', 'index.js'].map(f => path.join(root, 'src', f)).find(f => fs.existsSync(f));
const impl = process.env.SYNALLA_IMPL ? path.resolve(process.env.SYNALLA_IMPL) : own;
const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'golden', 'golden.json'), 'utf8'));

test('golden walk: every output matches the recorded one', async () => {
  const lib = await import(pathToFileURL(impl).href);
  const got = await run(lib);
  assert.deepEqual(got.map(e => e.name), golden.map(e => e.name), 'the walk itself changed');
  for (let i = 0; i < golden.length; i++) assert.deepEqual(got[i], golden[i], `entry ${i}: ${golden[i].name}`);
});

test('golden walk: it uses every export of the library', async () => {
  const lib = await import(pathToFileURL(impl).href);
  const used = new Set();
  await run(new Proxy(lib, { get(t, k) { used.add(k); return t[k]; } }));
  assert.deepEqual(Object.keys(lib).filter(k => !used.has(k)), []);
});
