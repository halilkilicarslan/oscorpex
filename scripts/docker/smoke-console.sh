#!/usr/bin/env bash
# Smoke test for the production console image (phase D4): build, static image config, in-image contents,
# then a hardened run behind nginx next to a real kernel + throwaway Postgres (cache/security headers,
# /health + authenticated /api through nginx, WebSocket upgrade incl. the foreign-Origin negative).
#
# Usage: scripts/docker/smoke-console.sh [--no-cache]
#   --no-cache   build the console image with --no-cache (the kernel image always reuses its cache)
#
# Needs a local docker daemon (refuses remote endpoints / non-"docker" buildx drivers) and pulls the pinned
# pgvector image for the throwaway database. Everything it creates has a unique name and is removed on exit.
set -euo pipefail

NO_CACHE=""
for arg in "$@"; do
	case "$arg" in
	--no-cache) NO_CACHE="--no-cache" ;;
	*)
		echo "usage: $0 [--no-cache]" >&2
		exit 2
		;;
	esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oscorpex-smoke-console.XXXXXX")"
RUN="oscx-smokec-$$-$RANDOM"
IMG_C="$RUN-console:runtime"
IMG_K="$RUN-kernel:runtime"
NET="$RUN-net"
PG="$RUN-pg"
KC="$RUN-kernel"
CC="$RUN-console"
V_CLAUDE="$RUN-claude"
V_OSC="$RUN-oscorpex"
V_VOLT="$RUN-voltagent"
PINNED_DIGEST="sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da"
PG_IMAGE="pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f"
MIN_FREE_KB=$((15 * 1024 * 1024)) # docker data root must have this much free space
CONSOLE_DOCKERFILE="$REPO_ROOT/apps/console/Dockerfile"

cleanup() {
	local rc=$?
	docker rm -f "$CC" "$KC" "$PG" >/dev/null 2>&1 || true
	docker volume rm -f "$V_CLAUDE" "$V_OSC" "$V_VOLT" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	docker rmi -f "$IMG_C" "$IMG_K" >/dev/null 2>&1 || true
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
# 4. disk guard
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
if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
	fail "host node and curl are required (JWT minting, HTTP checks)"
	finish
fi

# ---------------------------------------------------------------- static: Dockerfile + nginx sources
echo "--- static checks ---"
if [ -f "$CONSOLE_DOCKERFILE" ]; then
	from_bad=""
	from_count=0
	stages=" "
	has_unpriv=0
	while IFS= read -r line; do
		ref="$(awk '{ i = 2; if ($i ~ /^--/) i++; print $i }' <<<"$line")"
		name="$(awk '{ for (i = 1; i < NF; i++) if (toupper($i) == "AS") print $(i + 1) }' <<<"$line")"
		from_count=$((from_count + 1))
		case "$stages" in
		*" $ref "*) ;;
		*)
			case "$ref" in
			node:*) [ "$ref" = "node:22-bookworm-slim@$PINNED_DIGEST" ] || from_bad="$from_bad $ref" ;;
			*@sha256:*) ;;
			*) from_bad="$from_bad $ref" ;;
			esac
			case "$ref" in nginxinc/nginx-unprivileged:*-alpine@sha256:*) has_unpriv=1 ;; esac
			;;
		esac
		[ -z "$name" ] || stages="$stages$name "
	done < <(grep -Ei '^[[:space:]]*FROM[[:space:]]' "$CONSOLE_DOCKERFILE" || true)
	if [ "$from_count" -gt 0 ] && [ -z "$from_bad" ]; then
		pass "all $from_count console Dockerfile FROM lines are digest-pinned (node: $PINNED_DIGEST) or earlier stages"
	else
		fail "console Dockerfile FROM lines not pinned by @sha256 (or node not the pinned digest):${from_bad:- none parsed}"
	fi
	if [ "$has_unpriv" = 1 ]; then
		pass "runtime FROM is a digest-pinned nginxinc/nginx-unprivileged:<ver>-alpine"
	else
		fail "runtime FROM is not a digest-pinned nginxinc/nginx-unprivileged:<ver>-alpine"
	fi
	if grep -Eiq '^[[:space:]]*HEALTHCHECK[[:space:]]' "$CONSOLE_DOCKERFILE"; then pass "console Dockerfile declares HEALTHCHECK"; else fail "console Dockerfile has no HEALTHCHECK"; fi
	if grep -Eq '(^|[^[:alnum:]_])pnpm[[:space:]].*--filter[[:space:]]+"?console' "$CONSOLE_DOCKERFILE" && ! grep -Fq '@oscorpex/console' "$CONSOLE_DOCKERFILE"; then
		pass "console Dockerfile builds with 'pnpm --filter console' (not @oscorpex/console)"
	else
		fail "console Dockerfile does not build with 'pnpm --filter console ...' (or still mentions @oscorpex/console)"
	fi
