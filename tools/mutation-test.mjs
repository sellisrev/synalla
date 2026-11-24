// Test command for mutation runs (stryker.config.json). Runs the normal suite with SYNALLA_MUTATION_RUN=1, which only
// skips the static source checks that Stryker's instrumentation breaks on purpose.
//
// Guards against mutants that leak memory or hang (24 Nov 2026: two orphaned test children reached 40 GB and 27 GB):
// - the suite runs in ONE process (--test-isolation=none), so there are no test children that could be orphaned;
// - that process gets a 2 GB heap cap, so a leaking mutant crashes (counted as killed) instead of eating the PC;
// - each test has a time limit, and the whole run is stopped after RUN_LIMIT_MS, before Stryker's own timeout;
// - if this wrapper is stopped or the run overruns, the suite process is killed with its tree.
import { spawn, spawnSync } from 'node:child_process';

const RUN_LIMIT_MS = Number(process.env.SYNALLA_MUTATION_RUN_LIMIT_MS || 45000);
const env = { ...process.env, SYNALLA_MUTATION_RUN: '1' };
const child = spawn(process.execPath, ['--max-old-space-size=2048', '--import', './tools/ts-resolve.mjs', '--test', '--test-isolation=none', '--test-timeout=20000', 'test/*.test.js'],
  { stdio: 'inherit', env });

function killTree() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } }
}

const timer = setTimeout(() => { console.error(`mutation-test: run over ${RUN_LIMIT_MS} ms, killing the test tree`); killTree(); }, RUN_LIMIT_MS);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killTree(); process.exit(1); });
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});
