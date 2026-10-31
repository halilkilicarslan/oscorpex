#!/usr/bin/env bash
# Verifies the pnpm pin (packageManager + lockfile + corepack in a Node 22 container) and CI hardening.
#
# Usage: scripts/docker/check-toolchain.sh [--install] [--lockfile <path>] [--workspace <path>]
#   --install   slow: in a node:22-bookworm-slim container with the root build context and the real root
#               .dockerignore, run `corepack enable` then `pnpm install --frozen-lockfile` (the FIRST pnpm
#               call) and assert the lockfile is unchanged afterwards.
#   --lockfile  use <path> instead of the repo's pnpm-lock.yaml for the lockfile and container checks
#               (read-only; proves the checks catch an old lockfile, e.g. `git show HEAD:pnpm-lock.yaml`).
#   --workspace use <path> instead of the repo's pnpm-workspace.yaml for the pmOnFail and container checks.
set -euo pipefail

INSTALL=0
LOCKFILE=""
WORKSPACE=""
usage() {
	echo "usage: $0 [--install] [--lockfile <path>] [--workspace <path>]" >&2
	exit 2
}
while [ $# -gt 0 ]; do
	case "$1" in
	--install) INSTALL=1 ;;
	--lockfile)
		[ $# -ge 2 ] || usage
		LOCKFILE="$2"
		shift
		;;
	--workspace)
		[ $# -ge 2 ] || usage
		WORKSPACE="$2"
		shift
		;;
	*) usage ;;
	esac
	shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oscorpex-tool.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1"
	FAILS=$((FAILS + 1))
}

PNPM_VERSION="12.6.0"
PNPM_PIN="pnpm@12.6.0+sha512.3ef68f951cb111ac204b4a5a16f0b2ddf0da56a96e0413e81d855d9f0b55ef926714709028e1cd00c405c2c5fb7b9e8ec4dc46777c805d0373c2f2ff00fd20ec"
CI_YML="${OSCORPEX_CI_YML:-$REPO_ROOT/.github/workflows/ci.yml}" # env override is a test hook
[ -n "$LOCKFILE" ] || LOCKFILE="$REPO_ROOT/pnpm-lock.yaml"
[ -n "$WORKSPACE" ] || WORKSPACE="$REPO_ROOT/pnpm-workspace.yaml"

# --- packageManager pin ---
actual_pin="$(cd "$REPO_ROOT" && node -e 'const p=require("./package.json");process.stdout.write(p.packageManager||"")')"
if [ "$actual_pin" = "$PNPM_PIN" ]; then
	pass "package.json packageManager is pinned to $PNPM_VERSION with sha512"
else
	fail "package.json packageManager is '${actual_pin:-<unset>}', expected the $PNPM_VERSION pin with sha512"
fi

