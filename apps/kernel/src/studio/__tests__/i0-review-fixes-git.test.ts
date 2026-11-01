// ---------------------------------------------------------------------------
// I0 review fixes — A (git config pre-flight is an allow-list) and B (ref/option injection at the git manager).
// Every canary is a `touch <markers>/<name>` command (or an executable script doing the same). The kernel's git
// operations must leave the marker directory empty for each of these repo-controlled vectors:
//   config.worktree, gpg/showSignature, includeIf "onbranch:", a bare layout without `.git`, submodules.
// Plus: a harmless-but-unknown config key is refused (the allow-list), common benign keys are not.
// Each vector has a precondition test proving the trap is live under plain git (so a green result means something).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitManager } from "../git-manager.js";
import { freshTmp } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let work: string;
let repo: string;
let markers: string;

function git(cwd: string, args: string[], input?: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		input,
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

/** A script (usable as gpg.program) that records its invocation and fails. */
function canaryScript(name: string): string {
	const path = join(work, `${name}.sh`);
	writeFileSync(path, `#!/bin/sh\n${touch(name)}\nexit 1\n`);
	chmodSync(path, 0o755);
	return path;
}

/** Builds a commit object carrying a `gpgsig` header on top of `parent` and returns its hash (no gpg involved). */
function signedCommit(cwd: string, parent: string, message: string): string {
	const tree = git(cwd, ["rev-parse", `${parent}^{tree}`]).trim();
	const body = [
		`tree ${tree}`,
		`parent ${parent}`,
		"author t <t@example.test> 1700000000 +0000",
		"committer t <t@example.test> 1700000000 +0000",
		"gpgsig -----BEGIN PGP SIGNATURE-----",
		" ",
		" ZmFrZXNpZw==",
		" -----END PGP SIGNATURE-----",
		"",
		`${message}`,
		"",
	].join("\n");
	return git(cwd, ["hash-object", "-t", "commit", "-w", "--stdin"], body).trim();
}

function commitAll(cwd: string, message: string) {
	git(cwd, ["add", "-A"]);
	git(cwd, ["commit", "-q", "-m", message]);
}

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
	work = freshTmp("oscx-i0-rf-git-");
	repo = join(work, "repo");
	markers = join(work, "markers");
	mkdirSync(markers);
	initRepo(repo);
	writeFileSync(join(repo, "a.txt"), "a v1\n");
	writeFileSync(join(repo, "w.txt"), "w v1\n");
	writeFileSync(join(repo, "m.txt"), "base\n");
	commitAll(repo, "seed");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// 1. config.worktree
// ---------------------------------------------------------------------------

describe("A1: extensions.worktreeConfig — config.worktree is classified too", () => {
	function plantWorktreeConfig() {
		appendFileSync(join(repo, ".git", "config"), "[extensions]\n\tworktreeConfig = true\n");
		writeFileSync(
			join(repo, ".git", "config.worktree"),
			[
				'[filter "w"]',
				`\tclean = ${touch("worktree-clean")}`,
				`\tsmudge = ${touch("worktree-smudge")}`,
				'[merge "m"]',
				`\tdriver = ${touch("worktree-merge-driver")}; exit 1`,
				"",
			].join("\n"),
		);
		writeFileSync(join(repo, ".gitattributes"), "w.txt filter=w\nm.txt merge=m\n");
	}

	it("precondition: plain git fires the config.worktree clean filter", () => {
		plantWorktreeConfig();
		writeFileSync(join(repo, "w.txt"), "w edited, different size\n");
		git(repo, ["add", "w.txt"]);
		expect(fired()).toContain("worktree-clean");
	});

	it("commit / getStatus after editing a file bound to a config.worktree filter fires no canary", async () => {
		plantWorktreeConfig();
		writeFileSync(join(repo, "w.txt"), "w edited, different size\n");
		await outcome(gitManager.getStatus(repo));
		await outcome(gitManager.commit(repo, "via kernel"));
		expect(fired()).toEqual([]);
	});

	it("a conflicting merge does not run a config.worktree merge driver", async () => {
		plantWorktreeConfig();
		commitAll(repo, "attrs");
		git(repo, ["checkout", "-q", "-b", "other"]);
		writeFileSync(join(repo, "m.txt"), "other side\n");
		commitAll(repo, "other");
		git(repo, ["checkout", "-q", "main"]);
		writeFileSync(join(repo, "m.txt"), "main side\n");
		commitAll(repo, "main");
		// the plain-git setup above runs with the trap live and may fire the racy clean filter: only the kernel op counts
		clearMarkers();
		await outcome(gitManager.merge(repo, "other", "main"));
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 2. gpg / showSignature
// ---------------------------------------------------------------------------

describe("A2: gpg.program is never run for signature display or verification", () => {
	it("precondition: plain git log runs gpg.program for a commit carrying a gpgsig header", () => {
		const gpg = canaryScript("gpg-log");
		const head = git(repo, ["rev-parse", "HEAD"]).trim();
		const signed = signedCommit(repo, head, "signed");
		git(repo, ["update-ref", "refs/heads/main", signed]);
		git(repo, ["config", "log.showSignature", "true"]);
		git(repo, ["config", "gpg.program", gpg]);
		git(repo, ["log", "-1"]);
		expect(fired()).toContain("gpg-log");
	});

	it("getLog / getCommitLog with log.showSignature=true fire no canary", async () => {
		const gpg = canaryScript("gpg-log");
		const head = git(repo, ["rev-parse", "HEAD"]).trim();
		git(repo, ["update-ref", "refs/heads/main", signedCommit(repo, head, "signed")]);
		git(repo, ["config", "log.showSignature", "true"]);
		git(repo, ["config", "gpg.program", gpg]);
		await outcome(gitManager.getLog(repo));
		await outcome(gitManager.getCommitLog(repo));
		expect(fired()).toEqual([]);
	});

	it("a kernel merge with merge.verifySignatures=true fires no canary", async () => {
		const gpg = canaryScript("gpg-merge");
		const base = git(repo, ["rev-parse", "HEAD"]).trim();
		git(repo, ["update-ref", "refs/heads/other", signedCommit(repo, base, "signed tip")]);
		git(repo, ["config", "merge.verifySignatures", "true"]);
		git(repo, ["config", "gpg.program", gpg]);
		await outcome(gitManager.merge(repo, "other", "main"));
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 3. includeIf "onbranch:"
// ---------------------------------------------------------------------------

describe('A3: [includeIf "onbranch:<b>"] cannot smuggle drivers in when the branch changes', () => {
	function plant() {
		const evil = join(work, "evil.cfg");
		writeFileSync(
			evil,
			['[filter "e"]', `\tclean = ${touch("onbranch-clean")}`, `\tsmudge = ${touch("onbranch-smudge")}`, ""].join("\n"),
		);
		writeFileSync(join(repo, ".gitattributes"), "f.txt filter=e\n");
		writeFileSync(join(repo, "f.txt"), "f on main\n");
		commitAll(repo, "f on main");
		git(repo, ["checkout", "-q", "-b", "feature"]);
		writeFileSync(join(repo, "f.txt"), "f on feature, longer\n");
		commitAll(repo, "f on feature");
		// the include is inactive while `feature` is checked out
		appendFileSync(join(repo, ".git", "config"), `[includeIf "onbranch:main"]\n\tpath = ${evil}\n`);
	}

	it("precondition: once main is checked out, plain git runs the included clean filter", () => {
		plant();
		git(repo, ["checkout", "-q", "main"]);
		writeFileSync(join(repo, "f.txt"), "f edited on main, different size\n");
		git(repo, ["add", "f.txt"]);
		expect(fired()).toContain("onbranch-clean");
	});

	it("checkout main followed by status/commit fires no canary (the includeIf is refused)", async () => {
		plant();
		const co = await outcome(gitManager.checkout(repo, "main"));
		writeFileSync(join(repo, "f.txt"), "f edited on main, different size\n");
		await outcome(gitManager.getStatus(repo));
		await outcome(gitManager.commit(repo, "via kernel"));
		expect(fired()).toEqual([]);
		// documents the allow-list: includeif.* is refused rather than neutralised
		expect(co.ok).toBe(false);
	});

	it("the merge flow that switches to main fires no canary", async () => {
		plant();
		await outcome(gitManager.merge(repo, "feature", "main"));
		writeFileSync(join(repo, "f.txt"), "f edited after merge, different size\n");
		await outcome(gitManager.getStatus(repo));
		await outcome(gitManager.commit(repo, "after merge"));
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 4. bare-repo discovery
// ---------------------------------------------------------------------------

describe("A4: a bare layout at the repo root (no .git) is refused", () => {
	let bareRoot: string;

	function plantBareLayout() {
		const head = git(repo, ["rev-parse", "HEAD"]).trim();
		git(repo, ["update-ref", "refs/heads/main", signedCommit(repo, head, "signed")]);
		git(repo, ["checkout", "-q", "-b", "other"]);
		writeFileSync(join(repo, "a.txt"), "a on other, longer content\n");
		commitAll(repo, "other");
		const bare = join(work, "bare.git");
		git(work, ["clone", "-q", "--bare", repo, bare]);
		bareRoot = join(work, "bare-root");
		mkdirSync(bareRoot);
		cpSync(bare, bareRoot, { recursive: true });
		const gpg = canaryScript("gpg-bare");
		appendFileSync(
			join(bareRoot, "config"),
			[
				"[log]",
				"\tshowSignature = true",
				"[gpg]",
				`\tprogram = ${gpg}`,
				'[diff "evilcat"]',
				`\ttextconv = ${touch("bare-textconv")}`,
				"",
			].join("\n"),
		);
		writeFileSync(join(bareRoot, "info", "attributes"), "*.txt diff=evilcat\n");
	}

	it("precondition: plain git discovers the bare layout and runs the gpg canary", () => {
		plantBareLayout();
		git(bareRoot, ["log", "-1", "main"]);
		expect(fired()).toContain("gpg-bare");
	});

	it("getLog / getDiffBetween / getStatus fire no canary and are refused", async () => {
		plantBareLayout();
		const log = await outcome(gitManager.getLog(bareRoot));
		const between = await outcome(gitManager.getDiffBetween(bareRoot, "main", "other"));
		const status = await outcome(gitManager.getStatus(bareRoot));
		expect(fired()).toEqual([]);
		expect(between.ok).toBe(false);
		// getLog / getStatus may swallow errors into an empty result, but must not return repo data
		expect(!log.ok || log.value.length === 0).toBe(true);
		expect(!status.ok || (status.value.modified.length === 0 && status.value.staged.length === 0)).toBe(true);
	});

	it("a `.git` that is a symlink is refused", async () => {
		const real = join(work, "real-git");
		cpSync(join(repo, ".git"), real, { recursive: true });
		rmSync(join(repo, ".git"), { recursive: true, force: true });
		symlinkSync(real, join(repo, ".git"));
		const status = await outcome(gitManager.getStatus(repo));
		const diff = await outcome(gitManager.getDiff(repo));
		expect(diff.ok).toBe(false);
		expect(!status.ok || status.value.modified.length === 0).toBe(true);
	});

	it("a `.git` file pointing outside the repo is refused", async () => {
		const real = join(work, "elsewhere.git");
		cpSync(join(repo, ".git"), real, { recursive: true });
		rmSync(join(repo, ".git"), { recursive: true, force: true });
		writeFileSync(join(repo, ".git"), `gitdir: ${real}\n`);
		const diff = await outcome(gitManager.getDiff(repo));
		expect(diff.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 5. submodules
// ---------------------------------------------------------------------------

describe("A5: a populated submodule's own config cannot run commands", () => {
	function plantSubmodule() {
		const sub = join(repo, "sub");
		initRepo(sub);
		writeFileSync(join(sub, ".gitattributes"), "s.txt filter=s\n");
		writeFileSync(join(sub, "s.txt"), "s v1\n");
		commitAll(sub, "sub seed");
		appendFileSync(
			join(sub, ".git", "config"),
			['[filter "s"]', `\tclean = ${touch("sub-clean")}`, `\tsmudge = ${touch("sub-smudge")}`, ""].join("\n"),
		);
		// register `sub` as a gitlink + submodule of the parent
		writeFileSync(join(repo, ".gitmodules"), '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n');
		git(repo, ["add", ".gitmodules"]);
		git(repo, ["add", "sub"]);
		git(repo, ["commit", "-q", "-m", "add sub"]);
		// dirty the submodule worktree so a status in the parent has to inspect it
		// same size: git has to run the clean filter to tell whether the file changed
		writeFileSync(join(sub, "s.txt"), "s v2\n");
		clearMarkers();
	}

	it("precondition: plain `git status` in the parent runs the submodule's clean filter", () => {
		plantSubmodule();
		git(repo, ["status", "--porcelain"]);
		expect(fired()).toContain("sub-clean");
	});

	it("getStatus and checkout of the parent fire no canary", async () => {
		plantSubmodule();
		await outcome(gitManager.getStatus(repo));
		git(repo, ["checkout", "-q", "-b", "other"]);
		writeFileSync(join(repo, "a.txt"), "a on other\n");
		commitAll(repo, "other");
		clearMarkers();
		await outcome(gitManager.checkout(repo, "main"));
		await outcome(gitManager.getStatus(repo));
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 6. the allow-list itself
// ---------------------------------------------------------------------------

describe("A6: unknown keys are refused, common benign keys are not", () => {
	it("an unknown harmless key makes kernel git operations fail with a clear error", async () => {
		appendFileSync(join(repo, ".git", "config"), "[oscx]\n\tprobe = 1\n");
		await expect(gitManager.getStatus(repo)).rejects.toThrow(/oscx\.probe/i);
		await expect(gitManager.listBranches(repo)).rejects.toThrow(/oscx\.probe/i);
		await expect(gitManager.getDiff(repo)).rejects.toThrow(/oscx\.probe/i);
	});

	it("core.autocrlf, user.name, remote.origin.url (https), branch.main.remote, pull.rebase, init.defaultBranch pass", async () => {
		appendFileSync(
			join(repo, ".git", "config"),
			[
				"[core]",
				"\tautocrlf = false",
				'[remote "origin"]',
				"\turl = https://example.test/org/repo.git",
				"\tfetch = +refs/heads/*:refs/remotes/origin/*",
				'[branch "main"]',
				"\tremote = origin",
				"\tmerge = refs/heads/main",
				"[pull]",
				"\trebase = true",
				"[init]",
				"\tdefaultBranch = main",
				"",
			].join("\n"),
		);
		const status = await gitManager.getStatus(repo);
		expect(status.modified).toEqual([]);
		expect(await gitManager.listBranches(repo)).toContain("main");
		expect((await gitManager.getLog(repo)).length).toBeGreaterThan(0);
		writeFileSync(join(repo, "a.txt"), "a edited\n");
		expect(await gitManager.commit(repo, "benign config")).toBeTruthy();
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// B (manager level). option injection through ref arguments
// ---------------------------------------------------------------------------

describe("B: values starting with `-` are never parsed as git options by the manager", () => {
	it("getDiff(repo, '--output=<file>') rejects and writes no file", async () => {
		const out = join(work, "pwned-diff.txt");
		writeFileSync(join(repo, "a.txt"), "a edited\n");
		await expect(gitManager.getDiff(repo, `--output=${out}`)).rejects.toThrow();
		expect(existsSync(out)).toBe(false);
	});

	it("getDiffBetween with an option-shaped `from` / `to` rejects and writes no file", async () => {
		const out = join(work, "pwned-between.txt");
		writeFileSync(join(repo, "a.txt"), "a edited\n");
		await expect(gitManager.getDiffBetween(repo, `--output=${out}`, "main")).rejects.toThrow();
		await expect(gitManager.getDiffBetween(repo, "main", `--output=${out}`)).rejects.toThrow();
		expect(existsSync(out)).toBe(false);
	});

	it("checkout / merge with an option-shaped branch rejects and leaves HEAD alone", async () => {
		await expect(gitManager.checkout(repo, "--orphan=oscx-injected")).rejects.toThrow();
		await expect(gitManager.merge(repo, "--abort", "main")).rejects.toThrow();
		await expect(gitManager.merge(repo, "main", "--orphan=oscx-injected")).rejects.toThrow();
		expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
		expect(git(repo, ["branch", "--list", "oscx-injected"]).trim()).toBe("");
	});

	it("commitFiles with an option-shaped path rejects", async () => {
		writeFileSync(join(repo, "a.txt"), "a edited\n");
		await expect(gitManager.commitFiles(repo, ["--chmod=+x", "a.txt"], "msg")).rejects.toThrow();
		expect(git(repo, ["status", "--porcelain"])).not.toContain("A ");
	});
});

// ---------------------------------------------------------------------------
// 20. a repo_path that is a subdirectory of a larger repository
// ---------------------------------------------------------------------------

describe("A7: a project dir without its own .git never resolves to an enclosing repository", () => {
	function plantParentTrap() {
		// `repo` (the enclosing repository) already exists; the project dir is a plain subdirectory of it
		writeFileSync(join(repo, ".gitattributes"), "*.txt filter=pe\n");
		appendFileSync(
			join(repo, ".git", "config"),
			['[filter "pe"]', `\tclean = ${touch("parent-clean")}`, `\tsmudge = ${touch("parent-smudge")}`, ""].join("\n"),
		);
		const sub = join(repo, "projects", "p1");
		mkdirSync(sub, { recursive: true });
		writeFileSync(join(sub, "n.txt"), "n v1\n");
		return sub;
	}

	it("precondition: plain git inside the subdirectory discovers the parent repo and runs its clean filter", () => {
		const sub = plantParentTrap();
		git(sub, ["add", "n.txt"]);
		expect(fired()).toContain("parent-clean");
	});

	it("getStatus / commit / getDiff in the subdirectory fire no canary and are refused", async () => {
		const sub = plantParentTrap();
		const status = await outcome(gitManager.getStatus(sub));
		const commit = await outcome(gitManager.commit(sub, "via kernel"));
		const diff = await outcome(gitManager.getDiff(sub));
		expect(fired()).toEqual([]);
		expect(commit.ok).toBe(false);
		expect(diff.ok).toBe(false);
		expect(!status.ok || (status.value.untracked.length === 0 && status.value.modified.length === 0)).toBe(true);
	});
});
