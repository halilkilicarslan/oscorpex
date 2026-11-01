// ---------------------------------------------------------------------------
// I0 round 3 (security re-check) — N4: a populated submodule with `.gitmodules` `ignore = none` and a dirty file.
// Git runs status inside the submodule (and so its repo-controlled clean filter) whenever it LISTS local changes:
//   (a) after a branch switch (`git checkout` prints the local changes unless --quiet),
//   (b) the kernel merge path, which checks out the target branch first,
//   (c) the checkpoint-restore checkout,
//   (d) `git commit` with nothing to commit (it prints a full status).
// None of these may fire the canary through the kernel. Each has a precondition proving plain git does fire it.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitManager } from "../git-manager.js";
import { freshTmp } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const cp = vi.hoisted(() => ({ repoPath: "" }));

vi.mock("../checkpoint/checkpoint-repo.js", () => ({
	getCheckpoint: async () => ({
		id: "cp1",
		projectId: "p1",
		tenantId: "t1",
		type: "git",
		ref: "main",
		riskLevel: "low",
		metadata: { repoPath: cp.repoPath },
	}),
	createRollbackRequest: async () => "rb1",
	updateRollbackStatus: async () => undefined,
	markCheckpointRolledBack: async () => undefined,
	createCheckpoint: async () => undefined,
	listProjectCheckpoints: async () => [],
}));
vi.mock("../security/tool-policy-enforcer.js", () => ({
	ToolPolicyDeniedError: class ToolPolicyDeniedError extends Error {},
	enforceToolPolicy: () => undefined,
}));

let work: string;
let repo: string;
let markers: string;

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
async function outcome<T>(p: Promise<T>) {
	try {
		return { ok: true as const, value: await p };
	} catch (error) {
		return { ok: false as const, error };
	}
}

/**
 * main and `other` differ in a.txt (so switching rewrites the tree); the registered submodule `s` is populated,
 * carries a filter canary in its own config, and has a same-size dirty edit. HEAD is left on `other`.
 */
function plant() {
	writeFileSync(join(repo, "a.txt"), "a on main\n");
	const sub = join(repo, "s");
	initRepo(sub);
	writeFileSync(join(sub, ".gitattributes"), "s.txt filter=s\n");
	writeFileSync(join(sub, "s.txt"), "s v1\n");
	commitAll(sub, "sub seed");
	writeFileSync(join(repo, ".gitmodules"), '[submodule "s"]\n\tpath = s\n\turl = ./s\n\tignore = none\n');
	commitAll(repo, "main with submodule");
	git(repo, ["checkout", "-q", "-b", "other"]);
	writeFileSync(join(repo, "a.txt"), "a on other, longer\n");
	git(repo, ["add", "a.txt"]);
	git(repo, ["commit", "-q", "-m", "other"]);
	appendFileSync(
		join(sub, ".git", "config"),
		['[filter "s"]', `\tclean = ${touch("sub-clean")}`, `\tsmudge = ${touch("sub-smudge")}`, ""].join("\n"),
	);
	// same-size edit: git has to run the clean filter to tell whether the file changed
	writeFileSync(join(sub, "s.txt"), "s v2\n");
	clearMarkers();
}

