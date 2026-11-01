// ---------------------------------------------------------------------------
// F3-0 final fix round — simple-git env, proxy stream path & redirects,
// docker guard, platform probe profile, allowlist additions.
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	gitEnvArgs: [] as unknown[],
	spawnCalls: [] as Array<{ bin: string; args: string[]; env: Record<string, string | undefined> }>,
	upstreamPort: 0,
}));

vi.mock("simple-git", () => {
	const make = (): unknown => {
		const target: Record<string, unknown> = {};
		const proxy: unknown = new Proxy(target, {
			get(_t, prop) {
				if (prop === "then") return undefined;
				if (prop === "env") {
					return (...a: unknown[]) => {
						h.gitEnvArgs.push(...a);
						return proxy;
					};
				}
				return vi.fn(async () => "");
			},
		});
		return proxy;
	};
	return { simpleGit: vi.fn(() => make()), default: vi.fn(() => make()) };
});

vi.mock("node:child_process", async (orig) => {
	const real = await orig<typeof import("node:child_process")>();
	const { EventEmitter } = await import("node:events");
	const spawn = vi.fn((bin: string, args: string[], opts: { env?: Record<string, string | undefined> }) => {
		h.spawnCalls.push({ bin, args, env: opts?.env ?? {} });
		const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & Record<string, unknown>;
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();
		proc.stdin = { write: vi.fn(), end: vi.fn() };
		proc.kill = vi.fn();
		proc.unref = vi.fn();
		proc.pid = 4242;
		proc.killed = false;
		proc.exitCode = null;
		setTimeout(() => proc.emit("close", 0), 5);
		return proc;
	});
	return { ...real, spawn, default: { ...real, spawn } };
});

vi.mock("../app-runner.js", () => ({
	getAppStatus: vi.fn(() => ({
		running: true,
		previewUrl: `http://127.0.0.1:${h.upstreamPort}`,
		services: [],
	})),
	getResolvedConfig: vi.fn(),
	startApp: vi.fn(),
	stopApp: vi.fn(),
	switchPreviewService: vi.fn(),
}));
vi.mock("../db-provisioner.js", () => ({
	getDbStatus: vi.fn(),
	parseCloudUrl: vi.fn(),
	provisionDatabase: vi.fn(),
	stopAllDatabases: vi.fn(),
	stopDatabase: vi.fn(),
}));
vi.mock("../db.js", () => ({ getProject: vi.fn() }));
vi.mock("../runtime-analyzer.js", () => ({ analyzeProject: vi.fn(), writeEnvFile: vi.fn() }));
vi.mock("../routes/team-init-guard.js", () => ({ ensureProjectTeamInitialized: vi.fn() }));

import { startService } from "../app-runner/process-manager.js";
import { runCommand } from "../cli-usage/binary-locator.js";
import { gitManager } from "../git-manager.js";
import { runtimeRoutes } from "../routes/runtime-routes.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";

const SECRETS: Record<string, string> = {
	OSCORPEX_JWT_SECRET: "jwt-secret-value",
	DATABASE_URL: "postgresql://u:p@h/db",
	ANTHROPIC_API_KEY: "sk-ant-fake",
	GITHUB_TOKEN: "ghp_fake",
	AWS_SECRET_ACCESS_KEY: "aws-fake",
};

const savedEnv = { ...process.env };
function restoreEnv() {
	for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
	Object.assign(process.env, savedEnv);
}
afterEach(restoreEnv);

