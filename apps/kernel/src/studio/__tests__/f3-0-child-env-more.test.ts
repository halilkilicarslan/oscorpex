// ---------------------------------------------------------------------------
// F3-0 (extension) — more tenant-code child_process sites must receive a sanitized env.
// child_process is fully mocked — nothing is actually executed.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execSync: vi.fn(),
	execFileSync: vi.fn(),
	execFile: vi.fn(),
	spawn: vi.fn(),
	getProject: vi.fn(),
	analyzeProject: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execSync: mocks.execSync,
	execFileSync: mocks.execFileSync,
	execFile: mocks.execFile,
	spawn: mocks.spawn,
}));
vi.mock("../db.js", () => ({ getProject: mocks.getProject, insertTaskDiffs: vi.fn().mockResolvedValue(1) }));
vi.mock("../checkpoint/index.js", () => ({ createCheckpoint: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../db-provisioner.js", () => ({
	getDbConnectionInfo: vi.fn(),
	getDbStatus: vi.fn(),
	parseCloudUrl: vi.fn(),
	provisionDatabase: vi.fn().mockResolvedValue({ envVars: {} }),
	stopAllDatabases: vi.fn(),
	stopDatabase: vi.fn(),
}));
vi.mock("../runtime-analyzer.js", () => ({
	analyzeProject: mocks.analyzeProject,
	generateStudioConfig: vi.fn(),
	writeEnvFile: vi.fn(),
}));
vi.mock("../app-runner/port-manager.js", () => ({
	resolvePort: (p: number) => p,
	postStartHealthCheck: vi.fn().mockResolvedValue(true),
}));
vi.mock("../app-runner/process-manager.js", () => ({
	startService: vi.fn().mockResolvedValue({ name: "api", process: {}, port: 3999, url: "http://localhost:3999" }),
	stopApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../app-runner.js", () => ({
	getAppStatus: vi.fn(),
	getResolvedConfig: vi.fn(),
	startApp: vi.fn(),
	stopApp: vi.fn(),
	switchPreviewService: vi.fn(),
}));
vi.mock("../container-pool.js", () => ({ containerPool: { getStatus: vi.fn() } }));
vi.mock("../routes/team-init-guard.js", () => ({ ensureProjectTeamInitialized: vi.fn() }));
vi.mock("../security/workspace-resolver.js", () => ({ assertInsideWorkspace: vi.fn() }));
vi.mock("../security/tool-policy-enforcer.js", () => ({ enforceToolPolicy: vi.fn() }));
vi.mock("../legacy/cli-runtime.js", () => ({ streamWithCLI: vi.fn() }));

import { startApp } from "../app-runner/starter.js";
import { captureTaskDiffs } from "../diff-capture.js";
import { applyCommit } from "../git/commit-executor.js";
import { runLintFix } from "../lint-runner.js";
import { streamPlannerWithCLI } from "../planner-cli.js";
import { runtimeRoutes } from "../routes/runtime-routes.js";
import { runCliDemo } from "../task-runners.js";

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
};

/** Allowlist-round secrets: only tenant-code profiles drop these (provider keeps its denylist). */
const TENANT_ONLY_SECRETS: Record<string, string> = {
	ANTHROPIC_ADMIN_API_KEY: "sk-ant-admin-fake",
	CLAUDE_ADMIN_API_KEY: "sk-claude-admin-fake",
	MY_DB_PASSWORD: "hunter2",
	SSH_AUTH_SOCK: "/tmp/fake-agent.sock",
	"npm_config_//registry.npmjs.org/:_authToken": "npm-fake-token",
	OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer otel-fake",
	GIT_ASKPASS: "/tmp/fake-askpass",
	FOO_UNKNOWN: "unknown-platform-var",
};

const savedEnv: Record<string, string | undefined> = {};

