#!/usr/bin/env bash
# Smoke test for the production kernel image (phase D3): build, static image config, in-image contents,
# a hardened run against a throwaway Postgres, the verify-mode negative, admin-grant and a canary secret scan.
#
# Usage: scripts/docker/smoke-kernel.sh [--no-cache] [--skip-canary]
#   --no-cache     build every image with --no-cache (plan scenario 1)
#   --skip-canary  skip the slow canary secret scan (section g); the real-image key scan still runs
#
# Needs a local docker daemon (refuses remote endpoints / non-"docker" buildx drivers) and pulls
# the pinned pgvector image for the throwaway database. Everything it creates has a unique name and is removed on exit.
set -euo pipefail

NO_CACHE=""
SKIP_CANARY=0
for arg in "$@"; do
	case "$arg" in
	--no-cache) NO_CACHE="--no-cache" ;;
	--skip-canary) SKIP_CANARY=1 ;;
	*)
		echo "usage: $0 [--no-cache] [--skip-canary]" >&2
		exit 2
		;;
	esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oscorpex-smoke.XXXXXX")"
RUN="oscx-smoke-$$-$RANDOM"
IMG="$RUN:runtime"
IMG_CANARY="$RUN-canary:runtime"
IMG_CANARY_BUILD="$RUN-canary:build"
NET="$RUN-net"
PG="$RUN-pg"
K1="$RUN-kernel"
K2="$RUN-kernel-unmigrated"
V_CLAUDE="$RUN-claude"
V_OSC="$RUN-oscorpex"
V_VOLT="$RUN-voltagent"
PINNED_DIGEST="sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da"
CLAUDE_VERSION="2.1.302"
PG_IMAGE="pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f"
MIN_FREE_KB=$((15 * 1024 * 1024)) # docker data root must have this much free space
MIN_HOST_FREE_KB=$((5 * 1024 * 1024)) # host temp dir (docker save is extracted there)

cleanup() {
	local rc=$?
	docker rm -f "$K1" "$K2" "$PG" >/dev/null 2>&1 || true
	docker volume rm -f "$V_CLAUDE" "$V_OSC" "$V_VOLT" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	docker rmi -f "$IMG" "$IMG_CANARY" "$IMG_CANARY_BUILD" >/dev/null 2>&1 || true
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

# ---------------------------------------------------------------- preflight
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
	fail "docker is not available"
	finish
fi
# 1. never ship real files into a builder through a regressed ignore file
if ! "$REPO_ROOT/scripts/docker/check-context.sh" --real >"$WORK/context-real.log" 2>&1; then
	grep -m 12 -E '^(FAIL|RESULT)' "$WORK/context-real.log" | indent
	fail "check-context.sh --real failed: refusing to build (real files could reach the builder)"
	finish
fi
pass "check-context.sh --real passed"
# 2. only a local daemon builder
driver="$(docker buildx inspect 2>/dev/null | awk '/^Driver:/ && !d { print $2; d = 1 }')"
if [ "$driver" != docker ]; then
	fail "current buildx builder driver is '${driver:-unknown}', expected 'docker' (local daemon); refusing to send the context"
	finish
fi
pass "buildx builder driver is docker (local daemon)"
# 3. the docker endpoint itself must be local
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
# 4. disk guard: the builds and `docker save` extractions are large; fail early rather than fill the disk
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
df_out="$(docker run --rm --entrypoint df "node:22-bookworm-slim@$PINNED_DIGEST" -Pk / 2>/dev/null || true)"
free_kb="$(awk 'END { print $4 }' <<<"$df_out")"
case "$free_kb" in
'' | *[!0-9]*)
	echo "WARN: could not measure free space of the docker data root (${docker_root:-unknown}); disk guard skipped"
	;;
*)
	if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
		fail "docker data root (${docker_root:-unknown}) has $((free_kb / 1024 / 1024)) GB free, need at least $((MIN_FREE_KB / 1024 / 1024)) GB"
		finish
	fi
	pass "docker data root has $((free_kb / 1024 / 1024)) GB free"
	;;
esac
host_free_kb="$(df -Pk "$WORK" | awk 'END { print $4 }')"
if [ "$host_free_kb" -lt "$MIN_HOST_FREE_KB" ]; then
	fail "host temp dir has $((host_free_kb / 1024 / 1024)) GB free, need at least $((MIN_HOST_FREE_KB / 1024 / 1024)) GB for image extraction"
	finish
fi
pass "host temp dir has $((host_free_kb / 1024 / 1024)) GB free"

# ---------------------------------------------------------------- static: Dockerfile + CLI assets
echo "--- static checks ---"
DOCKERFILE="$REPO_ROOT/Dockerfile"
if [ -f "$DOCKERFILE" ]; then
	# Every FROM naming an external image must carry @sha256 (the node one: the pinned digest); FROM <earlier stage> is fine.
	from_bad=""
	from_count=0
	stages=" "
	while IFS= read -r line; do
		ref="$(awk '{ i = 2; if ($i ~ /^--/) i++; print $i }' <<<"$line")"
		name="$(awk '{ for (i = 1; i < NF; i++) if (toupper($i) == "AS") print $(i + 1) }' <<<"$line")"
		from_count=$((from_count + 1))
		case "$stages" in
		*" $ref "*) ;; # reference to an earlier stage
		*)
			case "$ref" in
			node:*) [ "$ref" = "node:22-bookworm-slim@$PINNED_DIGEST" ] || from_bad="$from_bad $ref" ;;
			*@sha256:*) ;;
			*) from_bad="$from_bad $ref" ;;
			esac
			;;
		esac
		[ -z "$name" ] || stages="$stages$name "
	done < <(grep -Ei '^[[:space:]]*FROM[[:space:]]' "$DOCKERFILE" || true)
	if [ "$from_count" -gt 0 ] && [ -z "$from_bad" ]; then
		pass "all $from_count Dockerfile FROM lines are digest-pinned (node: $PINNED_DIGEST) or earlier stages"
	else
		fail "Dockerfile FROM lines not pinned by @sha256 (or node not the pinned digest):${from_bad:- none parsed}"
	fi
	for stage in deps build deploy claude-cli runtime; do
		if grep -Eiq "^[[:space:]]*FROM[[:space:]].*[[:space:]]AS[[:space:]]+$stage([[:space:]]|\$)" "$DOCKERFILE"; then
			pass "Dockerfile has stage '$stage'"
		else
			fail "Dockerfile has no stage '$stage'"
		fi
	done