beforeEach(() => {
	work = freshTmp("oscx-i0-r3-sub-");
	markers = join(work, "markers");
	mkdirSync(markers);
	repo = join(work, "repo");
	cp.repoPath = repo;
	initRepo(repo);
	writeFileSync(join(repo, "seed.txt"), "seed\n");
	commitAll(repo, "seed");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("N4a: branch switch", () => {
	it("precondition: plain `git checkout main` (not --quiet) lists local changes and runs the submodule filter", () => {
		plant();
		git(repo, ["checkout", "main"]);
		expect(fired()).toContain("sub-clean");
	});

	it("gitManager.checkout fires no canary", async () => {
		plant();
		await outcome(gitManager.checkout(repo, "main"));
		await outcome(gitManager.getStatus(repo));
		expect(fired()).toEqual([]);
	});
});

describe("N4b: kernel merge (checks out the target branch first)", () => {
	it("precondition: plain `git checkout main` fires the canary", () => {
		plant();
		git(repo, ["checkout", "main"]);
		expect(fired()).toContain("sub-clean");
	});

	it("gitManager.merge fires no canary", async () => {
		plant();
		await outcome(gitManager.merge(repo, "other", "main"));
		expect(fired()).toEqual([]);
	});

	it("gitManager.mergeBranch fires no canary", async () => {
		plant();
		await outcome(gitManager.mergeBranch(repo, "other", "main"));
		expect(fired()).toEqual([]);
	});
});

describe("N4c: checkpoint restore", () => {
	it("precondition: plain `git checkout <ref>` fires the canary", () => {
		plant();
		git(repo, ["checkout", "main"]);
		expect(fired()).toContain("sub-clean");
	});

	it("requestRollback (git checkpoint) fires no canary", async () => {
		plant();
		const { requestRollback } = await import("../checkpoint/checkpoint-service.js");
		const result = await requestRollback({
			checkpointId: "cp1",
			projectId: "p1",
			tenantId: "t1",
			requestedBy: "u1",
			dryRun: false,
		} as never);
		// the checkout really ran (a blocked/failed rollback would make the canary check vacuous)
		expect(result.status, JSON.stringify(result)).toBe("applied");
		expect(fired()).toEqual([]);
	});
});

describe("N4d: commit with nothing to commit", () => {
	it("precondition: plain `git commit` with nothing staged prints a status and runs the submodule filter", () => {
		plant();
		try {
			git(repo, ["commit", "-m", "empty"]);
		} catch {
			/* exits 1: nothing to commit */
		}
		expect(fired()).toContain("sub-clean");
	});

	it("gitManager.commit fires no canary", async () => {
		plant();
		await outcome(gitManager.commit(repo, "nothing to commit"));
		expect(fired()).toEqual([]);
	});

	it("gitManager.commitChanges fires no canary", async () => {
		plant();
		await outcome(gitManager.commitChanges(repo, "nothing to commit"));
		expect(fired()).toEqual([]);
	});

	it("gitManager.commitFiles fires no canary", async () => {
		plant();
		await outcome(gitManager.commitFiles(repo, ["a.txt"], "nothing to commit"));
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// N4e: commits with an explicit file list on a repo that has a dirty submodule and a real staged change
// ---------------------------------------------------------------------------

describe("N4e: explicit file lists never touch the submodule or expand pathspec magic", () => {
	const gitlink = () => git(repo, ["ls-tree", "HEAD", "s"]).trim();
	const headSha = () => git(repo, ["rev-parse", "HEAD"]).trim();
	const committedNames = () =>
		git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter(Boolean);

	/** a.txt carries a real, staged change; s/ keeps its dirty file. */
	function stageRealChange() {
		plant();
		writeFileSync(join(repo, "a.txt"), "a with a real staged change\n");
		git(repo, ["add", "a.txt"]);
		clearMarkers();
	}

	for (const [label, run] of [
		["commitFiles", (files: string[]) => gitManager.commitFiles(repo, files, "explicit files")],
		["commitChanges", (files: string[]) => gitManager.commitChanges(repo, "explicit files", files)],
	] as const) {
		it(`${label}(["a.txt", "s"]) fires no canary and never changes the gitlink`, async () => {
			stageRealChange();
			const before = { link: gitlink(), head: headSha() };
			const result = await outcome(run(["a.txt", "s"]));
			expect(fired()).toEqual([]);
			expect(gitlink()).toBe(before.link);
			if (result.ok && headSha() !== before.head) expect(committedNames()).toEqual(["a.txt"]);
		});

		it(`${label}(["a.txt", "s/x"]) fires no canary and never changes the gitlink`, async () => {
			stageRealChange();
			const before = { link: gitlink(), head: headSha() };
			const result = await outcome(run(["a.txt", "s/x"]));
			expect(fired()).toEqual([]);
			expect(gitlink()).toBe(before.link);
			if (result.ok && headSha() !== before.head) expect(committedNames()).toEqual(["a.txt"]);
		});

		for (const magic of ["*", ":(glob)*", ":(top)*", ":/"]) {
			it(`${label}([${JSON.stringify(magic)}]) never expands to other files`, async () => {
				stageRealChange();
				writeFileSync(join(repo, "b.txt"), "untracked b\n");
				writeFileSync(join(repo, "c.txt"), "untracked c\n");
				const before = { link: gitlink() };
				await outcome(run(["a.txt", magic]));
				expect(fired()).toEqual([]);
				expect(gitlink()).toBe(before.link);
				const tracked = git(repo, ["ls-files"]).split("\n");
				expect(tracked).not.toContain("b.txt");
				expect(tracked).not.toContain("c.txt");
			});
		}
	}
});
