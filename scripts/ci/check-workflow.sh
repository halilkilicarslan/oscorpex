#!/usr/bin/env bash
# D6 CI workflow check: static policy checks on .github/workflows/ci.yml plus actionlint and zizmor.
#
# Usage: scripts/ci/check-workflow.sh [--no-docker]
#   --no-docker  skip the actionlint/zizmor container runs (policy checks still run)
#
# Policy checks use a small indentation-based node parser (no npm deps). actionlint and zizmor run in
# digest-pinned containers with a throwaway DOCKER_CONFIG (no credential helper, nothing written to $HOME).
#
# zizmor invocation: zizmor --offline --no-progress --format json .github/workflows/ci.yml
#   offline = deterministic (online-only audits are skipped); only high/medium findings fail, minus the
#   exceptions listed in ZIZMOR_ALLOWED_IDENTS below (each needs a reason).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CI_YML="${OSCORPEX_CI_YML:-$ROOT/.github/workflows/ci.yml}" # env override is a test hook

ACTIONLINT_IMAGE="rhysd/actionlint@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9" # 1.7.7
ZIZMOR_IMAGE="ghcr.io/zizmorcore/zizmor@sha256:a6460f1b6fe3dc08e588d314e73563bdd218ee30c995a4be5e9ee5bd300391ce" # 1.16.0
# rule idents allowed to report high/medium findings: "ident:reason" (none yet)
ZIZMOR_ALLOWED_IDENTS=""

USE_DOCKER=1
for a in "$@"; do
	case "$a" in
	--no-docker) USE_DOCKER=0 ;;
	*)
		echo "usage: $0 [--no-docker]" >&2
		exit 2
		;;
	esac
done

FAILED=0
pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1"
	FAILED=1
}

[ -f "$CI_YML" ] || {
	echo "FAIL: $CI_YML is missing"
	exit 1
}
command -v node >/dev/null 2>&1 || {
	echo "FAIL: node is required"
	exit 1
}

