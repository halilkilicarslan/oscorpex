// ---------------------------------------------------------------------------
// F3-0 — Child process env must not leak platform secrets into tenant code
// Covers: app-runner starter (migration exec), process-manager (service spawn),
// terminal exec. child_process is fully mocked — nothing is actually executed.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execSync: vi.fn(),
	execFileSync: vi.fn(),
	spawn: vi.fn(),
	getProject: vi.fn(),
	repoPath: { value: "" },
}));

vi.mock("node:child_process", () => ({
	execSync: mocks.execSync,
	execFileSync: mocks.execFileSync,
	spawn: mocks.spawn,
}));
vi.mock("../db.js", () => ({ getProject: mocks.getProject }));
vi.mock("../checkpoint/index.js", () => ({ createCheckpoint: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../db-provisioner.js", () => ({
	getDbConnectionInfo: vi.fn(),
	provisionDatabase: vi.fn().mockResolvedValue({
		envVars: { DATABASE_URL: "postgresql://appuser:apppw@127.0.0.1:55432/appdb" },
	}),
}));
vi.mock("../runtime-analyzer.js", () => ({
	analyzeProject: vi.fn(),
	generateStudioConfig: vi.fn(),
	writeEnvFile: vi.fn(),
}));
vi.mock("../app-runner/port-manager.js", () => ({
	resolvePort: (p: number) => p,
	postStartHealthCheck: vi.fn().mockResolvedValue(true),
}));
vi.mock("../app-runner/process-manager.js", () => ({
	startService: vi.fn().mockResolvedValue({
		name: "api",
		process: {},
		port: 3999,
		url: "http://localhost:3999",
	}),
	stopApp: vi.fn().mockResolvedValue(undefined),
}));

import { startService as mockedStartService } from "../app-runner/process-manager.js";
import { startApp, startFromConfig } from "../app-runner/starter.js";
import { terminalRoutes } from "../routes/terminal-routes.js";
import { analyzeProject } from "../runtime-analyzer.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";

const FAKE_SECRETS: Record<string, string> = {
	DATABASE_URL: "postgresql://platform:platform-pw@db.internal:5432/oscorpex",
	OSCORPEX_JWT_SECRET: "jwt-secret-value",
	OSCORPEX_API_KEY: "osk_platform_key",
	OPENAI_API_KEY: "sk-openai-fake",
	ANTHROPIC_API_KEY: "sk-ant-fake",
	PGPASSWORD: "pg-platform-password",
	PGHOST: "db.internal",
	PGUSER: "platform",
	STRIPE_WEBHOOK_SECRET: "whsec_fake",
	GITHUB_TOKEN: "ghp_fake",
	SOME_SERVICE_TOKEN: "tok_fake",
	// F3-0 allowlist round: not caught by the old denylist
	ANTHROPIC_ADMIN_API_KEY: "sk-ant-admin-fake",
	CLAUDE_ADMIN_API_KEY: "sk-claude-admin-fake",
	MY_DB_PASSWORD: "hunter2",
	SSH_AUTH_SOCK: "/tmp/fake-agent.sock",
	NODE_OPTIONS: "--require /tmp/fake-evil.js",
	"npm_config_//registry.npmjs.org/:_authToken": "npm-fake-token",
	OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer otel-fake",
	GIT_ASKPASS: "/tmp/fake-askpass",
	FOO_UNKNOWN: "unknown-platform-var",
};

const savedEnv: Record<string, string | undefined> = {};

function leakedKeys(env: NodeJS.ProcessEnv | undefined): string[] {
	if (!env) return ["<env undefined — inherits process.env>"];
	return Object.keys(env).filter(
		(k) =>
			k in FAKE_SECRETS &&
			// the app's own provisioned DATABASE_URL is allowed, the platform's is not
			env[k] === FAKE_SECRETS[k],
	);
}

function assertNoSecrets(env: NodeJS.ProcessEnv | undefined) {
	expect(env, "env option must be passed explicitly").toBeDefined();
	expect(leakedKeys(env)).toEqual([]);
	for (const k of Object.keys(env ?? {})) {
		expect(k, `unexpected sensitive key ${k}`).not.toMatch(/^PG[A-Z_]*$/);
		expect(k, `unexpected sensitive key ${k}`).not.toMatch(/_(SECRET|TOKEN)$/i);
		expect(k, `unexpected sensitive key ${k}`).not.toMatch(/PASSWORD|_API_KEY$/i);
	}
	expect(env?.OSCORPEX_JWT_SECRET).toBeUndefined();
	expect(env?.OSCORPEX_API_KEY).toBeUndefined();
	expect(env?.OPENAI_API_KEY).toBeUndefined();
	expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
}

