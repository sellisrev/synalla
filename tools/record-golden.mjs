// SPDX-FileCopyrightText: 2026 Serge Versillé
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Synalla-Commercial

// Records test/golden/golden.json from the current src/ (see test/golden/scenario.mjs).
// The file is the behaviour contract for ports and refactors: re-record only when a behaviour change is intended,
// and say which entries changed in the commit message.   node tools/record-golden.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../test/golden/scenario.mjs';

const root = path.join(import.meta.dirname, '..');
const file = path.join(root, 'test', 'golden', 'golden.json');
if (fs.existsSync(file) && !process.argv.includes('--force')) {
  console.error(`${file} exists; pass --force to re-record (only for an intended behaviour change)`);
  process.exit(1);
}
const lib = await import(pathToFileURL(['index.ts', 'index.js'].map(f => path.join(root, 'src', f)).find(f => fs.existsSync(f))).href);
const out = await run(lib);
fs.writeFileSync(file, JSON.stringify(out, null, 0).replace(/\},\{"name"/g, '},\n{"name"') + '\n');
console.log(`recorded ${out.length} entries to ${path.relative(root, file)}`);
