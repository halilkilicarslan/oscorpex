#!/usr/bin/env bash
# Smoke test for the production compose stack (phase D5): static compose checks, then a real
# postgres -> migrate -> backend -> console stack under a unique compose project (persistence across down/up,
# admin-grant, hardening, published ports, network isolation, WebSocket through nginx).
#
# Usage: scripts/docker/smoke-compose.sh
#
# Section labels [S1]..[S9] follow the numbered scenarios of plan D5 (docs/plans/2026-10-31-production-docker-image.md):
# S1 fresh up/migrate/health, S2 backend env, S3 required variables, S4 ports + isolation, S5 persistence,
# S6 admin-grant, S7 hardening, S8 WebSocket + events, S9 regression/renders.
#
# Needs a local docker daemon (refuses remote endpoints / non-"docker" buildx drivers). Compose NEVER sees the
# repo's real .env: every invocation passes --env-file <generated temp file> (which replaces the default .env
# lookup) and strips the interpolated variables from the calling environment. A static gate refuses to run any
# compose command if the compose files still use `env_file:` (that would read the real .env regardless).
# Everything it creates has a unique name and is removed on exit (down -v --remove-orphans + built images).
set -euo pipefail

if [ "$#" -ne 0 ]; then
	echo "usage: $0" >&2
	exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oscorpex-smoke-compose.XXXXXX")"
PROJ="oscx-smoke-$$-$RANDOM"
COMPOSE_FILE_MAIN="$REPO_ROOT/docker-compose.yml"
COMPOSE_FILE_DEV="$REPO_ROOT/docker-compose.dev.yml"
PINNED_DIGEST="sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da"
PG_IMAGE="pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f"
MIN_FREE_KB=$((15 * 1024 * 1024)) # docker data root must have this much free space
ENVF="$WORK/stack.env"
STACK_TOUCHED=0

# Variables compose interpolates or forwards: a value in the caller's environment would beat --env-file.
STRIP_VARS="POSTGRES_PASSWORD OSCORPEX_JWT_SECRET OSCORPEX_CONSOLE_PORT ANTHROPIC_API_KEY ANTHROPIC_BASE_URL COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES OSCORPEX_DEV_PG_PORT OSCORPEX_BACKEND_CPUS"

# dcf <envfile> <compose args...>: compose against the main file with an explicit env file, clean environment
dcf() {
	local envfile="$1" a
	shift
	local unset_args=()
	for a in $STRIP_VARS; do unset_args+=(-u "$a"); done
	env "${unset_args[@]}" docker compose -p "$PROJ" --env-file "$envfile" -f "$COMPOSE_FILE_MAIN" "$@"
}
dc() { dcf "$ENVF" "$@"; }

cleanup() {
	local rc=$?
	if [ "$STACK_TOUCHED" = 1 ] && [ -f "$ENVF" ]; then
		dc --profile sonar down -v --remove-orphans >/dev/null 2>&1 || true
		local img
		for img in $(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep "^${PROJ}[-_]" || true); do
			docker rmi -f "$img" >/dev/null 2>&1 || true
		done
	fi
	rm -rf "$WORK"
	exit $rc
}
trap cleanup EXIT

FAILS=0
pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1"
	FAILS=$((FAILS + 1))
}
finish() {
	echo "---"
	if [ "$FAILS" -eq 0 ]; then
		echo "RESULT: all checks passed"
		exit 0
	fi
	echo "RESULT: $FAILS check(s) failed"
	exit 1
}
indent() { sed 's/^/        /'; }

# ---------------------------------------------------------------- static gate (no compose, no docker)
echo "--- static gate (raw compose files) ---"
GATE_ABORT=0
if [ ! -f "$COMPOSE_FILE_MAIN" ]; then
	fail "docker-compose.yml is missing"
	finish
fi
# env_file would make compose read the repo's real .env no matter what --env-file says: never run compose then
if grep -Eq '^[[:space:]]*env_file[[:space:]]*:' "$COMPOSE_FILE_MAIN" "$COMPOSE_FILE_DEV" 2>/dev/null; then
	fail "docker-compose*.yml still uses 'env_file:' (would load the real .env); backend env must be an explicit list"
	GATE_ABORT=1
else
	pass "no env_file in the compose files"
fi
if grep -Eq '^[[:space:]]*container_name[[:space:]]*:' "$COMPOSE_FILE_MAIN"; then
	fail "docker-compose.yml still sets fixed container_name values"
else
	pass "no fixed container_name"
fi
if grep -Fq 'docker-entrypoint-initdb.d' "$COMPOSE_FILE_MAIN"; then
	fail "docker-compose.yml still mounts init.sql into /docker-entrypoint-initdb.d"
else
	pass "no initdb mount"
fi
if grep -Eq '^[[:space:]]*-[[:space:]]*"?(3141|3142|5432|127\.0\.0\.1:5432):' "$COMPOSE_FILE_MAIN"; then
	fail "docker-compose.yml still publishes 3141/3142/5432"
else
	pass "kernel/postgres ports are not published"
fi
if grep -Fq 'service_completed_successfully' "$COMPOSE_FILE_MAIN" && grep -Eq '^[[:space:]]*migrate[[:space:]]*:' "$COMPOSE_FILE_MAIN"; then
	pass "a migrate service gated with service_completed_successfully exists"
else
	fail "no migrate service / service_completed_successfully gate in docker-compose.yml"
fi
# README: the dev instructions must not start postgres from the production compose file (no published port there)
if [ -f "$REPO_ROOT/README.md" ] && grep -E 'docker[ -]compose.*[[:space:]]up[[:space:]].*postgres' "$REPO_ROOT/README.md" | grep -Fv 'docker-compose.dev.yml' | grep -q .; then
	fail "README.md still says 'docker compose up ... postgres' without -f docker-compose.dev.yml"
else
	pass "README.md has no dev postgres instruction that bypasses docker-compose.dev.yml"
fi
if [ -f "$COMPOSE_FILE_DEV" ] && grep -Ev '^[[:space:]]*#' "$COMPOSE_FILE_DEV" | grep -Eq 'docker\.sock|group_add'; then
	fail "docker-compose.dev.yml mentions docker.sock or group_add (dev override must be the dev postgres only)"
else
	pass "docker-compose.dev.yml has no docker.sock / group_add"
