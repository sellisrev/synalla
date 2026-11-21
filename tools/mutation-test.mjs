// Test command for mutation runs (stryker.config.json). Runs the normal suite with SYNALLA_MUTATION_RUN=1, which only
// skips the static source checks that Stryker's instrumentation breaks on purpose.
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['--test', 'test/*.test.js'], { stdio: 'inherit', env: { ...process.env, SYNALLA_MUTATION_RUN: '1' } });
process.exit(r.status ?? 1);