# --- pmOnFail: ignore stops pnpm 12 from writing packageManagerDependencies into the lockfile ---
if grep -Eq '^pmOnFail:[[:space:]]*["'\'']?ignore["'\'']?[[:space:]]*(#.*)?$' "$WORKSPACE"; then
	pass "pnpm-workspace.yaml has a top-level 'pmOnFail: ignore'"
else
	fail "pnpm-workspace.yaml has no top-level 'pmOnFail: ignore' line"
fi

# --- lockfile is a single YAML document with the real graph ---
# A scanner that reads only the first YAML document (osv-scanner) must see every importer and package, so no
# leading boot document (packageManagerDependencies) is allowed.
LOCK_REPORT="$WORK/lock-report.txt"
node - "$LOCKFILE" >"$LOCK_REPORT" <<'NODE'
const fs = require("node:fs");
const out = (ok, msg) => console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`);
const text = fs.readFileSync(process.argv[2], "utf8");
const lines = text.split("\n");
out(!lines.some((l) => l === "---"), "pnpm-lock.yaml is a single YAML document (no line that is exactly '---')");
const firstLine = lines.find((l) => l.trim() !== "") || "";
out(/^lockfileVersion:/.test(firstLine), "pnpm-lock.yaml's first non-empty line is 'lockfileVersion: ...'");
out(!/packageManagerDependencies/.test(text), "pnpm-lock.yaml has no packageManagerDependencies");
// first document = everything before a `---` that is not the very first line; root importer must list deps
const start = lines[0] === "---" ? 1 : 0;
let end = lines.findIndex((l, i) => i >= start && l === "---");
if (end < 0) end = lines.length;
const first = lines.slice(start, end).join("\n");
const root = first.match(/^importers:[ ]*\n(?:[ ]*\n)*[ ]{2}\.:[ ]*\n((?:[ ]{4,}.*\n|[ ]*\n)*)/m);
out(!!root && /^[ ]{4}(dependencies|devDependencies):/m.test(root[1]), "first document's root importer ('.') lists dependencies/devDependencies (a first-document-only scanner sees the real graph)");
NODE
cat "$LOCK_REPORT"
FAILS=$((FAILS + $(grep -c '^FAIL' "$LOCK_REPORT" || true)))

# --- container: corepack resolves the pinned pnpm and does not rewrite the lockfile (fast, no install) ---
if command -v docker >/dev/null 2>&1; then
	fast_dir="$WORK/fast"
	mkdir -p "$fast_dir/ctx"
	cp "$REPO_ROOT/package.json" "$fast_dir/ctx/"
	cp "$WORKSPACE" "$fast_dir/ctx/pnpm-workspace.yaml"
	cp "$LOCKFILE" "$fast_dir/ctx/pnpm-lock.yaml"
	cat >"$fast_dir/probe.Dockerfile" <<'EOF'
FROM node:22-bookworm-slim AS probe
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN sha256sum pnpm-lock.yaml > /lock.before
RUN corepack enable && pnpm --version > /pnpm-version.txt
RUN sha256sum pnpm-lock.yaml > /lock.after
FROM scratch
COPY --from=probe /pnpm-version.txt /lock.before /lock.after /
EOF
	if docker buildx build --no-cache --progress=plain --output "type=local,dest=$fast_dir/out" \
		-f "$fast_dir/probe.Dockerfile" "$fast_dir/ctx" >"$fast_dir/build.log" 2>&1; then
		got="$(tr -d '[:space:]' <"$fast_dir/out/pnpm-version.txt")"
		if [ "$got" = "$PNPM_VERSION" ]; then
			pass "container (node 22): corepack enable && pnpm --version == $PNPM_VERSION"
		else
			fail "container (node 22): pnpm --version printed '$got', expected $PNPM_VERSION"
		fi
		if [ "$(cut -d' ' -f1 <"$fast_dir/out/lock.before")" = "$(cut -d' ' -f1 <"$fast_dir/out/lock.after")" ]; then
			pass "container: pnpm-lock.yaml is byte-identical after corepack enable && pnpm --version"
		else
			fail "container: pnpm rewrote pnpm-lock.yaml (needs pmOnFail: ignore in pnpm-workspace.yaml and a single-document lockfile)"
		fi
	else
		fail "container (node 22): corepack/pnpm probe build failed"
		grep -E 'ERR_|ERROR|error' "$fast_dir/build.log" | head -n 6 | sed 's/^/        /' || true
	fi
else
	fail "docker is not installed (container pnpm check needs it)"
fi

# Informational only. The host pnpm is never invoked: corepack could rewrite the real lockfile, and
# the host Node may be too old for pnpm 12 (images and CI use Node 22).
if command -v corepack >/dev/null 2>&1; then
	echo "NOTE: host node $(node --version), corepack $(corepack --version)"
else
	echo "NOTE: host has no corepack (node $(node --version))"
fi

# --- ci.yml checks (indentation-robust line parser in node) ---
if [ ! -f "$CI_YML" ]; then
	fail ".github/workflows/ci.yml is missing"
else
	CI_REPORT="$WORK/ci-report.txt"
	node - "$CI_YML" "$PNPM_VERSION" >"$CI_REPORT" <<'NODE'
const fs = require("node:fs");
const [file, want] = process.argv.slice(2);
const lines = fs.readFileSync(file, "utf8").split("\n");
const indent = (l) => l.match(/^ */)[0].length;
const isBlank = (l) => /^\s*(#.*)?$/.test(l);
const out = (ok, msg) => console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`);

