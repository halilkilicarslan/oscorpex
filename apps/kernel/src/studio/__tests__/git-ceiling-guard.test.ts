// ---------------------------------------------------------------------------
// Project repos live under `<cwd>/.oscorpex/repos/<id>` (imports under the workspace root). In local dev the kernel
// runs inside the Oscorpex checkout, so a project dir without its own .git would let git walk UP and commit into the
// Oscorpex repo. GIT_CEILING_DIRECTORIES must stop that for kernel git calls and for spawned agent/build children.
//
// process.cwd() is spied (chdir is unavailable in vitest workers) so `resolve(".oscorpex/repos")` lands in the temp
// outer repo, never the real checkout.
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitManager } from "../git-manager.js";
import { gitSafeEnv, projectRepoCeilings } from "../git/git-safe-config.js";
import { type ChildProcessEnvProfile, buildSafeChildEnv } from "../security/env-sanitizer.js";
import { getWorkspaceRoot } from "../security/workspace-resolver.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PROFILES: ChildProcessEnvProfile[] = ["provider", "app_runner", "build_tool", "test"];

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1" },
	});
}

let work: string;
let outer: string;
let p1: string;

function roots(): string[] {
	return [resolve(outer, ".oscorpex/repos"), getWorkspaceRoot()];
}
function ceilingEntries(env: NodeJS.ProcessEnv): string[] {
	return (env.GIT_CEILING_DIRECTORIES ?? "").split(delimiter).filter(Boolean);
}
function commitCount(): number {
	return Number(git(outer, "rev-list", "--count", "HEAD").trim());
}

beforeEach(() => {
	work = realpathSync(mkdtempSync(join(tmpdir(), "oscx-ceil-")));
	outer = join(work, "outer");
	p1 = join(outer, ".oscorpex", "repos", "p1");
	mkdirSync(p1, { recursive: true });
	git(outer, "init", "-q");
	git(outer, "config", "user.name", "t");
	git(outer, "config", "user.email", "t@example.test");
	git(outer, "config", "commit.gpgsign", "false");
	writeFileSync(join(outer, "seed.txt"), "seed");
	git(outer, "add", "seed.txt");
	git(outer, "commit", "-q", "-m", "seed");
	vi.spyOn(process, "cwd").mockReturnValue(outer);
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(work, { recursive: true, force: true });
});

describe("git ceiling guard: kernel git calls", () => {
	it("control: without a ceiling git walks up from p1 and finds the outer repo", () => {
		expect(git(p1, "rev-parse", "--show-toplevel").trim()).toBe(outer);
	});

	it("projectRepoCeilings covers the project repos dir and the workspace root", () => {
		const ceilings = projectRepoCeilings();
		for (const root of roots()) expect(ceilings).toContain(root);
	});

	it("gitManager.commit in a .git-less project dir fails and leaves the outer repo untouched", async () => {
		const head = git(outer, "rev-parse", "HEAD").trim();
		const count = commitCount();
		writeFileSync(join(p1, "a.txt"), "a");
		await expect(gitManager.commit(p1, "should not land")).rejects.toThrow();
		expect(git(outer, "rev-parse", "HEAD").trim()).toBe(head);
		expect(commitCount()).toBe(count);
	});

	it("gitManager.commitFiles / commitChanges do not commit into the outer repo either", async () => {
		const head = git(outer, "rev-parse", "HEAD").trim();
		writeFileSync(join(p1, "a.txt"), "a");
		await gitManager.commitFiles(p1, ["a.txt"], "x").catch(() => undefined);
		await gitManager.commitChanges(p1, "y", ["a.txt"]).catch(() => undefined);
		expect(git(outer, "rev-parse", "HEAD").trim()).toBe(head);
	});
});

describe("git ceiling guard: env builders", () => {
	it("gitSafeEnv sets GIT_CEILING_DIRECTORIES to both roots, keeping GIT_CONFIG_*", () => {
		const env = gitSafeEnv({ PATH: "/usr/bin" });
		expect(ceilingEntries(env)).toEqual(expect.arrayContaining(roots()));
		expect(env.GIT_CONFIG_COUNT).toBeDefined();
	});

	for (const profile of PROFILES) {
		it(`buildSafeChildEnv(${profile}) sets GIT_CEILING_DIRECTORIES with both roots`, () => {
			const env = buildSafeChildEnv({ profile, base: { PATH: "/usr/bin" } });
			expect(ceilingEntries(env)).toEqual(expect.arrayContaining(roots()));
		});

		it(`buildSafeChildEnv(${profile}) lets extra extend but never drop the roots`, () => {
			const extraDir = join(work, "extra");
			const env = buildSafeChildEnv({
				profile,
				base: { PATH: "/usr/bin", GIT_CEILING_DIRECTORIES: "/base/ceiling" },
				extra: { GIT_CEILING_DIRECTORIES: extraDir },
			});
			const entries = ceilingEntries(env);
			expect(entries).toEqual(expect.arrayContaining(roots()));
			expect(entries).toContain(extraDir);
		});

		it(`buildSafeChildEnv(${profile}) empty extra value cannot drop the roots`, () => {
			const env = buildSafeChildEnv({ profile, base: { PATH: "/usr/bin" }, extra: { GIT_CEILING_DIRECTORIES: "" } });
			expect(ceilingEntries(env)).toEqual(expect.arrayContaining(roots()));
		});
	}
});

describe("git ceiling guard: spawned children", () => {
	for (const profile of PROFILES) {
		it(`real git rev-parse in p1 with buildSafeChildEnv(${profile}) does not resolve the outer repo`, () => {
			const env = buildSafeChildEnv({ profile, base: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir() } });
			const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: p1, env, encoding: "utf8" });
			expect(res.status).not.toBe(0);
			expect(res.stdout).not.toContain(outer);
		});
	}
});
