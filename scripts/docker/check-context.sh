#!/usr/bin/env bash
# Verifies what each Docker build context contains, resolving the ignore file like BuildKit does
# (`<dockerfile>.dockerignore` next to the Dockerfile wins, else `<context>/.dockerignore`, else none).
#
# Usage: scripts/docker/check-context.sh [--real | --mutate]
#   (default)  canary mode: a names-only mirror of the git-visible tree plus planted canary paths.
#   --real     names-only mirror of the actual working tree (no canaries planted).
#   --mutate   slow: for every line of the common-deny block, drop it from the root and console ignore
#              files and require that a planted canary then leaks.
#
# Contexts are NAMES ONLY: every path is recreated as an EMPTY regular file under a temp dir (symlinks are
# never followed or copied), so the probe never sees real contents. The probe lists the context BuildKit
# receives by bind-mounting it in a RUN step and writing the list out with `--output type=local`.
#
# Test hook: OSCORPEX_IGNORE_ROOT=<dir> reads the ignore files from <dir> (same relative paths as the repo)
# instead of the repo, so the checks can be exercised against a candidate set of ignore files.
set -euo pipefail

MODE=canary
MUTATE=0
for arg in "$@"; do
	case "$arg" in
	--real) MODE=real ;;
	--mutate) MUTATE=1 ;;
	*)
		echo "usage: $0 [--real | --mutate]" >&2
		exit 2
		;;
	esac
done
if [ "$MODE" = real ] && [ "$MUTATE" -eq 1 ]; then
	echo "--real and --mutate are mutually exclusive" >&2
	exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IGNORE_ROOT="${OSCORPEX_IGNORE_ROOT:-$REPO_ROOT}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oscorpex-ctx.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
MIRROR="$WORK/mirror"
mkdir -p "$MIRROR"

# busybox:1.36 pinned by its index digest
BUSYBOX="busybox:1.36@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
MAX_FILES=1500

BLOCK_BEGIN='# >>> common-deny (keep identical in every .dockerignore)'
BLOCK_END='# <<< common-deny'
IGNORE_FILES="
.dockerignore
apps/console/Dockerfile.dockerignore
docker/coder-agent/.dockerignore
apps/console/.dockerignore
"

FAILS=0
pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1"
	FAILS=$((FAILS + 1))
}

# Contract: the common-deny block holds at least these patterns (also seeds the generated canaries).
DEFAULT_DENY='**/node_modules
**/dist
**/.env*
**/.oscorpex
**/.voltagent
**/.serena
**/.claude*
**/.credentials.json
**/.mcp.json
**/.git
**/.npmrc
**/.yarnrc*
**/.netrc
**/.pgpass
**/.git-credentials
**/.aws
**/.ssh
**/.gnupg
**/.kube
**/.docker
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/*.jks
**/*.keystore
**/*.ppk
**/id_rsa*
**/id_dsa*
**/id_ecdsa*
**/id_ed25519*
**/credentials.json
**/service-account*.json
**/*.tfstate*
**/*.sqlite*
**/*.db
**/*.dump
**/*.log
**/.history
**/.idea
**/.vscode
**/.cursor
**/.playwright-mcp
**/*.swp
**/*~
**/.DS_Store
**/.tmp
**/coverage
**/__tests__
**/*.test.ts
**/*.test.tsx
**/*.test.js
**/*.spec.ts
**/*.spec.tsx
**/*.js.map
**/*.tsbuildinfo
**/src/**/*.js'

