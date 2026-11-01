// ---------------------------------------------------------------------------
// I0 review fixes — cases that need no git fixture and no HTTP layer:
//   C  sandbox fail-closed at the task-setup level; an unknown isolationLevel is never mapped to "local";
//   D  isolated-workspace write-back refuses every path with a `.git` segment (case-insensitive);
//   E  contained-fs rejects a FIFO promptly instead of blocking on open();
//   F  SonarQube: the platform token never goes to a tenant-supplied host; the scanner never runs in the repo;
//   G  installs: .npmrc `git=` and yarn plugins cannot run repo-chosen programs; quoted yarnPath is refused.
// Fakes and canaries only; every directory is a fresh temp dir.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	constants,
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp, makeFakeBin, makeVersionedYarn, prependPath, readInvocations } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const KERNEL_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const state = vi.hoisted(() => ({
	policy: undefined as unknown,
	settings: {} as Record<string, string | undefined>,
}));

vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getProjectSetting: async (_projectId: string, _category: string, key: string) => state.settings[key],
	};
});
vi.mock("../sandbox-manager.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		resolveTaskPolicy: async () => state.policy,
		startSandboxSession: async () => ({ id: "session-1" }),
	};
});

let work: string;
let bin: string;
let restorePath: () => void;
const rec: Record<string, string> = {};
const savedEnv: Record<string, string | undefined> = {};
let n = 0;

async function outcome<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
	try {
		return { ok: true, value: await p };
	} catch (error) {
		return { ok: false, error };
	}
}

const policy = (isolationLevel: string) => ({
	id: "pol",
	projectId: "p1",
	isolationLevel,
	allowedTools: [],
	deniedTools: [],
	filesystemScope: [],
	networkPolicy: "project_only",
	maxExecutionTimeMs: 300_000,
	maxOutputSizeBytes: 10_485_760,
	elevatedCapabilities: [],
	enforcementMode: "hard",
});

// Package-manager fakes that mimic the dangerous behaviours, honouring the same precedence as the real tools.
const NPM_SIMULATE = `
const { execFileSync } = require("child_process");
const argv = process.argv.slice(2);
try {
	const rc = fs.readFileSync(".npmrc", "utf8");
	const m = /^git\\s*=\\s*(\\S+)/m.exec(rc);
	const flag = argv.find((a) => a.startsWith("--git="));
	const eff = (flag ? flag.slice(6) : "") || process.env.npm_config_git || process.env.NPM_CONFIG_GIT || (m && m[1]) || "";
	if (eff && eff !== "git") execFileSync("/bin/sh", [eff], { stdio: "ignore" });
} catch {}
`;
const YARN_SIMULATE = `
const { execFileSync } = require("child_process");
const path = require("path");
try {
	const rc = fs.readFileSync(".yarnrc.yml", "utf8");
	const m = /plugins:\\s*\\n\\s*-\\s*path:\\s*(\\S+)/.exec(rc);
	if (m) execFileSync("/bin/sh", [path.resolve(m[1])], { stdio: "ignore" });
} catch {}
`;

beforeAll(() => {
	work = freshTmp("oscx-i0-rf-");
	bin = join(work, "bin");
	mkdirSync(bin);
	rec.npm = makeFakeBin(bin, "npm", { extra: NPM_SIMULATE });
	rec.pnpm = makeFakeBin(bin, "pnpm");
	rec.yarn = makeVersionedYarn(bin, { extra: YARN_SIMULATE });
	// npx mimics npx resolving a repo-local ./node_modules/.bin/sonar-scanner first
	rec.npx = makeFakeBin(bin, "npx", {
		stdout: "ok",
		extra: `
try {
	const local = require("path").join(process.cwd(), "node_modules", ".bin", "sonar-scanner");
	if (fs.existsSync(local)) require("child_process").execFileSync(local, { stdio: "ignore" });
} catch {}
`,
	});
	restorePath = prependPath(bin);
	for (const k of ["SONAR_ENABLED", "SONAR_TOKEN", "SONAR_HOST_URL"]) savedEnv[k] = process.env[k];
});
afterAll(() => {
	restorePath();
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
	for (const f of Object.values(rec)) rmSync(f, { force: true });
	state.settings = {};
});

