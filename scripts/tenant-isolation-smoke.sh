#!/usr/bin/env bash
set -euo pipefail
echo "=== Tenant Isolation Smoke Test ==="
echo "Verifying RLS and tenant isolation..."

# Check init.sql for RLS
FORCE_COUNT=$(grep -c "FORCE ROW LEVEL SECURITY" apps/kernel/scripts/init.sql)
ENABLE_COUNT=$(grep -c "^ALTER TABLE.*ENABLE ROW LEVEL SECURITY" apps/kernel/scripts/init.sql)
NULL_ESCAPE=$(grep -c "tenant_id IS NULL OR tenant_id =" apps/kernel/scripts/init.sql || true)

echo "FORCE RLS: $FORCE_COUNT tables"
echo "ENABLE RLS: $ENABLE_COUNT tables"
echo "NULL escape: $NULL_ESCAPE occurrences"

[ "$NULL_ESCAPE" -gt 0 ] && { echo "FAIL: tenant_id IS NULL escape found"; exit 1; }
[ "$FORCE_COUNT" -lt "$ENABLE_COUNT" ] && { echo "FAIL: FORCE RLS missing on some tables"; exit 1; }

echo "PASS: Tenant isolation schema checks passed"