# Hand-picked canaries (paths relative to the repo root); more are generated from the deny patterns.
EXPLICIT_CANARIES=".env
.env.local
.env.example
apps/console/.env
apps/console/.env.production
apps/kernel/.env
packages/core/.env
.oscorpex/repos/t1/.env.production
apps/kernel/.oscorpex/repos/t1/.env
apps/kernel/.oscorpex/repos/t1/src/app.ts
.voltagent/repos/x/.env
apps/kernel/.voltagent/x.json
node_modules/x/index.js
apps/kernel/node_modules/x/index.js
packages/core/node_modules/x/index.js
apps/kernel/dist/index.js
packages/core/dist/index.js
.serena/memories/x.md
apps/kernel/.serena/x.md
.claude/settings.local.json
.planning/x.md
coverage/x.json
apps/kernel/.tmp/x
apps/kernel/src/canary-key.pem
id_rsa
.git/config
.DS_Store
apps/kernel/src/.env
apps/kernel/src/sub/.env.production
apps/kernel/src/.oscorpex/x
apps/kernel/src/.voltagent/x
apps/kernel/src/.serena/x
apps/kernel/src/.claude/x
apps/kernel/src/.claude.json
apps/kernel/src/.git/config
apps/kernel/src/node_modules/x/i.js
apps/kernel/src/dist/x.js
apps/kernel/src/id_rsa
apps/kernel/src/id_ed25519
apps/kernel/src/creds.key
apps/kernel/src/x.p12
apps/kernel/src/.npmrc
apps/kernel/src/x.log
apps/kernel/src/stale.js
apps/kernel/src/x.tsbuildinfo
apps/kernel/scripts/.env
packages/core/src/.env
packages/core/src/dist/x.js
adapters/provider-claude/src/.env.local
docker/claude-cli/.env
docker/claude-cli/.npmrc
docker/claude-cli/.claude.json
docker/claude-cli/node_modules/x/i.js
docker/claude-cli/other.txt
apps/console/src/.env
apps/console/src/k.pem
apps/console/public/.env.production
apps/console/public/shot.png
packages/control-plane/src/.env
docker/coder-agent/.env
docker/coder-agent/x.pem"

# Trees that are (partly) re-included by the allow-lists; canaries are generated inside each of them.
CANARY_TREES="apps/kernel/src
packages/core/src
adapters/provider-claude/src
apps/console/src
apps/console/public
packages/control-plane/src
docker/claude-cli
docker/coder-agent"

# Secret / artifact families that must never reach any context (mirrors the common-deny block).
FORBIDDEN_RE='(^|/)node_modules(/|$)'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)dist(/|$)'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)\.env[^/]*(/|$)'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)\.(oscorpex|voltagent|serena|history|idea|vscode|cursor|playwright-mcp|tmp|aws|ssh|gnupg|kube|docker|git)(/|$)'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)\.claude[^/]*(/|$)'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)(\.credentials\.json|\.mcp\.json|\.npmrc|\.netrc|\.pgpass|\.git-credentials|credentials\.json|\.DS_Store)$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)\.yarnrc[^/]*$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)service-account[^/]*\.json$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)(coverage|__tests__)(/|$)'
FORBIDDEN_RE="$FORBIDDEN_RE"'|\.(pem|key|p12|pfx|jks|keystore|ppk|db|dump|log|swp)$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|\.(tfstate|sqlite)[^/]*$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|~$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|\.(js\.map|tsbuildinfo)$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|\.(test|spec)\.(tsx?|js)$'
FORBIDDEN_RE="$FORBIDDEN_RE"'|(^|/)src/.+\.js$'

# ---------------------------------------------------------------------------------------------
# Names-only mirror tool (node): list mode creates empty files from NUL-separated paths on stdin,
# walk mode mirrors a real tree. Refuses symlinked components and path traversal; never reads contents.
# ---------------------------------------------------------------------------------------------
cat >"$WORK/mirror.js" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [mode, dest, src] = process.argv.slice(2);

function ensureDirs(parts) {
	let cur = dest;
	for (const p of parts) {
		cur = path.join(cur, p);
		let st = null;
		try {
			st = fs.lstatSync(cur);
		} catch (e) {
			if (e.code !== "ENOENT") throw e;
		}
		if (st === null) fs.mkdirSync(cur);
		else if (st.isSymbolicLink()) throw new Error(`symlink component in mirror: ${cur}`);
		else if (!st.isDirectory()) throw new Error(`path component is not a directory: ${cur}`);
	}
}

function touch(rel) {
	const parts = rel.split("/").filter((p) => p !== "");
	if (path.isAbsolute(rel) || parts.length === 0 || parts.includes("..")) throw new Error(`bad path: ${rel}`);
	ensureDirs(parts.slice(0, -1));
	const full = path.join(dest, ...parts);
	try {
		const st = fs.lstatSync(full);
		if (st.isSymbolicLink() || st.isDirectory()) throw new Error(`path collides with a link/dir: ${rel}`);
	} catch (e) {
		if (e.code !== "ENOENT") throw e;
	}
	fs.writeFileSync(full, "");
}