else
	fail "apps/console/Dockerfile is missing"
fi
for f in apps/console/nginx/default.conf apps/console/nginx/security-headers.conf; do
	if [ -f "$REPO_ROOT/$f" ]; then pass "$f exists"; else fail "$f is missing"; fi
done

# static checks on apps/console/nginx/default.conf (brace-aware location blocks; includes are inlined)
if [ -f "$REPO_ROOT/apps/console/nginx/default.conf" ]; then
	# The checker lives in a temp file: bash 3.2 cannot parse a heredoc inside a process substitution.
	cat >"$WORK/nginx-static-check.js" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/#.*$/gm, "");
const inline = (body) => {
	let out = body;
	for (const inc of body.matchAll(/include\s+([^;]+);/g)) {
		const f = path.basename(inc[1].trim());
		if (fs.existsSync(path.join(dir, f))) out += "\n" + read(f);
	}
	return out;
};
const conf = inline(read("default.conf"));
const blocks = [];
for (const m of conf.matchAll(/location\s+([^{;]*?)\{/g)) {
	let depth = 1, i = m.index + m[0].length;
	const start = i;
	while (i < conf.length && depth > 0) { if (conf[i] === "{") depth++; else if (conf[i] === "}") depth--; i++; }
	blocks.push({ head: m[1].trim(), body: inline(conf.slice(start, i - 1)) });
}
const out = (ok, msg) => console.log((ok ? "PASS" : "FAIL") + "\t" + msg);
const ws = blocks.find((b) => /\/api\/studio\/ws/.test(b.head));
const api = blocks.find((b) => /^\/api\/?$/.test(b.head));
const health = blocks.find((b) => /^=\s*\/health$/.test(b.head));
const kernel = [api, health].filter(Boolean);
const badCsp = kernel.filter((b) => /(proxy_hide_header|add_header)\s+(Content-Security-Policy|X-Frame-Options)\b/i.test(b.body));
out(kernel.length === 2 && badCsp.length === 0, "nginx /api/ and /health locations exist and neither hide nor add Content-Security-Policy / X-Frame-Options");
out(!!api && /proxy_request_buffering\s+off\s*;/.test(api.body), "nginx /api/ has proxy_request_buffering off");
out(/absolute_redirect\s+off\s*;/.test(conf), "nginx config sets absolute_redirect off");
out(!!ws && /426/.test(ws.body) && /\$http_upgrade/.test(ws.body + conf), "nginx WS location has an upgrade guard (returns 426 for non-websocket upgrades)");
NODE
	while IFS=$'\t' read -r verdict msg; do
		case "$verdict" in
		PASS) pass "$msg" ;;
		FAIL) fail "$msg" ;;
		esac
	done < <(node "$WORK/nginx-static-check.js" "$REPO_ROOT/apps/console/nginx" 2>&1 || echo "FAIL	nginx static check script crashed")
fi
# root dev:console / build:console filters must name the real package
for s in dev:console build:console; do
	v="$(node -e 'const s=require(process.argv[1]).scripts||{};process.stdout.write(s[process.argv[2]]||"")' "$REPO_ROOT/package.json" "$s")"
	case "$v" in
	*"@oscorpex/console"*) fail "root script $s still filters on @oscorpex/console ($v)" ;;
	*"--filter console"*) pass "root script $s filters on 'console'" ;;
	*) fail "root script $s does not filter on 'console' ($v)" ;;
	esac
done

# ---------------------------------------------------------------- a. build
echo "--- build ---"
build_image() { # build_image <tag> <log> [extra args...]
	local tag="$1" log="$2"
	shift 2
	# shellcheck disable=SC2086
	docker buildx build --load --progress=plain "$@" -t "$tag" "$REPO_ROOT" >"$log" 2>&1
}
HAVE_C=0
HAVE_K=0
t0=$SECONDS
# context = repo root; BuildKit picks apps/console/Dockerfile.dockerignore next to the Dockerfile
# shellcheck disable=SC2086
if build_image "$IMG_C" "$WORK/build-console.log" $NO_CACHE -f "$CONSOLE_DOCKERFILE"; then
	HAVE_C=1
	pass "console image built (-f apps/console/Dockerfile, repo-root context) in $((SECONDS - t0))s${NO_CACHE:+ (no cache)}"
else
	fail "console image build failed after $((SECONDS - t0))s (last lines below)"
	tail -n 8 "$WORK/build-console.log" | indent
