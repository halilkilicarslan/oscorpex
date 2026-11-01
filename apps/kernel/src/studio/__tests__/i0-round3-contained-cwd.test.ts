// ---------------------------------------------------------------------------
// I0 round 3 — resolveContainedCwd (security/contained-fs.ts) and its use by app-runner startService:
// the service directory is judged by its REAL path; spawn never runs on a refusal, and a normal service starts from
// its real directory. spawn is mocked: no process is ever started.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp } from "./helpers/i0-fakes.js";

const sp = vi.hoisted(() => ({ calls: [] as { bin: string; args: string[]; cwd?: string }[] }));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (bin: string, args: string[], opts: { cwd?: string }) => {
			sp.calls.push({ bin, args, cwd: opts.cwd });
			const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
			const stdout = new EventEmitter();
			proc.stdout = stdout;
			proc.stderr = new EventEmitter();
			proc.pid = undefined;
			proc.killed = false;
			proc.exitCode = null;
			proc.kill = () => true;
			setImmediate(() => stdout.emit("data", Buffer.from("server listening")));
			return proc;
		},
	};
});
vi.mock("../app-runner/port-manager.js", () => ({
	resolvePort: (p: number) => p,
	postStartHealthCheck: async () => true,
}));

import { startService } from "../app-runner/process-manager.js";
import { PathContainmentError, resolveContainedCwd } from "../security/contained-fs.js";

let work: string;
let root: string;
let outside: string;

beforeAll(() => {
	work = freshTmp("oscx-i0-r3-cwd-");
});
afterAll(() => rmSync(work, { recursive: true, force: true }));
beforeEach(() => {
	sp.calls.length = 0;
	for (const d of ["repo", "repo-evil", "outside"]) rmSync(join(work, d), { recursive: true, force: true });
	root = join(work, "repo");
	outside = join(work, "outside");
	mkdirSync(join(root, "services", "api"), { recursive: true });
	mkdirSync(join(work, "repo-evil"));
	mkdirSync(join(outside, "app"), { recursive: true });
	writeFileSync(join(outside, "app", "package.json"), "{}");
});

describe("resolveContainedCwd", () => {
	it("accepts cwd equal to the root and returns the real paths", () => {
		const r = resolveContainedCwd(root, root);
		expect(r.realCwd).toBe(r.realRoot);
	});

	it("accepts a nested directory", () => {
		const r = resolveContainedCwd(root, join(root, "services", "api"));
		expect(r.realCwd).toBe(join(r.realRoot, "services", "api"));
	});

	it("refuses a sibling that shares the root's name as a prefix (/x/repo vs /x/repo-evil)", () => {
		expect(() => resolveContainedCwd(root, join(work, "repo-evil"))).toThrow(PathContainmentError);
	});

	it("refuses `..` segments that climb out of the root", () => {
		expect(() => resolveContainedCwd(root, join(root, "services", "..", ".."))).toThrow(PathContainmentError);
	});

	it("refuses an absolute path outside the root", () => {
		expect(() => resolveContainedCwd(root, outside)).toThrow(PathContainmentError);
	});

	it("refuses a symlink that escapes the root", () => {
		symlinkSync(join(outside, "app"), join(root, "frontend"));
		expect(() => resolveContainedCwd(root, join(root, "frontend"))).toThrow(PathContainmentError);
	});

	it("allows a symlink that stays inside the root and returns the REAL path", () => {
		symlinkSync(join("services", "api"), join(root, "svc"));
		const r = resolveContainedCwd(root, join(root, "svc"));
		expect(r.realCwd).toBe(join(r.realRoot, "services", "api"));
	});

	it("refuses a nonexistent cwd (and a nonexistent root)", () => {
		expect(() => resolveContainedCwd(root, join(root, "nope"))).toThrow(PathContainmentError);
		expect(() => resolveContainedCwd(join(work, "no-root"), root)).toThrow(PathContainmentError);
	});
});

describe("startService (spawn mocked)", () => {
	const cfg = (path: string) => ({
		name: "svc",
		path,
		command: "node server.js --port ${PORT}",
		port: 4010,
		readyPattern: "listening",
	});
	const logs: string[] = [];

	it("refuses an absolute config.path outside the repo; spawn is never called", async () => {
		await expect(startService(root, cfg(outside), (m) => logs.push(m))).rejects.toThrow(/refused/i);
		expect(sp.calls).toEqual([]);
	});

	it("refuses `frontend -> <outside>` (a symlink out of the repo); spawn is never called", async () => {
		symlinkSync(join(outside, "app"), join(root, "frontend"));
		await expect(startService(root, cfg("frontend"), (m) => logs.push(m))).rejects.toThrow(/refused/i);
		expect(sp.calls).toEqual([]);
	});

	it("refuses a `..` path out of the repo and a nonexistent service dir; spawn is never called", async () => {
		await expect(startService(root, cfg("../outside/app"), (m) => logs.push(m))).rejects.toThrow(/refused/i);
		await expect(startService(root, cfg("missing"), (m) => logs.push(m))).rejects.toThrow(/refused/i);
		expect(sp.calls).toEqual([]);
	});

	it("starts a normal service in its real directory", async () => {
		const running = await startService(root, cfg("services/api"), (m) => logs.push(m));
		expect(running.name).toBe("svc");
		expect(sp.calls).toHaveLength(1);
		expect(sp.calls[0].cwd).toBe(join(resolveContainedCwd(root, root).realRoot, "services", "api"));
	});

	it("starts an in-repo symlinked service from the symlink's REAL directory", async () => {
		symlinkSync(join("services", "api"), join(root, "svc"));
		await startService(root, cfg("svc"), (m) => logs.push(m));
		expect(sp.calls).toHaveLength(1);
		expect(sp.calls[0].cwd).toBe(join(resolveContainedCwd(root, root).realRoot, "services", "api"));
	});
});