if (mode === "list") {
	const buf = fs.readFileSync(0);
	const input = [];
	let from = 0;
	for (let i = 0; i < buf.length; i++) {
		if (buf[i] !== 0) continue;
		if (i > from) input.push(buf.subarray(from, i));
		from = i + 1;
	}
	if (from < buf.length) input.push(buf.subarray(from));
	for (const raw of input) {
		const rel = raw.toString("utf8");
		if (!Buffer.from(rel, "utf8").equals(raw)) throw new Error(`non-UTF-8 path name (not mirrored): ${JSON.stringify(raw.toString("latin1"))}`);
		if (src && src !== "-") {
			try {
				fs.lstatSync(path.join(src, rel));
			} catch {
				continue; // tracked but deleted in the working tree
			}
		}
		touch(rel);
	}
} else if (mode === "walk") {
	const walk = (rel) => {
		for (const d of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
			const r = rel ? `${rel}/${d.name}` : d.name;
			if (d.isDirectory()) {
				// prune heavy/VCS dirs but keep one placeholder so their exclusion is still tested
				if (d.name === "node_modules" || d.name === ".git") touch(`${r}/.placeholder`);
				else walk(r);
			} else {
				touch(r); // files, symlinks and specials all become empty regular files
			}
		}
	};
	walk("");
}
NODE

mirror_list() { # mirror_list <src-or-"-"> reads NUL paths on stdin
	node "$WORK/mirror.js" list "$MIRROR" "$1"
}

# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------
GIT_FILES="$WORK/git-files.txt"
(cd "$REPO_ROOT" && git ls-files -co --exclude-standard) >"$GIT_FILES"

# block_lines <file>: pattern lines inside the common block (no blanks, no comments)
block_lines() {
	awk -v b="$BLOCK_BEGIN" -v e="$BLOCK_END" '
		$0 == b { f = 1; next }
		$0 == e { f = 0 }
		f && NF && $0 !~ /^[[:space:]]*#/ { print }
	' "$1"
}

has() { grep -Fxq -- "$1" "$LIST"; }
has_prefix() { awk -v p="$1" 'index($0, p) == 1 { found = 1 } END { exit !found }' "$LIST"; }

require() {
	if has "$1"; then pass "$LABEL has $1"; else fail "$LABEL is missing $1"; fi
}
require_prefix() {
	if has_prefix "$1"; then pass "$LABEL has files under $1"; else fail "$LABEL has nothing under $1"; fi
}

# Workspace package dirs (relative), from the pnpm-workspace.yaml globs against the git-visible tree.
workspace_dirs() {
	local glob base
	sed -n 's/^[[:space:]]*-[[:space:]]*["'\'']\{0,1\}\([^"'\'']*\)["'\'']\{0,1\}[[:space:]]*$/\1/p' \
		"$REPO_ROOT/pnpm-workspace.yaml" | while IFS= read -r glob; do
		case "$glob" in
		*/\*)
			base="${glob%/\*}"
			grep -E "^$base/[^/]+/package\.json$" "$GIT_FILES" | sed 's|/package\.json$||'
			;;
		esac
	done
	return 0
}