fi
if [ -f "$REPO_ROOT/README.md" ] && grep -Fq oscorpex_dev "$REPO_ROOT/README.md" \
	&& grep -F 'docker-compose.dev.yml' "$REPO_ROOT/README.md" | grep -Fq postgres \
	&& ! grep -F 'POSTGRES_PASSWORD' "$REPO_ROOT/README.md" | grep -Fq '$(openssl'; then
	pass "README dev section uses the fixed oscorpex_dev password with the dev-override command (no random password)"
else
	fail "README dev section must use POSTGRES_PASSWORD=oscorpex_dev with 'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres' and no \$(openssl ...)"
fi
if [ "$GATE_ABORT" = 1 ]; then
	echo "ABORT: refusing to run compose while the files read the real .env"
	finish
fi

# ---------------------------------------------------------------- preflight
echo "--- preflight ---"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
	fail "docker is not available"
	finish
fi
if ! "$REPO_ROOT/scripts/docker/check-context.sh" --real >"$WORK/context-real.log" 2>&1; then
	grep -m 12 -E '^(FAIL|RESULT)' "$WORK/context-real.log" | indent || true
	fail "check-context.sh --real failed: refusing to build (real files could reach the builder)"
	finish
fi
pass "check-context.sh --real passed"
driver="$(docker buildx inspect 2>/dev/null | awk '/^Driver:/ && !d { print $2; d = 1 }')"
if [ "$driver" != docker ]; then
	fail "current buildx builder driver is '${driver:-unknown}', expected 'docker' (local daemon); refusing to send the context"
	finish
fi
pass "buildx builder driver is docker (local daemon)"
endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
for ep in "$endpoint" "${DOCKER_HOST:-unix://}"; do
	case "$ep" in
	unix://* | npipe://*) ;;
	*)
		fail "docker endpoint '${ep:-unknown}' is not local (unix:// or npipe://); refusing to send the context"
		finish
		;;
	esac
done
pass "docker endpoint is local (${DOCKER_HOST:-$endpoint})"
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
df_out="$(docker run --rm --entrypoint df "node:22-bookworm-slim@$PINNED_DIGEST" -Pk / 2>/dev/null || true)"
free_kb="$(awk 'END { print $4 }' <<<"$df_out")"
case "$free_kb" in
'' | *[!0-9]*)
	echo "WARN: could not measure free space of the docker data root (${docker_root:-unknown}); disk guard skipped"
	;;
*)
	if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
		if [ -n "${CI:-}" ]; then
			fail "docker data root (${docker_root:-unknown}) has $((free_kb / 1024 / 1024)) GB free, need at least $((MIN_FREE_KB / 1024 / 1024)) GB (CI must not skip)"
			finish
		fi
		echo "SKIP: docker data root (${docker_root:-unknown}) has $((free_kb / 1024 / 1024)) GB free, need at least $((MIN_FREE_KB / 1024 / 1024)) GB"
		exit 0
	fi
	pass "docker data root has $((free_kb / 1024 / 1024)) GB free"
	;;
esac
for tool in node curl openssl; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		fail "host $tool is required"
		finish
	fi
done

# ---------------------------------------------------------------- env file + --env-file semantics
echo "--- env file ---"
PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
PGPW="$(openssl rand -hex 16)"
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$PGPW"
JWT_SECRET="$(openssl rand -hex 32)"
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$JWT_SECRET"
ORIGIN="http://localhost:$PORT"
BASE="http://127.0.0.1:$PORT"
printf 'POSTGRES_PASSWORD=%s\nOSCORPEX_JWT_SECRET=%s\nOSCORPEX_CONSOLE_PORT=%s\nANTHROPIC_API_KEY=\n' "$PGPW" "$JWT_SECRET" "$PORT" >"$ENVF"
printf 'POSTGRES_PASSWORD=%s\nOSCORPEX_CONSOLE_PORT=%s\n' "$PGPW" "$PORT" >"$WORK/nojwt.env"
printf 'OSCORPEX_JWT_SECRET=%s\nOSCORPEX_CONSOLE_PORT=%s\n' "$JWT_SECRET" "$PORT" >"$WORK/nopg.env"

# Prove, with a canary in a throwaway project dir, that --env-file replaces the project's default .env on this
# docker compose version. If it did not, the repo's real .env would feed interpolation: abort.
mkdir -p "$WORK/envprobe"
printf 'CANARY=from-dotenv\n' >"$WORK/envprobe/.env"
: >"$WORK/envprobe/empty.env"
printf 'services:\n  probe:\n    image: scratch\n    environment:\n      V: ${CANARY:-unset}\n' >"$WORK/envprobe/compose.yml"
if env -u CANARY docker compose --env-file "$WORK/envprobe/empty.env" -f "$WORK/envprobe/compose.yml" config 2>/dev/null | grep -Fq 'V: unset'; then
	pass "docker compose --env-file replaces the default .env lookup (real .env cannot leak into interpolation)"
else
	fail "this docker compose still reads the project .env alongside --env-file: refusing to continue"
	finish
fi

# ---------------------------------------------------------------- 1. missing required variables
echo "--- [S3] required variables ---"
if dcf "$WORK/nojwt.env" config -q >"$WORK/cfg-nojwt.log" 2>&1; then
	fail "compose config succeeded without OSCORPEX_JWT_SECRET"
elif grep -Fq OSCORPEX_JWT_SECRET "$WORK/cfg-nojwt.log"; then
	pass "compose config fails without OSCORPEX_JWT_SECRET and names the variable"
else
	fail "compose config failed without OSCORPEX_JWT_SECRET but the error does not name it ($(head -c 200 "$WORK/cfg-nojwt.log"))"
fi
if dcf "$WORK/nopg.env" config -q >"$WORK/cfg-nopg.log" 2>&1; then
	fail "compose config succeeded without POSTGRES_PASSWORD"
elif grep -Fq POSTGRES_PASSWORD "$WORK/cfg-nopg.log"; then
	pass "compose config fails without POSTGRES_PASSWORD and names the variable"
else
	fail "compose config failed without POSTGRES_PASSWORD but the error does not name it ($(head -c 200 "$WORK/cfg-nopg.log"))"
fi

# ---------------------------------------------------------------- 9. regression: renders (dev override, profiles)
echo "--- [S9] config renders ---"
if dc config -q >"$WORK/cfg.log" 2>&1; then pass "docker-compose.yml renders with the generated env file"; else
	fail "docker-compose.yml does not render ($(head -c 300 "$WORK/cfg.log"))"
	finish