// ---------------------------------------------------------------------------
// C. sandbox fail-closed
// ---------------------------------------------------------------------------

describe("C: a container/vm isolation level fails the task setup; the agent never gets the source repo", () => {
	for (const level of ["container", "vm"]) {
		it(`setupSandboxExecution rejects for isolationLevel "${level}" instead of falling back to the source repo`, async () => {
			const { setupSandboxExecution } = await import("../execution/sandbox-execution-guard.js");
			const repo = freshTmp("oscx-i0-rf-src-");
			try {
				state.policy = policy(level);
				const result = await outcome(setupSandboxExecution("p1", { id: "t1" } as never, "agent-1", "developer", repo));
				// today the error is swallowed ("non-blocking") and runtimeRepoPath stays the source repo
				expect(result.ok).toBe(false);
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});
	}

	it("workspace isolation still yields an isolated copy (regression)", async () => {
		const { setupSandboxExecution } = await import("../execution/sandbox-execution-guard.js");
		const repo = freshTmp("oscx-i0-rf-src-");
		writeFileSync(join(repo, "a.txt"), "a\n");
		state.policy = policy("workspace");
		const ctx = await setupSandboxExecution("p1", { id: "t-ws" } as never, "agent-1", "developer", repo);
		try {
			expect(ctx.isolatedWorkspace?.isolated).toBe(true);
			expect(ctx.runtimeRepoPath).not.toBe(repo);
		} finally {
			await ctx.isolatedWorkspace?.cleanup();
			rmSync(repo, { recursive: true, force: true });
		}
	});

	for (const level of ["Container", "VM", "foo", ""]) {
		it(`resolveWorkspace does not map the unknown level ${JSON.stringify(level)} to local`, async () => {
			const { resolveWorkspace } = await import("../execution-workspace.js");
			const repo = freshTmp("oscx-i0-rf-src-");
			try {
				const result = await outcome(resolveWorkspace(repo, "t1", policy(level) as never));
				expect(result.ok).toBe(false);
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});
	}
});

// ---------------------------------------------------------------------------
// D. isolated-workspace write-back
// ---------------------------------------------------------------------------

describe("D: write-back never touches a `.git` path", () => {
	it("rejects `.git/config`, `.GIT/config` and `sub/.git/hooks/x`; the source `.git/config` is unchanged", async () => {
		const { prepareIsolatedWorkspace } = await import("../isolated-workspace.js");
		const source = freshTmp("oscx-i0-rf-wb-");
		try {
			mkdirSync(join(source, ".git", "hooks"), { recursive: true });
			mkdirSync(join(source, "sub", ".git", "hooks"), { recursive: true });
			mkdirSync(join(source, "src"));
			writeFileSync(join(source, ".git", "config"), "[core]\n\tbare = false\n");
			writeFileSync(join(source, "src", "ok.txt"), "ok v1\n");
			const ws = await prepareIsolatedWorkspace(source, "t-wb", policy("workspace") as never);
			expect(ws.isolated).toBe(true);
			// the agent (inside the workspace copy) plants hostile content
			const evil = "[core]\n\tfsmonitor = touch /tmp/oscx-should-never-exist\n";
			writeFileSync(join(ws.repoPath, ".git", "config"), evil);
			mkdirSync(join(ws.repoPath, ".GIT"), { recursive: true });
			writeFileSync(join(ws.repoPath, ".GIT", "config"), evil);
			writeFileSync(join(ws.repoPath, "sub", ".git", "hooks", "x"), "#!/bin/sh\ntouch /tmp/oscx-hook\n");
			writeFileSync(join(ws.repoPath, "src", "ok.txt"), "ok v2\n");
			try {
				const synced = await ws.writeBack([".git/config", ".GIT/config", "sub/.git/hooks/x", "src/ok.txt"]);
				expect(synced).toEqual(["src/ok.txt"]);
				expect(readFileSync(join(source, ".git", "config"), "utf8")).toBe("[core]\n\tbare = false\n");
				expect(existsSync(join(source, "sub", ".git", "hooks", "x"))).toBe(false);
				expect(readFileSync(join(source, "src", "ok.txt"), "utf8")).toBe("ok v2\n");
			} finally {
				await ws.cleanup();
			}
		} finally {
			rmSync(source, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// E. contained-fs
// ---------------------------------------------------------------------------

describe("E: contained-fs only reads regular files", () => {
	it.skipIf(process.platform === "win32")("a FIFO is rejected promptly (no blocking open)", async () => {
		const { gitManager } = await import("../git-manager.js");
		const repo = freshTmp("oscx-i0-rf-fifo-");
		const fifo = join(repo, "pipe");
		execFileSync("mkfifo", [fifo]);
		let fd: number | undefined;
		try {
			const call = gitManager.getFileContent(repo, "pipe").then(
				() => "returned",
				() => "rejected",
			);
			const timer = new Promise<string>((r) => setTimeout(() => r("hang"), 2000));
			const result = await Promise.race([call, timer]);
			// release a reader that is still blocked in open() so the test process can exit
			fd = openSync(fifo, constants.O_RDWR);
			await Promise.race([call, new Promise((r) => setTimeout(r, 1000))]);
			expect(result).toBe("rejected");
		} finally {
			if (fd !== undefined) closeSync(fd);
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// F. SonarQube
// ---------------------------------------------------------------------------

describe("F: SonarQube is disabled until workload isolation (I5)", () => {
	const TOKEN = "squ_i0_platform_token_0123456789";
	let repo: string;
	let canary: string;

	beforeEach(() => {
		repo = join(work, `sonar-repo-${++n}`);
		mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
		writeFileSync(join(repo, "sonar-project.properties"), "sonar.projectKey=x\n");
		canary = join(work, `sonar-canary-${n}`);
		const local = join(repo, "node_modules", ".bin", "sonar-scanner");
		writeFileSync(local, `#!/bin/sh\ntouch ${canary}\n`);
		chmodSync(local, 0o755);
		process.env.SONAR_ENABLED = "true";
		process.env.SONAR_TOKEN = TOKEN;
		process.env.SONAR_HOST_URL = "http://localhost:9000";
		state.settings = { enabled: "true", hostUrl: "https://evil.example", token: "squ_tenant_token" };
	});
	afterEach(() => vi.unstubAllGlobals());

	it("isSonarEnabled is false whatever the env or the project settings say", async () => {
		const { isSonarEnabled } = await import("../sonar-runner.js");
		expect(await isSonarEnabled()).toBe(false);
		expect(await isSonarEnabled("p1")).toBe(false);
	});

	it("runSonarScan never spawns anything: no token on argv or env, no repo-local scanner executed", async () => {
		const { runSonarScan } = await import("../sonar-runner.js");
		await runSonarScan(repo, undefined, "p1");
		await runSonarScan(repo);
		expect(readInvocations(rec.npx)).toEqual([]);
		expect(existsSync(canary)).toBe(false);
	});

	it("fetchQualityGate makes no outbound call, so no token can reach a tenant-supplied host", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const { fetchQualityGate } = await import("../sonar-runner.js");
		const gate = await fetchQualityGate("x", "p1");
		expect(gate.status).toBe("NONE");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("project creation cannot reach initSonarConfig: every call site is behind isSonarEnabled()", () => {
		// isSonarEnabled() is false (above), so a guarded initSonarConfig never runs. An unguarded call would.
		const dir = join(KERNEL_SRC, "studio");
		const offenders: string[] = [];
		const walk = (d: string) => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				if (e.name === "__tests__" || e.name === "node_modules") continue;
				const p = join(d, e.name);
				if (e.isDirectory()) walk(p);
				else if (p.endsWith(".ts") && !p.endsWith("sonar-runner.ts")) {
					const lines = readFileSync(p, "utf8").split("\n");
					lines.forEach((line, i) => {
						if (!/\binitSonarConfig\(/.test(line)) return;
						const context = lines.slice(Math.max(0, i - 15), i).join("\n");
						if (!/isSonarEnabled\(/.test(context)) offenders.push(`${p}:${i + 1}`);
					});
				}
			}
		};
		walk(dir);
		expect(offenders).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// G. installs
// ---------------------------------------------------------------------------

describe("G: install hardening — npm git, yarn plugins, quoted yarnPath", () => {
	function mkRepo(lock: "yarn.lock" | "package-lock.json", extra: Record<string, string> = {}) {
		const repo = join(work, `install-repo-${++n}`);
		mkdirSync(repo);
		const canary = join(work, `install-canary-${n}`);
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify({
				name: "victim",
				dependencies: { "left-pad": "1.3.0", gitdep: "git+https://example.invalid/x.git" },
			}),
		);
		writeFileSync(join(repo, lock), "");
		for (const [name, content] of Object.entries(extra)) writeFileSync(join(repo, name), content);
		return { repo, canary };
	}
	const canaries = (canary: string) => readdirSync(work).filter((f) => f.startsWith(canary.split("/").pop() ?? "?"));

	function script(path: string, canary: string) {
		writeFileSync(path, `touch ${canary}\n`);
		chmodSync(path, 0o755);
	}

	it("npm: a repo .npmrc `git=<script>` is never executed by the install", async () => {
		const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
		const { repo, canary } = mkRepo("package-lock.json");
		const evilGit = join(work, `evil-git-${n}.sh`);
		script(evilGit, canary);
		writeFileSync(join(repo, ".npmrc"), `git=${evilGit}\n`);
		syncDeclaredDependencies(repo, 20_000);
		const [inv] = readInvocations(rec.npm);
		expect(inv).toBeDefined();
		expect(canaries(canary)).toEqual([]);
		// the install forces the real git binary (flag or environment)
		const forced =
			inv.argv.includes("--git=git") || inv.env.npm_config_git === "git" || inv.env.NPM_CONFIG_GIT === "git";
		expect(forced).toBe(true);
	});

	it("yarn: a `.yarnrc.yml` with `plugins:` is refused with a clear error; yarn never runs and no plugin canary fires", async () => {
		const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
		const { repo, canary } = mkRepo("yarn.lock");
		script(join(repo, "evil-plugin.cjs"), canary);
		writeFileSync(join(repo, ".yarnrc.yml"), "plugins:\n  - path: ./evil-plugin.cjs\n    spec: evil\n");
		const result = syncDeclaredDependencies(repo, 20_000);
		expect(result.ok).toBe(false);
		expect(result.ranInstall).toBe(false);
		expect(result.error ?? "").toMatch(/yarnrc/i);
		expect(readInvocations(rec.yarn)).toEqual([]);
		expect(canaries(canary)).toEqual([]);
	});

	for (const [label, rc] of [
		["double-quoted", '"yarnPath": .yarn/releases/evil.cjs\n'],
		["single-quoted", "'yarnPath': .yarn/releases/evil.cjs\n"],
		["quoted, space-before-colon", '"yarnPath" : .yarn/releases/evil.cjs\n'],
	] as const) {
		it(`yarn: a ${label} yarnPath key is refused like the unquoted form`, async () => {
			const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
			const { repo, canary } = mkRepo("yarn.lock", { ".yarnrc.yml": rc });
			mkdirSync(join(repo, ".yarn", "releases"), { recursive: true });
			script(join(repo, ".yarn", "releases", "evil.cjs"), canary);
			const outcomeSync = syncDeclaredDependencies(repo, 20_000);
			expect(outcomeSync.ok).toBe(false);
			expect(outcomeSync.error ?? "").toMatch(/yarnrc/i);
			expect(readInvocations(rec.yarn)).toEqual([]);
			expect(canaries(canary)).toEqual([]);
		});
	}
});