/** `allow` = provider's own credentials that may legitimately be present. */
function assertNoPlatformSecrets(env: NodeJS.ProcessEnv | undefined, allow: string[] = []) {
	expect(env, "env option must be passed explicitly (undefined inherits process.env)").toBeDefined();
	for (const [k, v] of Object.entries(FAKE_SECRETS)) {
		if (allow.includes(k)) continue;
		expect(env?.[k], `${k} leaked into child env`).not.toBe(v);
	}
	for (const k of Object.keys(env ?? {})) {
		if (allow.includes(k)) continue;
		expect(k, `unexpected sensitive key ${k}`).not.toMatch(/^PG[A-Z_]*$/);
		expect(k, `unexpected sensitive key ${k}`).not.toMatch(/_(SECRET|TOKEN)$/i);
	}
	expect(env?.DATABASE_URL).toBeUndefined();
	expect(env?.OSCORPEX_JWT_SECRET).toBeUndefined();
	expect(env?.OSCORPEX_API_KEY).toBeUndefined();
	if (!allow.includes("ANTHROPIC_API_KEY")) expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
	if (!allow.includes("OPENAI_API_KEY")) expect(env?.OPENAI_API_KEY).toBeUndefined();
	// provider profile (allow non-empty) keeps denylist semantics; tenant-code profiles use an allowlist
	if (allow.length === 0) {
		for (const [k, v] of Object.entries(TENANT_ONLY_SECRETS)) {
			expect(env?.[k], `${k} leaked into tenant-code child env`).not.toBe(v);
		}
	}
	expect(env?.PATH).toBeTruthy();
}

beforeAll(() => {
	for (const [k, v] of Object.entries({ ...FAKE_SECRETS, ...TENANT_ONLY_SECRETS })) {
		savedEnv[k] = process.env[k];
		process.env[k] = v;
	}
});