fi
t0=$SECONDS
if build_image "$IMG_K" "$WORK/build-kernel.log" -f "$REPO_ROOT/Dockerfile"; then
	HAVE_K=1
	pass "kernel image built (root Dockerfile, cached from D3) in $((SECONDS - t0))s"
else
	fail "kernel image build failed after $((SECONDS - t0))s (last lines below)"
	tail -n 8 "$WORK/build-kernel.log" | indent
fi

# ---------------------------------------------------------------- b. image config + contents
echo "--- image config ---"
if [ "$HAVE_C" = 1 ]; then
	user="$(docker inspect --format '{{.Config.User}}' "$IMG_C")"
	case "$user" in
	101 | 101:* | nginx | nginx:*) pass "Config.User is non-root ($user)" ;;
	*) fail "Config.User is '${user:-<empty = root>}', expected 101 or nginx" ;;
	esac
	hc="$(docker inspect --format '{{if .Config.Healthcheck}}{{json .Config.Healthcheck.Test}}{{end}}' "$IMG_C")"
	if [ -n "$hc" ] && grep -Fq 8080 <<<"$hc"; then pass "HEALTHCHECK defined and targets 8080"; else fail "HEALTHCHECK missing or does not target 8080 ($hc)"; fi
	ports="$(docker inspect --format '{{json .Config.ExposedPorts}}' "$IMG_C")"
	if grep -Fq '8080/tcp' <<<"$ports" && ! grep -Fq '"80/tcp"' <<<"$ports"; then pass "image exposes 8080 only"; else fail "ExposedPorts is $ports (expected 8080/tcp only)"; fi
	envs="$(docker inspect --format '{{json .Config.Env}}' "$IMG_C")"
	if grep -Eiq 'sk-ant-|OPENAI|SECRET|PASSWORD|API_KEY' <<<"$envs"; then fail "image Config.Env mentions a secret-looking variable"; else pass "image Config.Env has no secret-looking variable"; fi

	echo "--- image contents ---"
	img_sh() { docker run --rm --network none --entrypoint sh "$IMG_C" -c "$1; echo __END__" 2>&1 || true; }
	out="$(img_sh 'id -u; id -un')"
	if grep -q '^101$' <<<"$out"; then pass "default process uid is 101"; else fail "default uid is not 101 ($(tr '\n' ' ' <<<"$out"))"; fi
	out="$(img_sh 'for b in node pnpm npm npx corepack yarn; do command -v $b; done')"
	bins="$(grep -v '^__END__$' <<<"$out" || true)"
	if [ -z "$bins" ]; then pass "no node/pnpm/npm/yarn in the runtime image"; else fail "runtime image ships build tooling: $(tr '\n' ' ' <<<"$bins")"; fi
	stray_cmd="$(cat <<'SH'
