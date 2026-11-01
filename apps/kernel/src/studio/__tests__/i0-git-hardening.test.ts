// ---------------------------------------------------------------------------
// I0 item 7 / scenario 7 — repo-controlled git configuration cannot make the kernel execute commands.
// A temp repo is booby-trapped through `.git/config` (core.pager, core.sshCommand, diff.external, a textconv
// driver, filter clean/smudge/process via .gitattributes), through an `include.path` file that defines more of the
// same, and through `objects/info/alternates`. Every canary is a `touch <canary>` command. The kernel's git
// operations (status, diff, log, commit, checkout, task-diff capture) must leave the canary directory empty and
// must not read objects from the alternate.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitManager } from "../git-manager.js";
import { freshTmp } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const inserted = vi.hoisted(() => ({ diffs: [] as unknown[] }));
vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		insertTaskDiffs: async (_taskId: string, diffs: unknown[]) => {
			inserted.diffs.push(...diffs);
			return diffs.length;
		},
	};
});

const ALT_SECRET = "ALT-ONLY-SECRET-CONTENT";
let work: string;
let repo: string;
let markers: string;
let altHash: string;

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1" },
	});
}
const touch = (name: string) => `touch ${join(markers, name)}`;
const fired = () => readdirSync(markers).sort();

function trap() {
	const included = join(work, "included.gitconfig");
	writeFileSync(
		included,
		[
			"[core]",
			`\tpager = ${touch("pager-included")}`,
			`\tsshCommand = ${touch("ssh-included")}`,
			'[filter "evil2"]',
			`\tclean = ${touch("clean-evil2")}`,
			`\tsmudge = ${touch("smudge-evil2")}`,
			"",
		].join("\n"),
	);
	appendFileSync(
		join(repo, ".git", "config"),
		[
			"[core]",
			`\tpager = ${touch("pager")}`,
			`\tsshCommand = ${touch("ssh")}`,
			"[diff]",
			`\texternal = ${touch("diff-external")}`,
			'[diff "evilcat"]',
			`\ttextconv = ${touch("textconv")}`,
			'[filter "evil"]',
			`\tclean = ${touch("clean-evil")}`,
			`\tsmudge = ${touch("smudge-evil")}`,
			'[filter "evil3"]',
			`\tprocess = ${touch("process-evil3")}`,
			"[include]",
			`\tpath = ${included}`,
			"",
		].join("\n"),
	);
	// objects of an unrelated repo become reachable through the alternates file
	const alt = join(work, "alt");
	mkdirSync(alt);
	git(alt, "init", "-q");
	git(alt, "config", "user.name", "t");
	git(alt, "config", "user.email", "t@example.test");
	writeFileSync(join(alt, "alt-only.txt"), ALT_SECRET);
	git(alt, "add", ".");
	git(alt, "commit", "-q", "-m", "alt");
	altHash = git(alt, "rev-parse", "HEAD").trim();
	writeFileSync(join(repo, ".git", "objects", "info", "alternates"), `${join(alt, ".git", "objects")}\n`);
}

beforeEach(() => {
	work = freshTmp("oscx-i0-git-");
	repo = join(work, "repo");
	markers = join(work, "markers");
	mkdirSync(repo);
	mkdirSync(markers);
	inserted.diffs.length = 0;
	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "user.name", "t");
	git(repo, "config", "user.email", "t@example.test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(
		join(repo, ".gitattributes"),
		"a.txt filter=evil\nb.txt filter=evil2 diff=evilcat\nc.txt diff=evilcat\nd.txt filter=evil3\n",
	);
	for (const f of ["a.txt", "b.txt", "c.txt", "d.txt"]) writeFileSync(join(repo, f), `${f} v1\n`);
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "seed");
	git(repo, "checkout", "-q", "-b", "other");
	for (const f of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(repo, f), `${f} on other, longer content\n`);
	git(repo, "commit", "-q", "-am", "other");
	git(repo, "checkout", "-q", "main");
	trap();
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function dirtyTree() {
	for (const f of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(repo, f), `${f} edited, with a different size\n`);
}

