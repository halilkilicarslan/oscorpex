// ---------------------------------------------------------------------------
// I0 round 3 — git cases:
//   B1  a conflicting merge returns success:false and leaves a clean tree, in any locale; clean merges succeed;
//   B2  harmless keys that real repos carry never make the allow-list refuse;
//   B3  a registered submodule (`.gitmodules` with `ignore = none`) cannot run its own filters through the
//       kernel's getStatus, the terminal git_status/git_diff route, or the mcp read-only gitStatus;
//   B9  a refused repo never leaks its absolute server path in an error body.
// Canaries are `touch <markers>/<name>`; each trap has a precondition proving it is live under plain git.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ws = await vi.hoisted(async () => {
	// the workspace root is read once at import time: fix it before anything is imported
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oscx-i0-r3-ws-")));
	process.env.OSCORPEX_WORKSPACE_ROOT = root;
	process.env.OSCORPEX_ENABLE_TERMINAL_EXEC = "true";
	return { root, repoPath: "" };
});

vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getProject: async (id: string) => (id === "p1" ? { id: "p1", name: "p1", repoPath: ws.repoPath } : undefined),
	};
});

import { gitManager } from "../git-manager.js";
import { freshTmp } from "./helpers/i0-fakes.js";

let work: string;
let repo: string;
let markers: string;
const savedLocale: Record<string, string | undefined> = {};

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: tmpdir(),
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
		},
	});
}
const touch = (name: string) => `touch ${join(markers, name)}`;
const fired = () => readdirSync(markers).sort();
const clearMarkers = () => {
	for (const f of readdirSync(markers)) rmSync(join(markers, f), { force: true });
};
const commitAll = (cwd: string, message: string) => {
	git(cwd, ["add", "-A"]);
	git(cwd, ["commit", "-q", "-m", message]);
};
function initRepo(dir: string) {
	mkdirSync(dir, { recursive: true });
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.name", "t"]);
	git(dir, ["config", "user.email", "t@example.test"]);
	git(dir, ["config", "commit.gpgsign", "false"]);
}
async function outcome<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
	try {
		return { ok: true, value: await p };
	} catch (error) {
		return { ok: false, error };
	}
}