// ---- Item 1: simple-git env -------------------------------------------------
describe("F3-0 simple-git env", () => {
	let dir: string;
	beforeEach(() => {
		h.gitEnvArgs.length = 0;
		dir = mkdtempSync(join(tmpdir(), "f3-git-"));
		Object.assign(process.env, SECRETS);
		process.env.HOME = process.env.HOME || "/home/fake";
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("git-manager creates simple-git with a sanitized env (no platform secrets, PATH and HOME kept)", async () => {
		try {
			await gitManager.initRepo(dir);
		} catch {
			// mocked git — result irrelevant, only the env handed to simple-git matters
		}
		expect(h.gitEnvArgs.length, "simpleGit(...).env(...) was never called").toBeGreaterThan(0);
		const env = h.gitEnvArgs[0] as Record<string, string | undefined>;
		for (const k of Object.keys(SECRETS)) expect(env[k], k).toBeUndefined();
		expect(Object.values(env)).not.toContain("jwt-secret-value");
		expect(env.PATH).toBeTruthy();
		expect(env.HOME).toBeTruthy();
	});
});

// ---- Items 2, 3: proxy stream path & redirects --------------------------------
describe("F3-0 preview proxy — stream path and redirects", () => {
	let server: Server | undefined;
	let hits: string[] = [];
	const app = new Hono();
	app.route("/", runtimeRoutes);
	const BASE = "http://localhost/projects/p1/app/proxy";
	const PAYLOAD = JSON.stringify({ data: "x".repeat(5000) });

	beforeAll(async () => {
		server = createServer((req, res) => {
			const url = req.url ?? "/";
			hits.push(url);
			if (url.startsWith("/gz-json")) {
				const gz = gzipSync(Buffer.from(PAYLOAD));
				res.writeHead(200, {
					"content-type": "application/json",
					"content-encoding": "gzip",
					"content-length": String(gz.length),
				});
				res.end(gz);
				return;
			}
			if (url.startsWith("/x")) {
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("target");
				return;
			}
			if (url.startsWith("/html-redir")) {
				res.writeHead(302, { location: "/x", "content-type": "text/html; charset=utf-8" });
				res.end("<html><head></head><body>Redirecting…</body></html>");
				return;
			}
			if (url.startsWith("/redir")) {
				res.writeHead(302, { location: "/x" });
				res.end();
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
		await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
		h.upstreamPort = (server.address() as AddressInfo).port;
	});
	afterAll(async () => {
		await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
	});
	beforeEach(() => {
		hits = [];
	});

	it("gzip-compressed JSON arrives complete and parseable, without stale content-length/content-encoding", async () => {
		const res = await app.request(`${BASE}/gz-json`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-encoding")).toBeNull();
		expect(res.headers.get("content-length")).toBeNull();
		const text = await res.text();
		expect(text.length).toBe(PAYLOAD.length);
		expect(JSON.parse(text)).toEqual(JSON.parse(PAYLOAD));
	});

	it("upstream 302 reaches the client as 302 with NO location header; target is not fetched", async () => {
		const res = await app.request(`${BASE}/redir`);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBeNull();
		expect(hits).not.toContain("/x");
	});

	it("upstream 302 exposes the target via x-oscorpex-upstream-location", async () => {
		const res = await app.request(`${BASE}/redir`);
		expect(res.status).toBe(302);
		expect(res.headers.get("x-oscorpex-upstream-location")).toBe("/x");
		expect(hits).not.toContain("/x");
	});

	it("an HTML-bodied 302 (the HTML rewrite branch) also drops location", async () => {
		const res = await app.request(`${BASE}/html-redir`);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBeNull();
		expect(res.headers.get("x-oscorpex-upstream-location")).toBe("/x");
		expect(hits).not.toContain("/x");
	});
});

// ---- Item 4: docker guard in startService ----------------------------------------
describe("F3-0 docker guard (startService)", () => {
	const REFUSED = [
		"docker compose up",
		"docker  compose up",
		"docker-compose up",
		"/usr/local/bin/docker run x",
		"podman compose up",
		"nerdctl run x",
	];
	const mk = (command: string) => ({ name: "svc", path: ".", command, port: 39999, readyPattern: "ready" });
	let dir: string;
	beforeEach(() => {
		h.spawnCalls.length = 0;
		dir = mkdtempSync(join(tmpdir(), "f3-docker-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	for (const cmd of REFUSED) {
		it(`auth enabled: refuses "${cmd}" and never spawns`, async () => {
			process.env.OSCORPEX_AUTH_ENABLED = "true";
			const started = startService(dir, mk(cmd), () => {});
			started.catch(() => {});
			const outcome = await Promise.race([
				started.then(
					() => "resolved",
					(e: Error) => e.message,
				),
				new Promise<string>((r) => setTimeout(() => r("not-refused"), 300)),
			]);
			expect(outcome).toMatch(/docker|container/i);
			expect(h.spawnCalls).toHaveLength(0);
		});
	}

	it("auth enabled: a non-container command is not refused by the guard", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const p = startService(dir, mk("node server.js"), () => {});
		p.catch(() => {});
		expect(h.spawnCalls.length).toBe(1);
	});

	it("auth disabled: docker commands are allowed (spawned) as before", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "false";
		for (const cmd of REFUSED) {
			h.spawnCalls.length = 0;
			const p = startService(dir, mk(cmd), () => {});
			p.catch(() => {});
			expect(h.spawnCalls.length, cmd).toBe(1);
		}
	});
});

// ---- Item 5: platform probe profile ---------------------------------------------
describe("F3-0 cli-usage probe env", () => {
	it("runCommand passes non-sensitive provider vars (CLAUDE_CONFIG_DIR) but never platform secrets", async () => {
		h.spawnCalls.length = 0;
		process.env.CLAUDE_CONFIG_DIR = "/tmp/f3-claude-config";
		Object.assign(process.env, SECRETS);
		await runCommand("claude", ["/usage"], { timeoutMs: 500 });
		expect(h.spawnCalls).toHaveLength(1);
		const env = h.spawnCalls[0].env;
		expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/f3-claude-config");
		for (const k of ["OSCORPEX_JWT_SECRET", "DATABASE_URL", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
			expect(env[k], k).toBeUndefined();
		}
	});
});

// ---- Item 6: allowlist additions --------------------------------------------------
describe("F3-0 env allowlist additions", () => {
	const base = {
		PATH: "/usr/bin",
		LC_MESSAGES: "en_US.UTF-8",
		LC_TIME: "C",
		LC_NUMERIC: "C",
		SystemRoot: "C:\\Windows",
		ComSpec: "C:\\Windows\\System32\\cmd.exe",
		PATHEXT: ".COM;.EXE",
		WINDIR: "C:\\Windows",
		...SECRETS,
		RANDOM_APP_VAR: "nope",
	};
	for (const profile of ["app_runner", "build_tool", "test"] as const) {
		it(`${profile}: passes LC_* and Windows basics; secrets and unknown vars stay out`, () => {
			const env = buildSafeChildEnv({ profile, base });
			for (const k of ["LC_MESSAGES", "LC_TIME", "LC_NUMERIC", "SystemRoot", "ComSpec", "PATHEXT", "WINDIR"]) {
				expect(env[k], k).toBe((base as Record<string, string>)[k]);
			}
			for (const k of Object.keys(SECRETS)) expect(env[k], k).toBeUndefined();
			expect(env.RANDOM_APP_VAR).toBeUndefined();
		});
	}
});
