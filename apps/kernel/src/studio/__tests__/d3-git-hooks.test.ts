// ---------------------------------------------------------------------------
// D3 — the kernel runs git inside tenant workspaces. A tenant-controlled repo can carry hooks
// (.git/hooks/*, core.hooksPath) and a core.fsmonitor command that execute as the kernel user. Every kernel git
// call must neutralise them with `-c core.hooksPath=/dev/null -c core.fsmonitor=false`.
//
// 1. behavioural: gitManager commit paths never run a planted hook / fsmonitor script;
// 2. static (AST): every git invocation site (execFileSync/spawn "git", simpleGit) carries the config, directly or
//    through a helper whose name mentions git + safe/harden/config/args.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitManager } from "../git-manager.js";

// real git processes + temp repos: allow slow CI machines
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1" },
	});
}

let work: string;
let repo: string;
let markers: string;

function script(path: string, name: string) {
	writeFileSync(path, `#!/bin/sh\ntouch "${join(markers, name)}"\nexit 0\n`);
	chmodSync(path, 0o755);
}
function fired(): string[] {
	return readdirSync(markers).sort();
}

beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "oscx-d3-git-"));
	repo = join(work, "repo");
	markers = join(work, "markers");
	mkdirSync(repo);
	mkdirSync(markers);
	git(repo, "init", "-q");
	git(repo, "config", "user.name", "t");
	git(repo, "config", "user.email", "t@example.test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "seed.txt"), "seed");
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "seed");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function plantHooks() {
	for (const h of ["pre-commit", "commit-msg", "post-commit", "prepare-commit-msg"]) {
		script(join(repo, ".git", "hooks", h), `hooks-${h}`);
	}
}