awk '/^F:/ { d = substr($0, 3); next } /^R:/ { print (d == "" ? "" : "/" d) "/" substr($0, 3) }' /lib/apk/db/installed >/tmp/apk-owned 2>/dev/null || : >/tmp/apk-owned
find / -xdev \( -name ".env*" -o -name "*.pem" -o -name "id_rsa*" -o -name ".npmrc" -o -name "pnpm-lock.yaml" -o -name "package.json" -o -name "*.ts" -o -name "*.tsx" \) -not -path "/proc/*" 2>/dev/null | while IFS= read -r f; do grep -qxF "$f" /tmp/apk-owned || echo "$f"; done | head -n 20
SH
)"
	out="$(img_sh "$stray_cmd")" # files owned by apk packages (e.g. the CA bundle) are legitimate
	stray="$(grep -v '^__END__$' <<<"$out" || true)"
	if [ -z "$stray" ]; then pass "no env files, keys, manifests or TypeScript sources in the runtime image"; else fail "runtime image has stray files: $(tr '\n' ' ' <<<"$stray")"; fi
	out="$(img_sh 'test -f /usr/share/nginx/html/index.html && echo INDEX_OK; ls /usr/share/nginx/html/assets 2>/dev/null | head -n 3; find /usr/share/nginx/html -name "*.map" | wc -l')"
	if grep -q '^INDEX_OK$' <<<"$out"; then pass "index.html is in /usr/share/nginx/html"; else fail "/usr/share/nginx/html/index.html is missing"; fi
	echo "NOTE: source maps in the runtime image: $(grep -E '^[[:space:]]*[0-9]+$' <<<"$out" | tail -n 1 | tr -d ' ')"
	out="$(img_sh 'find /usr/share/nginx/html /etc/nginx -exec sh -c '\''for f; do [ -w "$f" ] && echo "$f"; done'\'' sh {} +')"
	writable="$(grep -v '^__END__$' <<<"$out" || true)"
	if [ -z "$writable" ]; then pass "uid 101 cannot write /usr/share/nginx/html or /etc/nginx"; else fail "writable for uid 101: $(head -n 5 <<<"$writable" | tr '\n' ' ')"; fi
	out="$(img_sh 'find / -xdev -perm /6000 -type f 2>/dev/null | head -n 10')"
	suid="$(grep -v '^__END__$' <<<"$out" || true)"
	if [ -z "$suid" ]; then pass "no setuid/setgid files"; else fail "setuid/setgid files: $(tr '\n' ' ' <<<"$suid")"; fi
	if docker run --rm --network none --entrypoint nginx "$IMG_C" -t >"$WORK/nginx-t.log" 2>&1; then
		pass "nginx -t passes without a resolvable backend (variables + resolver)"
	else
		fail "nginx -t failed without a backend ($(tail -n 2 "$WORK/nginx-t.log" | tr '\n' '|'))"
	fi
	docker run --rm --network none --entrypoint cat "$IMG_C" /etc/nginx/conf.d/default.conf >"$WORK/default.conf" 2>/dev/null || : >"$WORK/default.conf"
	if grep -Eq '^[[:space:]]*server_tokens[[:space:]]+off' "$WORK/default.conf" || docker run --rm --network none --entrypoint sh "$IMG_C" -c 'cat /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf' 2>/dev/null | grep -Eq 'server_tokens[[:space:]]+off'; then
		pass "nginx config sets server_tokens off"
	else
		fail "nginx config does not set server_tokens off"
	fi
	if grep -Eq 'resolver[[:space:]]+127\.0\.0\.11' "$WORK/default.conf"; then pass "nginx config uses resolver 127.0.0.11"; else fail "nginx config has no 'resolver 127.0.0.11'"; fi
else
	fail "image config and contents checks skipped: console image was not built"
fi

# ---------------------------------------------------------------- c. runtime behind nginx
if [ "$HAVE_C" != 1 ] || [ "$HAVE_K" != 1 ]; then
	fail "runtime checks skipped: console and/or kernel image was not built"
	finish
fi
echo "--- runtime behind nginx ---"
free_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
PORT="$free_port"
ORIGIN="http://localhost:$PORT"
BASE="http://127.0.0.1:$PORT"
JWT_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$JWT_SECRET"
PGPW="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$PGPW"
URL="postgresql://postgres:$PGPW@$PG:5432/oscorpex"

docker network create "$NET" >/dev/null
docker volume create "$V_CLAUDE" >/dev/null
docker volume create "$V_OSC" >/dev/null
docker volume create "$V_VOLT" >/dev/null
if ! docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD="$PGPW" -e POSTGRES_DB=oscorpex \
	"$PG_IMAGE" >"$WORK/pg-start.log" 2>&1; then
	fail "postgres container did not start ($(tail -n 2 "$WORK/pg-start.log" | tr '\n' '|'))"
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
	fail "postgres did not become ready"
	finish
fi
printf 'NODE_ENV=production\nOSCORPEX_MIGRATION_DATABASE_URL=%s\nDATABASE_URL=%s\n' "$URL" "$URL" >"$WORK/migrate.env"
printf 'DATABASE_URL=%s\nOSCORPEX_JWT_SECRET=%s\nOSCORPEX_AUTH_ENABLED=true\nOSCORPEX_CORS_ORIGINS=%s\nOSCORPEX_TRUSTED_PROXY=true\n' "$URL" "$JWT_SECRET" "$ORIGIN" >"$WORK/kernel.env"
if docker run --rm --network "$NET" --env-file "$WORK/migrate.env" "$IMG_K" node dist/migrate.js >"$WORK/migrate.log" 2>&1; then
	pass "migrate run exits 0"
else
	fail "migrate run failed ($(tail -n 3 "$WORK/migrate.log" | tr '\n' '|'))"
	finish
fi
# kernel: same hardened flags as smoke-kernel, reachable as "backend" for nginx
if ! docker run -d --name "$KC" --network "$NET" --network-alias backend \
	--read-only --tmpfs /tmp:exec,size=512m --tmpfs /home/oscorpex:exec,size=256m,uid=1001,gid=1001,mode=0700 \
	-v "$V_CLAUDE":/home/oscorpex/.claude -v "$V_OSC":/app/.oscorpex -v "$V_VOLT":/app/.voltagent \
	--cap-drop ALL --security-opt no-new-privileges:true \
	--env-file "$WORK/kernel.env" "$IMG_K" >"$WORK/k-start.log" 2>&1; then
	fail "kernel container did not start ($(tail -n 2 "$WORK/k-start.log" | tr '\n' '|'))"
	finish
