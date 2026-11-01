// ---------------------------------------------------------------------------
// I0 item 6 / scenario 6 — kernel file access inside tenant repos is symlink-safe, including the check→use race.
//   * planted links (README.md → secret file, src → directory outside the repo) are never followed out of the repo;
//   * a path that is swapped for a symlink *between* the containment check and the read/copy cannot leak: the
//     swap is simulated deterministically by hooking the fs calls the kernel uses for its checks;
//   * writes never create directories outside the repo (mkdir only after the containment check).
// The secret lives in a temp directory so the suite behaves identically on macOS and Linux (no /proc needed).
// ---------------------------------------------------------------------------

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp } from "./helpers/i0-fakes.js";

const hook = vi.hoisted(() => ({ onCheck: null as null | ((p: string) => void) }));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const wrap =
		<A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			const res = await fn(...args);
			if (hook.onCheck && typeof args[0] === "string") hook.onCheck(args[0]);
			return res;
		};
	return {
		...actual,
		realpath: wrap(actual.realpath as never),
		lstat: wrap(actual.lstat as never),
		stat: wrap(actual.stat as never),
	};
});

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const wrap =
		<A extends unknown[], R>(fn: (...a: A) => R) =>
		(...args: A): R => {
			const res = fn(...args);
			if (hook.onCheck && typeof args[0] === "string") hook.onCheck(args[0]);
			return res;
		};
	const realpathSync = Object.assign(wrap(actual.realpathSync as never), {
		native: wrap(actual.realpathSync.native as never),
	});
	return {
		...actual,
		realpathSync,
		lstatSync: wrap(actual.lstatSync as never),
		statSync: wrap(actual.statSync as never),
	};
});

const SECRET = "TOP-SECRET-I0-SYMLINK";
let work: string;
let outside: string;
let secretFile: string;
let repo: string;
let n = 0;

beforeAll(() => {
	work = freshTmp("oscx-i0-sym-");
	outside = join(work, "outside");
	mkdirSync(outside);
	secretFile = join(outside, "secret.txt");
	writeFileSync(secretFile, SECRET);
	writeFileSync(join(outside, "listing-canary.txt"), "x");
});
afterAll(() => {
	rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
	hook.onCheck = null;
	repo = join(work, `repo-${++n}`);
	mkdirSync(repo);
	writeFileSync(join(repo, "safe.txt"), "safe");
});

describe("git-manager reads (scenario 6)", () => {
	it("README.md → secret file outside the repo cannot be read", async () => {
		const { gitManager } = await import("../git-manager.js");
		symlinkSync(secretFile, join(repo, "README.md"));
		await expect(gitManager.getFileContent(repo, "README.md")).rejects.toThrow();
	});

	it("a symlinked directory is neither listed nor traversed by getFileTree", async () => {
		const { gitManager } = await import("../git-manager.js");
		symlinkSync(outside, join(repo, "src"));
		let tree: { name: string; children?: unknown[] }[] = [];
		try {
			tree = await gitManager.getFileTree(repo, "src");
		} catch {
			/* refusing is fine */
		}
		expect(JSON.stringify(tree)).not.toContain("listing-canary");
		expect(JSON.stringify(tree)).not.toContain("secret.txt");
	});

	it("getFileContent through a symlinked directory is refused", async () => {
		const { gitManager } = await import("../git-manager.js");
		symlinkSync(outside, join(repo, "src"));
		await expect(gitManager.getFileContent(repo, "src/secret.txt")).rejects.toThrow();
	});

	it("a symlink swapped in after the containment check cannot be read (check→read race)", async () => {
		const { gitManager } = await import("../git-manager.js");
		const target = join(repo, "race.txt");
		writeFileSync(target, "original");
		let swapped = false;
		hook.onCheck = (p) => {
			if (swapped || p !== target) return;
			swapped = true;
			unlinkSync(target);
			symlinkSync(secretFile, target);
		};
		let content: string | undefined;
		try {
			content = await gitManager.getFileContent(repo, "race.txt");
		} catch {
			/* refusing (ELOOP / traversal) is the expected safe outcome */
		}
		expect(swapped, "the kernel must run a check on the target path for this test to mean anything").toBe(true);
		expect(content ?? "").not.toContain(SECRET);
	});

	it("a swap of a parent directory after the check cannot redirect the read outside", async () => {
		const { gitManager } = await import("../git-manager.js");
		const dir = join(repo, "docs");
		mkdirSync(dir);
		writeFileSync(join(dir, "secret.txt"), "decoy");
		let swapped = false;
		hook.onCheck = (p) => {
			if (swapped || p !== join(dir, "secret.txt")) return;
			swapped = true;
			rmSync(dir, { recursive: true, force: true });
			symlinkSync(outside, dir);
		};
		let content: string | undefined;
		try {
			content = await gitManager.getFileContent(repo, "docs/secret.txt");
		} catch {
			/* safe */
		}
		expect(content ?? "").not.toContain(SECRET);
	});
});