describe("D3: gitManager does not run tenant hooks or fsmonitor", () => {
	it("precondition: a plain git commit does run the planted hook (the probe is valid)", () => {
		plantHooks();
		writeFileSync(join(repo, "a.txt"), "a");
		git(repo, "add", ".");
		git(repo, "commit", "-q", "-m", "plain");
		expect(fired()).toContain("hooks-pre-commit");
	});

	const paths: [string, (r: string) => Promise<string>][] = [
		["commit", (r) => gitManager.commit(r, "via commit")],
		["commitFiles", (r) => gitManager.commitFiles(r, ["a.txt"], "via commitFiles")],
		["commitChanges", (r) => gitManager.commitChanges(r, "via commitChanges", ["a.txt"])],
	];
	for (const [name, run] of paths) {
		it(`${name}: .git/hooks/* are not executed`, async () => {
			plantHooks();
			writeFileSync(join(repo, "a.txt"), "a");
			const sha = await run(repo);
			expect(sha).toBeTruthy();
			expect(fired()).toEqual([]);
		});

		it(`${name}: a repo-config core.hooksPath is not honoured`, async () => {
			const dir = join(repo, ".githooks");
			mkdirSync(dir);
			for (const h of ["pre-commit", "commit-msg", "post-commit"]) script(join(dir, h), `hookspath-${h}`);
			git(repo, "config", "core.hooksPath", ".githooks");
			writeFileSync(join(repo, "a.txt"), "a");
			const sha = await run(repo);
			expect(sha).toBeTruthy();
			expect(fired()).toEqual([]);
		});

		it(`${name}: a repo-config core.fsmonitor command is not executed`, async () => {
			const fsm = join(work, "fsmonitor.sh");
			script(fsm, "fsmonitor");
			git(repo, "config", "core.fsmonitor", fsm);
			writeFileSync(join(repo, "a.txt"), "a");
			const sha = await run(repo);
			expect(sha).toBeTruthy();
			expect(fired()).toEqual([]);
		});
	}

	it("read paths (status/log/diff) do not execute fsmonitor either", async () => {
		const fsm = join(work, "fsmonitor.sh");
		script(fsm, "fsmonitor");
		git(repo, "config", "core.fsmonitor", fsm);
		writeFileSync(join(repo, "a.txt"), "a");
		await gitManager.getStatus(repo).catch(() => undefined);
		await gitManager.getLog(repo).catch(() => undefined);
		expect(fired()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Static coverage
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set(["__tests__", "node_modules", "dist"]);
const EXEC_FNS = new Set(["execFileSync", "execFile", "spawn", "spawnSync"]);
const HELPER = /(git.*(safe|harden|config|args))|((safe|harden).*git)/i;

function* walk(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (EXCLUDED_DIRS.has(name)) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) yield* walk(p);
		else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts")) yield p;
	}
}

function hardened(text: string): boolean {
	return (
		(text.includes("core.hooksPath=/dev/null") && text.includes("core.fsmonitor=false")) ||
		(text.includes("GIT_CONFIG_COUNT") && text.includes("core.hooksPath") && text.includes("core.fsmonitor")) ||
		HELPER.test(text)
	);
}

function enclosing(node: ts.Node): ts.Node {
	let n: ts.Node = node;
	while (n.parent && !ts.isFunctionLike(n.parent) && !ts.isSourceFile(n.parent)) n = n.parent;
	return n.parent ?? node;
}

function gitSites() {
	const sites: { where: string; ok: boolean }[] = [];
	for (const file of walk(join(REPO_ROOT, "apps/kernel/src"))) {
		const text = readFileSync(file, "utf8");
		if (!/git/i.test(text)) continue;
		const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node) => {
			if (ts.isCallExpression(node)) {
				const callee = ts.isIdentifier(node.expression)
					? node.expression.text
					: ts.isPropertyAccessExpression(node.expression)
						? node.expression.name.text
						: "";
				const first = node.arguments[0];
				const isGitExec = EXEC_FNS.has(callee) && first && ts.isStringLiteralLike(first) && first.text === "git";
				const isSimpleGit = callee === "simpleGit";
				if (isGitExec || isSimpleGit) {
					const scope = enclosing(node).getText(sf);
					const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
					sites.push({
						where: `${relative(REPO_ROOT, file)}:${line} (${isSimpleGit ? "simpleGit" : `${callee} "git"`})`,
						ok: hardened(node.getText(sf)) || hardened(scope),
					});
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	return sites;
}

describe("D3: static coverage of kernel git invocations", () => {
	it("finds the known git sites", () => {
		const wheres = gitSites().map((s) => s.where);
		for (const f of ["git-manager.ts", "git/commit-executor.ts", "diff-capture.ts", "git/git-rollback.ts"]) {
			expect(
				wheres.some((w) => w.includes(f)),
				`no git site found in ${f}`,
			).toBe(true);
		}
	});

	it("every git invocation disables hooks and fsmonitor", () => {
		const bad = gitSites()
			.filter((s) => !s.ok)
			.map((s) => s.where);
		expect(bad, `git calls without core.hooksPath=/dev/null + core.fsmonitor=false:\n${bad.join("\n")}`).toEqual([]);
	});

	it("terminal-routes git commands carry the hardening config", () => {
		const file = join(REPO_ROOT, "apps/kernel/src/studio/routes/terminal-routes.ts");
		expect(existsSync(file)).toBe(true);
		const text = readFileSync(file, "utf8");
		const entries = [...text.matchAll(/bin:\s*"git",\s*args:\s*\[([^\]]*)\]/g)].map((m) => m[1]);
		expect(entries.length).toBeGreaterThan(0);
		for (const args of entries) {
			expect(args, `terminal git entry [${args}]`).toContain("core.hooksPath=/dev/null");
			expect(args, `terminal git entry [${args}]`).toContain("core.fsmonitor=false");
		}
	});
});

// ---------------------------------------------------------------------------
// Round 3: commit signing, external diff / textconv drivers, github-integration
// ---------------------------------------------------------------------------

import { gitSafeEnv } from "../git/git-safe-config.js";

describe("D3: gitSafeEnv hardening entries", () => {
	it("also disables commit signing", () => {
		const env = gitSafeEnv({});
		const count = Number(env.GIT_CONFIG_COUNT);
		const pairs = Array.from({ length: count }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
		expect(pairs).toContainEqual(["core.hooksPath", "/dev/null"]);
		expect(pairs).toContainEqual(["core.fsmonitor", "false"]);
		expect(pairs.some(([k, v]) => String(k).toLowerCase() === "commit.gpgsign" && v === "false")).toBe(true);
	});
});

describe("D3: signing and diff drivers configured by a tenant repo do not run", () => {
	function failingScript(path: string, name: string) {
		writeFileSync(path, `#!/bin/sh\ntouch "${join(markers, name)}"\nexit 1\n`);
		chmodSync(path, 0o755);
	}

	it("precondition: plain git runs a configured gpg.program", () => {
		const gpg = join(work, "gpg.sh");
		failingScript(gpg, "gpg");
		git(repo, "config", "commit.gpgsign", "true");
		git(repo, "config", "gpg.program", gpg);
		writeFileSync(join(repo, "a.txt"), "a");
		git(repo, "add", ".");
		expect(() => git(repo, "commit", "-q", "-m", "x")).toThrow();
		expect(fired()).toContain("gpg");
	});

	it("gitManager.commit ignores commit.gpgsign=true and does not run gpg.program", async () => {
		const gpg = join(work, "gpg.sh");
		failingScript(gpg, "gpg");
		git(repo, "config", "commit.gpgsign", "true");
		git(repo, "config", "gpg.program", gpg);
		writeFileSync(join(repo, "a.txt"), "a");
		const sha = await gitManager.commit(repo, "signed?");
		expect(sha).toBeTruthy();
		expect(fired()).toEqual([]);
	});

	it("precondition: plain git diff runs diff.external", () => {
		const ext = join(work, "ext.sh");
		script(ext, "external");
		git(repo, "config", "diff.external", ext);
		writeFileSync(join(repo, "seed.txt"), "changed");
		git(repo, "diff", "HEAD");
		expect(fired()).toContain("external");
	});

	it("kernel diff does not run diff.external", async () => {
		const ext = join(work, "ext.sh");
		script(ext, "external");
		git(repo, "config", "diff.external", ext);
		writeFileSync(join(repo, "seed.txt"), "changed");
		const diff = await gitManager.getDiff(repo);
		expect(fired()).toEqual([]);
		expect(diff).toContain("changed");
	});

	function textconv() {
		const tc = join(work, "tc.sh");
		writeFileSync(tc, `#!/bin/sh\ntouch "${join(markers, "textconv")}"\ncat "$1"\n`);
		chmodSync(tc, 0o755);
		writeFileSync(join(repo, ".gitattributes"), "*.txt diff=evil\n");
		git(repo, "config", "diff.evil.textconv", tc);
		writeFileSync(join(repo, "seed.txt"), "changed");
	}

	it("precondition: plain git diff runs a textconv driver", () => {
		textconv();
		git(repo, "diff", "HEAD");
		expect(fired()).toContain("textconv");
	});

	it("kernel diff does not run a textconv driver", async () => {
		textconv();
		const diff = await gitManager.getDiff(repo);
		expect(fired()).toEqual([]);
		expect(diff).toContain("changed");
	});
});

describe("D3: static coverage, round 3", () => {
	it("every kernel git diff/show that prints content passes --no-ext-diff and --no-textconv", () => {
		const bad: string[] = [];
		for (const file of walk(join(REPO_ROOT, "apps/kernel/src"))) {
			const text = readFileSync(file, "utf8");
			if (!/git/i.test(text)) continue;
			const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
			const visit = (node: ts.Node) => {
				if (ts.isCallExpression(node)) {
					const t = node.getText(sf);
					const isExec =
						ts.isIdentifier(node.expression) &&
						EXEC_FNS.has(node.expression.text) &&
						node.arguments[0] &&
						ts.isStringLiteralLike(node.arguments[0]) &&
						node.arguments[0].text === "git";
					const arr = node.arguments[1];
					const execDiff =
						isExec &&
						arr &&
						ts.isArrayLiteralExpression(arr) &&
						arr.elements.some((e) => ts.isStringLiteralLike(e) && (e.text === "diff" || e.text === "show"));
					const simpleDiff =
						ts.isPropertyAccessExpression(node.expression) &&
						["diff", "show"].includes(node.expression.name.text) &&
						/^git$/.test(node.expression.expression.getText(sf));
					if ((execDiff || simpleDiff) && !/--name-only|--name-status/.test(t)) {
						const ok = t.includes("--no-ext-diff") && t.includes("--no-textconv");
						if (!ok) {
							const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
							bad.push(`${relative(REPO_ROOT, file)}:${line}`);
						}
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(sf);
		}
		expect(bad, `git diff/show without --no-ext-diff --no-textconv:\n${bad.join("\n")}`).toEqual([]);
	});

	it("github-integration.ts builds its git env with gitSafeEnv", () => {
		const text = readFileSync(join(REPO_ROOT, "apps/kernel/src/studio/github-integration.ts"), "utf8");
		expect(text).toMatch(/gitSafeEnv\(/);
	});
});
