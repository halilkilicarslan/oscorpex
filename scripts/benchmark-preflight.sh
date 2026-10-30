#!/usr/bin/env bash
# Check prerequisites without spending tokens or starting benchmark tasks.
set -euo pipefail
fail=0
check() {
  if "$@" >/dev/null 2>&1; then printf 'OK: %s\n' "$*"; else printf 'MISSING: %s\n' "$*"; fail=1; fi
}
check command -v docker
check docker info
check command -v node
check command -v pnpm
check command -v python3
if [[ -n "${OSCORPEX_ROOT:-}" && -f "$OSCORPEX_ROOT/apps/kernel/src/benchmark/runner.ts" ]]; then
  echo "OK: OSCORPEX_ROOT"
else
  echo "MISSING: OSCORPEX_ROOT with runner.ts"; fail=1
fi
if [[ -n "${MODEL_NAME:-}" ]]; then echo "OK: MODEL_NAME"; else echo "MISSING: MODEL_NAME"; fail=1; fi
if [[ -n "${OSCORPEX_BENCH_PROVIDER:-}" ]]; then echo "OK: OSCORPEX_BENCH_PROVIDER"; else echo "MISSING: OSCORPEX_BENCH_PROVIDER"; fail=1; fi
if [[ "$fail" != 0 ]]; then echo "Preflight failed: do not start benchmark"; exit 1; fi
echo "Preflight passed. Model endpoint and benchmark metric parser still require verification."