fi
health=""
for _ in $(seq 1 90); do
	health="$(docker inspect --format '{{.State.Health.Status}}' "$KC" 2>/dev/null || true)"
	[ "$health" = healthy ] && break
	[ "$(docker inspect --format '{{.State.Running}}' "$KC" 2>/dev/null || echo false)" = true ] || break
	sleep 2
done
if [ "$health" = healthy ]; then pass "kernel container becomes healthy"; else
	fail "kernel container health is '${health:-unknown}'"
	docker logs --tail 15 "$KC" 2>&1 | { grep -viE 'secret|password|database_url|token|api_key' || true; } | indent
	finish
fi
if [ "$(docker exec "$KC" printenv OSCORPEX_TRUSTED_PROXY 2>/dev/null || true)" = true ]; then pass "kernel container has OSCORPEX_TRUSTED_PROXY=true"; else fail "kernel container env lacks OSCORPEX_TRUSTED_PROXY=true"; fi
# console: started AFTER the kernel here, but nginx must not depend on it (variables + resolver)
if ! docker run -d --name "$CC" --network "$NET" -p "127.0.0.1:$PORT:8080" \
	--read-only --tmpfs /tmp:size=64m --cap-drop ALL --security-opt no-new-privileges:true \
	"$IMG_C" >"$WORK/c-start.log" 2>&1; then
	fail "console container did not start ($(tail -n 2 "$WORK/c-start.log" | tr '\n' '|'))"
	finish
fi
health=""
for _ in $(seq 1 45); do
	health="$(docker inspect --format '{{.State.Health.Status}}' "$CC" 2>/dev/null || true)"
	[ "$health" = healthy ] && break
	[ "$(docker inspect --format '{{.State.Running}}' "$CC" 2>/dev/null || echo false)" = true ] || break
	sleep 2
done
if [ "$health" = healthy ]; then pass "console container becomes healthy (read-only rootfs, cap-drop ALL, no-new-privileges)"; else
	fail "console container health is '${health:-unknown}'"
	docker logs --tail 15 "$CC" 2>&1 | { grep -viE 'secret|password|database_url|token|api_key' || true; } | indent
	finish
fi

echo "--- console container hardening ---"
cuid="$(docker exec "$CC" id -u 2>/dev/null || true)"
if [ "$cuid" = 101 ]; then pass "console container runs as uid 101"; else fail "console container uid is '$cuid' (expected 101)"; fi
status="$(docker exec "$CC" cat /proc/1/status 2>/dev/null || true)"
capeff="$(awk '/^CapEff:/ { print $2 }' <<<"$status")"
nnp="$(awk '/^NoNewPrivs:/ { print $2 }' <<<"$status")"
if [ "$capeff" = 0000000000000000 ]; then pass "/proc/1/status CapEff is 0"; else fail "CapEff is '$capeff' (expected 0000000000000000)"; fi
if [ "$nnp" = 1 ]; then pass "/proc/1/status NoNewPrivs is 1"; else fail "NoNewPrivs is '$nnp' (expected 1)"; fi
ro="$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$CC")"
if [ "$ro" = true ] && ! docker exec "$CC" sh -c 'touch /usr/share/nginx/html/x 2>/dev/null' && docker exec "$CC" sh -c 'touch /tmp/x'; then
	pass "rootfs is read-only; only /tmp is writable"
else
	fail "rootfs read-only check failed (ReadonlyRootfs=$ro)"
fi