fi
if dc -f "$COMPOSE_FILE_DEV" config -q >"$WORK/cfg-dev.log" 2>&1; then pass "docker-compose.yml + docker-compose.dev.yml renders"; else fail "dev override does not render ($(head -c 300 "$WORK/cfg-dev.log"))"; fi
if dc --profile sonar config -q >"$WORK/cfg-prof.log" 2>&1; then pass "sonar profile renders"; else fail "sonar profile does not render ($(head -c 300 "$WORK/cfg-prof.log"))"; fi
if dc -f "$COMPOSE_FILE_DEV" config postgres -q >"$WORK/cfg-devpg.log" 2>&1; then pass "'config postgres' renders with the dev override"; else fail "'config postgres' with the dev override does not render ($(head -c 300 "$WORK/cfg-devpg.log"))"; fi
if dcf "$WORK/nojwt.env" -f "$COMPOSE_FILE_DEV" config postgres -q >/dev/null 2>&1; then
	echo "NOTE: with the dev override, 'config postgres' does NOT require OSCORPEX_JWT_SECRET"
else
	echo "NOTE: with the dev override, 'config postgres' still requires OSCORPEX_JWT_SECRET (every service is interpolated)"
fi

# ---------------------------------------------------------------- static checks on the rendered config
echo "--- [S2/S4/S7/S9] rendered config ---"
# The checker lives in a temp file: bash 3.2 cannot parse a heredoc inside a process substitution.
cat >"$WORK/cfg-check.js" <<'NODE'
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const port = process.argv[3];
const proj = process.argv[4];
const mode = process.argv[5] || "base";
const svc = cfg.services || {};
const nets = cfg.networks || {};
const out = (ok, msg) => console.log((ok ? "PASS" : "FAIL") + "\t" + msg);
const names = (s) => Object.keys((svc[s] && svc[s].networks) || {}).sort().join(",");
const envOf = (s) => {
	const e = (svc[s] && svc[s].environment) || {};
	return Array.isArray(e) ? Object.fromEntries(e.map((x) => x.split(/=(.*)/s).slice(0, 2))) : e;
};
const vols = (s) => ((svc[s] && svc[s].volumes) || []).map((v) => (typeof v === "string" ? v : `${v.source || ""}:${v.target}`));
const have = (s) => !!svc[s];
const expect = process.argv[6] || "";
if (mode === "cpus") {
	const c = svc.backend && svc.backend.cpus;
	if (expect === "none") out(c === undefined || c === null || Number(c) === 0, "backend has no cpus limit by default");
	else out(c !== undefined && Number(c) === Number(expect), "backend cpus is " + expect + " when OSCORPEX_BACKEND_CPUS=" + expect + " (got " + c + ")");
	process.exit(0);
}
if (mode === "dev") {
	const pg = svc.postgres || {};
	const pub = (pg.ports || []).find((p) => Number(p.target) === 5432);
	out(!!pub && pub.host_ip === "127.0.0.1" && String(pub.published) === (expect || "5432"), "dev override: postgres publishes 127.0.0.1:" + (expect || "5432"));
	const pn = Object.keys(pg.networks || {});
	out(pn.some((n) => nets[n] && nets[n].internal !== true), "dev override: postgres is attached to a non-internal network (" + pn.join(",") + ")");
	process.exit(0);
}
out(["postgres", "migrate", "backend", "console"].every(have), "services postgres, migrate, backend, console are defined");
out(!Object.values(svc).some((s) => s.container_name), "no service sets container_name");
out(!Object.values(svc).some((s) => s.env_file), "no service uses env_file");
out(svc.postgres && svc.postgres.image === "pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f", "postgres image is the digest-pinned pgvector");
out(svc.postgres && !svc.postgres.ports && !vols("postgres").some((v) => /init\.sql|initdb/.test(v)), "postgres publishes no ports and has no init.sql mount");
out(svc.postgres && !!svc.postgres.healthcheck, "postgres has a healthcheck");
const published = Object.entries(svc).flatMap(([n, s]) => (s.ports || []).map((p) => ({ n, p })));
const core = published.filter((x) => ["postgres", "migrate", "backend", "console"].includes(x.n));
out(core.length === 1 && core[0].n === "console" && core[0].p.host_ip === "127.0.0.1" && String(core[0].p.published) === port && Number(core[0].p.target) === 8080, "only console publishes a port: 127.0.0.1:" + port + " -> 8080");
const agents = Object.keys(svc).filter((n) => /^agent-/.test(n));
out(agents.length === 0, "the legacy agent pool is gone: no agent-* services (" + agents.join(",") + ")");
const extra = published.filter((x) => !["postgres", "migrate", "backend", "console"].includes(x.n) && x.p.host_ip !== "127.0.0.1");
out(extra.length === 0, "other profile services (sonarqube) bind published ports to 127.0.0.1 only" + (extra.length ? " (offenders: " + extra.map((x) => x.n).join(",") + ")" : ""));
const kimg = (n) => (svc[n] && svc[n].image) || "";
out(!!kimg("backend") && kimg("backend") === kimg("migrate") && kimg("backend").indexOf(proj) === 0 && /kernel/.test(kimg("backend")), "migrate and backend share one kernel image (" + kimg("backend") + ")");
const volSrc = (n) => ((svc[n] && svc[n].volumes) || []).map((v) => (typeof v === "string" ? v.split(":")[0] : v.source || ""));
out(!(cfg.volumes && cfg.volumes["agent-workspace"]) && !Object.keys(svc).some((n) => volSrc(n).includes("agent-workspace")), "no agent-workspace volume is defined or mounted");
const lim = (s, k, dk) => (s[k] !== undefined && s[k] !== null && s[k] !== "" && s[k] !== 0) || (s.deploy && s.deploy.resources && s.deploy.resources.limits && s.deploy.resources.limits[dk] !== undefined);
const noLimit = ["postgres", "migrate", "backend", "console"].filter((n) => !(svc[n] && lim(svc[n], "mem_limit", "memory") && lim(svc[n], "pids_limit", "pids")));
out(noLimit.length === 0, "postgres, migrate, backend and console set mem_limit and pids_limit" + (noLimit.length ? " (missing: " + noLimit.join(",") + ")" : ""));
out(["migrate", "backend", "console"].every((n) => svc[n] && svc[n].pull_policy === "build"), "migrate, backend and console have pull_policy: build");
const badLog = Object.keys(svc).filter((n) => {
	const l = svc[n].logging || {};
	return !(l.driver === "local" || (l.driver === "json-file" && l.options && l.options["max-size"] && l.options["max-file"]));
});
out(badLog.length === 0, "every service has a bounded log driver (local, or json-file with max-size/max-file)" + (badLog.length ? " (missing: " + badLog.join(",") + ")" : ""));
const pg = svc.postgres || {};
out((pg.security_opt || []).includes("no-new-privileges:true") && (pg.cap_drop || []).includes("ALL") && JSON.stringify([...(pg.cap_add || [])].sort()) === JSON.stringify(["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"]), "postgres: no-new-privileges, cap_drop ALL, cap_add exactly CHOWN/DAC_OVERRIDE/FOWNER/SETUID/SETGID");
out(/@sha256:[0-9a-f]{64}$/.test((svc.sonarqube && svc.sonarqube.image) || ""), "sonarqube image is digest-pinned");
const toBytes = (v) => {
	if (typeof v === "number") return v;
	const m = /^(\d+)\s*([kmg]?)b?$/i.exec(String(v));
	return m ? Number(m[1]) * { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()] : 0;
};
const tmpfsSizes = {};
const tf = (svc.backend && svc.backend.tmpfs) || [];
for (const t of Array.isArray(tf) ? tf : [tf]) {
	const [target, opts = ""] = String(t).split(/:(.*)/s);
	const m = /size=([^,]+)/.exec(opts);
	if (m) tmpfsSizes[target] = toBytes(m[1]);
}
for (const v of (svc.backend && svc.backend.volumes) || []) if (typeof v === "object" && v.type === "tmpfs" && v.tmpfs && v.tmpfs.size) tmpfsSizes[v.target] = toBytes(v.tmpfs.size);
out((tmpfsSizes["/tmp"] || 0) >= 1024 ** 3 && (tmpfsSizes["/home/oscorpex"] || 0) >= 512 * 1024 ** 2, "backend tmpfs sizes: /tmp >= 1g and /home/oscorpex >= 512m (" + JSON.stringify(tmpfsSizes) + ")");
out(svc.migrate && JSON.stringify(svc.migrate.command) === JSON.stringify(["node", "dist/migrate.js"]) && svc.migrate.restart === "no", "migrate runs 'node dist/migrate.js' with restart: no");
const me = envOf("migrate");
out(!!me.OSCORPEX_MIGRATION_DATABASE_URL && !!me.DATABASE_URL, "migrate has OSCORPEX_MIGRATION_DATABASE_URL and DATABASE_URL");
const dep = (svc.backend && svc.backend.depends_on) || {};
out(dep.migrate && dep.migrate.condition === "service_completed_successfully", "backend depends_on migrate: service_completed_successfully");
const cdep = (svc.console && svc.console.depends_on) || {};
out(cdep.backend && cdep.backend.condition === "service_healthy", "console depends_on backend: service_healthy");
const be = envOf("backend");
out(!("POSTGRES_PASSWORD" in be) && !("OSCORPEX_MIGRATION_DATABASE_URL" in be), "backend environment has no POSTGRES_PASSWORD / OSCORPEX_MIGRATION_DATABASE_URL");
out(be.OSCORPEX_AUTH_ENABLED === "true" && be.OSCORPEX_TRUSTED_PROXY === "true" && !!be.OSCORPEX_JWT_SECRET && !!be.DATABASE_URL, "backend environment: AUTH_ENABLED, TRUSTED_PROXY, JWT_SECRET, DATABASE_URL");
out(be.OSCORPEX_CORS_ORIGINS === `http://localhost:${port},http://127.0.0.1:${port}`, "backend OSCORPEX_CORS_ORIGINS lists localhost and 127.0.0.1 on the console port");
for (const s of ["migrate", "backend", "console"]) {
	const x = svc[s] || {};
	out(x.read_only === true && (x.cap_drop || []).includes("ALL") && (x.security_opt || []).includes("no-new-privileges:true"), `${s}: read_only, cap_drop ALL, no-new-privileges:true`);
}
const bv = vols("backend").join(" ");
out(/oscorpex-data:\/app\/\.oscorpex/.test(bv) && /studio-data:\/app\/\.voltagent/.test(bv) && /claude-home:\/home\/oscorpex\/\.claude/.test(bv), "backend volumes: oscorpex-data, studio-data, claude-home at the planned paths");
const tm = JSON.stringify((svc.backend && svc.backend.tmpfs) || []) + JSON.stringify((svc.backend && svc.backend.volumes) || []);
out(/\/tmp/.test(tm) && /\/home\/oscorpex/.test(tm) && /uid=1001/.test(tm), "backend has tmpfs /tmp and /home/oscorpex (uid=1001)");
out(names("postgres") === "db" && names("migrate") === "db", "postgres and migrate are on the db network only");
out(names("backend") === "db,frontend,studio-agents", "backend is on db, frontend and studio-agents");
out(names("console") === "frontend", "console is on the frontend network only");
out(nets.db && nets.db.internal === true, "db network is internal");
out(nets["studio-agents"] && nets["studio-agents"].internal === true, "studio-agents network is internal");
out(nets.frontend && nets.frontend.internal !== true, "frontend network allows egress (not internal)");
NODE
if dc --profile sonar config --format json >"$WORK/config.json" 2>"$WORK/config-json.err"; then
	while IFS=$'\t' read -r verdict msg; do
		case "$verdict" in
		PASS) pass "$msg" ;;
		FAIL) fail "$msg" ;;
		esac
	done < <(node "$WORK/cfg-check.js" "$WORK/config.json" "$PORT" "$PROJ" base 2>&1 || echo "FAIL	rendered-config check script crashed")