else
	fail "Dockerfile is missing at the repo root"
fi
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
	if [ -f "$REPO_ROOT/docker/claude-cli/$f" ]; then
		pass "docker/claude-cli/$f exists"
	else
		fail "docker/claude-cli/$f is missing"
	fi
done

# ---------------------------------------------------------------- a. build
echo "--- build ---"
# --no-cache applies to the first (runtime) build only; the canary builds reuse its base layers.
# The `--target build` stage is built (and scanned) from the canary context in section g.
build_image() { # build_image <context> <tag> <log> [extra args...]
	local ctx="$1" tag="$2" log="$3"
	shift 3
	# shellcheck disable=SC2086
	docker buildx build --load --progress=plain $NO_CACHE "$@" -t "$tag" "$ctx" >"$log" 2>&1
}
HAVE_RUNTIME=0
t0=$SECONDS
if build_image "$REPO_ROOT" "$IMG" "$WORK/build-runtime.log"; then
	HAVE_RUNTIME=1
	pass "runtime image built from the repo root in $((SECONDS - t0))s${NO_CACHE:+ (no cache)}"
else
	fail "runtime image build failed after $((SECONDS - t0))s (last lines below)"
	tail -n 8 "$WORK/build-runtime.log" | indent
fi
NO_CACHE=""

