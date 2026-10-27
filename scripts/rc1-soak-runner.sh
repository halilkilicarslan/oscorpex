#!/usr/bin/env bash
set -euo pipefail

echo "============================================"
echo "  Oscorpex RC1 Soak Execution"
echo "  Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================"
echo ""

PASS=0; FAIL=0; WARN=0

check() {
	local name="$1" result="$2"
	if [ "$result" = "pass" ]; then echo "[PASS] $name"; PASS=$((PASS+1));
	elif [ "$result" = "warn" ]; then echo "[WARN] $name"; WARN=$((WARN+1));
	else echo "[FAIL] $name"; FAIL=$((FAIL+1)); fi
}

echo "--- Phase 1: Environment Verification ---"
check "Node.js available" "$(node --version > /dev/null 2>&1 && echo pass || echo fail)"
check "pnpm available" "$(pnpm --version > /dev/null 2>&1 && echo pass || echo fail)"

echo ""
echo "--- Phase 2: Build Verification ---"
pnpm --filter @oscorpex/kernel typecheck > /dev/null 2>&1 && check "Kernel typecheck" "pass" || check "Kernel typecheck" "fail"
pnpm --filter @oscorpex/kernel build > /dev/null 2>&1 && check "Kernel build" "pass" || check "Kernel build" "fail"

echo ""
echo "--- Phase 3: Full Regression ---"
cd apps/kernel
for suite in p0 p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p12 p13; do
	cfg="vitest.${suite}.config.ts"
	if [ -f "$cfg" ]; then
		npx vitest run --config "$cfg" > /dev/null 2>&1 && check "Suite ${suite}" "pass" || check "Suite ${suite}" "fail"
	fi
done
[ -f "vitest.p11-unit.config.ts" ] && { npx vitest run --config vitest.p11-unit.config.ts > /dev/null 2>&1 && check "Suite p11" "pass" || check "Suite p11" "fail"; }
[ -f "vitest.rc1.config.ts" ] && { npx vitest run --config vitest.rc1.config.ts > /dev/null 2>&1 && check "Suite rc1" "pass" || check "Suite rc1" "fail"; }
cd ../..

echo ""
echo "--- Phase 4: Policy Kit ---"
pnpm --filter @oscorpex/policy-kit test > /dev/null 2>&1 && check "Policy-kit tests" "pass" || check "Policy-kit tests" "fail"

echo ""
echo "--- Phase 5: Security Smoke ---"
# RLS verification
NULL_COUNT=$(grep -c "tenant_id IS NULL OR tenant_id =" apps/kernel/scripts/init.sql 2>/dev/null || echo 0)
[ "$NULL_COUNT" = "0" ] && check "RLS NULL escape absent" "pass" || check "RLS NULL escape present" "fail"

FORCE_COUNT=$(grep -c "FORCE ROW LEVEL SECURITY" apps/kernel/scripts/init.sql 2>/dev/null || echo 0)
[ "$FORCE_COUNT" -gt 0 ] && check "FORCE RLS present ($FORCE_COUNT tables)" "pass" || check "FORCE RLS missing" "fail"

# Docker socket
SOCKET_ACTIVE=$(grep -v "^[[:space:]]*#" docker-compose.yml | grep -c "docker.sock" 2>/dev/null || echo 0)
[ "$SOCKET_ACTIVE" = "0" ] && check "Docker socket not in default compose" "pass" || check "Docker socket active" "fail"

# Secret guard patterns
SECRET_PATTERNS=$(grep -c "pattern" apps/kernel/src/studio/mcp-bridge/secret-guard.ts 2>/dev/null || echo 0)
[ "$SECRET_PATTERNS" -gt 20 ] && check "Secret guard ($SECRET_PATTERNS patterns)" "pass" || check "Secret guard insufficient" "warn"

echo ""
echo "============================================"
echo "  SUMMARY"
echo "  PASS: $PASS  |  FAIL: $FAIL  |  WARN: $WARN"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
	echo "  RC1 SOAK: BLOCKED — $FAIL failures"
	exit 1
elif [ "$WARN" -gt 0 ]; then
	echo "  RC1 SOAK: PASSED WITH WARNINGS"
	exit 0
else
	echo "  RC1 SOAK: PASSED"
	exit 0
fi