else
	fail "docker compose config --format json failed ($(head -c 200 "$WORK/config-json.err"))"
fi
# check_render <label> <envfile> <mode> <expect> <extra compose args...>: render JSON and run the matching checker mode
check_render() {
	local label="$1" envfile="$2" mode="$3" expect="$4" verdict msg
	shift 4
	if dcf "$envfile" "$@" config --format json >"$WORK/render.json" 2>"$WORK/render.err"; then
		while IFS=$'\t' read -r verdict msg; do
			case "$verdict" in
			PASS) pass "$msg" ;;
			FAIL) fail "$msg" ;;
			esac
		done < <(node "$WORK/cfg-check.js" "$WORK/render.json" "$PORT" "$PROJ" "$mode" "$expect" 2>&1 || echo "FAIL	$label check script crashed")
	else
		fail "$label does not render ($(head -c 200 "$WORK/render.err"))"
	fi
}
{ cat "$ENVF"; echo OSCORPEX_DEV_PG_PORT=55432; } >"$WORK/devport.env"
{ cat "$ENVF"; echo OSCORPEX_BACKEND_CPUS=2; } >"$WORK/cpus.env"
check_render "base + dev override" "$ENVF" dev 5432 -f "$COMPOSE_FILE_DEV"
check_render "base + dev override with OSCORPEX_DEV_PG_PORT=55432" "$WORK/devport.env" dev 55432 -f "$COMPOSE_FILE_DEV"
check_render "base (default cpus)" "$ENVF" cpus none
check_render "base with OSCORPEX_BACKEND_CPUS=2" "$WORK/cpus.env" cpus 2