# ---------------------------------------------------------------------------------------------
# Common-deny block identity across ignore files
# ---------------------------------------------------------------------------------------------
check_common_block() {
	echo "--- common-deny block ---"
	local f n=0 first="" blk
	for f in $IGNORE_FILES; do
		n=$((n + 1))
		if [ ! -f "$IGNORE_ROOT/$f" ]; then
			fail "ignore file $f does not exist"
			continue
		fi
		local begins ends
		begins="$(grep -Fxc -- "$BLOCK_BEGIN" "$IGNORE_ROOT/$f" || true)"
		ends="$(grep -Fxc -- "$BLOCK_END" "$IGNORE_ROOT/$f" || true)"
		if [ "$begins" != 1 ] || [ "$ends" != 1 ]; then
			fail "$f must contain the common-deny begin/end markers exactly once (found $begins/$ends)"
			continue
		fi
		blk="$WORK/block.$n"
		awk -v b="$BLOCK_BEGIN" -v e="$BLOCK_END" '$0 == e { f = 0 } f { print } $0 == b { f = 1 }' \
			"$IGNORE_ROOT/$f" >"$blk"
		if [ ! -s "$blk" ]; then
			fail "$f: common-deny block is empty"
			continue
		fi
		if awk -v e="$BLOCK_END" 'f && NF { bad = 1 } $0 == e { f = 1 } END { exit bad }' "$IGNORE_ROOT/$f"; then
			pass "$f: common-deny block is the last non-blank content"
		else
			fail "$f: content follows the common-deny block (it must be last)"
		fi
		if [ -z "$first" ]; then
			first="$blk"
			pass "$f: common-deny block present ($(wc -l <"$blk" | tr -d ' ') lines)"
		elif cmp -s "$first" "$blk"; then
			pass "$f: common-deny block identical to the first ignore file's"
		else
			fail "$f: common-deny block differs from the first ignore file's"
		fi
	done
}

# ---------------------------------------------------------------------------------------------
# Mirror + canaries
# ---------------------------------------------------------------------------------------------
CANARY_ALL="$WORK/canaries.txt"
: >"$CANARY_ALL"

prepare_mirror() {
	if [ "$MODE" = canary ]; then
		(cd "$REPO_ROOT" && git ls-files -z -co --exclude-standard) | mirror_list "$REPO_ROOT" ||
			{ fail "could not build the names-only mirror"; return 1; }
		# patterns: contract defaults plus whatever the real common blocks hold
		{
			printf '%s\n' "$DEFAULT_DENY"
			for f in $IGNORE_FILES; do
				if [ -f "$IGNORE_ROOT/$f" ]; then block_lines "$IGNORE_ROOT/$f"; fi
			done
		} | sort -u >"$WORK/patterns.txt"
		{
			printf '%s\n' "$EXPLICIT_CANARIES"
			while IFS= read -r pat; do
				case "$pat" in \*\*/*) ;; *) continue ;; esac
				body="${pat#\*\*/}"
				name="${body//\*\*/sub}"
				name="${name//\*/canary}"
				while IFS= read -r tree; do
					case "$name" in
					*/*)
						base="$tree"
						case "$tree" in */src) base="${tree%/src}" ;; esac
						echo "$base/$name"
						;;
					*)
						echo "$tree/f/$name"
						echo "$tree/d/$name/x"
						;;
					esac
				done <<<"$CANARY_TREES"
			done <"$WORK/patterns.txt"
		} | sort -u >"$CANARY_ALL"
		tr '\n' '\0' <"$CANARY_ALL" | mirror_list - || { fail "could not plant canaries"; return 1; }
		echo "mode: canary (names-only mirror of $(wc -l <"$GIT_FILES" | tr -d ' ') git-visible files + $(wc -l <"$CANARY_ALL" | tr -d ' ') planted canaries)"
	else
		node "$WORK/mirror.js" walk "$MIRROR" "$REPO_ROOT" || { fail "could not mirror the working tree"; return 1; }
		echo "mode: real (names-only mirror of the working tree; node_modules/.git pruned to placeholders)"
	fi
}

# canary paths relative to a context dir (ctx "." = repo root)
canaries_for() {
	if [ "$1" = . ]; then
		cat "$CANARY_ALL"
	else
		awk -v c="$1/" 'index($0, c) == 1 { print substr($0, length(c) + 1) }' "$CANARY_ALL"
	fi
}