beforeAll(() => {
	for (const [k, v] of Object.entries(FAKE_SECRETS)) {
		savedEnv[k] = process.env[k];
		process.env[k] = v;
	}
	for (const k of ["OSCORPEX_ENABLE_TERMINAL_EXEC", "NODE_ENV", "OSCORPEX_AUTH_ENABLED"]) savedEnv[k] = process.env[k];
});

afterAll(() => {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "f3-0-child-env-"));
	mocks.execSync.mockReset();
	mocks.execFileSync.mockReset();
	mocks.spawn.mockReset();
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — app-runner starter (migration script)", () => {
	it("passes a sanitized env containing PATH and the app's own DB vars", async () => {
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { migrate: "node migrate.js" } }));
		vi.mocked(analyzeProject).mockReturnValue({
			services: [
				{
					name: "api",
					framework: "express",
					language: "node",
					startCommand: "node server.js",
					installCommand: null,
					port: 3999,
					readyPattern: "listening",
					type: "backend",
					path: ".",
					depsInstalled: true,
				},
			],
			databases: [{ type: "postgresql" }],
			envVars: [],
		} as never);

		await startApp("proj-1", tmp, () => {});

		const migrateCall = mocks.execSync.mock.calls.find((c) => String(c[0]).includes("run migrate"));
		expect(migrateCall, "migration execSync call not found").toBeDefined();
		const env = (migrateCall?.[1] as { env?: NodeJS.ProcessEnv }).env;

		assertNoSecrets(env);
		expect(env?.PATH).toBeTruthy();
		// provisioned app DB vars survive and override the platform value
		expect(env?.DATABASE_URL).toBe("postgresql://appuser:apppw@127.0.0.1:55432/appdb");
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — process-manager (service spawn)", () => {
	it("spawns the tenant app with a sanitized env that keeps PATH, PORT and service env", async () => {
		const { startService } = await vi.importActual<typeof import("../app-runner/process-manager.js")>(
			"../app-runner/process-manager.js",
		);
		const proc = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			killed: false,
			exitCode: null,
			pid: 0,
			kill: vi.fn(),
		});
		mocks.spawn.mockReturnValue(proc);

		const p = startService(
			tmp,
			{
				name: "api",
				path: ".",
				command: "node server.js",
				port: 3999,
				readyPattern: "listening",
				env: { API_TARGET: "http://localhost:4000" },
			},
			() => {},
		);
		// settle the promise without waiting on the 45s timer
		proc.emit("exit", 1);
		await expect(p).rejects.toThrow();

		expect(mocks.spawn).toHaveBeenCalledTimes(1);
		const opts = mocks.spawn.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
		assertNoSecrets(opts.env);
		expect(opts.env?.PATH).toBeTruthy();
		expect(opts.env?.PORT).toBe("3999");
		expect(opts.env?.API_TARGET).toBe("http://localhost:4000");
	});
});