# ---------------------------------------------------------------- 2. fresh up
echo "--- [S1] fresh stack ---"
STACK_TOUCHED=1
BUILD_DEADLINE=1800
UP_DEADLINE=300
# run_bounded <seconds> <logfile> <cmd...>: run in the background; on timeout kill it and return 124
run_bounded() {
	local limit="$1" log="$2" pid i=0
	shift 2
	set -m # job control: the background command leads its own process group (pgid = pid), no setsid needed
	"$@" >"$log" 2>&1 &
	pid=$!
	set +m
	while kill -0 "$pid" 2>/dev/null; do
		if [ "$i" -ge "$limit" ]; then
			kill -TERM -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
			sleep 2
			kill -KILL -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
			wait "$pid" 2>/dev/null || true
			echo "TIMEOUT after ${limit}s" >>"$log"
			return 124
		fi
		sleep 1
		i=$((i + 1))
	done
	wait "$pid"
}
# pick_port: a free loopback port; rewrites the env file and the derived URLs
pick_port() {
	PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
	ORIGIN="http://localhost:$PORT"
	BASE="http://127.0.0.1:$PORT"
	printf 'POSTGRES_PASSWORD=%s\nOSCORPEX_JWT_SECRET=%s\nOSCORPEX_CONSOLE_PORT=%s\nANTHROPIC_API_KEY=\n' "$PGPW" "$JWT_SECRET" "$PORT" >"$ENVF"
}
# up_bounded <logfile>: up -d under a deadline; retries with a new console port if the port was taken meanwhile
up_bounded() {
	local log="$1" attempt rc=1
	for attempt in 1 2 3; do
		run_bounded "$UP_DEADLINE" "$log" dc up -d && return 0
		rc=$?
		if grep -Eqi 'port is already allocated|address already in use|ports are not available' "$log"; then
			echo "NOTE: console port $PORT was taken at up time; retrying with a new port (attempt $attempt)"
			dc down --remove-orphans >/dev/null 2>&1 || true
			pick_port
			continue
		fi
		break
	done
	if [ "$rc" = 124 ]; then echo "up -d exceeded ${UP_DEADLINE}s" >>"$log"; dc logs --tail 20 >>"$log" 2>&1 || true; fi
	return "$rc"
}
t0=$SECONDS
if run_bounded "$BUILD_DEADLINE" "$WORK/build.log" dc build; then
	pass "docker compose build succeeded in $((SECONDS - t0))s"
else
	fail "docker compose build failed or exceeded ${BUILD_DEADLINE}s (last lines below)"
	tail -n 8 "$WORK/build.log" | indent
	finish
fi
if up_bounded "$WORK/up.log"; then pass "docker compose up -d returned within ${UP_DEADLINE}s (migrate completed, backend started)"; else
	fail "docker compose up -d failed or exceeded ${UP_DEADLINE}s"
	tail -n 20 "$WORK/up.log" | indent
	finish
fi
cid() { dc ps -aq "$1" 2>/dev/null | awk 'NR == 1'; }
wait_healthy() { # wait_healthy <service> <tries>: poll the container health every 2s
	local svc="$1" tries="$2" id h=""
	for _ in $(seq 1 "$tries"); do
		id="$(cid "$svc")"
		[ -n "$id" ] && h="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
		[ "$h" = healthy ] && return 0
		[ -n "$id" ] && [ "$(docker inspect --format '{{.State.Running}}' "$id" 2>/dev/null || echo false)" != true ] && return 1
		sleep 2
	done
	return 1
}
mid="$(cid migrate)"
mstate="$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "${mid:-none}" 2>/dev/null || echo missing)"
if [ "$mstate" = exited:0 ]; then pass "migrate exited with code 0"; else
	fail "migrate state is '$mstate' (expected exited:0)"
	[ -z "$mid" ] || docker logs --tail 15 "$mid" 2>&1 | { grep -viE 'secret|password|database_url|token|api_key' || true; } | indent
fi
psql_in() { dc exec -T postgres sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}" -qAt -v ON_ERROR_STOP=1'; }
echo "select value from public.schema_meta where key = 'init_sql_sha256'" | psql_in >"$WORK/hash.out" 2>"$WORK/hash.err" || true
if grep -Eq '^[0-9a-f]{64}$' "$WORK/hash.out"; then pass "schema_meta holds init_sql_sha256 (schema applied by migrate)"; else fail "schema_meta has no init_sql_sha256 ($(head -c 200 "$WORK/hash.err"))"; fi
if dc exec -T postgres sh -c 'test ! -e /docker-entrypoint-initdb.d/init.sql'; then pass "postgres has no /docker-entrypoint-initdb.d/init.sql"; else fail "postgres container has /docker-entrypoint-initdb.d/init.sql"; fi
if wait_healthy backend 90; then pass "backend becomes healthy"; else
	fail "backend is not healthy"
	dc logs --tail 15 backend 2>&1 | { grep -viE 'secret|password|database_url|token|api_key' || true; } | indent
	finish
fi
if wait_healthy console 45; then pass "console becomes healthy"; else
	fail "console is not healthy"
	dc logs --tail 15 console 2>&1 | { grep -viE 'secret|password|database_url|token|api_key' || true; } | indent
	finish
fi

