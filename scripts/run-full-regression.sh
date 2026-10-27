#!/usr/bin/env bash
set -euo pipefail
echo "=== Oscorpex Full Regression Suite ==="
PASS=0; FAIL=0

run() { local n="$1"; shift; echo -n "[$n] "; if "$@" > /dev/null 2>&1; then echo "PASS"; PASS=$((PASS+1)); else echo "FAIL"; FAIL=$((FAIL+1)); fi; }

run "typecheck" pnpm --filter @oscorpex/kernel typecheck
run "build" pnpm --filter @oscorpex/kernel build
run "policy-kit" pnpm --filter @oscorpex/policy-kit test

cd apps/kernel
for s in p0 p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p12 p13; do
    cfg="vitest.${s}.config.ts"
    [ -f "$cfg" ] && run "test-${s}" npx vitest run --config "$cfg" || { echo "[test-${s}] SKIP"; }
done
# p11 uses separate config
[ -f "vitest.p11-unit.config.ts" ] && run "test-p11" npx vitest run --config vitest.p11-unit.config.ts
# rc1 stabilization
[ -f "vitest.rc1.config.ts" ] && run "test-rc1" npx vitest run --config vitest.rc1.config.ts || { echo "[test-rc1] SKIP"; }
cd ../..

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -gt 0 ] && { echo "REGRESSION: FAILED"; exit 1; } || echo "REGRESSION: PASSED"