describe("F3-0 child env — app env passthrough without base leakage", () => {
	async function spawnWithEnv(env: Record<string, string>) {
		const { startService } = await vi.importActual<typeof import("../app-runner/process-manager.js")>(
			"../app-runner/process-manager.js",
		);
		const proc = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			killed: false,
			exitCode: null,
			pid: 0,
			kill: vi.fn(),
		});
		mocks.spawn.mockReturnValue(proc);
		const p = startService(
			tmp,
			{ name: "api", path: ".", command: "node server.js", port: 3999, readyPattern: "listening", env },
			() => {},
		);
		proc.emit("exit", 1);
		await expect(p).rejects.toThrow();
		return (mocks.spawn.mock.calls[0][2] as { env?: NodeJS.ProcessEnv }).env;
	}

	it("app-declared DATABASE_URL reaches the child with the APP value, never the platform's", async () => {
		const env = await spawnWithEnv({ DATABASE_URL: "app-url", MY_DB_PASSWORD: "app-pw" });
		expect(env?.DATABASE_URL).toBe("app-url");
		expect(env?.MY_DB_PASSWORD).toBe("app-pw");
	});

	it("platform secrets the app did not declare are absent (even when other secret-named keys are declared)", async () => {
		const env = await spawnWithEnv({ DATABASE_URL: "app-url" });
		expect(env?.PGPASSWORD).toBeUndefined();
		expect(env?.PGHOST).toBeUndefined();
		expect(env?.OSCORPEX_JWT_SECRET).toBeUndefined();
		expect(env?.ANTHROPIC_ADMIN_API_KEY).toBeUndefined();
		expect(env?.MY_DB_PASSWORD).toBeUndefined();
		expect(env?.FOO_UNKNOWN).toBeUndefined();
	});

	it("an app-declared key with the same name as an unrelated platform var never pulls the platform value", async () => {
		const env = await spawnWithEnv({ FOO_UNKNOWN: "app-foo", SOME_SERVICE_TOKEN: "app-tok" });
		expect(env?.FOO_UNKNOWN).toBe("app-foo");
		expect(env?.SOME_SERVICE_TOKEN).toBe("app-tok");
	});

	it("starter: provisioned dbEnvVars reach the migration with app values, not platform PGHOST/PGPASSWORD", async () => {
		const { provisionDatabase } = await import("../db-provisioner.js");
		vi.mocked(provisionDatabase).mockResolvedValueOnce({
			envVars: {
				DATABASE_URL: "postgresql://app:app@127.0.0.1:55432/appdb",
				PGHOST: "127.0.0.1",
				PGPASSWORD: "app-pw",
			},
		} as never);
		writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { migrate: "node migrate.js" } }));
		vi.mocked(analyzeProject).mockReturnValue({
			services: [
				{
					name: "api",
					framework: "express",
					language: "node",
					startCommand: "node server.js",
					installCommand: null,
					port: 3999,
					readyPattern: "listening",
					type: "backend",
					path: ".",
					depsInstalled: true,
				},
			],
			databases: [{ type: "postgresql" }],
			envVars: [],
		} as never);

		await startApp("proj-2", tmp, () => {});

		const call = mocks.execSync.mock.calls.find((c) => String(c[0]).includes("run migrate"));
		const env = (call?.[1] as { env?: NodeJS.ProcessEnv }).env;
		expect(env?.PGHOST).toBe("127.0.0.1");
		expect(env?.PGPASSWORD).toBe("app-pw");
		expect(env?.DATABASE_URL).toBe("postgresql://app:app@127.0.0.1:55432/appdb");
		expect(env?.GIT_ASKPASS).toBeUndefined();
		expect(env?.FOO_UNKNOWN).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 buildSafeChildEnv — allowlist for tenant-code profiles", () => {
	const ALLOWED = [
		"PATH",
		"HOME",
		"USER",
		"LOGNAME",
		"SHELL",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"TERM",
		"TMPDIR",
		"TMP",
		"TEMP",
		"NODE_ENV",
		"CI",
		"FORCE_COLOR",
		"NO_COLOR",
		"HTTP_PROXY",
		"HTTPS_PROXY",
		"NO_PROXY",
		"http_proxy",
		"https_proxy",
		"no_proxy",
	];
	const DROPPED = [
		"ANTHROPIC_ADMIN_API_KEY",
		"CLAUDE_ADMIN_API_KEY",
		"STRIPE_API_KEY",
		"MY_DB_PASSWORD",
		"SSH_AUTH_SOCK",
		"NODE_OPTIONS",
		"NODE_PATH",
		"npm_config_//registry.npmjs.org/:_authToken",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"GIT_ASKPASS",
		"FOO_UNKNOWN",
	];
	const base = (): NodeJS.ProcessEnv => {
		const b: Record<string, string> = {};
		for (const k of [...ALLOWED, ...DROPPED]) b[k] = `val-${k}`;
		return b;
	};

	for (const profile of ["app_runner", "build_tool", "test"] as const) {
		it(`${profile}: passes only the base allowlist`, () => {
			const env = buildSafeChildEnv({ profile, base: base() });
			for (const k of ALLOWED) expect(env[k], `${k} should pass`).toBe(`val-${k}`);
			for (const k of DROPPED) expect(env[k], `${k} should be dropped`).toBeUndefined();
			// GIT_CEILING_DIRECTORIES is always injected so git cannot walk up out of a project dir
			expect(Object.keys(env).sort()).toEqual([...ALLOWED, "GIT_CEILING_DIRECTORIES"].sort());
		});

		it(`${profile}: explicit extra still passes`, () => {
			const env = buildSafeChildEnv({ profile, base: base(), extra: { PORT: "3000", MY_APP_FLAG: "1" } });
			expect(env.PORT).toBe("3000");
			expect(env.MY_APP_FLAG).toBe("1");
		});

		it(`${profile}: process.env default base also drops unknown platform vars`, () => {
			const env = buildSafeChildEnv({ profile });
			expect(env.FOO_UNKNOWN).toBeUndefined();
			expect(env.ANTHROPIC_ADMIN_API_KEY).toBeUndefined();
			expect(env.SSH_AUTH_SOCK).toBeUndefined();
			expect(env.NODE_OPTIONS).toBeUndefined();
			expect(env["npm_config_//registry.npmjs.org/:_authToken"]).toBeUndefined();
		});
	}

	it("provider profile keeps denylist behaviour: non-sensitive unknown var passes, secrets dropped", () => {
		const env = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/bin", FOO_UNKNOWN: "x", DATABASE_URL: "postgres://p", OSCORPEX_JWT_SECRET: "j" },
		});
		expect(env.FOO_UNKNOWN).toBe("x");
		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.OSCORPEX_JWT_SECRET).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 docker compose in multi-tenant mode", () => {
	const dockerConfig = () => ({
		services: [{ name: "web", path: ".", command: "docker compose up web", port: 3999, readyPattern: "ready" }],
		preview: "web",
	});

	it("is refused with a clear error when auth is enabled", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		vi.mocked(mockedStartService).mockClear();
		const err = await startFromConfig("proj-d1", tmp, dockerConfig() as never, () => {}).then(
			() => null,
			(e: unknown) => (e instanceof Error ? e.message : String(e)),
		);
		expect(err, "startFromConfig should reject").not.toBeNull();
		expect(err).toMatch(/docker/i);
		expect(err).toMatch(/multi-tenant|disabled|auth|devre dışı/i);
		expect(mockedStartService).not.toHaveBeenCalled();
	});

	it("is still allowed when auth is disabled (local dev)", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "false";
		vi.mocked(mockedStartService).mockClear();
		await startFromConfig("proj-d2", tmp, dockerConfig() as never, () => {});
		expect(mockedStartService).toHaveBeenCalledTimes(1);
		expect(vi.mocked(mockedStartService).mock.calls[0][1].command).toBe("docker compose up");
	});

	it("non-docker services start normally when auth is enabled", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		vi.mocked(mockedStartService).mockClear();
		await startFromConfig(
			"proj-d3",
			tmp,
			{
				services: [{ name: "api", path: ".", command: "node server.js", port: 3999, readyPattern: "ready" }],
				preview: "api",
			} as never,
			() => {},
		);
		expect(mockedStartService).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — terminal exec", () => {
	const app = new Hono();
	app.route("/", terminalRoutes);

	it("runs allowlisted commands with a sanitized env that keeps PATH", async () => {
		process.env.OSCORPEX_ENABLE_TERMINAL_EXEC = "true";
		process.env.NODE_ENV = "test";
		const repo = join(tmp, "repo");
		mkdirSync(join(repo, ".git"), { recursive: true }); // the git pre-flight wants a real `.git` directory
		mocks.getProject.mockResolvedValue({ id: "p1", name: "x", repoPath: repo });
		// the pre-flight spawns git too (execFileSync is mocked): answer its probes, everything else is "ok"
		mocks.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
			if (args[0] === "rev-parse" && args.includes("--absolute-git-dir"))
				return `${realpathSync(join(repo, ".git"))}\n`;
			if (args[0] === "config") return "";
			return "ok";
		});

		const res = await app.request("http://localhost/projects/p1/terminal/exec", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ command: "git_status" }),
		});
		expect(res.status).toBe(200);
		// the terminal command itself (pre-flight probes are separate calls, each also checked below)
		const terminalCalls = mocks.execFileSync.mock.calls.filter((c) => (c[1] as string[])[0] === "status");
		expect(terminalCalls).toHaveLength(1);
		for (const call of mocks.execFileSync.mock.calls) assertNoSecrets((call[2] as { env?: NodeJS.ProcessEnv }).env);
		const opts = terminalCalls[0][2] as { env?: NodeJS.ProcessEnv };
		expect(opts.env?.PATH).toBeTruthy();
	});
});