echo "--- HTTP through nginx ---"
# http <name> <path> [curl args...]: headers -> $WORK/<name>.h (CR stripped), body -> $WORK/<name>.b, status in $HTTP_CODE
http() {
	local name="$1" path="$2"
	shift 2
	HTTP_CODE="$(curl -sS --max-time 15 -o "$WORK/$name.b" -D "$WORK/$name.h.raw" -w '%{http_code}' "$@" "$BASE$path" 2>"$WORK/$name.err" || true)"
	tr -d '\r' <"$WORK/$name.h.raw" >"$WORK/$name.h" 2>/dev/null || : >"$WORK/$name.h"
}
hdr() { awk -v k="$(tr 'A-Z' 'a-z' <<<"$2")" 'BEGIN { FS = ": " } { n = tolower($1); if (n == k) { sub(/^[^:]*: */, ""); print } }' "$WORK/$1.h"; }
# sec_headers <label> <name>: every security header from the plan, present on that response
sec_headers() {
	local label="$1" name="$2" csp pp miss=""
	csp="$(hdr "$name" content-security-policy)"
	for d in "default-src 'self'" "script-src 'self'" "img-src 'self' data: blob:" "font-src 'self' data:" "connect-src 'self'" "frame-src 'self'" "object-src 'none'" "base-uri 'self'" "form-action 'self'" "frame-ancestors 'none'"; do
		grep -Fq "$d" <<<"$csp" || miss="$miss [CSP:$d]"
	done
	[ "$(hdr "$name" x-content-type-options | tr 'A-Z' 'a-z')" = nosniff ] || miss="$miss [X-Content-Type-Options]"
	[ "$(hdr "$name" x-frame-options | tr 'a-z' 'A-Z' | head -n 1)" = DENY ] || miss="$miss [X-Frame-Options]"
	case "$(hdr "$name" referrer-policy | head -n 1)" in strict-origin-when-cross-origin | no-referrer) ;; *) miss="$miss [Referrer-Policy]" ;; esac
	pp="$(hdr "$name" permissions-policy)"
	for d in 'camera=()' 'microphone=()' 'geolocation=()'; do grep -Fq "$d" <<<"$pp" || miss="$miss [Permissions-Policy:$d]"; done
	if [ -z "$miss" ]; then pass "security headers complete on $label"; else fail "security headers missing on $label:$miss"; fi
}

# sec_headers_min <label> <name>: kernel responses only carry the three headers nginx guarantees
sec_headers_min() {
	local label="$1" name="$2" miss=""
	[ "$(hdr "$name" x-content-type-options | tr 'A-Z' 'a-z')" = nosniff ] || miss="$miss [X-Content-Type-Options]"
	[ -n "$(hdr "$name" referrer-policy)" ] || miss="$miss [Referrer-Policy]"
	[ -n "$(hdr "$name" permissions-policy)" ] || miss="$miss [Permissions-Policy]"
	if [ -z "$miss" ]; then pass "nosniff/Referrer-Policy/Permissions-Policy present on $label"; else fail "guaranteed headers missing on $label:$miss"; fi
}
# kernel_passthrough <label> <name> <path> [bearer]: the kernel's own CSP / X-Frame-Options (its preview proxy sets a
# sandbox CSP and must stay frameable by the console) must reach the browser untouched: compare with a direct request
kernel_passthrough() {
	local label="$1" name="$2" path="$3" bearer="${4:-}" direct via h
	direct="$(docker exec -e P="$path" -e B="$bearer" -e O="$ORIGIN" "$KC" node -e '
const h = { Origin: process.env.O };
if (process.env.B) h.Authorization = "Bearer " + process.env.B;
fetch("http://127.0.0.1:3141" + process.env.P, { headers: h }).then((r) => {
	console.log("csp=" + (r.headers.get("content-security-policy") || ""));
	console.log("xfo=" + (r.headers.get("x-frame-options") || ""));
}).catch(() => process.exit(1));
' 2>/dev/null || echo "direct-request-failed")"
	via="csp=$(hdr "$name" content-security-policy | paste -sd, -)
xfo=$(hdr "$name" x-frame-options | paste -sd, -)"
	if [ "$direct" = "$via" ]; then pass "kernel CSP/X-Frame-Options pass through nginx unchanged on $label"; else
		fail "CSP/X-Frame-Options differ on $label: direct [$(tr '\n' ' ' <<<"$direct")] vs via nginx [$(tr '\n' ' ' <<<"$via")]"
	fi
}

# api_headers <label> <name> <path> [bearer]: /api responses: kernel X-Frame-Options passes through (present, equal to
# direct), Cache-Control is exactly no-store, no Expires
api_headers() {
	local label="$1" name="$2" path="$3" bearer="${4:-}" direct_xfo via_xfo
	direct_xfo="$(docker exec -e P="$path" -e B="$bearer" -e O="$ORIGIN" "$KC" node -e '
const h = { Origin: process.env.O };
if (process.env.B) h.Authorization = "Bearer " + process.env.B;
fetch("http://127.0.0.1:3141" + process.env.P, { headers: h }).then((r) => process.stdout.write(r.headers.get("x-frame-options") || "")).catch(() => process.exit(1));
' 2>/dev/null || true)"
	via_xfo="$(hdr "$name" x-frame-options | paste -sd, -)"
	if [ -n "$via_xfo" ] && [ "$via_xfo" = "$direct_xfo" ]; then pass "kernel X-Frame-Options ('$via_xfo') present and unchanged on $label"; else fail "X-Frame-Options on $label: via nginx '$via_xfo', direct '$direct_xfo' (expected present and equal)"; fi
	if [ "$(hdr "$name" cache-control | paste -sd, -)" = no-store ]; then pass "Cache-Control is exactly no-store on $label"; else fail "Cache-Control on $label is '$(hdr "$name" cache-control | paste -sd, -)' (expected no-store)"; fi
	if [ -z "$(hdr "$name" expires)" ]; then pass "no Expires header forwarded on $label"; else fail "Expires header forwarded on $label ('$(hdr "$name" expires)')"; fi
}