# http <name> <path> [curl args...]: status in $HTTP_CODE, body in $WORK/<name>.b
http() {
	local name="$1" path="$2"
	shift 2
	HTTP_CODE="$(curl -sS --max-time 15 -o "$WORK/$name.b" -w '%{http_code}' "$@" "$BASE$path" 2>"$WORK/$name.err" || true)"
}
http root /
if [ "$HTTP_CODE" = 200 ] && grep -Fq '<div id="root">' "$WORK/root.b"; then pass "console serves / on 127.0.0.1:$PORT (200, <div id=\"root\">)"; else fail "/ returned $HTTP_CODE (root div present: $(grep -Fc '<div id="root">' "$WORK/root.b" || true))"; fi
http health /health
if [ "$HTTP_CODE" = 200 ]; then pass "/health through the console is 200"; else fail "/health through the console returned $HTTP_CODE"; fi

# ---------------------------------------------------------------- 3. backend environment
echo "--- [S2] backend environment ---"
BID="$(cid backend)"
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$BID" >"$WORK/backend-env.txt" 2>/dev/null || : >"$WORK/backend-env.txt"
if grep -Eq '^POSTGRES_PASSWORD=' "$WORK/backend-env.txt"; then fail "backend container env contains POSTGRES_PASSWORD"; else pass "backend container env has no POSTGRES_PASSWORD"; fi
if grep -Eq '^OSCORPEX_MIGRATION_DATABASE_URL=' "$WORK/backend-env.txt"; then fail "backend container env contains OSCORPEX_MIGRATION_DATABASE_URL"; else pass "backend container env has no OSCORPEX_MIGRATION_DATABASE_URL"; fi
if grep -Fxq 'OSCORPEX_TRUSTED_PROXY=true' "$WORK/backend-env.txt"; then pass "backend container env has OSCORPEX_TRUSTED_PROXY=true"; else fail "backend container env lacks OSCORPEX_TRUSTED_PROXY=true"; fi
if grep -Fxq "OSCORPEX_CORS_ORIGINS=http://localhost:$PORT,http://127.0.0.1:$PORT" "$WORK/backend-env.txt"; then pass "backend container env has the CORS origins for localhost and 127.0.0.1"; else fail "backend OSCORPEX_CORS_ORIGINS is '$(grep '^OSCORPEX_CORS_ORIGINS=' "$WORK/backend-env.txt" || true)'"; fi

# ---------------------------------------------------------------- 4. ports and networks
echo "--- [S4] ports and networks ---"
bindings=""
for id in $(dc ps -aq 2>/dev/null); do
	name="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"
	b="$(docker inspect --format '{{range $p,$bs := .NetworkSettings.Ports}}{{range $bs}}{{.HostIp}}:{{.HostPort}}->{{$p}} {{end}}{{end}}' "$id")"
	[ -z "$b" ] || bindings="$bindings$name=$b;"
done
if [ "$bindings" = "console=127.0.0.1:$PORT->8080/tcp ;" ]; then pass "the only host-published port is 127.0.0.1:$PORT -> console 8080"; else fail "published ports: ${bindings:-none} (expected only console=127.0.0.1:$PORT->8080/tcp)"; fi
for n in db studio-agents; do
	internal="$(docker network inspect --format '{{.Internal}}' "${PROJ}_$n" 2>/dev/null || echo missing)"
	if [ "$internal" = true ]; then pass "network $n is internal"; else fail "network $n internal flag is '$internal' (expected true)"; fi
done
internal="$(docker network inspect --format '{{.Internal}}' "${PROJ}_frontend" 2>/dev/null || echo missing)"
if [ "$internal" = false ]; then pass "network frontend is not internal (backend egress for the Claude API)"; else fail "network frontend internal flag is '$internal' (expected false)"; fi
CID="$(cid console)"
cnets="$(docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CID" 2>/dev/null || true)"
if [ "$cnets" = "${PROJ}_frontend " ]; then pass "console container is attached to the frontend network only"; else fail "console networks: '$cnets'"; fi
res="$(dc exec -T console sh -c 'nslookup postgres >/dev/null 2>&1 && echo RESOLVES || echo NORESOLVE' 2>/dev/null || echo EXECFAIL)"
if [ "$res" = NORESOLVE ]; then pass "console container cannot resolve 'postgres'"; else fail "console container postgres lookup says '$res' (expected NORESOLVE)"; fi
PGIP="$(docker inspect --format "{{(index .NetworkSettings.Networks \"${PROJ}_db\").IPAddress}}" "$(cid postgres)" 2>/dev/null || true)"
if [ -z "$PGIP" ]; then fail "could not determine the postgres IP on the db network"; else
	if dc exec -T backend node -e 'const s=require("node:net").connect(5432,process.argv[1]);s.setTimeout(3000);s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1));s.on("timeout",()=>process.exit(1))' "$PGIP" >/dev/null 2>&1; then
		pass "backend reaches postgres $PGIP:5432 over TCP (positive control)"
	else
		fail "backend cannot reach postgres $PGIP:5432 over TCP"
	fi
	nc_rc=0
	dc exec -T console sh -c 'command -v nc >/dev/null 2>&1 || exit 127; nc -z -w2 backend 3141' >/dev/null 2>&1 || nc_rc=$?
	case "$nc_rc" in
	0) pass "console container reaches backend:3141 with nc (positive control)" ;;
	127) fail "nc is missing in the console container: the TCP isolation check cannot run" ;;
	*) fail "nc positive control failed (console -> backend:3141, exit $nc_rc): the negative check below is invalid" ;;
	esac
	if [ "$nc_rc" = 0 ]; then
		nc_rc=0
		dc exec -T console sh -c 'nc -z -w2 "$1" 5432' sh "$PGIP" >/dev/null 2>&1 || nc_rc=$?
		if [ "$nc_rc" = 0 ]; then fail "console container reaches postgres $PGIP:5432 over TCP"; else pass "console container cannot connect to postgres $PGIP:5432 (nc exit $nc_rc)"; fi
	fi
fi
if dc exec -T backend node -e 'require("node:dns").lookup("postgres",(e)=>process.exit(e?1:0))' >/dev/null 2>&1; then pass "backend container resolves 'postgres' (db network)"; else fail "backend container cannot resolve 'postgres'"; fi