beforeEach(() => {
	work = freshTmp("oscx-i0-r3-git-");
	markers = join(work, "markers");
	mkdirSync(markers);
	// every repo lives where the mcp workspace resolver looks: <root>/t1/p1
	repo = join(ws.root, "t1", "p1");
	rmSync(join(ws.root, "t1"), { recursive: true, force: true });
	ws.repoPath = repo;
	initRepo(repo);
	writeFileSync(join(repo, "a.txt"), "a v1\n");
	writeFileSync(join(repo, "m.txt"), "base\n");
	commitAll(repo, "seed");
	for (const k of ["LC_ALL", "LANG"]) savedLocale[k] = process.env[k];
});
afterEach(() => {
	for (const [k, v] of Object.entries(savedLocale)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	rmSync(work, { recursive: true, force: true });
});
afterAll(() => rmSync(ws.root, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// B1. merge conflicts
// ---------------------------------------------------------------------------

describe("B1: a conflicting merge is detected structurally and leaves a clean tree", () => {
	function conflictingBranches() {
		git(repo, ["checkout", "-q", "-b", "other"]);
		writeFileSync(join(repo, "m.txt"), "other side\n");
		commitAll(repo, "other");
		git(repo, ["checkout", "-q", "main"]);
		writeFileSync(join(repo, "m.txt"), "main side\n");
		commitAll(repo, "main");
	}

	for (const [label, env] of [
		["LC_ALL=C", { LC_ALL: "C", LANG: "C" }],
		["Turkish locale", { LC_ALL: "tr_TR.UTF-8", LANG: "tr_TR.UTF-8" }],
	] as const) {
		it(`returns success:false and leaves no merge state or conflict markers (${label})`, async () => {
			Object.assign(process.env, env);
			conflictingBranches();
			const result = await gitManager.merge(repo, "other", "main");
			expect(result.success).toBe(false);
			expect(result.conflicts ?? []).toContain("m.txt");
			expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
			expect(readFileSync(join(repo, "m.txt"), "utf8")).toBe("main side\n");
			expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
		});
	}

	it("a non-conflicting merge still succeeds", async () => {
		git(repo, ["checkout", "-q", "-b", "feature"]);
		writeFileSync(join(repo, "feature.txt"), "feature\n");
		commitAll(repo, "feature");
		git(repo, ["checkout", "-q", "main"]);
		const result = await gitManager.merge(repo, "feature", "main");
		expect(result.success).toBe(true);
		expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("feature\n");
	});
});

// ---------------------------------------------------------------------------
// B2. harmless keys
// ---------------------------------------------------------------------------

describe("B2: common harmless config keys do not make kernel git operations refuse", () => {
	const KEYS: [string, string][] = [
		["branch.main.vscode-merge-base", "origin/main"],
		["branch.main.pushremote", "origin"],
		["branch.main.description", "the main branch"],
		["remote.origin.url", "https://example.test/org/repo.git"],
		["remote.origin.tagopt", "--no-tags"],
		["remote.origin.prune", "true"],
		["remote.origin.push", "refs/heads/main"],
		["core.untrackedcache", "true"],
		["core.sparsecheckout", "false"],
	];
	for (const [key, value] of KEYS) {
		it(`${key}`, async () => {
			git(repo, ["config", key, value]);
			const status = await gitManager.getStatus(repo);
			expect(status.modified).toEqual([]);
			expect(await gitManager.listBranches(repo)).toContain("main");
			expect((await gitManager.getLog(repo)).length).toBeGreaterThan(0);
		});
	}

	it("core.sparsecheckout=true (a real sparse repo) is not refused either", async () => {
		git(repo, ["config", "core.sparsecheckout", "true"]);
		await expect(gitManager.getStatus(repo)).resolves.toBeDefined();
		await expect(gitManager.listBranches(repo)).resolves.toContain("main");
	});
});

// ---------------------------------------------------------------------------
// B3. submodules
// ---------------------------------------------------------------------------

describe("B3: a registered, populated submodule cannot run commands (.gitmodules ignore = none)", () => {
	function plantSubmodule() {
		const sub = join(repo, "s");
		initRepo(sub);
		writeFileSync(join(sub, ".gitattributes"), "s.txt filter=s\n");
		writeFileSync(join(sub, "s.txt"), "s v1\n");
		commitAll(sub, "sub seed");
		appendFileSync(
			join(sub, ".git", "config"),
			['[filter "s"]', `\tclean = ${touch("sub-clean")}`, `\tsmudge = ${touch("sub-smudge")}`, ""].join("\n"),
		);
		writeFileSync(join(repo, ".gitmodules"), '[submodule "s"]\n\tpath = s\n\turl = ./s\n\tignore = none\n');
		git(repo, ["add", ".gitmodules"]);
		git(repo, ["add", "s"]);
		git(repo, ["commit", "-q", "-m", "add submodule"]);
		// same-size edit: git has to run the clean filter to tell whether the file changed
		writeFileSync(join(sub, "s.txt"), "s v2\n");
		clearMarkers();
	}

	it("precondition: plain `git status` in the parent runs the submodule's clean filter", () => {
		plantSubmodule();
		git(repo, ["status", "--porcelain"]);
		expect(fired()).toContain("sub-clean");
	});

	it("gitManager.getStatus fires no canary", async () => {
		plantSubmodule();
		await outcome(gitManager.getStatus(repo));
		expect(fired()).toEqual([]);
	});

	for (const command of ["git_status", "git_diff"]) {
		it(`terminal ${command} fires no canary`, async () => {
			plantSubmodule();
			const { terminalRoutes } = await import("../routes/terminal-routes.js");
			const app = new Hono();
			app.route("/", terminalRoutes);
			await app.request("/projects/p1/terminal/exec", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ command }),
			});
			expect(fired()).toEqual([]);
		});
	}

	it("mcp read-only gitStatus fires no canary", async () => {
		plantSubmodule();
		const { gitStatus } = await import("../mcp-bridge/read-only-tools.js");
		await gitStatus({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "gitStatus",
			args: {},
			source: "system",
		});
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// B9. error bodies carry no server path
// ---------------------------------------------------------------------------

describe("B9: a refused repo never leaks its absolute path in an error response", () => {
	const leaks = (text: string) =>
		text.includes(repo) ||
		text.includes(ws.root) ||
		text.includes(realpathSync(tmpdir())) ||
		/\/(var|tmp|private|Users)\//.test(text);

	beforeEach(() => {
		// an unknown key makes the allow-list refuse this repo
		appendFileSync(join(repo, ".git", "config"), "[oscx]\n\tprobe = 1\n");
	});

	for (const path of ["/projects/p1/git/status", "/projects/p1/git/diff", "/projects/p1/git/branches"]) {
		it(`GET ${path}`, async () => {
			const { gitFileRoutes } = await import("../routes/git-file-routes.js");
			const app = new Hono();
			app.route("/", gitFileRoutes);
			const res = await app.request(path);
			const body = await res.text();
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(leaks(body), `body leaks a path: ${body}`).toBe(false);
		});
	}

	it("POST /projects/p1/terminal/exec git_status", async () => {
		const { terminalRoutes } = await import("../routes/terminal-routes.js");
		const app = new Hono();
		app.route("/", terminalRoutes);
		const res = await app.request("/projects/p1/terminal/exec", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ command: "git_status" }),
		});
		const body = await res.text();
		expect(leaks(body), `body leaks a path: ${body}`).toBe(false);
	});

	it("mcp read-only gitStatus", async () => {
		const { gitStatus } = await import("../mcp-bridge/read-only-tools.js");
		const result = await gitStatus({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "gitStatus",
			args: {},
			source: "system",
		});
		expect(result.ok).toBe(false);
		expect(leaks(JSON.stringify(result)), `result leaks a path: ${JSON.stringify(result)}`).toBe(false);
	});
});
