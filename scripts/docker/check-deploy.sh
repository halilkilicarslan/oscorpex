#!/usr/bin/env bash
# D2 deploy-artifact check: builds the kernel, runs `pnpm deploy --prod` into a temp dir and verifies the
# artifact (dist chunks, init.sql, every @oscorpex/* package importable, no secrets / sources / devDependencies)
# plus the compiled migrate and admin-grant entry points against a scratch PostgreSQL database.
#
# Usage: scripts/docker/check-deploy.sh [--db <superuser postgres URL>]
#   --db  superuser connection used to create/drop the scratch databases
#         (default: $PGURL, else postgresql://localhost:5432/postgres)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEFAULT_DB="${PGURL:-postgresql://localhost:5432/postgres}"
DB_URL=""

while [ $# -gt 0 ]; do
	case "$1" in
	--db)
		[ $# -ge 2 ] || {
			echo "usage: $0 [--db <superuser postgres URL>]" >&2
			exit 2
		}
		DB_URL="$2"
		shift
		;;
	*)
		echo "usage: $0 [--db <superuser postgres URL>]" >&2
		exit 2
		;;
	esac
	shift
done
if [ -z "$DB_URL" ]; then
	DB_URL="$DEFAULT_DB"
	echo "INFO: --db not given, using default $DEFAULT_DB"
fi