# ---------------------------------------------------------------------------------------------
# probe_ctx <dockerfile-rel|-> <ctx-rel> <out-list>
# Resolves the ignore file like BuildKit, places it, builds the probe, writes names (no "./") to out-list.
# Sets IGNORE_DESC to a description of the resolved ignore file.
# ---------------------------------------------------------------------------------------------
probe_ctx() {
	local df="$1" ctx="$2" out="$3" ctxdir sibling="" pdir
	if [ "$ctx" = . ]; then ctxdir="$MIRROR"; else ctxdir="$MIRROR/$ctx"; fi
	IGNORE_DESC="none"
	if [ "$df" != "-" ] && [ -f "$IGNORE_ROOT/$df.dockerignore" ]; then
		sibling="$IGNORE_ROOT/$df.dockerignore"
		IGNORE_DESC="$df.dockerignore"
	fi
	if [ -z "$sibling" ]; then
		local cf
		if [ "$ctx" = . ]; then cf=".dockerignore"; else cf="$ctx/.dockerignore"; fi
		if [ -f "$IGNORE_ROOT/$cf" ]; then
			cp "$IGNORE_ROOT/$cf" "$ctxdir/.dockerignore"
			IGNORE_DESC="$cf"
		else
			rm -f "$ctxdir/.dockerignore"
		fi
	fi
	pdir="$(mktemp -d "$WORK/probe.XXXXXX")"
	cat >"$pdir/probe.Dockerfile" <<EOF
FROM $BUSYBOX AS list
RUN --network=none --mount=type=bind,source=.,target=/ctx cd /ctx && find . -mindepth 1 \( -type f -o -type l \) | sort > /list.txt
FROM scratch
COPY --from=list /list.txt /
EOF
	if [ -n "$sibling" ]; then cp "$sibling" "$pdir/probe.Dockerfile.dockerignore"; fi
	if ! docker buildx build --no-cache --progress=plain --output "type=local,dest=$pdir/out" \
		-f "$pdir/probe.Dockerfile" "$ctxdir" >"$pdir/build.log" 2>&1; then
		echo "build log tail:" >&2
		tail -n 15 "$pdir/build.log" >&2
		rm -rf "$pdir"
		return 1
	fi
	sed 's|^\./||' "$pdir/out/list.txt" >"$out"
	rm -rf "$pdir"
}

# ---------------------------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------------------------
forbid_regex() { # forbid_regex <description> <ERE>
	local hits
	hits="$(grep -E -- "$2" "$LIST" | head -n 10 || true)"
	if [ -z "$hits" ]; then
		pass "$LABEL: no $1"
	else
		fail "$LABEL leaks $1:"
		printf '%s\n' "$hits" | sed 's/^/        /'
	fi
}

check_secrets() { # check_secrets <ctx>
	forbid_regex "secret/artifact paths (common-deny families)" "$FORBIDDEN_RE"
	if [ "$MODE" = canary ]; then
		local hits n
		canaries_for "$1" >"$WORK/ctx-canaries.txt"
		hits="$(grep -Fxf "$WORK/ctx-canaries.txt" "$LIST" || true)"
		n="$(printf '%s' "$hits" | grep -c . || true)"
		if [ "$n" -eq 0 ]; then
			pass "$LABEL: none of the $(wc -l <"$WORK/ctx-canaries.txt" | tr -d ' ') planted canaries reached the context"
		else
			fail "$LABEL: $n planted canaries reached the context (first 10):"
			printf '%s\n' "$hits" | head -n 10 | sed 's/^/        /'
		fi
	fi
}

check_allowed() { # inverse allow-list: every path must match an expected ERE (file: $WORK/allowed.re)
	local bad
	bad="$(grep -Evf "$WORK/allowed.re" "$LIST" | head -n 10 || true)"
	if [ -z "$bad" ]; then
		pass "$LABEL: every path matches the expected allow-list"
	else
		fail "$LABEL has paths outside the expected allow-list (first 10):"
		printf '%s\n' "$bad" | sed 's/^/        /'
	fi
}

check_workspace_manifests() {
	local d
	require package.json
	require pnpm-lock.yaml
	require pnpm-workspace.yaml
	require tsconfig.base.json
	for d in $(workspace_dirs); do
		require "$d/package.json"
	done
}

MANIFESTS_RE='^(apps|packages|adapters)/[^/]+/package\.json$'

