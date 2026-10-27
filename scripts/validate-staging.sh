#!/usr/bin/env bash
set -euo pipefail

echo "=== Oscorpex Staging Validation ==="
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

PASS=0
FAIL=0
SKIP=0

run_check() {
	local name="$1"
	shift
	echo -n "[$name] "
	if "$@" > /dev/null 2>&1; then
		echo "PASS"
		PASS=$((PASS + 1))
	else
		echo "FAIL"
		FAIL=$((FAIL + 1))
	fi
}

# Build checks
run_check "typecheck" pnpm --filter @oscorpex/kernel typecheck
run_check "build-kernel" pnpm --filter @oscorpex/kernel build
run_check "build-policy-kit" pnpm --filter @oscorpex/policy-kit build

# Test suites
cd apps/kernel
for suite in p0 p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p11 p12; do
	config="vitest.${suite}.config.ts"
	if [ -f "$config" ]; then
		run_check "test-${suite}" npx vitest run --config "$config"
	else
		echo "[test-${suite}] SKIP (config not found)"
		SKIP=$((SKIP + 1))
	fi
done
cd ../..

# Package tests
run_check "policy-kit-tests" pnpm --filter @oscorpex/policy-kit test

# Summary
echo ""
echo "=== Summary ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "SKIP: $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
	echo "STAGING VALIDATION: FAILED"
	exit 1
else
	echo "STAGING VALIDATION: PASSED"
	exit 0
fi
