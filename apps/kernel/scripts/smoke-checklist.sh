#!/bin/bash
# ---------------------------------------------------------------------------
# Oscorpex Closure Smoke Checklist
# Run this script to verify the kernel is in a releasable state.
# Exit 0 = all checks passed. Exit 1 = at least one check failed.
# ---------------------------------------------------------------------------

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
	local name="$1"
	shift
	if "$@" > /dev/null 2>&1; then
		echo -e "${GREEN}✓${NC} $name"
		PASS=$((PASS + 1))
	else
		echo -e "${RED}✗${NC} $name"
		FAIL=$((FAIL + 1))
	fi
}

echo "=== Oscorpex Closure Smoke Checklist ==="
echo ""

cd "$(dirname "$0")/../.."

echo "--- Monorepo Typecheck ---"
check "root typecheck" pnpm typecheck

echo ""
echo "--- Build ---"
check "core package build" pnpm --filter @oscorpex/core build
check "kernel build" pnpm --filter @oscorpex/kernel build

echo ""
echo "--- Kernel Test Suite ---"
check "kernel tests" pnpm --filter @oscorpex/kernel test

echo ""
echo "--- Provider Registry Smoke ---"
check "provider registry contract tests" pnpm --filter @oscorpex/kernel test -- --testPathPattern=provider-registry

echo ""
echo "--- Replay Smoke ---"
check "replay contract tests" pnpm --filter @oscorpex/kernel test -- --testPathPattern=replay-contract
check "replay restore tests" pnpm --filter @oscorpex/kernel test -- --testPathPattern=replay-restore
check "replay route tests" pnpm --filter @oscorpex/kernel test -- --testPathPattern=replay-routes

echo ""
echo "--- Hook Registry Smoke ---"
check "hook registry tests" pnpm --filter @oscorpex/kernel test -- --testPathPattern=hook-registry

echo ""
echo "--- Final Audit Closure ---"
check "final audit closure tests" pnpm --filter @oscorpex/kernel test -- --testPathPattern=final-audit-closure

echo ""
echo "=== Summary ==="
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"

if [ $FAIL -eq 0 ]; then
	echo -e "${GREEN}All checks passed. Kernel is in releasable state.${NC}"
	exit 0
else
	echo -e "${RED}Some checks failed. Review output above.${NC}"
	exit 1
fi