// top-level permissions block: key at column 0
const permIdx = lines.findIndex((l) => /^permissions\s*:/.test(l));
if (permIdx < 0) {
	out(false, "ci.yml has no top-level permissions: block");
} else {
	const inline = lines[permIdx].replace(/^permissions\s*:\s*/, "").replace(/#.*$/, "").trim();
	const grants = [];
	if (inline) grants.push(inline);
	for (let i = permIdx + 1; i < lines.length && (isBlank(lines[i]) || indent(lines[i]) > 0); i++) {
		if (!isBlank(lines[i])) grants.push(lines[i].replace(/#.*$/, "").trim());
	}
	out(grants.some((g) => /^contents\s*:\s*read$/.test(g)), "ci.yml top-level permissions grants contents: read");
}

// no write grants anywhere: block, quoted, flow-style ({contents: write}) and write-all
const code = lines.map((l, i) => [l.replace(/\s#.*$/, "").replace(/^\s*#.*$/, ""), i + 1]);
const writes = code.filter(
	([l]) =>
		!/^\s*(name|run)\s*:/.test(l) &&
		(/:\s*["']?write(-all)?["']?\s*(,|\}|$)/.test(l) || /permissions\s*:\s*\{[^}]*write/.test(l) || /permissions\s*:\s*["']?write-all/.test(l)),
);
out(writes.length === 0, `ci.yml has no write permission grants${writes.length ? ` (lines ${writes.map((w) => w[1]).join(",")})` : ""}`);

// on: must not use pull_request_target / workflow_run
const onIdx = lines.findIndex((l) => /^["']?on["']?\s*:/.test(l));
const risky = [];
if (onIdx >= 0) {
	for (let i = onIdx; i < lines.length; i++) {
		if (i > onIdx && !isBlank(lines[i]) && indent(lines[i]) === 0) break;
		if (/\b(pull_request_target|workflow_run)\b/.test(code[i][0])) risky.push(i + 1);
	}
}
out(onIdx >= 0 && risky.length === 0, `ci.yml on: has no pull_request_target/workflow_run${risky.length ? ` (lines ${risky.join(",")})` : ""}`);

// every actions/checkout step sets persist-credentials: false
{
	let checkouts = 0;
	const missing = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/uses\s*:\s*actions\/checkout@/.test(code[i][0])) continue;
		checkouts++;
		let s = i;
		while (s > 0 && !(/^\s*-\s/.test(lines[s]) && indent(lines[s]) <= indent(lines[i]))) s--;
		const si = indent(lines[s]);
		let e = i + 1;
		while (e < lines.length && (isBlank(lines[e]) || indent(lines[e]) > si)) e++;
		const step = code.slice(s, e).map((c) => c[0]).join("\n");
		if (!/persist-credentials\s*:\s*["']?false["']?\s*$/m.test(step)) missing.push(i + 1);
	}
	if (checkouts === 0) out(false, "ci.yml has no actions/checkout step");
	else out(missing.length === 0, `every actions/checkout step sets persist-credentials: false${missing.length ? ` (missing at lines ${missing.join(",")})` : ""}`);
}

// no npx in workflow steps (use pnpm exec)
{
	const npx = code.filter(([l]) => /(^|[\s;&|(])npx\s/.test(l)).map((c) => c[1]);
	out(npx.length === 0, `ci.yml uses no npx (use pnpm exec)${npx.length ? ` (${npx.length} lines, first ${npx.slice(0, 5).join(",")})` : ""}`);
}

// pnpm/action-setup: no version input, or it equals the pin
let found = 0;
const bad = [];
const versionOf = (l) => {
	const m = l.match(/^\s*(?:-\s+)?version\s*:\s*["']?([^"'#\s]+)/);
	return m ? m[1] : null;
};
for (let i = 0; i < lines.length; i++) {
	if (!/uses\s*:\s*pnpm\/action-setup@/.test(lines[i])) continue;
	found++;
	const stepIndent = indent(lines[i]);
	for (let j = i + 1; j < lines.length; j++) {
		if (isBlank(lines[j])) continue;
		if (indent(lines[j]) < stepIndent || (/^\s*-\s/.test(lines[j]) && indent(lines[j]) <= stepIndent)) break;
		const v = versionOf(lines[j]);
		if (v && v !== want) bad.push(`${v} (line ${j + 1})`);
	}
	// `uses` may follow sibling keys of the same "- name:" item
	for (let j = i - 1; j >= 0; j--) {
		if (isBlank(lines[j])) continue;
		if (indent(lines[j]) < stepIndent - 2) break;
		const v = versionOf(lines[j]);
		if (v && v !== want) bad.push(`${v} (line ${j + 1})`);
		if (/^\s*-\s/.test(lines[j])) break;
	}
}
if (found === 0) out(false, "ci.yml has no pnpm/action-setup step");
else out(bad.length === 0, `pnpm/action-setup has no version input differing from ${want}${bad.length ? `: ${bad.join(", ")}` : ""}`);
NODE
	cat "$CI_REPORT"
	FAILS=$((FAILS + $(grep -c '^FAIL' "$CI_REPORT" || true)))
fi

# --- slow: container install + build ---
if [ "$INSTALL" -eq 1 ]; then
	echo "--- install check ---"
	# 1. never ship real files into a builder through a regressed ignore file
	if ! "$REPO_ROOT/scripts/docker/check-context.sh" --real >"$WORK/context-real.log" 2>&1; then
		grep -m 12 -E '^(FAIL|RESULT)' "$WORK/context-real.log" | sed 's/^/        /'
		fail "check-context.sh --real failed: refusing to run the install probes (real files could reach the builder)"
		echo "---"
		echo "RESULT: $FAILS check(s) failed"
		exit 1
	fi
	pass "check-context.sh --real passed"
	# 2. only a local daemon builder: the context must not leave this machine
	driver="$(docker buildx inspect 2>/dev/null | awk '/^Driver:/ && !d { print $2; d = 1 }')"
	if [ "$driver" != docker ]; then
		fail "current buildx builder driver is '${driver:-unknown}', expected 'docker' (local daemon); refusing to send the context"
		echo "---"
		echo "RESULT: $FAILS check(s) failed"
		exit 1
	fi
	pass "buildx builder driver is docker (local daemon)"
	# 3. the docker endpoint itself must be local (unix socket / named pipe), not a remote TCP/SSH host
	endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
	for ep in "$endpoint" "${DOCKER_HOST:-unix://}"; do
		case "$ep" in
		unix://* | npipe://*) ;;
		*)
			fail "docker endpoint '${ep:-unknown}' is not local (unix:// or npipe://); refusing to send the context"
			echo "---"
			echo "RESULT: $FAILS check(s) failed"
			exit 1
			;;
		esac
	done
	pass "docker endpoint is local (${DOCKER_HOST:-$endpoint})"

	# run_probe <name> <filter> <artifact> <sibling-ignore-or-empty>
	run_probe() {
		local name="$1" filter="$2" artifact="$3" sibling="$4" pdir
		pdir="$WORK/install-$name"
		mkdir -p "$pdir"
		cat >"$pdir/probe.Dockerfile" <<EOF
FROM node:22-bookworm-slim AS install
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN sha256sum pnpm-lock.yaml > /lock.before
# pnpm install must be the FIRST pnpm invocation: a warm-up \`pnpm --version\` could rewrite the lockfile
RUN corepack enable
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \\
    pnpm install --frozen-lockfile
RUN pnpm --version > /pnpm-version.txt && sha256sum pnpm-lock.yaml > /lock.after
RUN pnpm --filter "$filter" build
RUN test -f $artifact && echo present > /artifact.txt
FROM scratch
COPY --from=install /pnpm-version.txt /lock.before /lock.after /artifact.txt /
EOF
		if [ -n "$sibling" ]; then cp "$sibling" "$pdir/probe.Dockerfile.dockerignore"; fi
		if docker buildx build --progress=plain --output "type=local,dest=$pdir/out" \
			-f "$pdir/probe.Dockerfile" "$REPO_ROOT" >"$pdir/build.log" 2>&1; then
			pass "$name: pnpm install --frozen-lockfile succeeded as the first pnpm call"
			local got
			got="$(tr -d '[:space:]' <"$pdir/out/pnpm-version.txt")"
			if [ "$got" = "$PNPM_VERSION" ]; then
				pass "$name: pnpm --version after install == $PNPM_VERSION"
			else
				fail "$name: pnpm --version after install is '$got', expected $PNPM_VERSION"
			fi
			if [ "$(cut -d' ' -f1 <"$pdir/out/lock.before")" = "$(cut -d' ' -f1 <"$pdir/out/lock.after")" ]; then
				pass "$name: pnpm-lock.yaml unchanged by install"
			else
				fail "$name: pnpm-lock.yaml changed during install"
			fi
			pass "$name: pnpm --filter \"$filter\" build succeeded and $artifact exists"
		else
			fail "$name: install/build failed (pnpm pin, frozen lockfile, build inputs missing from the context, or $artifact missing)"
			grep -E 'ERR_PNPM|ERROR|error' "$pdir/build.log" | head -n 8 | sed 's/^/        /' || true
		fi
	}

	# kernel: root context with the real root .dockerignore (no sibling ignore file)
	run_probe kernel "@oscorpex/kernel..." apps/kernel/dist/index.js ""
	# console: root context with apps/console/Dockerfile.dockerignore as the sibling ignore file
	if [ -f "$REPO_ROOT/apps/console/Dockerfile.dockerignore" ]; then
		run_probe console "console..." apps/console/dist/index.html "$REPO_ROOT/apps/console/Dockerfile.dockerignore"
	else
		fail "console: apps/console/Dockerfile.dockerignore does not exist"
	fi
fi

echo "---"
if [ "$FAILS" -gt 0 ]; then
	echo "RESULT: $FAILS check(s) failed"
	exit 1
fi
echo "RESULT: all checks passed"