# ---------------------------------------------------------------- b. docker inspect
echo "--- image config ---"
if [ "$HAVE_RUNTIME" = 1 ]; then
	docker inspect --format '{{json .Config}}' "$IMG" >"$WORK/config.json"
	node - "$WORK/config.json" <<'NODE' >"$WORK/config-report.txt"
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = (ok, msg) => console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`);
out(["oscorpex", "1001", "1001:1001", "oscorpex:oscorpex"].includes(cfg.User), `image User is '${cfg.User}' (oscorpex or 1001[:1001])`);
out(!!cfg.Healthcheck && Array.isArray(cfg.Healthcheck.Test) && cfg.Healthcheck.Test[0] !== "NONE", "HEALTHCHECK is defined");
const env = Object.fromEntries((cfg.Env || []).map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]));
out(env.NODE_ENV === "production", `Env NODE_ENV=production (got '${env.NODE_ENV}')`);
out(!!env.CLAUDE_CONFIG_DIR, `Env CLAUDE_CONFIG_DIR is set (${env.CLAUDE_CONFIG_DIR})`);
out(!!env.CLAUDE_CLI_PATH, `Env CLAUDE_CLI_PATH is set (${env.CLAUDE_CLI_PATH})`);
out(env.DISABLE_AUTOUPDATER === "1", `Env DISABLE_AUTOUPDATER=1 (got '${env.DISABLE_AUTOUPDATER}')`);
const secretKeys = Object.keys(env).filter((k) => /SECRET|PASSWORD|TOKEN|API_KEY/i.test(k));
out(secretKeys.length === 0, `no secret-looking Env keys${secretKeys.length ? `: ${secretKeys.join(", ")}` : ""}`);
const secretVals = Object.entries(env).filter(([, v]) => /sk-ant-|sk-proj-|ghp_|postgres(ql)?:\/\/[^/\s]*:[^@\s]+@/i.test(v));
out(secretVals.length === 0, `no secret-looking Env values${secretVals.length ? `: ${secretVals.map(([k]) => k).join(", ")}` : ""}`);
const ep = JSON.stringify(cfg.Entrypoint), cmd = JSON.stringify(cfg.Cmd);
out(ep === '["tini","-g","--"]', `Entrypoint is ["tini","-g","--"] (got ${ep})`);
out(cmd === '["node","dist/index.js"]', `Cmd is ["node","dist/index.js"] (got ${cmd})`);
out(cfg.WorkingDir === "/app", `WorkingDir is /app (got '${cfg.WorkingDir}')`);
NODE
	cat "$WORK/config-report.txt"
	FAILS=$((FAILS + $(grep -c '^FAIL:' "$WORK/config-report.txt" || true)))
else
	fail "image config checks skipped: runtime image was not built"
fi

# ---------------------------------------------------------------- c. inside the image
echo "--- image contents ---"
# img_sh <script>: run a shell script in the image (default entrypoint); prints stdout, fails if it did not finish.
img_sh() {
	local out
	out="$(docker run --rm ${IMG_USER:+-u "$IMG_USER"} "$IMG" sh -c "$1; echo __END__" 2>&1)" || true
	case "$out" in
	*__END__) printf '%s\n' "${out%__END__}" ;;
	*)
		printf '%s\n' "$out"
		return 1
		;;
	esac
}
if [ "$HAVE_RUNTIME" = 1 ]; then
	uid="$(img_sh 'id -u' | tr -d '[:space:]' || true)"
	if [ "$uid" = 1001 ]; then pass "id -u is 1001"; else fail "id -u is '$uid', expected 1001"; fi

	# as root, any file type (a setgid directory is as unwanted as a setuid binary)
	suid="$(IMG_USER=0 img_sh 'find / -xdev -perm /6000 2>/dev/null' || echo "<run failed>")"
	if [ -z "$(printf '%s' "$suid" | tr -d '[:space:]')" ]; then pass "no setuid/setgid files in the image"; else
		fail "setuid/setgid files present:"
		head -n 10 <<<"$suid" | indent
	fi

	cv="$(img_sh 'claude --version' || true)"
	if grep -Fq "$CLAUDE_VERSION" <<<"$cv"; then pass "claude --version reports $CLAUDE_VERSION"; else fail "claude --version output: $(head -n 2 <<<"$cv" | tr '\n' ' ')"; fi

	pkgs="$(node -e 'const d=require(process.argv[1]).dependencies||{};process.stdout.write(Object.keys(d).filter(n=>n.startsWith("@oscorpex/")).join(" "))' "$REPO_ROOT/apps/kernel/package.json")"
	imp="$(docker run --rm -w /app "$IMG" node --input-type=module -e '
const names = process.argv.slice(1);
const bad = [];
for (const n of names) { try { await import(n); } catch (e) { bad.push(n + ": " + (e && e.message || e)); } }
console.log(bad.length ? "BAD " + bad.join(" | ") : "OK " + names.length);
' $pkgs 2>&1 | tail -n 3 || true)"
	case "$imp" in
	"OK 0") fail "package import smoke: no @oscorpex/* dependencies found in apps/kernel/package.json" ;;
	OK*) pass "every @oscorpex/* dependency imports in the image (${imp#OK } packages)" ;;
	*) fail "package import smoke: $imp" ;;
	esac

	for f in /app/dist/index.js /app/dist/migrate.js /app/dist/admin-grant.js /app/scripts/init.sql; do
		yes_out="$(img_sh "test -f $f && echo yes" || true)"
		if grep -q yes <<<"$yes_out"; then pass "$f exists"; else fail "$f is missing"; fi
	done
	yes_out="$(img_sh 'test ! -e /app/src && echo yes' || true)"
	if grep -q yes <<<"$yes_out"; then pass "no /app/src"; else fail "/app/src exists in the image"; fi
	yes_out="$(img_sh 'test ! -e /app/pnpm-workspace.yaml && echo yes' || true)"
	if grep -q yes <<<"$yes_out"; then pass "no /app/pnpm-workspace.yaml"; else fail "/app/pnpm-workspace.yaml exists in the runtime image"; fi
	envfiles="$(img_sh 'find /app /opt -name ".env*" 2>/dev/null' || echo '<run failed>')"
	if [ -z "$(printf '%s' "$envfiles" | tr -d '[:space:]')" ]; then pass "no .env* files under /app or /opt"; else
		fail ".env* files in the image:"
		head -n 5 <<<"$envfiles" | indent
	fi
	dev="$(img_sh 'for d in vitest typescript tsx @biomejs/biome; do test -e /app/node_modules/$d && echo "direct:$d"; done; find /app/node_modules/.pnpm -maxdepth 1 \( -name "vitest@*" -o -name "typescript@*" -o -name "tsx@*" -o -name "@biomejs*" \) 2>/dev/null' || echo '<run failed>')"
	if [ -z "$(printf '%s' "$dev" | tr -d '[:space:]')" ]; then pass "no devDependencies (vitest, typescript, tsx, biome) in /app/node_modules"; else
		fail "devDependencies present:"
		head -n 6 <<<"$dev" | indent
	fi
	# immutability without --read-only: the runtime user (uid 1001) must not be able to change code or config
	for p in /app /app/dist /app/scripts/init.sql /app/node_modules /opt/claude-cli /etc/claude-code/managed-settings.json; do
		w="$(img_sh "if [ -e $p ]; then if [ -w $p ]; then echo writable; else echo readonly; fi; else echo missing; fi" || true)"
		case "$w" in
		*readonly*) pass "$p is not writable by uid 1001 (no --read-only)" ;;
		*missing*) fail "$p is missing" ;;
		*) fail "$p is writable by uid 1001 (or probe failed): $(head -n 2 <<<"$w" | tr '\n' ' ')" ;;
		esac
	done
	envw="$(img_sh 'touch /app/.env 2>/dev/null && echo created; echo probe-done' || true)"
	if grep -q created <<<"$envw" || ! grep -q probe-done <<<"$envw"; then fail "uid 1001 could create /app/.env (or probe failed)"; else pass "creating /app/.env as uid 1001 fails"; fi
	owned="$(img_sh "find /app /opt/claude-cli \\( ! -user 0 -o -perm /022 \\) ! -type l ! -path '/app/.oscorpex*' ! -path '/app/.voltagent*' 2>/dev/null" || echo "<run failed>")"
	if [ -z "$(printf '%s' "$owned" | tr -d '[:space:]')" ]; then pass "/app and /opt/claude-cli are root-owned and not group/world-writable"; else
		fail "files not root-owned or group/world-writable:"
		head -n 10 <<<"$owned" | indent
	fi
	tools="$(img_sh 'for t in python3 make g++ gcc cc; do command -v $t; done' || echo '<run failed>')"
	if [ -z "$(printf '%s' "$tools" | tr -d '[:space:]')" ]; then pass "python3/make/g++ absent from the runtime image"; else fail "build tools in runtime: $(printf '%s' "$tools" | tr '\n' ' ')"; fi
else
	fail "image content checks skipped: runtime image was not built"
fi

# ---------------------------------------------------------------- d/e/f. hardened run against a throwaway database
if [ "$HAVE_RUNTIME" = 1 ]; then
	echo "--- hardened run ---"
	PGPW="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
	[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$PGPW"
	JWT="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
	[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$JWT"
	docker network create "$NET" >/dev/null
	docker volume create "$V_CLAUDE" >/dev/null
	docker volume create "$V_OSC" >/dev/null
	docker volume create "$V_VOLT" >/dev/null
	if ! docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD="$PGPW" -e POSTGRES_DB=oscorpex \
		$PG_IMAGE >"$WORK/pg-start.log" 2>&1; then
		fail "could not start the throwaway postgres ($PG_IMAGE)"
		tail -n 3 "$WORK/pg-start.log" | indent
		finish
	fi
	ready=0
	for _ in $(seq 1 60); do
		if docker exec "$PG" pg_isready -U postgres -d oscorpex >/dev/null 2>&1 \
			&& docker exec "$PG" psql -U postgres -d oscorpex -qAt -c 'select 1' >/dev/null 2>&1; then
			ready=1
			break
		fi
		sleep 1
	done
	if [ "$ready" != 1 ]; then
		fail "throwaway postgres did not become ready"
		finish
	fi
	docker exec "$PG" psql -U postgres -qAt -c 'CREATE DATABASE unmigrated' >/dev/null
	URL="postgresql://postgres:$PGPW@$PG:5432/oscorpex"
	URL_FRESH="postgresql://postgres:$PGPW@$PG:5432/unmigrated"

	umask 077
	printf 'NODE_ENV=production\nOSCORPEX_MIGRATION_DATABASE_URL=%s\nDATABASE_URL=%s\n' "$URL" "$URL" >"$WORK/migrate.env"
	printf 'DATABASE_URL=%s\nOSCORPEX_JWT_SECRET=%s\nOSCORPEX_AUTH_ENABLED=true\n' "$URL" "$JWT" >"$WORK/kernel.env"
	printf 'DATABASE_URL=%s\nOSCORPEX_JWT_SECRET=%s\nOSCORPEX_AUTH_ENABLED=true\n' "$URL_FRESH" "$JWT" >"$WORK/kernel-fresh.env"

	for n in 1 2; do
		if docker run --rm --network "$NET" --env-file "$WORK/migrate.env" "$IMG" node dist/migrate.js >"$WORK/migrate-$n.log" 2>&1; then
			pass "migrate container run #$n exits 0"
		else
			fail "migrate container run #$n failed ($(tail -n 3 "$WORK/migrate-$n.log" | tr '\n' '|'))"
		fi
	done

	kernel_run() { # kernel_run <name> <env-file>
		docker run -d --name "$1" --network "$NET" \
			--read-only --tmpfs /tmp:exec,size=512m --tmpfs /home/oscorpex:exec,size=256m,uid=1001,gid=1001,mode=0700 \
			-v "$V_CLAUDE":/home/oscorpex/.claude -v "$V_OSC":/app/.oscorpex -v "$V_VOLT":/app/.voltagent \
			--cap-drop ALL --security-opt no-new-privileges:true \
			--env-file "$2" "$IMG"
	}

	if kernel_run "$K1" "$WORK/kernel.env" >"$WORK/k1-start.log" 2>&1; then
		health=""
		for _ in $(seq 1 90); do
			health="$(docker inspect --format '{{.State.Health.Status}}' "$K1" 2>/dev/null || true)"
			[ "$health" = healthy ] && break
			[ "$(docker inspect --format '{{.State.Running}}' "$K1" 2>/dev/null || echo false)" = true ] || break
			sleep 2
		done
		if [ "$health" = healthy ]; then pass "kernel container becomes healthy (hardened flags, verify mode)"; else
			fail "kernel container health is '${health:-unknown}'"
			docker logs --tail 15 "$K1" 2>&1 | { grep -viE 'secret|password|database_url|token|api_key' || true; } | indent
		fi

		if docker exec "$K1" node -e "fetch('http://127.0.0.1:3141/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
			pass "/health returns 200"
		else
			fail "/health did not return 200"
		fi

		caps="$(docker exec "$K1" sh -c '
for p in /proc/1 /proc/[0-9]*; do
	[ -r "$p/comm" ] || continue
	c="$(cat "$p/comm")"
	if [ "$p" = /proc/1 ] || [ "$c" = node ]; then
		echo "$p $c $(grep -E "^(CapEff|NoNewPrivs):" "$p/status" | tr -s "[:space:]" " " | tr -d "\n")"
	fi
done' 2>&1 || true)"
		bad_caps=0
		seen_node=0
		while IFS= read -r line; do
			[ -n "$line" ] || continue
			case "$line" in *" node "*) seen_node=1 ;; esac
			case "$line" in
			*"CapEff: 0000000000000000"*"NoNewPrivs: 1"*) ;;
			*) bad_caps=1 ;;
			esac
		done <<EOF
$caps
EOF
		if [ -n "$caps" ] && [ "$seen_node" = 1 ] && [ "$bad_caps" = 0 ]; then
			pass "PID 1 and the node process have CapEff 0 and NoNewPrivs 1"
		else
			fail "capability state: $(printf '%s' "$caps" | tr '\n' '|')"
		fi

		for p in /app/dist/.w /app/scripts/init.sql /opt/claude-cli/.w; do
			if docker exec "$K1" sh -c "echo x >> $p" >/dev/null 2>&1; then fail "write to $p succeeded (must be read-only)"; else pass "write to $p is refused"; fi
		done
		for p in /app/.oscorpex/.w /app/.voltagent/.w /home/oscorpex/.claude/.w /tmp/.w; do
			if docker exec "$K1" sh -c "echo x > $p && rm -f $p" >/dev/null 2>&1; then pass "write to $p succeeds"; else fail "write to $p failed (must be writable)"; fi
		done

		claude_dir="$(docker exec "$K1" stat -c '%u:%g %a' /home/oscorpex/.claude 2>&1 || true)"
		if [ "$claude_dir" = "1001:1001 700" ]; then pass "/home/oscorpex/.claude is owned 1001:1001 mode 0700"; else fail "/home/oscorpex/.claude is '$claude_dir' (expected '1001:1001 700')"; fi
		# pnpm must come from the pre-seeded pinned copy: no network, exactly 12.6.0, with and without a package.json
		pnpm_v="$(docker exec "$K1" pnpm --version 2>&1 || true)"
		if [ "$pnpm_v" = 12.6.0 ]; then pass "pnpm --version is exactly 12.6.0 as uid 1001 in /app"; else fail "pnpm --version in /app: $(head -n 3 <<<"$pnpm_v" | tr '\n' ' ')"; fi
	pnpm_nn="$(docker run --rm --network none --user 1001:1001 -w /tmp \
			--tmpfs /tmp:exec,size=64m --tmpfs /home/oscorpex:exec,size=64m,uid=1001,gid=1001,mode=0700 --read-only \
			--cap-drop ALL --security-opt no-new-privileges:true "$IMG" sh -c 'mkdir -p /tmp/empty && cd /tmp/empty && pnpm --version' 2>&1 || true)"
		if [ "$pnpm_nn" = 12.6.0 ]; then pass "pnpm --version is 12.6.0 with --network none in a directory without package.json"; else fail "pnpm --version offline in an empty dir: $(head -n 3 <<<"$pnpm_nn" | tr '\n' ' ')"; fi
		# --setting-sources project,local must ignore a user-level apiKeyHelper; the control run proves the probe works
		helper="$(docker run --rm --network none --read-only --tmpfs /tmp:exec,size=64m \
			--tmpfs /home/oscorpex:exec,size=64m,uid=1001,gid=1001,mode=0700 \
			--cap-drop ALL --security-opt no-new-privileges:true "$IMG" sh -c '
mkdir -p "$CLAUDE_CONFIG_DIR" && printf "{\"apiKeyHelper\":\"touch /tmp/helper-ran\"}" >"$CLAUDE_CONFIG_DIR/settings.json"
cd /tmp
rm -f /tmp/helper-ran
timeout 20 claude --setting-sources project,local --strict-mcp-config -p hi </dev/null >/dev/null 2>&1 || true
if [ -e /tmp/helper-ran ]; then echo SAFE_HELPER_RAN; else echo SAFE_HELPER_ABSENT; fi
rm -f /tmp/helper-ran
timeout 20 claude -p hi </dev/null >/dev/null 2>&1 || true
if [ -e /tmp/helper-ran ]; then echo CONTROL_HELPER_RAN; else echo CONTROL_HELPER_ABSENT; fi' 2>&1 || true)"
		if ! grep -Fxq CONTROL_HELPER_RAN <<<"$helper"; then
			fail "user-settings probe is meaningless: the control run (no flags) did not trigger the planted apiKeyHelper ($(tr '\n' ' ' <<<"$helper"))"
		elif grep -Fxq SAFE_HELPER_ABSENT <<<"$helper"; then
			pass "--setting-sources project,local --strict-mcp-config ignores a user-level apiKeyHelper (control without flags runs it)"
		else
			fail "user-level apiKeyHelper ran despite --setting-sources project,local ($(tr '\n' ' ' <<<"$helper"))"
		fi
		ms="$(docker exec "$K1" sh -c 'stat -c "%u:%g %a" /etc/claude-code/managed-settings.json && node -e "const j=JSON.parse(require(\"fs\").readFileSync(\"/etc/claude-code/managed-settings.json\",\"utf8\"));console.log(j.disableAllHooks===true?\"hooks-disabled\":\"hooks-not-disabled\");console.log(j.env&&j.env.ANTHROPIC_BASE_URL===\"https://api.anthropic.com\"?\"base-url-pinned\":\"base-url-not-pinned\")"' 2>&1 || true)"
		if grep -Fxq "0:0 644" <<<"$ms" && grep -Fxq "hooks-disabled" <<<"$ms" && grep -Fxq "base-url-pinned" <<<"$ms"; then pass "/etc/claude-code/managed-settings.json is root:root 0644, valid JSON, disableAllHooks true, env.ANTHROPIC_BASE_URL pinned"; else fail "managed-settings.json check: $(head -n 3 <<<"$ms" | tr '\n' ' ')"; fi

		logs="$(docker logs "$K1" 2>&1 || true)"
		if grep -Fq "$PGPW" <<<"$logs"; then fail "kernel logs contain the postgres password"; else pass "kernel logs do not contain the postgres password"; fi

		cv="$(docker exec -e HOME=/home/oscorpex -e CLAUDE_CONFIG_DIR=/home/oscorpex/.claude "$K1" claude --version 2>&1 || true)"
		if grep -Fq "$CLAUDE_VERSION" <<<"$cv"; then pass "claude --version works as the container user on a read-only rootfs"; else fail "claude --version in the container: $(head -n 3 <<<"$cv" | tr '\n' ' ')"; fi
	else
		fail "kernel container did not start ($(tail -n 2 "$WORK/k1-start.log" | tr '\n' '|'))"
	fi
	docker rm -f "$K1" >/dev/null 2>&1 || true

	# ---- e. verify mode against an unmigrated database must refuse to boot
	echo "--- verify-mode negative ---"
	if kernel_run "$K2" "$WORK/kernel-fresh.env" >"$WORK/k2-start.log" 2>&1; then
		running=true
		for _ in $(seq 1 45); do
			running="$(docker inspect --format '{{.State.Running}}' "$K2" 2>/dev/null || echo false)"
			[ "$running" = true ] || break
			sleep 2
		done
		code="$(docker inspect --format '{{.State.ExitCode}}' "$K2" 2>/dev/null || echo 0)"
		if [ "$running" = false ] && [ "$code" != 0 ]; then pass "kernel on an unmigrated database exits non-zero ($code)"; else fail "kernel on an unmigrated database did not exit non-zero (running=$running exit=$code)"; fi
		logs="$(docker logs "$K2" 2>&1 || true)"
		if grep -qi 'migrat' <<<"$logs"; then pass "unmigrated-database logs mention migrate"; else fail "unmigrated-database logs do not mention migrate"; fi
		if grep -Fq "$PGPW" <<<"$logs"; then fail "unmigrated-database logs contain the postgres password"; else pass "unmigrated-database logs do not contain the postgres password"; fi
	else
		fail "unmigrated kernel container did not start ($(tail -n 2 "$WORK/k2-start.log" | tr '\n' '|'))"
	fi
	docker rm -f "$K2" >/dev/null 2>&1 || true

	# ---- f. admin-grant from the compiled image
	echo "--- admin-grant ---"
	EMAIL="d3-admin-check@example.test"
	docker exec "$PG" psql -U postgres -d oscorpex -qAt -c "INSERT INTO users (email, password_hash) VALUES ('$EMAIL', 'x') ON CONFLICT (email) DO NOTHING" >/dev/null 2>&1 || true
	if docker run --rm --network "$NET" --env-file "$WORK/migrate.env" "$IMG" node dist/admin-grant.js grant "$EMAIL" >"$WORK/ag.log" 2>&1; then
		flag="$(docker exec "$PG" psql -U postgres -d oscorpex -qAt -c "SELECT is_platform_admin FROM users WHERE email = '$EMAIL'" 2>/dev/null || true)"
		if [ "$flag" = t ]; then pass "admin-grant in the image sets is_platform_admin = true"; else fail "admin-grant flag is '$flag' (expected t)"; fi
		granted="$(grep -c 'Granted' "$WORK/ag.log" || true)"
		if [ "$granted" = 1 ]; then pass "admin-grant prints exactly one 'Granted' line"; else fail "admin-grant printed $granted 'Granted' lines (expected 1)"; fi
	else
		fail "admin-grant in the image failed ($(tail -n 3 "$WORK/ag.log" | tr '\n' '|'))"
	fi
	if docker run --rm --network "$NET" --env-file "$WORK/migrate.env" "$IMG" node dist/admin-grant.js revoke "$EMAIL" >"$WORK/ag-revoke.log" 2>&1; then
		flag="$(docker exec "$PG" psql -U postgres -d oscorpex -qAt -c "SELECT is_platform_admin FROM users WHERE email = '$EMAIL'" 2>/dev/null || true)"
		if [ "$flag" = f ]; then pass "admin-grant revoke in the image sets is_platform_admin = false"; else fail "admin-grant revoke flag is '$flag' (expected f)"; fi
		revoked="$(grep -c 'Revoked' "$WORK/ag-revoke.log" || true)"
		if [ "$revoked" = 1 ]; then pass "admin-grant prints exactly one 'Revoked' line"; else fail "admin-grant printed $revoked 'Revoked' lines (expected 1)"; fi
	else
		fail "admin-grant revoke in the image failed ($(tail -n 3 "$WORK/ag-revoke.log" | tr '\n' '|'))"
	fi
else
	fail "hardened run, verify-mode negative and admin-grant skipped: runtime image was not built"
fi

# ---------------------------------------------------------------- g. secret scans over saved layers
SCANNER="$WORK/scan-layers.mjs"
cat >"$SCANNER" <<'NODE'
// Prints "ENTRIES <n>" (files scanned) then SCAN-DONE; callers must require n > 0 (fail closed).
// usage: node scan-layers.mjs <extracted docker-save dir> (--marker <value> | --keys)
// Walks every file of an extracted `docker save`, decompresses gzip/zstd blobs, parses tar layers entry by entry
// and prints "HIT <kind> <blob> <entry path>" for each match. Exit code 0 always; the caller counts HIT lines.
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import zlib from "node:zlib";

const [dir, mode, marker] = process.argv.slice(2);
const opt = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
};
// Scoping (keys mode only): hits inside layers of the pinned base image, or in dpkg-owned files (verified
// unmodified by the caller), are reported as INFO lines instead of HIT. Everything else is a HIT.
const usrMerge = (p) => p.replace(/^\/(bin|sbin|lib|lib32|lib64|libx32)\//, "/usr/$1/");
const normPath = (p) => usrMerge(`/${p.replace(/^\.?\/+/, "")}`);
const readLines = (f) => (f ? readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
const baseDiffIds = new Set(readLines(opt("--base-diffids")));
const dpkgOwned = new Set(readLines(opt("--dpkg-list")).map(normPath));
const baseLayerBlobs = new Set();
if (existsSync(join(dir, "manifest.json")) && baseDiffIds.size) {
	for (const item of JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))) {
		const cfg = JSON.parse(readFileSync(join(dir, item.Config), "utf8"));
		(cfg.rootfs?.diff_ids ?? []).forEach((id, i) => {
			if (baseDiffIds.has(id) && item.Layers[i]) baseLayerBlobs.add(item.Layers[i]);
		});
	}
}
console.log(`BASE-LAYER-BLOBS ${baseLayerBlobs.size} DPKG-OWNED ${dpkgOwned.size}`);
const KEYS = [
	["sk-ant", /sk-ant-[a-z]+[0-9]{2}-[A-Za-z0-9_-]{40,}/g],
	["sk-proj", /sk-proj-[A-Za-z0-9_-]{40,}/g],
	["aws-akia", /(^|[^0-9A-Z])AKIA[0-9A-Z]{16}([^0-9A-Z]|$)/g],
	["github-pat", /github_pat_[A-Za-z0-9_]{60,}/g],
	["ghp", /ghp_[A-Za-z0-9]{36}/g],
	// a PEM header followed by the first 64 base64 chars of a body (no END needed: the body may span chunks);
	// a bare marker literal embedded in a binary does not match
	["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{64}/g],
];
const seen = new Set();
let entries = 0;
const hit = (kind, blob, entry, extra = "") => {
	const k = `${kind}|${blob}|${entry}|${extra}`;
	if (seen.has(k)) return;
	seen.add(k);
	let label = "HIT";
	let why = "";
	if (mode === "--keys") {
		if (baseLayerBlobs.has(blob)) [label, why] = ["INFO:", " (base-image layer)"];
		else if (dpkgOwned.has(normPath(entry))) [label, why] = ["INFO:", " (dpkg-owned, verified)"];
	}
	console.log(`${label}${label === "HIT" ? " " : " skipped hit"} ${kind} ${blob} ${entry}${extra ? ` ${extra}` : ""}${why}`);
};

function scan(blob, entry, tail, piece) {
	const data = tail.length ? Buffer.concat([tail, piece]) : piece;
	if (mode === "--marker") {
		if (data.indexOf(marker) !== -1) hit("marker", blob, entry);
	} else {
		const text = data.toString("latin1");
		for (const [kind, re] of KEYS) {
			re.lastIndex = 0;
			for (const m of text.matchAll(re)) hit(kind, blob, entry, `${m[0].slice(0, 12)}...(${m[0].length} chars)`);
		}
	}
	return data.subarray(Math.max(0, data.length - 8192));
}

async function* decompressed(file) {
	const fd = createReadStream(file);
	const head = await new Promise((resolve) => {
		const s = createReadStream(file, { start: 0, end: 3 });
		const parts = [];
		s.on("data", (c) => parts.push(c));
		s.on("end", () => resolve(Buffer.concat(parts)));
		s.on("error", () => resolve(Buffer.alloc(0)));
	});
	if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
		yield* fd.pipe(zlib.createGunzip());
	} else if (head.length >= 4 && head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) {
		if (typeof zlib.createZstdDecompress === "function") {
			yield* fd.pipe(zlib.createZstdDecompress());
		} else {
			fd.destroy();
			const p = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "inherit"] });
			yield* p.stdout;
		}
	} else {
		yield* fd;
	}
}

const octal = (b) => Number.parseInt(b.toString("latin1").replace(/\0.*$/, "").trim() || "0", 8);
const cstr = (b) => b.toString("utf8").replace(/\0.*$/s, "");

async function scanBlob(file, rel) {
	let state = "probe"; // probe -> tar | raw
	let pending = Buffer.alloc(0);
	let remaining = 0;
	let pad = 0;
	let entry = rel;
	let tail = Buffer.alloc(0);
	let collect = null; // { type, size, parts }
	let nextName = null;
	for await (let chunk of decompressed(file)) {
		if (state === "probe") {
			pending = Buffer.concat([pending, chunk]);
			if (pending.length < 512) continue;
			state = pending.subarray(257, 262).toString("latin1") === "ustar" ? "tar" : "raw";
			chunk = pending;
			pending = Buffer.alloc(0);
			if (state === "raw") {
				entries++;
				tail = scan(rel, rel, tail, chunk);
				continue;
			}
		} else if (state === "raw") {
			tail = scan(rel, rel, tail, chunk);
			continue;
		}
		let off = 0;
		while (off < chunk.length) {
			if (remaining > 0) {
				const n = Math.min(remaining, chunk.length - off);
				const piece = chunk.subarray(off, off + n);
				if (collect) collect.parts.push(piece);
				else tail = scan(rel, entry, tail, piece);
				remaining -= n;
				off += n;
				if (remaining === 0) {
					if (collect) {
						const body = Buffer.concat(collect.parts);
						if (collect.type === "L") nextName = cstr(body);
						else if (collect.type === "x") {
							const m = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
							if (m) nextName = m[1];
						}
						collect = null;
					}
				}
				continue;
			}
			if (pad > 0) {
				const n = Math.min(pad, chunk.length - off);
				pad -= n;
				off += n;
				continue;
			}
			const need = 512 - pending.length;
			const n = Math.min(need, chunk.length - off);
			pending = Buffer.concat([pending, chunk.subarray(off, off + n)]);
			off += n;
			if (pending.length < 512) continue;
			const h = pending;
			pending = Buffer.alloc(0);
			if (h.every((x) => x === 0)) continue;
			const size = octal(h.subarray(124, 136));
			const type = String.fromCharCode(h[156] || 48);
			let name = cstr(h.subarray(0, 100));
			const prefix = cstr(h.subarray(345, 500));
			if (prefix) name = `${prefix}/${name}`;
			if (type === "L" || type === "x") collect = { type, parts: [] };
			else {
				entries++;
				entry = nextName ?? name;
				nextName = null;
				tail = Buffer.alloc(0);
				if (mode === "--marker" && entry.includes(marker)) hit("marker-in-name", rel, entry);
			}
			remaining = type === "5" || type === "2" || type === "1" ? 0 : size;
			pad = remaining > 0 ? (512 - (remaining % 512)) % 512 : 0;
		}
	}
	if (state === "probe" && pending.length) scan(rel, rel, Buffer.alloc(0), pending);
}

function* walk(d) {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.isFile() && statSync(p).size > 0) yield p;
	}
}

for (const f of walk(dir)) await scanBlob(f, f.slice(dir.length + 1));
console.log(`ENTRIES ${entries}`);
console.log("SCAN-DONE");
NODE

# save_and_scan <image> <label> <scan args...>: stream docker save into tar, scan; prints the scanner output.
# Fails closed: SAVE-FAILED / SCAN-FAILED lines are printed when docker save, tar or the scanner fail.
save_and_scan() {
	local image="$1" label="$2" ex="$WORK/save-$2"
	shift 2
	mkdir -p "$ex"
	if ! docker save "$image" | tar -xf - -C "$ex"; then
		echo "SAVE-FAILED"
		rm -rf "$ex"
		return 1
	fi
	if ! node "$SCANNER" "$ex" "$@"; then echo "SCAN-FAILED"; fi
	rm -rf "$ex"
}
# scan_verdict <output>: "ok" | "no-entries" | "incomplete"
scan_verdict() {
	local n
	if grep -Eq '^(SAVE|SCAN)-FAILED$' <<<"$1" || ! grep -q '^SCAN-DONE$' <<<"$1"; then
		echo incomplete
		return
	fi
	n="$(awk '/^ENTRIES / { print $2 }' <<<"$1")"
	case "$n" in
	'' | 0 | *[!0-9]*) echo no-entries ;;
	*) echo ok ;;
	esac
}

if [ "$HAVE_RUNTIME" = 1 ]; then
	echo "--- real-image key scan ---"
	scope_ok=1
	# (a) diff IDs of the pinned base image
	BASE_REF="node:22-bookworm-slim@$PINNED_DIGEST"
	docker image inspect "$BASE_REF" >/dev/null 2>&1 || docker pull -q "$BASE_REF" >/dev/null 2>&1 || true
	base_ids="$(docker image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' "$BASE_REF" 2>/dev/null || true)"
	printf '%s\n' "$base_ids" >"$WORK/base-diffids.txt"
	if [ -z "$(tr -d '[:space:]' <<<"$base_ids")" ]; then
		fail "could not read the layer diff IDs of $BASE_REF (scan scoping unavailable)"
		scope_ok=0
	fi
	# (b) dpkg-owned paths, and proof that none of them was modified
	docker run --rm -u 0 "$IMG" sh -c 'cat /var/lib/dpkg/info/*.list' >"$WORK/dpkg-owned.txt" 2>/dev/null || true
	if [ ! -s "$WORK/dpkg-owned.txt" ]; then
		fail "could not collect the dpkg file lists from the image"
		scope_ok=0
	fi
	docker run --rm -u 0 "$IMG" sh -c 'dpkg --verify; echo "__VERIFY_RC=$?"' >"$WORK/dpkg-verify.txt" 2>&1 || true
	# dpkg --verify prints "??5?????? [c] <path>" for a checksum mismatch and "missing ..." for deleted files
	modified="$(awk '/^\?\?5/ { print }' "$WORK/dpkg-verify.txt")"
	if ! grep -q '^__VERIFY_RC=' "$WORK/dpkg-verify.txt"; then
		fail "dpkg --verify did not run in the image"
		scope_ok=0
	elif [ -n "$modified" ]; then
		fail "dpkg --verify reports modified package files:"
		head -n 10 <<<"$modified" | indent
		scope_ok=0
	else
		pass "dpkg --verify: no dpkg-owned file was modified ($(awk '/^missing/ { n++ } END { print n + 0 }' "$WORK/dpkg-verify.txt") deleted by hardening)"
	fi
	scan_args=(--keys)
	if [ "$scope_ok" = 1 ]; then scan_args=(--keys --base-diffids "$WORK/base-diffids.txt" --dpkg-list "$WORK/dpkg-owned.txt"); fi
	out="$(save_and_scan "$IMG" real "${scan_args[@]}" 2>&1 || true)"
	if grep -q '^INFO: ' <<<"$out"; then
		echo "INFO: scan hits skipped as third-party content (base image layers / verified dpkg files):"
		grep '^INFO: ' <<<"$out" | indent
	fi
	verdict="$(scan_verdict "$out")"
	if [ "$verdict" != ok ]; then
		fail "real-image key scan is not trustworthy ($verdict): $(tail -n 3 <<<"$out" | tr '\n' '|')"
	elif grep -q '^HIT ' <<<"$out"; then
		fail "real-looking keys found in the runtime image layers (inspect; do not weaken the regex silently):"
		grep -m 20 '^HIT ' <<<"$out" | indent
	else
		pass "no sk-ant-/sk-proj-/AKIA/github_pat_/ghp_/private-key patterns in any runtime image layer ($(awk '/^ENTRIES / { print $2 }' <<<"$out") files scanned)"
	fi
	docker rmi -f "$IMG" >/dev/null 2>&1 || true
else
	fail "real-image key scan skipped: runtime image was not built"
fi

if [ "$SKIP_CANARY" = 1 ]; then
	echo "--- canary scan skipped (--skip-canary) ---"
else
	echo "--- canary secret scan ---"
	CTX="$WORK/canary-ctx"
	MARKER="OSCX_CANARY_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
	mkdir -p "$CTX"
	# Copy the git-visible files (never .env*) so the canary context mirrors the real one.
	(cd "$REPO_ROOT" && git ls-files -z --cached --others --exclude-standard) | node -e '
const fs = require("node:fs"), path = require("node:path");
const [root, dest] = process.argv.slice(1);
const names = fs.readFileSync(0, "utf8").split("\0").filter(Boolean);
for (const n of names) {
	if (/(^|\/)\.env/.test(n) || n.startsWith(".git/")) continue;
	const src = path.join(root, n);
	let st;
	try { st = fs.lstatSync(src); } catch { continue; }
	if (!st.isFile()) continue;
	fs.mkdirSync(path.dirname(path.join(dest, n)), { recursive: true });
	fs.copyFileSync(src, path.join(dest, n));
}' "$REPO_ROOT" "$CTX"
	for f in \
		.env \
		apps/kernel/.env \
		apps/kernel/src/.env \
		apps/console/.env \
		.oscorpex/repos/t1/.env.production \
		apps/kernel/.oscorpex/repos/t1/.env \
		apps/kernel/src/canary.pem \
		docker/claude-cli/.claude.json; do
		mkdir -p "$CTX/$(dirname "$f")"
		printf 'CANARY_SECRET=%s\n' "$MARKER" >"$CTX/$f"
	done
	mkdir -p "$CTX/docker/claude-cli"
	printf '//registry.npmjs.org/:_authToken=%s\n' "$MARKER" >"$CTX/docker/claude-cli/.npmrc"
	if [ ! -f "$CTX/Dockerfile" ] || [ ! -f "$CTX/.dockerignore" ]; then
		fail "canary context lacks Dockerfile or .dockerignore (root Dockerfile missing?)"
	else
		cmp -s "$CTX/.dockerignore" "$REPO_ROOT/.dockerignore" || fail "canary context .dockerignore differs from the real one"
		for target in runtime build; do
			if [ "$target" = runtime ]; then tag="$IMG_CANARY"; else tag="$IMG_CANARY_BUILD"; fi
			if build_image "$CTX" "$tag" "$WORK/canary-$target.log" --target "$target"; then
				pass "canary $target image built"
				out="$(save_and_scan "$tag" "canary-$target" --marker "$MARKER" 2>&1 || true)"
				verdict="$(scan_verdict "$out")"
				if [ "$verdict" != ok ]; then
					fail "canary $target layer scan is not trustworthy ($verdict): $(tail -n 3 <<<"$out" | tr '\n' '|')"
				elif grep -q '^HIT ' <<<"$out"; then
					fail "canary marker found in $target image layers:"
					grep -m 10 '^HIT ' <<<"$out" | indent
				else
					pass "canary marker absent from every $target image layer ($(awk '/^ENTRIES / { print $2 }' <<<"$out") files scanned)"
				fi
				meta="$(docker history --no-trunc "$tag" 2>&1 || true)"
				if grep -Fq "$MARKER" <<<"$meta"; then fail "canary marker in docker history of the $target image"; else pass "canary marker absent from docker history ($target)"; fi
				meta="$(docker inspect "$tag" 2>&1 || true)"
				if grep -Fq "$MARKER" <<<"$meta"; then fail "canary marker in docker inspect of the $target image"; else pass "canary marker absent from docker inspect ($target)"; fi
				docker rmi -f "$tag" >/dev/null 2>&1 || true
			else
				fail "canary $target image build failed (last lines below)"
				tail -n 6 "$WORK/canary-$target.log" | indent
			fi
		done
	fi
fi

finish
