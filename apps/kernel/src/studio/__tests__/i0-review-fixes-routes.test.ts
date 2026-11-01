// ---------------------------------------------------------------------------
// I0 review fixes — request-level cases, mounted without auth (the routers are exercised directly):
//   B  git routes: a request string that starts with `-` is a 400 and never reaches git as an option;
//   C  sandbox-policy route: an unknown isolationLevel is a 400;
//   F  project settings route: a private/metadata SonarQube hostUrl is a 400 and is never saved.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp, makeFakeBin, prependPath, readInvocations } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const state = vi.hoisted(() => ({
	repoPath: "",
	savedSettings: [] as unknown[][],
	createdPolicies: [] as Record<string, unknown>[],
	agentCliTool: "none" as string | undefined,
	sonarSettings: { enabled: "true", hostUrl: "https://sonar.tenant.example", token: "squ_tenant" } as Record<
		string,
		string | undefined
	>,
}));

vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getProject: async (id: string) => (id === "p1" ? { id: "p1", name: "p1", repoPath: state.repoPath } : undefined),
		getProjectForTenant: async (id: string) =>
			id === "p1" ? { id: "p1", name: "p1", repoPath: state.repoPath } : undefined,
		getProjectAgent: async (id: string) =>
			id === "a1"
				? { id: "a1", projectId: "p1", name: "a1", cliTool: state.agentCliTool, systemPrompt: "" }
				: undefined,
		getProjectSetting: async (_p: string, _c: string, key: string) => state.sonarSettings[key],
		setProjectSettings: async (...args: unknown[]) => {
			state.savedSettings.push(args);
		},
	};
});
vi.mock("../sandbox-manager.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		createSandboxPolicy: async (params: Record<string, unknown>) => {
			state.createdPolicies.push(params);
			return { id: "pol-1", ...params };
		},
	};
});

let work: string;
type TestEnv = { Variables: { tenantId: string } };
let app: Hono<TestEnv>;

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), GIT_CONFIG_GLOBAL: "/dev/null" },
	});
}