http root /
if [ "$HTTP_CODE" = 200 ] && grep -Fq '<div id="root">' "$WORK/root.b"; then pass "/ returns 200 with <div id=\"root\">"; else fail "/ returned $HTTP_CODE, root div present: $(grep -Fc '<div id="root">' "$WORK/root.b" || true)"; fi
if grep -Fq 'no-cache' <<<"$(hdr root cache-control)"; then pass "/ Cache-Control contains no-cache"; else fail "/ Cache-Control is '$(hdr root cache-control)'"; fi
http index /index.html
if [ "$HTTP_CODE" = 200 ] && grep -Fq 'no-cache' <<<"$(hdr index cache-control)"; then pass "/index.html is 200 with Cache-Control no-cache"; else fail "/index.html: $HTTP_CODE, Cache-Control '$(hdr index cache-control)'"; fi
grep -Eo '/assets/[^"'\'' )]+\.(js|css)' "$WORK/root.b" >"$WORK/assets.txt" || true
ASSET="$(awk 'NR == 1' "$WORK/assets.txt")"
if [ -n "$ASSET" ]; then
	http asset "$ASSET"
	cc="$(hdr asset cache-control)"
	age="$(sed -n 's/.*max-age=\([0-9][0-9]*\).*/\1/p' <<<"$cc")"
	if [ "$HTTP_CODE" = 200 ] && grep -Fq immutable <<<"$cc" && [ "${age:-0}" -ge 31536000 ]; then pass "$ASSET is 200 with immutable + max-age>=1y ($cc)"; else fail "$ASSET: $HTTP_CODE, Cache-Control '$cc'"; fi
	sec_headers "$ASSET" asset
else
	fail "no /assets/*.js|css reference found in index.html"
fi
sec_headers "/" root
http missing /assets/does-not-exist-$RANDOM.js
if [ "$HTTP_CODE" = 404 ]; then pass "missing /assets file is 404 (no SPA fallback for assets)"; else fail "missing /assets file returned $HTTP_CODE (expected 404)"; fi
sec_headers "a 404 response (nginx error page)" missing
mcc="$(hdr missing cache-control)"
mage="$(sed -n 's/.*max-age=\([0-9][0-9]*\).*/\1/p' <<<"$mcc")"
if grep -Fq immutable <<<"$mcc" || [ "${mage:-0}" -ge 86400 ]; then fail "missing /assets 404 carries a long-lived Cache-Control ('$mcc')"; else pass "missing /assets 404 is not cached long-term ('${mcc:-none}')"; fi
# GET /api without the trailing slash: no absolute redirect leaking the internal :8080
http apinoslash /api
loc="$(hdr apinoslash location)"
case "$loc" in
*:8080*) fail "GET /api redirects to an absolute URL with the internal port ($loc)" ;;
*) pass "GET /api does not redirect to :8080 (${loc:-no redirect}, status $HTTP_CODE)" ;;
esac
# the console's real auth path (root /api/auth) must refuse foreign browser origins before the handler runs
http regevil /api/auth/register -X POST -H 'Content-Type: application/json' -H 'Origin: http://evil.example' -d '{"email":"evil@smoke.test","password":"x"}'
if [ "$HTTP_CODE" = 403 ]; then pass "POST /api/auth/register with a foreign Origin is 403 through nginx"; else fail "POST /api/auth/register with a foreign Origin returned $HTTP_CODE (expected 403)"; fi
http regok /api/auth/register -X POST -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -d '{}'
if [ "$HTTP_CODE" != 403 ] && [ "$HTTP_CODE" != 000 ]; then pass "POST /api/auth/register with the allowed Origin and an invalid body is handled ($HTTP_CODE, not 403)"; else fail "POST /api/auth/register with the allowed Origin returned $HTTP_CODE"; fi
http unauth /api/studio/projects
if [ "$HTTP_CODE" = 401 ]; then pass "unauthenticated /api/studio/projects is 401 through nginx"; else fail "unauthenticated /api/studio/projects returned $HTTP_CODE (expected 401)"; fi
sec_headers_min "a proxied /api/studio 401 response" unauth
kernel_passthrough "a proxied /api/studio 401 response" unauth /api/studio/projects
api_headers "a proxied /api/studio 401 response" unauth /api/studio/projects
http health /health
if [ "$HTTP_CODE" = 200 ]; then pass "/health returns 200 through nginx"; else fail "/health returned $HTTP_CODE"; fi
sec_headers_min "/health" health
kernel_passthrough "/health" health /health
server_leak=0
for n in root asset missing unauth health; do
	[ -f "$WORK/$n.h" ] || continue
	sv="$(hdr "$n" server)"
	case "$sv" in
	*[0-9]*)
		fail "Server header on $n leaks a version ('$sv')"
		server_leak=1
		;;
	*) ;;
	esac