# run_context <name> <dockerfile-rel|-> <ctx-rel>
run_context() {
	local name="$1" df="$2" ctx="$3" d total
	LABEL="$name context"
	LIST="$WORK/list-$name.txt"
	echo "--- $name context (dockerfile: $df, context: $ctx) ---"
	if ! probe_ctx "$df" "$ctx" "$LIST"; then
		fail "$name context: probe build failed"
		return 0
	fi
	echo "ignore file in effect: $IGNORE_DESC"
	if [ "$IGNORE_DESC" = none ]; then fail "$name context: no ignore file resolves, the whole directory is shipped"; fi
	total="$(wc -l <"$LIST" | tr -d ' ')"
	echo "$name context file count: $total"
	if [ "$total" -gt "$MAX_FILES" ]; then
		fail "$name context has $total files (cap $MAX_FILES)"
	else
		pass "$name context file count $total <= $MAX_FILES"
	fi
	check_secrets "$ctx"

	case "$name" in
	root)
		cat >"$WORK/allowed.re" <<'EOF'
^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|tsconfig\.json)$
^(apps|packages|adapters)/[^/]+/package\.json$
^apps/kernel/src/.+\.tsx?$
^apps/kernel/tsconfig[^/]*\.json$
^apps/kernel/tsdown\.config\.ts$
^apps/kernel/scripts/(init\.sql|admin-grant\.ts)$
^(packages|adapters)/[^/]+/src/.+\.tsx?$
^(packages|adapters)/[^/]+/tsconfig[^/]*\.json$
^(packages|adapters)/[^/]+/tsdown\.config\.ts$
^docker/claude-cli/(package\.json|package-lock\.json)$
EOF
		check_allowed
		check_workspace_manifests
		require tsconfig.json
		require apps/kernel/src/index.ts
		require apps/kernel/tsdown.config.ts
		require apps/kernel/tsconfig.json
		require apps/kernel/scripts/init.sql
		require apps/kernel/scripts/admin-grant.ts
		for d in $(workspace_dirs); do
			case "$d" in
			packages/* | adapters/*)
				require_prefix "$d/src/"
				require "$d/tsconfig.json"
				if grep -Fxq "$d/tsdown.config.ts" "$GIT_FILES"; then require "$d/tsdown.config.ts"; fi
				;;
			esac
		done
		;;
	console)
		# extensions of the tracked apps/console/src files, written out on purpose: a new extension must be
		# added here deliberately (derived from `git ls-files apps/console/src` on 2026-10-31)
		local exts="css|svg|ts|tsx"
		cat >"$WORK/allowed.re" <<EOF
^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json)$
$MANIFESTS_RE
^apps/console/(index\.html|vite\.config\.ts|nginx\.conf)$
^apps/console/tsconfig[^/]*\.json$
^apps/console/src/.+\.($exts)$
^apps/console/public/[^/]+\.svg$
^packages/control-plane/src/.+\.tsx?$
^packages/control-plane/tsconfig[^/]*\.json$
EOF
		check_allowed
		check_workspace_manifests
		if has apps/console/pnpm-lock.yaml; then
			fail "console context ships stale apps/console/pnpm-lock.yaml (root lockfile is authoritative)"
		else
			pass "console context: no stale apps/console/pnpm-lock.yaml"
		fi
		# vite.config.ts / tsconfig*.json / src import only @oscorpex/control-plane, never kernel sources
		if has_prefix "apps/kernel/src/"; then fail "console context ships apps/kernel/src/ (console does not need it)"; else pass "console context: no apps/kernel/src/"; fi
		for f in index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json nginx.conf package.json; do
			require "apps/console/$f"
		done
		require_prefix "apps/console/src/"
		# every tracked public asset must reach the console image; a future favicon.ico/robots.txt dropped by the
		# public/*.svg rule must fail loudly
		grep -E '^apps/console/public/' "$GIT_FILES" | while IFS= read -r pf; do
			if has "$pf"; then echo "PASS: console context has $pf"; else echo "FAIL: console context is missing tracked public asset $pf"; fi
		done >"$WORK/public-assets.txt"
		cat "$WORK/public-assets.txt"
		FAILS=$((FAILS + $(grep -c '^FAIL' "$WORK/public-assets.txt" || true)))
		if [ ! -s "$WORK/public-assets.txt" ]; then fail "console: no tracked files under apps/console/public"; fi
		require_prefix "packages/control-plane/src/"
		require packages/control-plane/tsconfig.json
		;;
	coder-agent)
		printf '%s\n' '^(agent-worker\.ts|tsconfig\.json)$' >"$WORK/allowed.re"
		check_allowed
		require agent-worker.ts
		require tsconfig.json
		;;
	console-local)
		if [ "$total" -eq 0 ]; then
			pass "console-local context (apps/console/.dockerignore) is empty"
		else
			fail "console-local context must be EMPTY (deny-all) but has $total files (first 10):"
			head -n 10 "$LIST" | sed 's/^/        /'
		fi
		;;
	esac
}

# ---------------------------------------------------------------------------------------------
# --mutate: dropping any common-deny line from the root/console ignore files must make a canary leak
# ---------------------------------------------------------------------------------------------
planted_leaks() { # planted_leaks <df> <ctx>: number of planted canaries reaching the context
	local out="$WORK/mut-list.txt"
	probe_ctx "$1" "$2" "$out" || { echo ERR; return 0; }
	canaries_for "$2" >"$WORK/mut-canaries.txt"
	grep -Fxf "$WORK/mut-canaries.txt" "$out" | grep -c . || true
}

run_mutations() {
	echo "--- mutation run (canary coverage of each common-deny line) ---"
	local saved="$IGNORE_ROOT" mut="$WORK/mut" f
	mkdir -p "$mut/apps/console" "$mut/docker/coder-agent"
	for f in $IGNORE_FILES; do
		if [ -f "$saved/$f" ]; then cp "$saved/$f" "$mut/$f"; fi
	done
	IGNORE_ROOT="$mut"
	local target df ctx base lines line total_lines=0 caught=0
	for target in ".dockerignore|Dockerfile|." "apps/console/Dockerfile.dockerignore|apps/console/Dockerfile|."; do
		f="${target%%|*}"
		rest="${target#*|}"
		df="${rest%%|*}"
		ctx="${rest#*|}"
		if [ ! -f "$mut/$f" ]; then
			fail "mutation: $f does not exist"
			continue
		fi
		block_lines "$mut/$f" >"$WORK/mut-lines.txt"
		if [ ! -s "$WORK/mut-lines.txt" ]; then
			fail "mutation: $f has no common-deny block to mutate"
			continue
		fi
		base="$(planted_leaks "$df" "$ctx")"
		if [ "$base" = ERR ]; then
			fail "mutation baseline probe failed for $f"
			continue
		fi
		echo "mutation baseline for $f: $base leaked canaries"
		cp "$mut/$f" "$WORK/mut-orig"
		while IFS= read -r line; do
			case "$line" in
			'**/*.test.js')
				# every .js under a re-included src/ is already denied by **/src/**/*.js, and nothing else re-includes .js
				echo "NOTE: '$line' is redundant with '**/src/**/*.js' and cannot be mutation-tested"
				continue
				;;
			esac
			total_lines=$((total_lines + 1))
			awk -v b="$BLOCK_BEGIN" -v e="$BLOCK_END" -v l="$line" '
				$0 == b { f = 1 }
				$0 == e { f = 0 }
				!(f && $0 == l) { print }
			' "$WORK/mut-orig" >"$mut/$f"
			n="$(planted_leaks "$df" "$ctx")"
			if [ "$n" = ERR ]; then
				fail "mutation probe failed for '$line' (removed from $f)"
			elif [ "$n" -gt "$base" ]; then
				caught=$((caught + 1))
			else
				fail "mutation: removing '$line' from $f is not caught by any canary"
			fi
		done <"$WORK/mut-lines.txt"
		cp "$WORK/mut-orig" "$mut/$f"
	done
	IGNORE_ROOT="$saved"
	echo "NOTE: docker/coder-agent/.dockerignore is deny-all plus two re-includes, so its common block is redundant defense and is not mutated"
	if [ "$total_lines" -gt 0 ]; then
		echo "mutation summary: $caught of $total_lines removed lines were caught by a canary"
	fi
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------
check_common_block
if prepare_mirror; then
	if [ "$MUTATE" -eq 1 ]; then
		run_mutations
	else
		run_context root Dockerfile .
		run_context console apps/console/Dockerfile .
		run_context coder-agent docker/coder-agent/Dockerfile docker/coder-agent
		run_context console-local - apps/console
	fi
fi

echo "---"
if [ "$FAILS" -gt 0 ]; then
	echo "RESULT: $FAILS check(s) failed"
	exit 1
fi
echo "RESULT: all checks passed"