FAILS=0
pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1"
	FAILS=$((FAILS + 1))
}
check() { # check <description> <command...>
	local desc="$1"
	shift
	if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

TMP="$(mktemp -d)"
SCRATCH_NAME="oscorpex_d2_deploy_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
SCRATCH_CREATED=0
BOOT_CREATED=0
BOOT_NAME="${SCRATCH_NAME}_boot"

# Replace the database name of a postgres URL (keeps credentials/host/query).
with_db() { # with_db <url> <dbname>
	node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; process.stdout.write(u.toString());' "$1" "$2"
}

cleanup() {
	local rc=$?
	if [ "$SCRATCH_CREATED" = 1 ]; then
		psql "$DB_URL" -qAt -c "DROP DATABASE IF EXISTS ${SCRATCH_NAME} WITH (FORCE)" >/dev/null 2>&1 || true
	fi
	if [ "$BOOT_CREATED" = 1 ]; then
		psql "$DB_URL" -qAt -c "DROP DATABASE IF EXISTS ${BOOT_NAME} WITH (FORCE)" >/dev/null 2>&1 || true
	fi
	rm -rf "$TMP"
	exit $rc
}
trap 'exit 130' INT TERM
trap cleanup EXIT

OUT="$TMP/out"

# ---------------------------------------------------------------- build + deploy
cd "$ROOT"
if pnpm --filter "@oscorpex/kernel..." build >"$TMP/build.log" 2>&1; then
	pass "pnpm build"
else
	fail "pnpm build (log tail: $(tail -n 15 "$TMP/build.log" | tr '\n' '|'))"
fi

if pnpm --filter @oscorpex/kernel deploy --prod "$OUT" >"$TMP/deploy.log" 2>&1; then
	pass "pnpm deploy --prod"
else
	fail "pnpm deploy --prod (log tail: $(tail -n 15 "$TMP/deploy.log" | tr '\n' '|'))"
	echo "FAIL: $FAILS check(s) failed (deploy output missing, aborting)"
	exit 1
fi

# ---------------------------------------------------------------- kernel files
for f in dist/index.js dist/migrate.js dist/admin-grant.js scripts/init.sql package.json; do
	check "out contains $f" test -f "$OUT/$f"
done

# every relative import specifier in out/dist/*.js resolves
MISSING_IMPORTS=""
if [ -d "$OUT/dist" ]; then
	for js in "$OUT"/dist/*.js; do
		[ -f "$js" ] || continue
		# Top-level static imports/re-exports and dynamic import("./x.js") only: bundled scaffold templates embed
		# `from './x.js'` text in template strings that must not count; only hashed chunk names (name-XXXXXXXX.js) are checked.
		specs="$({
			grep -E '^(import|export) .* from "\./[^"]+"' "$js" | grep -oE 'from "\./[^"]+"' || true
			grep -E '^import "\./[^"]+"' "$js" | grep -oE '"\./[^"]+"' || true
			grep -oE 'import\("\./[^"]+"\)' "$js" || true
		} | grep -oE '\./[^"]+' | grep -E -- '-[A-Za-z0-9_-]{8}\.js$' | sort -u || true)"
		for spec in $specs; do
			[ -f "$OUT/dist/$spec" ] || MISSING_IMPORTS="$MISSING_IMPORTS $(basename "$js"):$spec"
		done
	done
fi
if [ -z "$MISSING_IMPORTS" ] && [ -d "$OUT/dist" ]; then
	pass "all relative imports in out/dist resolve"
else
	fail "unresolved relative imports in out/dist:${MISSING_IMPORTS:- (dist missing)}"
fi

# ---------------------------------------------------------------- @oscorpex/* packages
PKGS="$(node -e 'const d = require(process.argv[1]).dependencies || {}; console.log(Object.keys(d).filter((k) => k.startsWith("@oscorpex/")).join("\n"))' "$ROOT/apps/kernel/package.json")"
for pkg in $PKGS; do
	dir="$OUT/node_modules/$pkg"
	check "$pkg: dist/index.js present" test -f "$dir/dist/index.js"
	LEAK=""
	[ -e "$dir/src" ] && LEAK="$LEAK src"
	[ -n "$(find "$dir/" -name __tests__ -print 2>/dev/null | head -n 1)" ] && LEAK="$LEAK __tests__"
	[ -n "$(find "$dir/" -name '.env*' -print 2>/dev/null | head -n 1)" ] && LEAK="$LEAK .env"
	[ -e "$dir/tsconfig.json" ] && LEAK="$LEAK tsconfig.json"
	if [ -z "$LEAK" ] && [ -d "$dir" ]; then pass "$pkg: no src/tests/.env/tsconfig in package"; else fail "$pkg: leaked or missing:${LEAK:- (package dir missing)}"; fi
	if (cd "$OUT" && node --input-type=module -e "await import('$pkg')") >"$TMP/import.log" 2>&1; then
		pass "$pkg: import() succeeds"
	else
		fail "$pkg: import() failed ($(tail -n 3 "$TMP/import.log" | tr '\n' '|'))"
	fi
done

# ---------------------------------------------------------------- out hygiene
# Third-party fixtures inside node_modules (e.g. ssh2 test keys) are not ours; scan everything else.
check "out has no .env* files outside node_modules" test -z "$(find "$OUT" -path "$OUT/node_modules" -prune -o -name '.env*' -print 2>/dev/null | head -n 1)"
check "out has no *.pem files outside node_modules" test -z "$(find "$OUT" -path "$OUT/node_modules" -prune -o -name '*.pem' -print 2>/dev/null | head -n 1)"
check "@oscorpex/* packages in out contain no .env* or *.pem" test -z "$(find "$OUT"/node_modules/@oscorpex/ \( -name '.env*' -o -name '*.pem' \) -print 2>/dev/null | head -n 1)"
check "out has no src/ at its root" test ! -e "$OUT/src"
for dev in vitest @biomejs/biome tsx typescript; do
	check "devDependency $dev absent from out/node_modules" test ! -e "$OUT/node_modules/$dev"
done

# ---------------------------------------------------------------- scratch database
if psql "$DB_URL" -qAt -c "CREATE DATABASE ${SCRATCH_NAME}" >"$TMP/createdb.log" 2>&1; then
	SCRATCH_CREATED=1
	pass "scratch database $SCRATCH_NAME created"
else
	fail "scratch database creation ($(tail -n 2 "$TMP/createdb.log" | tr '\n' '|'))"
	echo "FAIL: $FAILS check(s) failed"
	exit 1
fi
SCRATCH_URL="$(with_db "$DB_URL" "$SCRATCH_NAME")"

run_node() { # run_node <logfile> <env assignments...> -- <node args...>   (cwd = out)
	local log="$1"
	shift
	local envs=()
	while [ "$1" != "--" ]; do
		envs+=("$1")
		shift
	done
	shift
	(cd "${RUN_CWD:-$OUT}" && env -u OSCORPEX_MIGRATION_DATABASE_URL -u DATABASE_URL ${envs[@]+"${envs[@]}"} node "$@") >"$log" 2>&1
}

# ---------------------------------------------------------------- migrate artifact
if [ -f "$OUT/dist/migrate.js" ]; then
	if run_node "$TMP/migrate-nourl.log" NODE_ENV=production -- dist/migrate.js; then
		fail "migrate without OSCORPEX_MIGRATION_DATABASE_URL must exit non-zero"
	elif grep -q "OSCORPEX_MIGRATION_DATABASE_URL" "$TMP/migrate-nourl.log"; then
		pass "migrate without migration URL exits non-zero and names OSCORPEX_MIGRATION_DATABASE_URL"
	else
		fail "migrate without migration URL exited non-zero but did not mention OSCORPEX_MIGRATION_DATABASE_URL"
	fi
	if run_node "$TMP/migrate1.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" "DATABASE_URL=$SCRATCH_URL" -- dist/migrate.js; then
		pass "migrate applies the schema (exit 0)"
	else
		fail "migrate exit 0 ($(tail -n 5 "$TMP/migrate1.log" | tr '\n' '|'))"
	fi
	HASH="$(psql "$SCRATCH_URL" -qAt -c "SELECT value FROM public.schema_meta WHERE key = 'init_sql_sha256'" 2>/dev/null || true)"
	if [ -n "$HASH" ]; then pass "scratch schema_meta.init_sql_sha256 present"; else fail "scratch schema_meta.init_sql_sha256 missing"; fi
	if run_node "$TMP/migrate2.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" "DATABASE_URL=$SCRATCH_URL" -- dist/migrate.js; then
		pass "migrate is idempotent (second run exit 0)"
	else
		fail "migrate second run ($(tail -n 5 "$TMP/migrate2.log" | tr '\n' '|'))"
	fi
else
	fail "migrate artifact missing: dist/migrate.js (skipping migrate runs)"
	fail "migrate-dependent checks skipped (schema not applied)"
	# Apply the schema directly so the admin-grant checks can still run against a real users table.
	psql "$SCRATCH_URL" -qAt -v ON_ERROR_STOP=1 -f "$ROOT/apps/kernel/scripts/init.sql" >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- admin-grant artifact
EMAIL="d2-admin-check@example.test"
psql "$SCRATCH_URL" -qAt -c "INSERT INTO users (email, password_hash) VALUES ('$EMAIL', 'x') ON CONFLICT (email) DO NOTHING" >/dev/null 2>&1 || true
admin_flag() { psql "$SCRATCH_URL" -qAt -c "SELECT is_platform_admin FROM users WHERE email = '$EMAIL'" 2>/dev/null || true; }

if [ -f "$OUT/dist/admin-grant.js" ]; then
	if run_node "$TMP/ag-nourl.log" NODE_ENV=production "DATABASE_URL=$SCRATCH_URL" -- dist/admin-grant.js grant "$EMAIL"; then
		fail "admin-grant without OSCORPEX_MIGRATION_DATABASE_URL must exit non-zero in production"
	else
		pass "admin-grant without migration URL exits non-zero"
	fi
	if run_node "$TMP/ag-grant.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" -- dist/admin-grant.js grant "$EMAIL" && [ "$(admin_flag)" = "t" ]; then
		pass "admin-grant grant sets is_platform_admin = true"
	else
		fail "admin-grant grant ($(tail -n 3 "$TMP/ag-grant.log" | tr '\n' '|'))"
	fi
	GRANTED="$(grep -c "Granted platform admin" "$TMP/ag-grant.log" || true)"
	if [ "$GRANTED" = 1 ]; then pass "admin-grant prints exactly one 'Granted platform admin' line"; else fail "admin-grant printed $GRANTED 'Granted platform admin' lines (expected 1)"; fi
	if run_node "$TMP/ag-revoke.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" -- dist/admin-grant.js revoke "$EMAIL" && [ "$(admin_flag)" = "f" ]; then
		pass "admin-grant revoke sets is_platform_admin = false"
	else
		fail "admin-grant revoke ($(tail -n 3 "$TMP/ag-revoke.log" | tr '\n' '|'))"
	fi
	REVOKED="$(grep -c "Revoked" "$TMP/ag-revoke.log" || true)"
	if [ "$REVOKED" = 1 ]; then pass "admin-grant prints exactly one 'Revoked' line"; else fail "admin-grant printed $REVOKED 'Revoked' lines (expected 1)"; fi
	if run_node "$TMP/ag-unknown.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" -- dist/admin-grant.js grant "nobody-$EMAIL"; then
		fail "admin-grant for an unknown email must exit non-zero"
	else
		pass "admin-grant unknown email exits non-zero"
	fi
else
	fail "admin-grant artifact missing: dist/admin-grant.js (skipping admin-grant runs)"
fi

# ---------------------------------------------------------------- symlinked entry points
LINK="$TMP/linked-out"
ln -s "$OUT" "$LINK"
if [ -f "$OUT/dist/admin-grant.js" ]; then
	if RUN_CWD="$TMP" run_node "$TMP/ag-link.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" -- "$LINK/dist/admin-grant.js" grant "$EMAIL" && [ "$(admin_flag)" = "t" ]; then
		pass "admin-grant acts when started through a symlinked directory"
	else
		fail "admin-grant via symlink ($(tail -n 3 "$TMP/ag-link.log" | tr '\n' '|'))"
	fi
else
	fail "admin-grant symlink check skipped (artifact missing)"
fi
if [ -f "$OUT/dist/migrate.js" ]; then
	psql "$SCRATCH_URL" -qAt -c "DROP TABLE IF EXISTS public.schema_meta" >/dev/null 2>&1 || true
	if RUN_CWD="$TMP" run_node "$TMP/migrate-link.log" NODE_ENV=production "OSCORPEX_MIGRATION_DATABASE_URL=$SCRATCH_URL" "DATABASE_URL=$SCRATCH_URL" -- "$LINK/dist/migrate.js" \
		&& [ -n "$(psql "$SCRATCH_URL" -qAt -c "SELECT value FROM public.schema_meta WHERE key = 'init_sql_sha256'" 2>/dev/null || true)" ]; then
		pass "migrate acts (exit 0, schema applied) when started through a symlink from another cwd"
	else
		fail "migrate via symlink ($(tail -n 3 "$TMP/migrate-link.log" | tr '\n' '|'))"
	fi
else
	fail "migrate symlink check skipped (artifact missing)"
fi

# ---------------------------------------------------------------- production boot (verify mode)
# Production boot requires a JWT secret at module load (before the DB phase); a throwaway value is enough.
JWT_SECRET="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
free_port() { node -e 'const s = require("net").createServer().listen(0, () => { console.log(s.address().port); s.close(); })'; }
# boot_run <logfile> <env assignments...>  — runs `node dist/index.js` (cwd = out) with a 60s alarm; echoes the exit code
boot_run() {
	local log="$1"
	shift
	local rc=0
	(cd "$OUT" && env -u OSCORPEX_MIGRATION_DATABASE_URL -u DATABASE_URL NODE_ENV=production "PORT=$(free_port)" "OSCORPEX_JWT_SECRET=$JWT_SECRET" OSCORPEX_AUTH_ENABLED=true "$@" \
		perl -e 'alarm 60; exec @ARGV' node dist/index.js) >"$log" 2>&1 || rc=$?
	echo "$rc"
}
if [ -f "$OUT/dist/index.js" ]; then
	if psql "$DB_URL" -qAt -c "CREATE DATABASE ${BOOT_NAME}" >/dev/null 2>&1; then
		BOOT_CREATED=1
		BOOT_URL="$(with_db "$DB_URL" "$BOOT_NAME")"
		RC="$(boot_run "$TMP/boot-unmigrated.log" "DATABASE_URL=$BOOT_URL")"
		if [ "$RC" = 0 ] || [ "$RC" = 142 ]; then
			fail "boot against an unmigrated database must exit non-zero within the timeout (rc=$RC)"
		elif grep -q "migrate" "$TMP/boot-unmigrated.log" && ! grep -q "ERR_MODULE_NOT_FOUND" "$TMP/boot-unmigrated.log"; then
			pass "production boot refuses an unmigrated database and tells the operator to run migrate"
		else
			fail "boot output lacks 'migrate' or shows ERR_MODULE_NOT_FOUND ($(tail -n 4 "$TMP/boot-unmigrated.log" | cut -c1-200 | tr '\n' '|'))"
		fi
	else
		fail "boot scratch database creation"
	fi

	RC="$(boot_run "$TMP/boot-badurl.log" "DATABASE_URL=postgresql://u:SEKRET123@localhost:notaport/db")"
	if [ "$RC" = 0 ] || [ "$RC" = 142 ]; then
		fail "boot with an invalid DATABASE_URL must exit non-zero within the timeout (rc=$RC)"
	else
		pass "boot with an invalid DATABASE_URL exits non-zero"
	fi
	if grep -q "SEKRET123" "$TMP/boot-badurl.log"; then
		fail "boot output leaks the database password"
	else
		pass "boot output does not contain the database password"
	fi
	# a stack trace is allowed; util.inspect's enumerable-property dump is not
	if grep -qE "^[[:space:]]*input:|code: '|^[[:space:]]*\{[[:space:]]*$" "$TMP/boot-badurl.log"; then
		fail "boot failure printed an enumerable-property dump of the error"
	else
		pass "boot failure prints no enumerable-property dump (no input:/code: lines)"
	fi

	# module-load failure (JWT secret missing in production) must be caught by index.ts, not escape as an uncaught error
	RC=0
	(cd "$OUT" && env -u OSCORPEX_MIGRATION_DATABASE_URL -u DATABASE_URL -u OSCORPEX_JWT_SECRET NODE_ENV=production "PORT=$(free_port)" \
		perl -e 'alarm 60; exec @ARGV' node dist/index.js) >"$TMP/boot-nojwt.log" 2>&1 || RC=$?
	if [ "$RC" = 0 ] || [ "$RC" = 142 ]; then
		fail "boot without OSCORPEX_JWT_SECRET must exit non-zero within the timeout (rc=$RC)"
	elif ! grep -qi "jwt" "$TMP/boot-nojwt.log"; then
		fail "boot without OSCORPEX_JWT_SECRET does not mention the JWT secret"
	elif grep -qE '^Node\.js v' "$TMP/boot-nojwt.log"; then
		fail "boot without OSCORPEX_JWT_SECRET escaped as an uncaught error (Node.js trailer present)"
	else
		pass "module-load failure (no JWT secret) is caught by index.ts and reported"
	fi
else
	fail "boot checks skipped (dist/index.js missing)"
fi

# ---------------------------------------------------------------- summary
if [ "$FAILS" -gt 0 ]; then
	echo "FAIL: $FAILS check(s) failed"
	exit 1
fi
echo "PASS: all checks passed"