afterAll(() => {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "f3-0-child-env-more-"));
	for (const m of [mocks.execSync, mocks.execFileSync, mocks.execFile, mocks.spawn]) m.mockReset();
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — lint-runner (eslint/prettier execFile wrapper)", () => {
	it("runs eslint and prettier in the tenant repo with a sanitized env", async () => {
		writeFileSync(join(tmp, "a.ts"), "export const a = 1;\n");
		mocks.execFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
			cb(null, "", "");
			return new EventEmitter();
		});

		await runLintFix(tmp, ["a.ts"]);

		expect(mocks.execFile).toHaveBeenCalledTimes(2); // eslint + prettier
		for (const call of mocks.execFile.mock.calls) {
			const opts = call[2] as { env?: NodeJS.ProcessEnv; cwd?: string };
			expect(opts.cwd).toBe(tmp);
			assertNoPlatformSecrets(opts.env);
		}
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — task-runners runCliDemo (build step)", () => {
	it("runs the build step with a sanitized env", async () => {
		mocks.execFileSync.mockReturnValue("");
		await runCliDemo(tmp, { id: "t1", description: "run `pnpm start`" } as never, () => {});

		expect(mocks.execFileSync).toHaveBeenCalled();
		for (const call of mocks.execFileSync.mock.calls) {
			const opts = call[2] as { env?: NodeJS.ProcessEnv; cwd?: string };
			expect(opts.cwd).toBe(tmp);
			assertNoPlatformSecrets(opts.env);
		}
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — runtime-routes install endpoint", () => {
	const app = new Hono();
	app.route("/", runtimeRoutes);

	it("runs the install command with a sanitized env", async () => {
		mocks.getProject.mockResolvedValue({ id: "p1", name: "x", repoPath: tmp });
		mocks.analyzeProject.mockReturnValue({
			services: [{ name: "api", path: ".", installCommand: "npm install" }],
			databases: [],
			envVars: [],
		});
		mocks.execSync.mockReturnValue("");

		const res = await app.request("http://localhost/projects/p1/runtime/install", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(200);
		expect(mocks.execSync).toHaveBeenCalledTimes(1);
		const [cmd, opts] = mocks.execSync.mock.calls[0] as [string, { env?: NodeJS.ProcessEnv }];
		expect(cmd).toContain("--ignore-scripts");
		assertNoPlatformSecrets(opts.env);
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — app-runner starter (dependency install)", () => {
	it("runs the dependency install with a sanitized env", async () => {
		mocks.analyzeProject.mockReturnValue({
			services: [
				{
					name: "api",
					framework: "express",
					language: "node",
					startCommand: "node server.js",
					installCommand: "npm install",
					port: 3999,
					readyPattern: "listening",
					type: "backend",
					path: ".",
					depsInstalled: false,
				},
			],
			databases: [],
			envVars: [],
		});
		mocks.execSync.mockReturnValue("");

		await startApp("proj-1", tmp, () => {});

		const installCall = mocks.execSync.mock.calls.find((c) => String(c[0]).includes("install"));
		expect(installCall, "install execSync call not found").toBeDefined();
		assertNoPlatformSecrets((installCall?.[1] as { env?: NodeJS.ProcessEnv }).env);
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — planner-cli codex spawn", () => {
	it("spawns codex without platform secrets (provider's own OPENAI_API_KEY may be present)", () => {
		const proc = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			stdin: { write: vi.fn(), end: vi.fn() },
			kill: vi.fn(),
		});
		mocks.spawn.mockReturnValue(proc);

		const stop = streamPlannerWithCLI(
			{ repoPath: tmp, prompt: "p", systemPrompt: "s", provider: "codex", timeoutMs: 1_000 },
			{ onTextDelta: () => {}, onDone: () => {}, onError: () => {} },
		);

		expect(mocks.spawn).toHaveBeenCalledTimes(1);
		expect(mocks.spawn.mock.calls[0][0]).toBe("codex");
		const opts = mocks.spawn.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
		assertNoPlatformSecrets(opts.env, ["OPENAI_API_KEY"]);
		proc.emit("close", 0);
		stop();
	});
});

// ---------------------------------------------------------------------------
describe("F3-0 child env — git paths in the tenant repo", () => {
	it("commit-executor: `git commit` (runs repo hooks) gets a sanitized env on every git call", () => {
		const repo = join(tmp, "repo");
		mkdirSync(repo);
		mocks.execFileSync.mockReturnValue("abc123\n");

		const result = applyCommit({
			proposal: {
				id: "cp1",
				tenantId: "t1",
				projectId: "p1",
				checkpointId: "c1",
				message: "feat: x",
				stagedFiles: [],
				diffSnapshot: "",
				diffSizeBytes: 0,
				secretScanPassed: true,
				testGatePassed: true,
				status: "approved",
				proposedAt: new Date().toISOString(),
			},
			checkpoint: {
				id: "c1",
				tenantId: "t1",
				projectId: "p1",
				headSha: "abc123",
				branchName: "main",
				stagedFiles: [],
				createdAt: new Date().toISOString(),
				expiresAt: new Date().toISOString(),
			},
			repoPath: repo,
			actorId: "tester",
		});

		expect(result.status).toBe("applied");
		const commitCall = mocks.execFileSync.mock.calls.find((c) => (c[1] as string[])[0] === "commit");
		expect(commitCall, "git commit call not found").toBeDefined();
		for (const call of mocks.execFileSync.mock.calls) {
			assertNoPlatformSecrets((call[2] as { env?: NodeJS.ProcessEnv }).env);
		}
	});

	it("diff-capture: git diff calls get a sanitized env", async () => {
		mocks.execFileSync.mockReturnValue("+added line\n");

		await captureTaskDiffs("task-1", tmp, { filesCreated: ["a.ts"], filesModified: ["b.ts"], logs: [] } as never);

		expect(mocks.execFileSync).toHaveBeenCalled();
		for (const call of mocks.execFileSync.mock.calls) {
			assertNoPlatformSecrets((call[2] as { env?: NodeJS.ProcessEnv }).env);
		}
	});
});
