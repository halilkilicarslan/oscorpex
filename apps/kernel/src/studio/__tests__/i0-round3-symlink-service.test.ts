// ---------------------------------------------------------------------------
// I0 round 3 — N3: a service directory that is a SYMLINK. yarn walks up from the REAL cwd, so the install guard must
// judge the real path: `frontend -> a/b/c` inherits `a/b/.yarnrc.yml` (plugins), and `frontend -> <outside>/app` leaves
// the repo altogether. Both are refused before any `yarn --version` probe; nothing may run. Regression: a normal,
// non-symlinked service directory still installs.
// Entry points: hardenInstall / hardenInstallCommand (with repoRoot) and POST /projects/:id/runtime/install.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	freshTmp,
	makeFakeBin,
	makeVersionedYarn,
	prependPath,
	readInvocations,
	yarnVersionProbes,
} from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const st = vi.hoisted(() => ({ repoPath: "", services: [] as unknown[] }));

vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, getProject: async () => ({ id: "p1", name: "p1", repoPath: st.repoPath }) };
});
vi.mock("../runtime-analyzer.js", () => ({
	analyzeProject: () => ({ services: st.services }),
	writeEnvFile: vi.fn(),
	generateStudioConfig: vi.fn(),
}));
vi.mock("../app-runner.js", () => ({
	getAppStatus: vi.fn(),
	getResolvedConfig: vi.fn(),
	startApp: vi.fn(),
	stopApp: vi.fn(),
	switchPreviewService: vi.fn(),
}));
vi.mock("../db-provisioner.js", () => ({
	getDbConnectionInfo: vi.fn(),
	getDbStatus: vi.fn(),
	parseCloudUrl: vi.fn(),
	provisionDatabase: vi.fn(),
	stopAllDatabases: vi.fn(),
	stopDatabase: vi.fn(),
}));
vi.mock("../routes/team-init-guard.js", () => ({ ensureProjectTeamInitialized: vi.fn() }));

import { hardenInstall, hardenInstallCommand } from "../safe-install.js";

let work: string;
let bin: string;
let repo: string;
let outside: string;
let canary: string;
let restorePath: () => void;
const rec: Record<string, string> = {};

function git(cwd: string, args: string[]) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: work,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
		},
	});
}

const yarnInvocations = () => readInvocations(rec.yarn).length;
const anyInstallerRan = () => [rec.yarn, rec.npm].some((f) => readInvocations(f).length > 0);

beforeAll(() => {
	work = freshTmp("oscx-i0-r3-symsvc-");
	bin = join(work, "bin");
	mkdirSync(bin);
	rec.yarn = makeVersionedYarn(bin);
	rec.npm = makeFakeBin(bin, "npm");
	restorePath = prependPath(bin);
});
afterAll(() => {
	restorePath();
	rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
	for (const f of Object.values(rec)) rmSync(f, { force: true });
	rmSync(join(bin, "yarn-version-probes.log"), { force: true });
	rmSync(join(work, "repo"), { recursive: true, force: true });
	rmSync(join(work, "outside"), { recursive: true, force: true });
	repo = join(work, "repo");
	outside = join(work, "outside");
	canary = join(work, "plugin-canary");
	rmSync(canary, { force: true });
	mkdirSync(repo);
	git(repo, ["init", "-q", "-b", "main"]);
	git(repo, ["config", "user.name", "t"]);
	git(repo, ["config", "user.email", "t@example.test"]);
	st.repoPath = repo;
});

const SERVICE_FILES = (yarnVersion = "4.5.0") => ({
	"package.json": JSON.stringify({ name: "frontend", packageManager: `yarn@${yarnVersion}` }),
	"yarn.lock": "",
	".fake-yarn-version": `${yarnVersion}\n`,
});
function writeFiles(dir: string, files: Record<string, string>) {
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}
function plantPlugin(dir: string) {
	writeFileSync(join(dir, "evil-plugin.cjs"), `touch ${canary}\n`);
	chmodSync(join(dir, "evil-plugin.cjs"), 0o755);
	writeFileSync(join(dir, ".yarnrc.yml"), "plugins:\n  - path: ./evil-plugin.cjs\n");
}