describe("precondition: the booby traps are live under plain git (the probes are valid)", () => {
	it("a plain `git add` + `git diff` fires the clean filters and diff.external", () => {
		dirtyTree();
		// Only the markers matter: the evil3 process filter can make `git add` die ("remote end hung up unexpectedly")
		// when it re-hashes a racily-clean file, so a failing plain-git call is tolerated.
		const tolerate = (...args: string[]) => {
			try {
				// the racily-clean d.txt (evil3 process filter) is not part of this probe: disable that one driver
				git(repo, "-c", "filter.evil3.process=", ...args);
			} catch {
				/* the probe's exit status is irrelevant */
			}
		};
		tolerate("add", "a.txt", "b.txt", "c.txt");
		writeFileSync(join(repo, "c.txt"), "c.txt edited again\n");
		tolerate("diff", "HEAD");
		expect(fired(), `fired: ${fired().join(",")}`).toEqual(
			expect.arrayContaining(["clean-evil", "clean-evil2", "diff-external"]),
		);
	});

	it("the alternate is honoured by plain git", () => {
		expect(git(repo, "cat-file", "-p", `${altHash}:alt-only.txt`)).toContain(ALT_SECRET);
	});
});

describe("kernel git operations execute nothing repo-controlled (scenario 7)", () => {
	it("getStatus", async () => {
		dirtyTree();
		const status = await gitManager.getStatus(repo);
		expect(status.modified).toContain("a.txt");
		expect(fired()).toEqual([]);
	});

	it("getDiff / getDiffBetween", async () => {
		dirtyTree();
		await gitManager.getDiff(repo);
		await gitManager.getDiff(repo, "HEAD");
		await gitManager.getDiffBetween(repo, "main", "other");
		expect(fired()).toEqual([]);
	});

	it("getLog / getCommitLog / getCurrentBranch / listBranches", async () => {
		await gitManager.getLog(repo);
		await gitManager.getCommitLog(repo);
		await gitManager.getCurrentBranch(repo);
		await gitManager.listBranches(repo);
		expect(fired()).toEqual([]);
	});

	it("commit (git add . + commit)", async () => {
		dirtyTree();
		expect(await gitManager.commit(repo, "via kernel")).toBeTruthy();
		expect(fired()).toEqual([]);
	});

	it("commitFiles / commitChanges", async () => {
		dirtyTree();
		await gitManager.commitFiles(repo, ["a.txt"], "files");
		writeFileSync(join(repo, "b.txt"), "b changed again\n");
		await gitManager.commitChanges(repo, "changes", ["b.txt"]);
		expect(fired()).toEqual([]);
	});

	it("checkout (smudge filters)", async () => {
		await gitManager.checkout(repo, "other");
		expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("on other");
		await gitManager.checkout(repo, "main");
		expect(fired()).toEqual([]);
	});

	it("a long-running `filter.<x>.process` driver is never spawned (commit of a file bound to it)", async () => {
		writeFileSync(join(repo, "d.txt"), "d.txt edited\n");
		expect(await gitManager.commit(repo, "via kernel")).toBeTruthy();
		await gitManager.checkout(repo, "other");
		expect(fired()).toEqual([]);
	});

	it("captureTaskDiffs", async () => {
		dirtyTree();
		const { captureTaskDiffs } = await import("../diff-capture.js");
		const count = await captureTaskDiffs("i0-task", repo, {
			filesCreated: [],
			filesModified: ["a.txt", "b.txt", "c.txt"],
		} as never);
		expect(count).toBeGreaterThan(0);
		expect(fired()).toEqual([]);
	});

	it("objects reachable only through objects/info/alternates are not readable", async () => {
		let diff = "";
		try {
			diff = await gitManager.getDiff(repo, altHash);
		} catch {
			/* refusing is the expected safe outcome */
		}
		expect(diff).not.toContain(ALT_SECRET);
	});
});

describe("gitSafeEnv carries the new hardening", () => {
	it("neutralises sshCommand/pager/external diff and the global/system config sources", async () => {
		const { gitSafeEnv } = await import("../git/git-safe-config.js");
		const env = gitSafeEnv({ PATH: "/usr/bin" });
		const pairs = new Map<string, string>();
		for (let i = 0; i < Number(env.GIT_CONFIG_COUNT); i++) {
			pairs.set(String(env[`GIT_CONFIG_KEY_${i}`]), String(env[`GIT_CONFIG_VALUE_${i}`]));
		}
		expect(pairs.get("core.sshCommand")).toBe("");
		expect(pairs.get("core.pager")).toBe("cat");
		expect(pairs.get("diff.external")).toBe("");
		// the pre-existing entries are kept
		expect(pairs.get("core.hooksPath")).toBe("/dev/null");
		expect(pairs.get("core.fsmonitor")).toBe("false");
		expect(pairs.get("commit.gpgSign")).toBe("false");
		expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
		expect(env.GIT_ALTERNATE_OBJECT_DIRECTORIES ?? "").toBe("");
	});
});
