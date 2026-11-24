#!/bin/bash
# Full mutation run with the memory/hang watchdog. Usage: tools/run-mutation.sh [log file]
cd "$(dirname "$0")/.." || exit 1
LOG=${1:-reports/mutation-run.log}
mkdir -p "$(dirname "$LOG")"
powershell -NoProfile -ExecutionPolicy Bypass -File tools/mutation-watchdog.ps1 >> "$LOG.watchdog" 2>&1 &
npx stryker run >> "$LOG" 2>&1
code=$?
wait
exit $code