const json = (method: string, path: string, body?: unknown) =>
	app.request(path, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

beforeAll(async () => {
	work = freshTmp("oscx-i0-rf-routes-");
	state.repoPath = join(work, "repo");
	git(work, "init", "-q", "-b", "main", state.repoPath);
	git(state.repoPath, "config", "user.name", "t");
	git(state.repoPath, "config", "user.email", "t@example.test");
	writeFileSync(join(state.repoPath, "a.txt"), "a\n");
	git(state.repoPath, "add", "-A");
	git(state.repoPath, "commit", "-q", "-m", "seed");
	const { gitFileRoutes } = await import("../routes/git-file-routes.js");
	const { sandboxRoutes } = await import("../routes/sandbox-routes.js");
	const { analyticsRoutes } = await import("../routes/analytics-routes.js");
	const { agentRoutes } = await import("../routes/agent-routes.js");
	app = new Hono<TestEnv>();
	app.use("*", async (c, next) => {
		c.set("tenantId", "t1");
		await next();
	});
	app.route("/", agentRoutes);
	app.route("/", gitFileRoutes);
	app.route("/", sandboxRoutes);
	app.route("/", analyticsRoutes);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));
beforeEach(() => {
	state.savedSettings.length = 0;
	state.createdPolicies.length = 0;
});

const headIsMain = () => git(state.repoPath, "rev-parse", "--abbrev-ref", "HEAD").trim() === "main";

// ---------------------------------------------------------------------------
// B. every route that forwards a request string into a git argument
// ---------------------------------------------------------------------------

describe("B: option-shaped request values are a 400 (GET /git/diff, POST /git/revert|merge|commit)", () => {
	it("GET /projects/:id/git/diff?ref=--output=<file> is 400 and writes no file", async () => {
		const out = join(work, "pwned-route.txt");
		writeFileSync(join(state.repoPath, "a.txt"), "a edited\n");
		const res = await json("GET", `/projects/p1/git/diff?ref=${encodeURIComponent(`--output=${out}`)}`);
		expect(res.status).toBe(400);
		expect(existsSync(out)).toBe(false);
		git(state.repoPath, "checkout", "--", "a.txt");
	});

	it("GET /projects/:id/git/diff?ref=-p is 400", async () => {
		const res = await json("GET", "/projects/p1/git/diff?ref=-p");
		expect(res.status).toBe(400);
	});

	it("POST /projects/:id/git/revert with commitHash '--no-commit' is 400", async () => {
		const res = await json("POST", "/projects/p1/git/revert", { commitHash: "--no-commit" });
		expect(res.status).toBe(400);
	});

	for (const [name, body] of [
		["source", { source: "--abort", target: "main" }],
		["target", { source: "main", target: "--orphan=oscx-injected" }],
	] as const) {
		it(`POST /projects/:id/git/merge with an option-shaped ${name} is 400`, async () => {
			const res = await json("POST", "/projects/p1/git/merge", body);
			expect(res.status).toBe(400);
			expect(headIsMain()).toBe(true);
			expect(git(state.repoPath, "branch", "--list", "oscx-injected").trim()).toBe("");
		});
	}

	it("POST /projects/:id/git/commit with an option-shaped file entry is 400", async () => {
		writeFileSync(join(state.repoPath, "a.txt"), "a edited again\n");
		const res = await json("POST", "/projects/p1/git/commit", { message: "m", files: ["--chmod=+x", "a.txt"] });
		expect(res.status).toBe(400);
		expect(git(state.repoPath, "log", "--format=%s", "-1").trim()).toBe("seed");
		git(state.repoPath, "checkout", "--", "a.txt");
	});
});

// ---------------------------------------------------------------------------
// C. sandbox policy route
// ---------------------------------------------------------------------------

describe("C: POST /projects/:id/sandbox-policy validates isolationLevel", () => {
	for (const level of ["Container", "foo", "WORKSPACE", "", 1, {}] as unknown[]) {
		it(`isolationLevel ${JSON.stringify(level)} is 400 and nothing is stored`, async () => {
			const res = await json("POST", "/projects/p1/sandbox-policy", { isolationLevel: level });
			expect(res.status).toBe(400);
			expect(state.createdPolicies).toEqual([]);
		});
	}

	it("the known levels are still accepted", async () => {
		for (const level of ["none", "workspace"]) {
			const res = await json("POST", "/projects/p1/sandbox-policy", { isolationLevel: level });
			expect(res.status).toBe(201);
		}
	});
});

// ---------------------------------------------------------------------------
// F. SonarQube host validation on save
// ---------------------------------------------------------------------------

describe("F: PUT /projects/:id/settings/sonarqube rejects private / metadata hosts", () => {
	for (const hostUrl of [
		"http://169.254.169.254",
		"http://169.254.169.254/latest/meta-data",
		"http://127.0.0.1:9000",
		"http://[::1]:9000",
		"http://10.0.0.5:9000",
		"file:///etc/passwd",
	]) {
		it(`${hostUrl} is 400 and is not saved`, async () => {
			const res = await json("PUT", "/projects/p1/settings/sonarqube", { enabled: "true", hostUrl });
			expect(res.status).toBe(400);
			expect(state.savedSettings).toEqual([]);
		});
	}
});

describe("F: legacy / platform Sonar hosts are normalised to blank on save", () => {
	const saved = process.env.SONAR_HOST_URL;
	afterAll(() => {
		if (saved === undefined) Reflect.deleteProperty(process.env, "SONAR_HOST_URL");
		else process.env.SONAR_HOST_URL = saved;
	});

	it("the legacy default http://localhost:9000 saves fine and is stored blank", async () => {
		const res = await json("PUT", "/projects/p1/settings/sonarqube", {
			enabled: "true",
			hostUrl: "http://localhost:9000",
		});
		expect(res.status).toBe(200);
		const body = state.savedSettings[0]?.[2] as Record<string, string> | undefined;
		expect(body?.hostUrl ?? "").toBe("");
	});

	for (const hostUrl of ["http://localhost:9000/", "HTTP://LOCALHOST:9000//"]) {
		it(`the legacy default written as ${hostUrl} saves fine and is stored blank`, async () => {
			const res = await json("PUT", "/projects/p1/settings/sonarqube", { enabled: "true", hostUrl });
			expect(res.status).toBe(200);
			const body = state.savedSettings[0]?.[2] as Record<string, string> | undefined;
			expect(body?.hostUrl ?? "").toBe("");
		});
	}

	for (const hostUrl of [
		"http://localhost:9001",
		"http://localhost:9000/x",
		"http://127.0.0.1:9000/",
		"http://LOCALHOST:8080//",
	]) {
		it(`${hostUrl} (not the legacy default) is still 400 and not saved`, async () => {
			const res = await json("PUT", "/projects/p1/settings/sonarqube", { enabled: "true", hostUrl });
			expect(res.status).toBe(400);
			expect(state.savedSettings).toEqual([]);
		});
	}

	it("the platform host (SONAR_HOST_URL) saves fine and is stored blank", async () => {
		process.env.SONAR_HOST_URL = "https://sonar.platform.example";
		const res = await json("PUT", "/projects/p1/settings/sonarqube", {
			enabled: "true",
			hostUrl: "https://sonar.platform.example",
		});
		expect(res.status).toBe(200);
		const body = state.savedSettings[0]?.[2] as Record<string, string> | undefined;
		expect(body?.hostUrl ?? "").toBe("");
	});

	it("saving settings without a hostUrl still works", async () => {
		const res = await json("PUT", "/projects/p1/settings/sonarqube", { enabled: "false" });
		expect(res.status).toBe(200);
	});
});

describe("F: Sonar scan / quality-gate endpoints are disabled until workload isolation", () => {
	const saved: Record<string, string | undefined> = {};
	let record: string;
	let restorePath: () => void;
	let bin: string;

	beforeAll(() => {
		for (const k of ["SONAR_ENABLED", "SONAR_TOKEN"]) saved[k] = process.env[k];
		process.env.SONAR_ENABLED = "true";
		process.env.SONAR_TOKEN = "squ_platform_token";
		bin = join(work, "bin");
		mkdirSync(bin);
		record = makeFakeBin(bin, "npx", { stdout: "ok" });
		restorePath = prependPath(bin);
		writeFileSync(join(state.repoPath, "sonar-project.properties"), "sonar.projectKey=x\n");
	});
	afterAll(() => {
		restorePath();
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = v;
		}
	});

	it("POST /projects/:id/sonar/scan is 409 with a clear message and spawns no scanner", async () => {
		const res = await json("POST", "/projects/p1/sonar/scan", {});
		expect(res.status).toBe(409);
		expect(JSON.stringify(await res.json())).toMatch(/isolation|disabled/i);
		expect(readInvocations(record)).toEqual([]);
	});

	it("GET /projects/:id/sonar/status reports enabled:false", async () => {
		const res = await json("GET", "/projects/p1/sonar/status");
		expect(res.status).toBe(200);
		expect(((await res.json()) as { enabled: boolean }).enabled).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Agent start route
// ---------------------------------------------------------------------------

describe("POST /projects/:id/agents/:agentId/start for an agent without a CLI tool", () => {
	for (const cliTool of ["none", undefined, ""] as (string | undefined)[]) {
		it(`cliTool ${JSON.stringify(cliTool)} is a client-state conflict (409/422), not a 500`, async () => {
			state.agentCliTool = cliTool;
			const res = await json("POST", "/projects/p1/agents/a1/start", {});
			expect([409, 422]).toContain(res.status);
		});
	}
});