done
if [ "$server_leak" = 0 ]; then pass "Server header carries no version on any checked response"; fi

echo "--- authenticated API + WebSocket ---"
TENANT="smokec-$RANDOM"
UID_="smokec-user-$RANDOM"
EMAIL="$UID_@smoke.test"
if docker exec "$PG" psql -U postgres -d oscorpex -qAt -v ON_ERROR_STOP=1 \
	-c "INSERT INTO tenants (id, name, slug) VALUES ('$TENANT', '$TENANT', '$TENANT') ON CONFLICT DO NOTHING" \
	-c "INSERT INTO users (id, email, password_hash, tenant_id, is_platform_admin) VALUES ('$UID_', '$EMAIL', 'x', '$TENANT', false) ON CONFLICT DO NOTHING" \
	-c "INSERT INTO user_roles (user_id, tenant_id, role) VALUES ('$UID_', '$TENANT', 'owner') ON CONFLICT DO NOTHING" >"$WORK/seed.log" 2>&1; then
	pass "seeded tenant, user and user_roles rows"
else
	fail "seeding the user failed ($(tail -n 2 "$WORK/seed.log" | tr '\n' '|'))"
fi
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
http me /api/studio/auth/me -H "Authorization: Bearer $TOKEN" -H "Origin: $ORIGIN"
if [ "$HTTP_CODE" = 200 ]; then pass "authenticated GET /api/studio/auth/me reaches the kernel through nginx (200)"; else fail "authenticated /api/studio/auth/me returned $HTTP_CODE ($(head -c 200 "$WORK/me.b"))"; fi
sec_headers_min "an authenticated proxied /api response" me
kernel_passthrough "an authenticated proxied /api response" me /api/studio/auth/me "$TOKEN"
api_headers "an authenticated proxied /api response" me /api/studio/auth/me "$TOKEN"
echo "NOTE: SSE buffering check skipped: the SSE endpoints (task log stream) need a seeded project + running task; proxy_buffering off is covered by the config review only"

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
if [ -n "$T1" ]; then pass "POST /api/studio/ws/ticket through nginx returns a ticket"; else fail "no ticket returned through nginx"; fi
st="$(ws_status "$ORIGIN" "$T1")"
case "$st" in
*" 101 "*) pass "WebSocket through nginx with the allowed Origin returns 101" ;;
*) fail "WebSocket with allowed Origin: '$st' (expected 101)" ;;
esac
T2="$(ticket_for "$ORIGIN")"
st="$(ws_status "http://evil.example" "$T2")"
case "$st" in
*" 101 "*) fail "WebSocket with a foreign Origin was upgraded ($st)" ;;
*" 403 "*) pass "WebSocket with a foreign Origin is rejected (403)" ;;
*) fail "WebSocket with a foreign Origin: '$st' (expected 403)" ;;
esac

# an h2c upgrade must be refused at the WS location, never proxied
h2c="$(curl -sS -i --http1.1 --max-time 5 -o "$WORK/h2c.out" -H 'Connection: Upgrade, HTTP2-Settings' -H 'Upgrade: h2c' -H 'HTTP2-Settings: AAMAAABkAAQAoAAAAAIAAAAA' -H "Origin: $ORIGIN" "$BASE/api/studio/ws" >/dev/null 2>&1; tr -d '\r' <"$WORK/h2c.out" | awk 'NR == 1')"
case "$h2c" in
*" 426 "*) pass "Upgrade: h2c on the WS location is refused with 426" ;;
*) fail "Upgrade: h2c on the WS location: '$h2c' (expected 426)" ;;
esac
# tickets travel in the query string: nginx must not write them to its logs
docker logs "$CC" >"$WORK/console.log" 2>&1 || true
if grep -Fq 'ticket=' "$WORK/console.log"; then fail "console container logs contain a 'ticket=' string"; else pass "console container logs contain no ticket= string"; fi

finish