async function runtimeInstall(path: string, installCommand = "yarn install") {
	st.services = [{ name: "frontend", path, installCommand }];
	const { runtimeRoutes } = await import("../routes/runtime-routes.js");
	const app = new Hono();
	app.route("/", runtimeRoutes);
	const res = await app.request("/projects/p1/runtime/install", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ serviceName: "frontend" }),
	});
	return (await res.json()) as { results: { name: string; success: boolean; error?: string }[] };
}

describe("N3: `frontend -> a/b/c` inherits a/b/.yarnrc.yml (plugins)", () => {
	function plant() {
		writeFiles(join(repo, "a", "b", "c"), SERVICE_FILES());
		plantPlugin(join(repo, "a", "b"));
		symlinkSync(join("a", "b", "c"), join(repo, "frontend"));
		git(repo, ["add", "-A"]);
		git(repo, ["commit", "-q", "-m", "monorepo with a symlinked service"]);
	}

	it("hardenInstallCommand refuses, makes zero version probes, fires no plugin canary", () => {
		plant();
		const r = hardenInstallCommand("yarn install", join(repo, "frontend"), repo);
		expect(r.ok).toBe(false);
		expect(yarnVersionProbes(bin)).toBe(0);
		expect(yarnInvocations()).toBe(0);
		expect(existsSync(canary)).toBe(false);
	});

	it("hardenInstall(yarn) refuses the same way", () => {
		plant();
		const h = hardenInstall("yarn", join(repo, "frontend"), repo);
		expect(h.ok).toBe(false);
		expect(yarnVersionProbes(bin)).toBe(0);
	});

	it("POST /runtime/install for the service is refused: no probe, no yarn run, no canary", async () => {
		plant();
		const { results } = await runtimeInstall("frontend");
		expect(results[0].success).toBe(false);
		expect(yarnVersionProbes(bin)).toBe(0);
		expect(yarnInvocations()).toBe(0);
		expect(existsSync(canary)).toBe(false);
	});
});

describe("N3: `frontend -> <outside>/app` leaves the repo root", () => {
	function plant() {
		writeFiles(join(outside, "app"), SERVICE_FILES("1.22.22")); // no .yarnrc anywhere: only the escape is wrong
		symlinkSync(join(outside, "app"), join(repo, "frontend"));
		git(repo, ["add", "-A"]);
		git(repo, ["commit", "-q", "-m", "escaping symlink"]);
	}

	for (const command of ["yarn install", "npm install", "pnpm install"]) {
		it(`hardenInstallCommand refuses "${command}": the real cwd is not inside the real repo root`, () => {
			plant();
			const r = hardenInstallCommand(command, join(repo, "frontend"), repo);
			expect(r.ok).toBe(false);
			expect(yarnVersionProbes(bin)).toBe(0);
		});
	}

	it("POST /runtime/install for the service is refused and no installer runs", async () => {
		plant();
		const { results } = await runtimeInstall("frontend");
		expect(results[0].success).toBe(false);
		expect(anyInstallerRan()).toBe(false);
		expect(yarnVersionProbes(bin)).toBe(0);
	});

	it("POST /runtime/install with npm for the escaping service is refused too", async () => {
		plant();
		const { results } = await runtimeInstall("frontend", "npm install");
		expect(results[0].success).toBe(false);
		expect(anyInstallerRan()).toBe(false);
	});
});

describe("regression: a normal, non-symlinked service directory still installs", () => {
	it("hardenInstallCommand: yarn 1.x and npm", () => {
		writeFiles(join(repo, "svc"), SERVICE_FILES("1.22.22"));
		const y = hardenInstallCommand("yarn install", join(repo, "svc"), repo);
		expect(y.ok).toBe(true);
		expect(y.command).toContain("--ignore-scripts");
		const n = hardenInstallCommand("npm install", join(repo, "svc"), repo);
		expect(n.ok).toBe(true);
		expect(n.command).toContain("--ignore-scripts");
	});

	it("POST /runtime/install runs the hardened install exactly once", async () => {
		writeFiles(join(repo, "svc"), SERVICE_FILES("1.22.22"));
		const { results } = await runtimeInstall("svc");
		expect(results[0].success).toBe(true);
		const runs = readInvocations(rec.yarn);
		expect(runs).toHaveLength(1);
		expect(runs[0].argv).toContain("--ignore-scripts");
	});
});
