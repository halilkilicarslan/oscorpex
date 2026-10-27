#!/usr/bin/env bash
set -euo pipefail

echo "=== Oscorpex Production Preflight ==="
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

PASS=0
FAIL=0
WARN=0

check() {
	local name="$1"
	local result="$2"
	if [ "$result" = "pass" ]; then
		echo "[PASS] $name"
		PASS=$((PASS + 1))
	elif [ "$result" = "warn" ]; then
		echo "[WARN] $name"
		WARN=$((WARN + 1))
	else
		echo "[FAIL] $name"
		FAIL=$((FAIL + 1))
	fi
}

# Environment checks
if [ "${NODE_ENV:-}" = "production" ]; then
	check "NODE_ENV=production" "pass"
else
	check "NODE_ENV=production" "fail"
fi

# JWT secret
if [ -n "${OSCORPEX_JWT_SECRET:-}" ] && [ ${#OSCORPEX_JWT_SECRET} -ge 32 ]; then
	check "JWT secret strong (>=32 chars)" "pass"
elif [ -n "${OSCORPEX_JWT_SECRET:-}" ]; then
	check "JWT secret present but weak (<32 chars)" "fail"
else
	check "JWT secret missing" "fail"
fi

# Dev auth bypass
if [ "${OSCORPEX_DEV_NO_AUTH:-}" = "true" ]; then
	check "DEV_NO_AUTH=true in production" "fail"
else
	check "DEV_NO_AUTH disabled" "pass"
fi

# Terminal exec
if [ "${OSCORPEX_ENABLE_TERMINAL_EXEC:-}" = "true" ]; then
	check "Terminal exec enabled in production" "fail"
else
	check "Terminal exec disabled" "pass"
fi

# MCP write tools
if [ "${OSCORPEX_ENABLE_MCP_WRITE_TOOLS:-}" = "true" ]; then
	if [ "${OSCORPEX_ALLOW_MCP_WRITE_IN_PROD:-}" = "true" ]; then
		check "MCP write tools enabled with prod override" "warn"
	else
		check "MCP write enabled without prod flag" "fail"
	fi
else
	check "MCP write tools disabled" "pass"
fi

# Docker socket
if [ -S "/var/run/docker.sock" ]; then
	check "Docker socket accessible" "warn"
else
	check "Docker socket not accessible" "pass"
fi

# docker-compose.yml check
if grep -q "^[^#]*docker.sock" docker-compose.yml 2>/dev/null; then
	check "Docker socket in default compose (uncommented)" "fail"
else
	check "Docker socket not in default compose" "pass"
fi

# RLS check (source inspection)
if grep -q "FORCE ROW LEVEL SECURITY" apps/kernel/scripts/init.sql 2>/dev/null; then
	check "FORCE ROW LEVEL SECURITY present" "pass"
else
	check "FORCE ROW LEVEL SECURITY missing" "fail"
fi

# RLS NULL escape check
if grep -q "tenant_id IS NULL OR tenant_id =" apps/kernel/scripts/init.sql 2>/dev/null; then
	check "tenant_id IS NULL escape present" "fail"
else
	check "tenant_id IS NULL escape removed" "pass"
fi

# Rate limiting check
if grep -q "rateLimiter" apps/kernel/src/studio/routes/index.ts 2>/dev/null; then
	check "Rate limiting configured" "pass"
else
	check "Rate limiting missing" "fail"
fi

# Hermes
if [ "${OSCORPEX_ENABLE_HERMES:-}" = "true" ]; then
	check "Hermes enabled — verify read-only config" "warn"
else
	check "Hermes disabled (default)" "pass"
fi

# P13-K: Hermes session budget — enforce conservative limit in production
if [ "${OSCORPEX_HERMES_SESSION_BUDGET:-100}" -le 50 ]; then
	check "Hermes session budget conservative (<=50)" "pass"
elif [ "${OSCORPEX_ENABLE_HERMES:-}" = "true" ]; then
	check "Hermes session budget high (>50) while Hermes enabled" "warn"
else
	check "Hermes disabled — session budget irrelevant" "pass"
fi

# Gateway
if [ "${OSCORPEX_ENABLE_GATEWAY:-}" = "true" ]; then
	check "Gateway enabled — verify read-only config" "warn"
else
	check "Gateway disabled (default)" "pass"
fi

# Scheduler
if [ "${OSCORPEX_ENABLE_SCHEDULER:-}" = "true" ]; then
	check "Scheduler enabled — verify read-only config" "warn"
else
	check "Scheduler disabled (default)" "pass"
fi

# Coverage threshold configured
if grep -q "thresholds" apps/kernel/vitest.config.ts 2>/dev/null; then
	check "Coverage thresholds configured in vitest.config.ts" "pass"
else
	check "Coverage thresholds missing from vitest.config.ts" "warn"
fi

# P0-P13 test suites present in CI
MISSING_SUITES=0
for p in p0 p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p11 p12 p13; do
	if ! grep -q "vitest.${p}" .github/workflows/ci.yml 2>/dev/null; then
		MISSING_SUITES=$((MISSING_SUITES + 1))
	fi
done
if [ "$MISSING_SUITES" -eq 0 ]; then
	check "All P0-P13 suites listed in CI" "pass"
else
	check "CI missing ${MISSING_SUITES} test suite(s)" "fail"
fi

# MCP write tool production guard
if [ "${OSCORPEX_ENABLE_MCP_WRITE_TOOLS:-}" = "true" ] && [ "${NODE_ENV:-}" = "production" ] && [ "${OSCORPEX_ALLOW_MCP_WRITE_IN_PROD:-}" != "true" ]; then
	check "MCP write tools enabled in production without override flag" "fail"
else
	check "MCP write tool production guard OK" "pass"
fi

# Checkpoint table exists in schema
if grep -q "CREATE TABLE IF NOT EXISTS mcp_checkpoints" apps/kernel/scripts/init.sql 2>/dev/null; then
	check "mcp_checkpoints table in schema" "pass"
else
	check "mcp_checkpoints table missing from schema" "fail"
fi

# Summary
echo ""
echo "=== Summary ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "WARN: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
	echo "PRODUCTION PREFLIGHT: FAILED — do not deploy"
	exit 1
elif [ "$WARN" -gt 0 ]; then
	echo "PRODUCTION PREFLIGHT: PASSED WITH WARNINGS — review before deploy"
	exit 0
else
	echo "PRODUCTION PREFLIGHT: PASSED"
	exit 0
fi