# ---------------------------------------------------------------- 7. backend hardening
echo "--- [S7] backend hardening ---"
status="$(dc exec -T backend cat /proc/1/status 2>/dev/null || true)"
capeff="$(awk '/^CapEff:/ { print $2 }' <<<"$status")"
nnp="$(awk '/^NoNewPrivs:/ { print $2 }' <<<"$status")"
if [ "$capeff" = 0000000000000000 ]; then pass "backend /proc/1/status CapEff is 0"; else fail "backend CapEff is '$capeff'"; fi
if [ "$nnp" = 1 ]; then pass "backend /proc/1/status NoNewPrivs is 1"; else fail "backend NoNewPrivs is '$nnp'"; fi
buid="$(dc exec -T backend id -u 2>/dev/null | tr -d '\r' || true)"
if [ "$buid" = 1001 ]; then pass "backend runs as uid 1001"; else fail "backend uid is '$buid' (expected 1001)"; fi
ro="$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$BID" 2>/dev/null || true)"
rootopts="$(dc exec -T backend awk '$2 == "/" { print $4 }' /proc/mounts 2>/dev/null | tr -d '\r' | awk 'NR == 1')"
if [ "$ro" = true ] && grep -Eq '(^|,)ro(,|$)' <<<"$rootopts"; then pass "backend rootfs is read-only (HostConfig.ReadonlyRootfs=true, / mounted '$rootopts')"; else fail "backend rootfs not read-only (ReadonlyRootfs='$ro', / mount options '$rootopts')"; fi
if dc exec -T backend sh -c 'touch /tmp/.smoke-write && touch /home/oscorpex/.claude/.smoke-write && rm -f /tmp/.smoke-write /home/oscorpex/.claude/.smoke-write'; then pass "/tmp and /home/oscorpex/.claude are writable"; else fail "/tmp or /home/oscorpex/.claude is not writable"; fi
if dc exec -T backend sh -c 'touch /app/.oscorpex/.smoke-write && touch /app/.voltagent/.smoke-write && rm -f /app/.oscorpex/.smoke-write /app/.voltagent/.smoke-write'; then pass "/app/.oscorpex and /app/.voltagent volumes are writable"; else fail "/app/.oscorpex or /app/.voltagent is not writable"; fi
cv="$(dc exec -T backend claude --version 2>&1 | tr -d '\r' || true)"
if grep -Eq '[0-9]+\.[0-9]+\.[0-9]+' <<<"$cv"; then pass "claude --version runs in the backend ($(head -n 1 <<<"$cv"))"; else fail "claude --version failed ('$(head -c 120 <<<"$cv")')"; fi

# ---------------------------------------------------------------- seed user + JWT
echo "--- authenticated API ---"
TENANT="smokecp-$RANDOM"
UID_="smokecp-user-$RANDOM"
EMAIL="$UID_@smoke.test"
cat >"$WORK/seed.sql" <<SQL
INSERT INTO tenants (id, name, slug) VALUES ('$TENANT', '$TENANT', '$TENANT') ON CONFLICT DO NOTHING;
INSERT INTO users (id, email, password_hash, tenant_id, is_platform_admin) VALUES ('$UID_', '$EMAIL', 'x', '$TENANT', false) ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, tenant_id, role) VALUES ('$UID_', '$TENANT', 'owner') ON CONFLICT DO NOTHING;
SQL
if psql_in <"$WORK/seed.sql" >"$WORK/seed.log" 2>&1; then pass "seeded tenant, user and user_roles rows"; else fail "seeding the user failed ($(tail -n 2 "$WORK/seed.log" | tr '\n' '|'))"; fi
# HS256 token exactly as apps/kernel/src/studio/auth/jwt.ts signJwt does (secret passed through the environment)
TOKEN="$(JWT_SECRET="$JWT_SECRET" SUB="$UID_" EMAIL="$EMAIL" TENANT="$TENANT" node -e '
const c = require("node:crypto");
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b({ alg: "HS256", typ: "JWT" });
const p = b({ sub: process.env.SUB, email: process.env.EMAIL, tenantId: process.env.TENANT, role: "owner", iat: now, exp: now + 3600, jti: c.randomUUID() });
const s = c.createHmac("sha256", process.env.JWT_SECRET).update(h + "." + p).digest("base64url");
process.stdout.write(h + "." + p + "." + s);
')"
auth() { # auth <name> <path> [curl args...]: authenticated request with the allowed Origin
	local name="$1" path="$2"
	shift 2
	http "$name" "$path" -H "Authorization: Bearer $TOKEN" -H "Origin: $ORIGIN" "$@"
}
auth me /api/studio/auth/me
if [ "$HTTP_CODE" = 200 ]; then pass "authenticated GET /api/studio/auth/me is 200 through the console"; else fail "/api/studio/auth/me returned $HTTP_CODE"; fi

# ---------------------------------------------------------------- 5. persistence across down/up
echo "--- [S5] persistence ---"
auth create /api/studio/projects -X POST -H 'Content-Type: application/json' -d '{"name":"smoke-compose-project","description":"Created by the compose smoke test"}'
PROJECT_ID="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).id||""))}catch{}})' <"$WORK/create.b")"
if { [ "$HTTP_CODE" = 200 ] || [ "$HTTP_CODE" = 201 ]; } && [ -n "$PROJECT_ID" ]; then pass "POST /api/studio/projects created project $PROJECT_ID ($HTTP_CODE)"; else fail "project creation returned $HTTP_CODE ($(head -c 200 "$WORK/create.b"))"; fi
REPO_DIR="/app/.oscorpex/repos/$PROJECT_ID"
if [ -n "$PROJECT_ID" ] && dc exec -T backend test -d "$REPO_DIR/.git"; then pass "repo dir $REPO_DIR (with .git) exists in the oscorpex-data volume"; else fail "repo dir $REPO_DIR is missing in the backend"; fi
if dc down >"$WORK/down.log" 2>&1; then pass "docker compose down (volumes kept)"; else fail "docker compose down failed ($(tail -n 2 "$WORK/down.log" | tr '\n' '|'))"; fi
if up_bounded "$WORK/up2.log" && wait_healthy backend 90 && wait_healthy console 45; then pass "stack comes back healthy after down/up"; else
	fail "stack did not come back healthy after down/up"
	tail -n 12 "$WORK/up2.log" | indent
	finish
fi
auth list /api/studio/projects
if [ "$HTTP_CODE" = 200 ] && [ -n "$PROJECT_ID" ] && grep -Fq "$PROJECT_ID" "$WORK/list.b"; then pass "project $PROJECT_ID is still listed after down/up"; else fail "project not listed after down/up (status $HTTP_CODE)"; fi
if [ -n "$PROJECT_ID" ] && dc exec -T backend test -d "$REPO_DIR/.git"; then pass "repo dir still exists after down/up"; else fail "repo dir is gone after down/up"; fi