# --- policy checks ---
set +e
CI_YML="$CI_YML" node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.env.CI_YML, "utf8").split("\n");
const results = [];
const out = (ok, msg) => results.push((ok ? "PASS: " : "FAIL: ") + msg);
const indentOf = (l) => l.match(/^ */)[0].length;
const isBlank = (l) => /^\s*(#.*)?$/.test(l);

// top-level blocks: key at indent 0 -> its lines
const top = {};
let cur = null;
for (const l of lines) {
	const m = l.match(/^([A-Za-z_"][^:]*):/);
	if (m) { cur = m[1].replace(/"/g, ""); top[cur] = []; }
	else if (cur) top[cur].push(l);
}

// jobs: keys at indent 2 under jobs:
const jobs = {};
let job = null;
for (const l of top.jobs || []) {
	const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
	if (m) { job = m[1]; jobs[job] = { lines: [], steps: [] }; continue; }
	if (job) jobs[job].lines.push(l);
}
// steps: "- " items at the indent of the first "- " after "steps:"
for (const [name, j] of Object.entries(jobs)) {
	const si = j.lines.findIndex((l) => /^    steps:\s*$/.test(l));
	if (si < 0) continue;
	let step = null;
	for (const l of j.lines.slice(si + 1)) {
		if (/^      - /.test(l)) { step = { text: [l] }; j.steps.push(step); }
		else if (step && (isBlank(l) || indentOf(l) >= 8)) step.text.push(l);
		else if (!isBlank(l) && indentOf(l) < 6) break;
	}
	for (const s of j.steps) {
		s.raw = s.text.join("\n");
		// run body: join continuation lines of "run:" (inline or block scalar)
		const runLines = [];
		let inRun = false, runIndent = 0;
		for (const l of s.text) {
			const m = l.match(/^(\s*)(?:- )?run:\s*(.*)$/);
			if (m) {
				inRun = true; runIndent = m[1].length + (l.includes("- run:") ? 2 : 0);
				if (m[2] && !/^[|>][+-]?$/.test(m[2])) runLines.push(m[2]);
				continue;
			}
			if (inRun) {
				if (isBlank(l) || indentOf(l) > runIndent) runLines.push(l.trim());
				else inRun = false;
			}
		}
		s.run = runLines.join("\n").replace(/\\\n\s*/g, " ");
		s.uses = (s.raw.match(/^\s*(?:- )?uses:\s*(\S+)/m) || [])[1] || "";
		s.name = (s.raw.match(/^\s*(?:- )?name:\s*(.+)$/m) || [])[1] || "";
		s.cond = (s.raw.match(/^\s*(?:- )?if:\s*(.+)$/m) || [])[1] || "";
	}
}
const allText = lines.join("\n");

// 1. pinning, timeouts, concurrency
const unpinned = [];
lines.forEach((l, i) => {
	const m = l.match(/^\s*(?:- )?uses:\s*(\S+)(.*)$/);
	if (!m || m[1].startsWith("./")) return;
	if (!/@[0-9a-f]{40}$/.test(m[1]) || !/^\s*#\s*v\d/.test(m[2])) unpinned.push(i + 1);
});
out(unpinned.length === 0, "every uses: is pinned to a 40-hex SHA with a trailing # vX.Y.Z comment" + (unpinned.length ? ` (lines ${unpinned.join(",")})` : ""));
const jobNames = Object.keys(jobs);
out(jobNames.length > 0, "ci.yml defines jobs");
const noTimeout = jobNames.filter((n) => !jobs[n].lines.some((l) => /^    timeout-minutes:\s*\d+\s*$/.test(l)));
out(noTimeout.length === 0, "every job has timeout-minutes" + (noTimeout.length ? ` (missing: ${noTimeout.join(",")})` : ""));
const conc = (top.concurrency || []).join("\n");
out(/^\s+group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}\s*$/m.test(conc), "concurrency group is ${{ github.workflow }}-${{ github.ref }}");
out(/^\s+cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*\x27pull_request\x27\s*\}\}\s*$/m.test(conc), "concurrency cancel-in-progress only for pull_request runs (never cancels master)");
const badRunner = jobNames.filter((n) => !jobs[n].lines.some((l) => /^    runs-on:\s*ubuntu-24\.04\s*$/.test(l)));
out(badRunner.length === 0, "every job runs-on ubuntu-24.04 (pinned runner image)" + (badRunner.length ? ` (${badRunner.join(",")})` : ""));
for (const n of ["build", "docker"]) {
	if (!jobs[n]) { out(false, `job ${n} exists`); continue; }
	const t = (jobs[n].lines.map((l) => l.match(/^    timeout-minutes:\s*(\d+)/)).find(Boolean) || [])[1];
	out(Number(t) >= 60, `job ${n} timeout-minutes >= 60 (got ${t})`);
}

// 2. pnpm toolchain
out(!/pnpm\/action-setup/.test(allText), "no pnpm/action-setup");
const nodeSetups = Object.values(jobs).flatMap((j) => j.steps.filter((s) => /^actions\/setup-node@/.test(s.uses)));
out(nodeSetups.length > 0 && nodeSetups.every((s) => !/^\s*cache:/m.test(s.raw) && /node-version:\s*"?22/.test(s.raw)),
	"actions/setup-node is node 22 without cache:");
out(nodeSetups.length > 0 && nodeSetups.every((s) => /^\s*package-manager-cache:\s*"?false"?\s*$/m.test(s.raw)), "every actions/setup-node step sets package-manager-cache: false");
// lockfile must not drift after install
for (const n of jobNames) {
	const st = jobs[n].steps;
	st.forEach((s, i) => {
		if (!/pnpm install --frozen-lockfile/.test(s.run)) return;
		const nx = st[i + 1];
		out(!!nx && /git diff --exit-code pnpm-lock\.yaml/.test(nx.run), `job ${n}: step after pnpm install --frozen-lockfile is git diff --exit-code pnpm-lock.yaml`);
	});
}
out(!/\bnpx\b/.test(allText.replace(/#.*$/gm, "")), "no npx (use pnpm exec)");
for (const n of jobNames) {
	const st = jobs[n].steps;
	const usesPnpm = st.some((s) => /\bpnpm\b(?!-)/.test(s.run) || /scripts\/docker\//.test(s.run));
	if (!usesPnpm) continue;
	const firstUse = st.findIndex((s) => /\bpnpm\b(?!-)/.test(s.run) || /scripts\/docker\//.test(s.run));
	const idx = (re) => st.findIndex((s) => re.test(s.run));
	const en = idx(/corepack enable/), inst = idx(/corepack install/);
	out(en >= 0 && inst >= 0 && en <= firstUse && inst <= firstUse && en <= inst, `job ${n}: corepack enable + corepack install run before the first pnpm/script step`);
	const ver = st.findIndex((s) => /pnpm --version/.test(s.run) && /12\.6\.0/.test(s.run));
	out(ver >= 0, `job ${n}: asserts pnpm --version == 12.6.0`);
	const cache = st.find((s) => /^actions\/cache@/.test(s.uses) && /hashFiles\(\x27pnpm-lock\.yaml\x27\)/.test(s.raw));
	out(!!cache && st.some((s) => /pnpm store path/.test(s.run)), `job ${n}: pnpm store cached via actions/cache keyed on hashFiles(pnpm-lock.yaml), path from pnpm store path`);
}

// 3. digests
const svcImgs = [];
lines.forEach((l, i) => { const m = l.match(/^\s+image:\s*(\S+)/); if (m) svcImgs.push([i + 1, m[1]]); });
const badSvc = svcImgs.filter(([, v]) => !/@sha256:[0-9a-f]{64}$/.test(v));
out(svcImgs.length > 0 && badSvc.length === 0, "every services: image is digest-pinned" + (badSvc.length ? ` (lines ${badSvc.map((b) => b[0]).join(",")})` : ""));
const PG = "pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f";
out(svcImgs.some(([, v]) => v === PG), "postgres service uses the approved pgvector digest");
const dockerRuns = [];
for (const j of Object.values(jobs)) for (const s of j.steps) for (const l of s.run.split("\n"))
	if (/\bdocker run\b/.test(l) && !/@sha256:[0-9a-f]{64}/.test(l)) dockerRuns.push(l.trim().slice(0, 60));
out(dockerRuns.length === 0, "every docker run image is digest-pinned" + (dockerRuns.length ? ` (${dockerRuns[0]}...)` : ""));

// 4. docker job
const dj = jobs.docker;
out(!!dj, "docker job exists");
if (dj) {
	const st = dj.steps;
	const tm = (dj.lines.map((l) => l.match(/^    timeout-minutes:\s*(\d+)/)).find(Boolean) || [])[1];
	
	const co = st.find((s) => /^actions\/checkout@/.test(s.uses));
	out(!!co && /persist-credentials:\s*false/.test(co.raw), "docker job checkout has persist-credentials: false");
	out(/pgvector\/pgvector/.test(dj.lines.join("\n")), "docker job has a pgvector service");
	const scriptRe = /scripts\/docker\/(check-context|check-toolchain|check-deploy|smoke-kernel|smoke-console|smoke-compose)\.sh/;
	const firstScript = st.findIndex((s) => scriptRe.test(s.run));
	const cleanup = st.findIndex((s) => /rm -rf \/usr\/share\/dotnet/.test(s.run) && /\/usr\/local\/lib\/android/.test(s.run) &&
		/\/opt\/ghc/.test(s.run) && /CodeQL/.test(s.run) && /\/usr\/local\/\.ghcup/.test(s.run) && /docker image prune/.test(s.run) && /df -h/.test(s.run));
	out(cleanup >= 0 && firstScript >= 0 && cleanup < firstScript, "disk cleanup step (dotnet/android/ghc/.ghcup/CodeQL, docker image prune, df -h) precedes the first script");
	const buildx = st.findIndex((s) => /docker\/setup-buildx-action/.test(s.uses));
	const lastScript = st.map((s) => scriptRe.test(s.run)).lastIndexOf(true);
	out(buildx < 0 || buildx > lastScript, "no docker/setup-buildx-action in the docker job (scripts need the default docker driver)");
	const order = [
		["check-context.sh", /scripts\/docker\/check-context\.sh(?!\s+--real)(?=\s|$)/],
		["check-context.sh --real", /scripts\/docker\/check-context\.sh\s+--real\b/],
		["check-toolchain.sh --install", /scripts\/docker\/check-toolchain\.sh\s+--install\b/],
		["check-deploy.sh --db", /scripts\/docker\/check-deploy\.sh\s+--db\s+postgres(ql)?:\/\/\S+@localhost:5432\/postgres/],
		["smoke-kernel.sh", /scripts\/docker\/smoke-kernel\.sh/],
		["smoke-console.sh", /scripts\/docker\/smoke-console\.sh/],
		["smoke-compose.sh", /scripts\/docker\/smoke-compose\.sh/],
	];
	let prev = -1;
	for (const [label, re] of order) {
		const i = st.findIndex((s) => re.test(s.run));
		out(i >= 0 && i > prev, `docker job runs ${label} (in order)`);
		if (i >= 0) prev = i;
	}
	const last = st[st.length - 1];
	out(!!last && /^always\(\)$/.test(last.cond.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim()) && /docker ps -a/.test(last.run) && /docker system df/.test(last.run),
		"docker job ends with an if: always() step running docker ps -a and docker system df");
	const dcorep = st.findIndex((s) => /corepack install/.test(s.run));
	out(dcorep >= 0 && dcorep < firstScript, "docker job installs pnpm via corepack before the scripts");
}

// 5. old steps gone, no stray compose
out(!/docker compose|docker-compose/.test(allText.replace(/#.*$/gm, "")), "no docker compose invocations in ci.yml (the smoke scripts own them)");
out(!/Docker Compose config validation|Docker build backend|Docker build console/.test(allText), "old compose config / Docker build backend|console steps are gone");

// 6. dependency scan
const scanJob = Object.entries(jobs).find(([, j]) => /osv-scanner/.test(j.lines.join("\n")));
out(!!scanJob, "a dependency-scan job/step runs osv-scanner");
if (scanJob) {
	const t = scanJob[1].lines.join("\n");
	out(/pnpm-lock\.yaml/.test(t.replace(/docker\/claude-cli\/pnpm-lock\.yaml/g, "")) && /docker\/claude-cli\/pnpm-lock\.yaml/.test(t),
		"osv-scanner covers pnpm-lock.yaml and docker/claude-cli/pnpm-lock.yaml");
}

if (scanJob) {
	const j = scanJob[1], jt = j.lines.join("\n");
	const step = j.steps.find((x) => /osv-scanner/.test(x.raw));
	const r = step ? step.run : "";
	out(!!step && !/\|\|\s*true\b/.test(jt) && !/continue-on-error/.test(jt), "deps-scan has no `|| true` and no continue-on-error");
	out(/\brc=0\b/.test(r) && /\|\|\s*rc=\$\?/.test(r) && /\[\s*"\$rc"\s+-le\s+1\s*\]/.test(r), "deps-scan accepts only osv-scanner exit codes 0 and 1 (rc=0; ... || rc=$?; [ \"$rc\" -le 1 ])");
	const dl = (step ? step.text : []).filter((l) => /osv-scanner@sha256:[0-9a-f]{64}/.test(l));
	out(dl.length > 0 && dl.every((l) => /#\s*v\d+\.\d+\.\d+/.test(l)), "osv-scanner image digest line carries a # vX.Y.Z comment");
}
out(Object.values(jobs).some((j) => j.steps.some((s) => /scripts\/ci\/check-workflow\.sh/.test(s.run))), "CI runs scripts/ci/check-workflow.sh");

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
'
RC=$?
set -e
[ "$RC" -eq 0 ] || FAILED=1

# --- check-toolchain.sh ci.yml checks (permissions, no pull_request_target, persist-credentials, no npx, ...) ---
TC_OUT="$(OSCORPEX_CI_YML="$CI_YML" "$ROOT/scripts/docker/check-toolchain.sh" 2>&1 || true)"
TC_FAILS="$(echo "$TC_OUT" | grep '^FAIL: ci\.yml:' || true)"
if ! echo "$TC_OUT" | grep -q '^PASS: ci\.yml:'; then
	echo "$TC_OUT" | tail -5
	fail "check-toolchain.sh emitted no 'PASS: ci.yml:' line (crashed before its ci.yml section?)"
elif [ -n "$TC_FAILS" ]; then
	echo "$TC_FAILS"
	FAILED=1
else
	pass "check-toolchain.sh ci.yml checks"
fi

# --- actionlint + zizmor ---
if [ "$USE_DOCKER" -eq 0 ]; then
	echo "SKIP: actionlint and zizmor (--no-docker)"
else
	DOCKER_HOST_RESOLVED="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}"
	TMPD="$(mktemp -d)"
	trap 'rm -rf "$TMPD"' EXIT
	echo '{}' >"$TMPD/config.json"
	dk() { DOCKER_CONFIG="$TMPD" DOCKER_HOST="$DOCKER_HOST_RESOLVED" docker "$@"; }
	if [ -z "$DOCKER_HOST_RESOLVED" ] || ! dk info >/dev/null 2>&1; then
		fail "docker is unavailable: actionlint/zizmor cannot run (use --no-docker to skip)"
	else
		WF_DIR="$(cd "$(dirname "$CI_YML")" && pwd)"
		WF_FILE="$(basename "$CI_YML")" # only the workflow directory is mounted (the repo root may hold a local .env)
		if AL_OUT="$(dk run --rm --network none -v "$WF_DIR":/w:ro -w /w "$ACTIONLINT_IMAGE" -color=false "$WF_FILE" 2>&1)"; then
			pass "actionlint reports no problems"
		else
			echo "$AL_OUT" | head -30
			fail "actionlint reported problems"
		fi
		ZJ="$TMPD/zizmor.json"
		dk run --rm --network none -v "$WF_DIR":/w:ro -w /w "$ZIZMOR_IMAGE" --offline --no-progress --format json "$WF_FILE" >"$ZJ" 2>"$TMPD/zizmor.err" || true
		if [ ! -s "$ZJ" ]; then
			head -10 "$TMPD/zizmor.err"
			fail "zizmor produced no output"
		else
			ZOUT="$(ZJ="$ZJ" ALLOWED="$ZIZMOR_ALLOWED_IDENTS" node -e '
const f = JSON.parse(require("fs").readFileSync(process.env.ZJ, "utf8"));
const allowed = (process.env.ALLOWED || "").split(/\s+/).filter(Boolean).map((a) => a.split(":")[0]);
const bad = f.filter((x) => ["High", "Medium"].includes(x.determinations && x.determinations.severity) && !allowed.includes(x.ident));
for (const b of bad) {
	const loc = (b.locations && b.locations[0] && b.locations[0].symbolic) || {};
	console.log(`  ${b.determinations.severity} ${b.ident}: ${b.desc} (${loc.annotation || ""})`);
}
process.exit(bad.length ? 1 : 0);
' 2>&1)" && pass "zizmor reports no high/medium findings" || {
				echo "$ZOUT" | head -30
				fail "zizmor reported high/medium findings"
			}
		fi
	fi
fi

if [ "$FAILED" -eq 0 ]; then
	echo "OK: all workflow checks passed"
else
	echo "FAILED: workflow checks failed"
	exit 1
fi