describe("git-manager writes (scenario 6)", () => {
	it("mkdir happens only after the containment check: no directory is created outside via a planted link", async () => {
		const { gitManager } = await import("../git-manager.js");
		symlinkSync(outside, join(repo, "link"));
		await expect(gitManager.writeFileContent(repo, "link/created-dir/x.txt", "pwn")).rejects.toThrow();
		expect(existsSync(join(outside, "created-dir"))).toBe(false);
	});

	it("a normal nested write still works", async () => {
		const { gitManager } = await import("../git-manager.js");
		await gitManager.writeFileContent(repo, "a/b/c.txt", "ok");
		expect(readFileSync(join(repo, "a", "b", "c.txt"), "utf8")).toBe("ok");
	});

	it("a lexical `..` escape is refused before anything is created", async () => {
		const { gitManager } = await import("../git-manager.js");
		await expect(gitManager.writeFileContent(repo, "../escape-dir/x.txt", "pwn")).rejects.toThrow();
		expect(existsSync(join(work, "escape-dir"))).toBe(false);
	});
});

describe("isolated-workspace write-back (scenario 6)", () => {
	async function isolate() {
		const { prepareIsolatedWorkspace } = await import("../isolated-workspace.js");
		mkdirSync(join(repo, "src"));
		writeFileSync(join(repo, "src", "a.txt"), "original");
		return prepareIsolatedWorkspace(repo, `i0-sym-${n}-${Date.now()}`, { isolationLevel: "workspace" } as never);
	}

	it("a workspace file that is a symlink to a secret is not written back", async () => {
		const ws = await isolate();
		try {
			symlinkSync(secretFile, join(ws.repoPath, "leak.txt"));
			const synced = await ws.writeBack(["leak.txt"]);
			expect(synced).toEqual([]);
			expect(existsSync(join(repo, "leak.txt"))).toBe(false);
		} finally {
			await ws.cleanup();
		}
	});

	it("a symlink swapped in between the checks and the copy never lands in the source repo (check→copy race)", async () => {
		const ws = await isolate();
		try {
			const sourceFile = join(ws.repoPath, "src", "a.txt");
			writeFileSync(sourceFile, "edited");
			let swapped = false;
			hook.onCheck = (p) => {
				if (swapped || p !== sourceFile) return;
				swapped = true;
				unlinkSync(sourceFile);
				symlinkSync(secretFile, sourceFile);
			};
			await ws.writeBack(["src/a.txt"]).catch(() => undefined);
			const dest = join(repo, "src", "a.txt");
			expect(swapped).toBe(true);
			expect(lstatSync(dest).isSymbolicLink()).toBe(false);
			expect(readFileSync(dest, "utf8")).not.toContain(SECRET);
		} finally {
			await ws.cleanup();
		}
	});

	it("a source-repo directory replaced by a symlink after isolation cannot redirect the write-back outside", async () => {
		const ws = await isolate();
		try {
			writeFileSync(join(ws.repoPath, "src", "a.txt"), "edited");
			rmSync(join(repo, "src"), { recursive: true, force: true });
			symlinkSync(outside, join(repo, "src"));
			await ws.writeBack(["src/a.txt"]).catch(() => undefined);
			expect(existsSync(join(outside, "a.txt"))).toBe(false);
		} finally {
			await ws.cleanup();
		}
	});

	it("a normal write-back still lands in the source repo", async () => {
		const ws = await isolate();
		try {
			writeFileSync(join(ws.repoPath, "src", "a.txt"), "edited");
			expect(await ws.writeBack(["src/a.txt"])).toEqual(["src/a.txt"]);
			expect(readFileSync(join(repo, "src", "a.txt"), "utf8")).toBe("edited");
		} finally {
			await ws.cleanup();
		}
	});
});