# ---------------------------------------------------------------- 6. admin-grant
echo "--- [S6] admin-grant ---"
auth stats_before /api/studio/platform/stats
if [ "$HTTP_CODE" = 403 ]; then pass "GET /api/studio/platform/stats is 403 before the grant"; else fail "platform/stats before the grant returned $HTTP_CODE (expected 403)"; fi
if dc run --rm -T migrate node dist/admin-grant.js grant "$EMAIL" >"$WORK/grant.log" 2>&1; then pass "admin-grant exits 0"; else fail "admin-grant failed ($(tail -n 3 "$WORK/grant.log" | tr '\n' '|'))"; fi
granted="$(grep -c '^Granted' "$WORK/grant.log" || true)"
if [ "$granted" = 1 ]; then pass "admin-grant printed exactly one Granted line"; else fail "admin-grant printed $granted Granted lines"; fi
auth stats_after /api/studio/platform/stats
if [ "$HTTP_CODE" = 200 ]; then pass "GET /api/studio/platform/stats is 200 after the grant"; else fail "platform/stats after the grant returned $HTTP_CODE (expected 200)"; fi

# ---------------------------------------------------------------- 8. WebSocket through nginx
echo "--- [S8] WebSocket ---"
ticket_for() { # ticket_for <origin> -> prints the ticket
	curl -sS --max-time 15 -X POST -H "Authorization: Bearer $TOKEN" -H "Origin: $1" "$BASE/api/studio/ws/ticket" 2>/dev/null \
		| node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).ticket||"")}catch{}})'
}
ws_status() { # ws_status <origin> <ticket> -> prints the first status line of the handshake response
	curl -sS -i --http1.1 --max-time 3 -o "$WORK/ws.out" \
		-H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
		-H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $1" \
		"$BASE/api/studio/ws?ticket=$2" >/dev/null 2>&1 || true
	tr -d '\r' <"$WORK/ws.out" | awk 'NR == 1'
}
T1="$(ticket_for "$ORIGIN")"
if [ -n "$T1" ]; then pass "POST /api/studio/ws/ticket through the console returns a ticket"; else fail "no ticket returned"; fi
st="$(ws_status "$ORIGIN" "$T1")"
case "$st" in
*" 101 "*) pass "WebSocket through the console with the allowed Origin returns 101" ;;
*) fail "WebSocket with the allowed Origin: '$st' (expected 101)" ;;
esac
T2="$(ticket_for "http://127.0.0.1:$PORT")"
st="$(ws_status "http://127.0.0.1:$PORT" "$T2")"
case "$st" in
*" 101 "*) pass "WebSocket with the http://127.0.0.1:$PORT Origin returns 101 (second configured origin)" ;;
*) fail "WebSocket with the 127.0.0.1 Origin: '$st' (expected 101)" ;;
esac
T3="$(ticket_for "$ORIGIN")"
st="$(ws_status "http://evil.example" "$T3")"
case "$st" in
*" 101 "*) fail "WebSocket with a foreign Origin was upgraded ($st)" ;;
*" 403 "*) pass "WebSocket with a foreign Origin is rejected (403)" ;;
*) fail "WebSocket with a foreign Origin: '$st' (expected 403)" ;;
esac
# Event flow: a ws client inside the backend container (kernel image ships `ws`, node 22) connects to the console
# service over the frontend network with an allowed Origin, subscribes to the scenario-5 project, and must receive
# the event the kernel emits when an intake question is answered through the API.
QID="smokeq-$RANDOM"
cat >"$WORK/seed-q.sql" <<SQL
INSERT INTO intake_questions (id, project_id, question, created_at) VALUES ('$QID', '$PROJECT_ID', 'smoke question?', now());
SQL
if [ -z "$PROJECT_ID" ] || ! psql_in <"$WORK/seed-q.sql" >"$WORK/seed-q.log" 2>&1; then
	fail "could not seed an intake question for the event-flow check ($(tail -n 2 "$WORK/seed-q.log" 2>/dev/null | tr '\n' '|'))"
else
	cat >"$WORK/ws-client.js" <<'NODE'
const WebSocket = require(require.resolve("ws", { paths: ["/app"] }));
const ws = new WebSocket(`ws://console:8080/api/studio/ws?ticket=${process.env.TICKET}`, { origin: process.env.ORIGIN });
const timer = setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 25000);
ws.on("error", (e) => { console.log("ERROR " + e.message); process.exit(1); });
ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", projectId: process.env.PROJECT_ID })));
ws.on("message", (raw) => {
	let m;
	try { m = JSON.parse(raw.toString()); } catch { return; }
	if (m.type === "subscribed") console.log("SUBSCRIBED");
	if (m.type === "event" && m.projectId === process.env.PROJECT_ID && m.payload && m.payload.type === "escalation:user") {
		console.log("EVENT " + m.payload.type);
		clearTimeout(timer);
		process.exit(0);
	}
});
NODE
	T4="$(ticket_for "$ORIGIN")"
	: >"$WORK/ws-client.out"
	dc exec -T -e TICKET="$T4" -e ORIGIN="$ORIGIN" -e PROJECT_ID="$PROJECT_ID" backend node -e "$(cat "$WORK/ws-client.js")" >"$WORK/ws-client.out" 2>&1 &
	WS_PID=$!
	subscribed=0
	for _ in $(seq 1 20); do
		if grep -q '^SUBSCRIBED' "$WORK/ws-client.out"; then
			subscribed=1
			break
		fi
		kill -0 "$WS_PID" 2>/dev/null || break
		sleep 1
	done
	if [ "$subscribed" = 1 ]; then pass "ws client inside the backend subscribed to the project through console:8080"; else fail "ws client did not subscribe ($(head -c 200 "$WORK/ws-client.out"))"; fi
	auth answer "/api/studio/projects/$PROJECT_ID/intake-questions/$QID/answer" -X POST -H 'Content-Type: application/json' -d '{"answer":"yes"}'
	if [ "$HTTP_CODE" = 200 ]; then pass "answering the intake question through the API is 200"; else fail "intake answer returned $HTTP_CODE"; fi
	if wait "$WS_PID" && grep -q '^EVENT escalation:user' "$WORK/ws-client.out"; then pass "the project event arrived over the WebSocket after the API call"; else fail "no project event received over the WebSocket ($(tr '\n' ' ' <"$WORK/ws-client.out" | head -c 200))"; fi
fi

finish
