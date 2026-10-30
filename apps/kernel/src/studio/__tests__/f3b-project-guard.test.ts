// ---------------------------------------------------------------------------
// F3-b — generic project access guard (accessGuard: `/projects/:id/...`), assertProjectInTenant for
// projects referenced outside the path, SSE hardening and the guard cache.
//
// Contract assumed for the implementation:
//   - accessGuard calls sys_project_tenant(id) for every `/projects/:id[/...]` request (collection routes
//     such as /projects, /projects/import, /projects/from-template excluded). Not equal to the caller's
//     tenant / NULL / missing project => 404 with ONE uniform body that does not echo the id.
//   - Platform admins are not exempt.
//   - Only positive lookups are cached; a cache hit performs no extra DB statement.
//
// Runs in both DB modes (restricted runtime role and superuser/CI-simulation where RLS is bypassed): the
// assertions do not depend on RLS hiding the foreign project.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// OSCORPEX_WORKSPACE_ROOT must be set before the routes are loaded (temp dir only)
const WS_ROOT = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "f3b-ws-")));
	process.env.OSCORPEX_WORKSPACE_ROOT = root;
	return root;
});

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { agentRuntime } from "../agent-runtime.js";
import { eventBus } from "../event-bus.js";
import { studioRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { mkUser, registerCleanup, seedProject, seedProjectAgent, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

let hermesSaved: string | undefined;
beforeEach(() => {
	hermesSaved = process.env.OSCORPEX_ENABLE_HERMES;
	process.env.OSCORPEX_ENABLE_HERMES = "true";
});
afterEach(() => {
	if (hermesSaved === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_ENABLE_HERMES");
	else process.env.OSCORPEX_ENABLE_HERMES = hermesSaved;
});
afterAll(() => {
	rmSync(WS_ROOT, { recursive: true, force: true });
});

const SECRET_NAME = `f3b-secret-${randomUUID().slice(0, 8)}`;
const MISSING = `f3b-missing-${randomUUID()}`;

let isSuper = true;
let userA: SeededUser;
let adminA: SeededUser;
let projA: string;
let projB: string;
let agentB: string;
let taskA: string; // task of A's project
let taskB: string; // task of B's project

function call(
	who: { token: string },
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return runOutsideScope(async () =>
		studioRoutes.request(path, {
			method,
			headers: { Authorization: `Bearer ${who.token}`, "content-type": "application/json", ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

/** Reads the body of finished responses; open streams (non-404) are cancelled so the test never hangs. */
async function readBody(res: Response): Promise<string> {
	if (res.status === 404 || res.headers.get("content-type")?.includes("json")) return res.text();
	await res.body?.cancel().catch(() => undefined);
	return "";
}

async function seedTask(
	projectId: string,
	tenantId: string,
	o: { status?: string; agent?: string; logs?: string[] } = {},
): Promise<string> {
	const planId = `f3b-plan-${randomUUID()}`;
	const phaseId = `f3b-phase-${randomUUID()}`;
	const taskId = `f3b-task-${randomUUID()}`;
	const output = o.logs ? JSON.stringify({ filesCreated: [], filesModified: [], logs: o.logs }) : null;
	await withMigrator(async (c) => {
		await c.query("INSERT INTO project_plans (id, project_id, created_at, tenant_id) VALUES ($1, $2, now(), $3)", [
			planId,
			projectId,
			tenantId,
		]);
		await c.query("INSERT INTO phases (id, plan_id, name, tenant_id) VALUES ($1, $2, 'f3b', $3)", [
			phaseId,
			planId,
			tenantId,
		]);
		await c.query(
			"INSERT INTO tasks (id, phase_id, title, project_id, tenant_id, status, assigned_agent, output) VALUES ($1, $2, 'f3b', $3, $4, $5, $6, $7)",
			[taskId, phaseId, projectId, tenantId, o.status ?? "queued", o.agent ?? "", output],
		);
	});
	return taskId;
}

async function taskLogs(taskId: string): Promise<string[]> {
	return withMigrator(async (c) => {
		const r = await c.query("SELECT output FROM tasks WHERE id = $1", [taskId]);
		const raw = r.rows[0]?.output as string | null;
		return raw ? ((JSON.parse(raw).logs as string[] | undefined) ?? []) : [];
	});
}

beforeAll(async () => {
	const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await probe.connect();
	try {
		isSuper =
			(await probe.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper === true;
	} finally {
		await probe.end();
	}
	userA = await mkUser({ tenantId: TENANT_A });
	adminA = await mkUser({ tenantId: TENANT_A, admin: true });

	projA = await seedProject(TENANT_A, { name: "f3b-own" });
	projB = await seedProject(TENANT_B, { name: SECRET_NAME });
	agentB = await seedProjectAgent(projB);
	taskA = await seedTask(projA, TENANT_A);
	taskB = await seedTask(projB, TENANT_B);
	// in-memory state that leaks even when RLS hides the DB rows
	agentRuntime.ensureVirtualProcess(projB, agentB, "f3b-agent");
});

interface RouteCase {
	name: string;
	method: string;
	path: (projectId: string) => string;
	body?: (projectId: string) => unknown;
	headers?: (projectId: string) => Record<string, string>;
}

const CASES: RouteCase[] = [
	{ name: "project detail", method: "GET", path: (p) => `/projects/${p}` },
	{ name: "agents/:agentId/stream", method: "GET", path: (p) => `/projects/${p}/agents/${agentB}/stream` },
	{ name: "app/proxy/", method: "GET", path: (p) => `/projects/${p}/app/proxy/` },
	{
		name: "app/switch-preview",
		method: "POST",
		path: (p) => `/projects/${p}/app/switch-preview`,
		body: () => ({ service: "web" }),
	},
	// terminal routes are rate limited (5/min) per actor + exact path; each case below uses a distinct
	// (actor, path) pair at most once, so the limiter never kicks in
	{ name: "terminal/info", method: "GET", path: (p) => `/projects/${p}/terminal/info` },
	{ name: "tasks/:taskId/stream", method: "GET", path: (p) => `/projects/${p}/tasks/${taskB}/stream` },
	{ name: "pipeline status", method: "GET", path: (p) => `/projects/${p}/pipeline/status` },
	{ name: "inspector", method: "GET", path: (p) => `/projects/${p}/tasks/${taskB}/inspector` },
	{ name: "ci status", method: "GET", path: (p) => `/ci/status/${p}` },
	{
		name: "ci track (body projectId)",
		method: "POST",
		path: () => "/ci/track",
		body: (p) => ({ projectId: p, provider: "github", prId: "1" }),
	},
	{
		name: "hermes session (x-project-id)",
		method: "POST",
		path: () => "/hermes/session",
		body: () => ({}),
		headers: (p) => ({ "x-project-id": p }),
	},
	{ name: "notifications (query projectId)", method: "GET", path: (p) => `/notifications?projectId=${p}` },
];

function callCase(who: { token: string }, c: RouteCase, projectId: string): Promise<Response> {
	return call(who, c.method, c.path(projectId), c.body?.(projectId), c.headers?.(projectId));
}

/** The uniform "not found" body as the guard produces it for a project that does not exist. */
async function uniformNotFound(): Promise<string> {
	const res = await call(userA, "GET", `/projects/${MISSING}`);
	expect(res.status).toBe(404);
	return res.text();
}

describe("F3-b — scenario 1: foreign project => 404 with the same body as a missing project", () => {
	it("the baseline (missing project) body is a 404 that does not echo the id or the secret", async () => {
		const body = await uniformNotFound();
		expect(body).not.toContain(MISSING);
		expect(body).not.toContain(projB);
	});

	it.each(CASES)("$name — tenant A user on B's project", async (c) => {
		const uniform = await uniformNotFound();
		const res = await callCase(userA, c, projB);
		const text = await readBody(res);
		expect(res.status).toBe(404);
		expect(text).toBe(uniform);
		expect(text).not.toContain(SECRET_NAME);
	});

	it.each(CASES)("$name — missing project returns the identical 404 body", async (c) => {
		const uniform = await uniformNotFound();
		const res = await callCase(userA, c, MISSING);
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(uniform);
	});

	it("own project still works (positive control)", async () => {
		for (const path of [`/projects/${projA}`, `/projects/${projA}/tasks`]) {
			const res = await call(userA, "GET", path);
			expect(res.status, path).toBe(200);
		}
		const term = await call(userA, "GET", `/projects/${projA}/terminal/info`);
		expect(term.status).toBe(200);
		const ci = await call(userA, "GET", `/ci/status/${projA}`);
		expect(ci.status).toBe(200);
	});

	it(`runs in the active DB mode (${isSuper ? "superuser/CI-simulation: RLS bypassed" : "restricted role"})`, () => {
		// Both modes execute the exact same assertions above; this only records which one is active.
		expect(typeof isSuper).toBe("boolean");
	});
});

describe("F3-b — scenario 2: path variants cannot bypass the guard", () => {
	const encodedFirstChar = (id: string) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;

	it("percent-encoded id => same uniform 404", async () => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "GET", `/projects/${encodedFirstChar(projB)}`);
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(uniform);
	});

	it("percent-encoded id on a sub-route => same uniform 404", async () => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "GET", `/projects/${encodedFirstChar(projB)}/tasks`);
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(uniform);
	});

	it("trailing slash cannot bypass: project root => uniform 404 (403 unknown-route is also not a bypass)", async () => {
		const uniform = await uniformNotFound();
		const root = await call(userA, "GET", `/projects/${projB}/`);
		const rootText = await readBody(root);
		expect([403, 404]).toContain(root.status);
		if (root.status === 404) expect(rootText).toBe(uniform);
		expect(rootText).not.toContain(SECRET_NAME);

		const sub = await call(userA, "GET", `/projects/${projB}/tasks/`);
		const subText = await readBody(sub);
		expect([403, 404]).toContain(sub.status);
		expect(subText).not.toContain(SECRET_NAME);
	});

	it("double slash never reaches B's data", async () => {
		for (const path of [`/projects//${projB}`, `//projects/${projB}`, `/projects/${projB}//terminal/info`]) {
			const res = await call(userA, "GET", path);
			const text = await readBody(res);
			expect([400, 403, 404], path).toContain(res.status);
			expect(text, path).not.toContain(SECRET_NAME);
		}
	});

	it("dot-dot segments (resolved or encoded) never reach B's data", async () => {
		const paths = [
			`/projects/${projA}/../${projB}`,
			`/projects/${projA}/%2e%2e/${projB}`,
			`/projects/${projA}%2F..%2F${projB}`,
			`/projects/${projA}/../${projB}/tasks`,
		];
		for (const path of paths) {
			const res = await call(userA, "GET", path);
			const text = await readBody(res);
			expect([400, 403, 404], path).toContain(res.status);
			expect(text, path).not.toContain(SECRET_NAME);
		}
		// a resolved `..` that lands on B's project must give the uniform body
		const uniform = await uniformNotFound();
		const resolved = await call(userA, "GET", `/projects/${projA}/../${projB}`);
		expect(resolved.status).toBe(404);
		expect(await resolved.text()).toBe(uniform);
	});

	it("case variants of the projects segment never reach B's data", async () => {
		for (const path of [`/Projects/${projB}`, `/PROJECTS/${projB}/tasks`, `/projects/${projB.toUpperCase()}`]) {
			const res = await call(userA, "GET", path);
			const text = await readBody(res);
			expect([403, 404], path).toContain(res.status);
			expect(text, path).not.toContain(SECRET_NAME);
		}
	});
});

describe("F3-b — scenario 3: platform admin is not exempt", () => {
	it.each(CASES)("$name — admin of tenant A on B's project", async (c) => {
		const uniform = await uniformNotFound();
		const res = await callCase(adminA, c, projB);
		const text = await readBody(res);
		expect(res.status).toBe(404);
		expect(text).toBe(uniform);
	});

	it("admin still reaches own project", async () => {
		const res = await call(adminA, "GET", `/projects/${projA}`);
		expect(res.status).toBe(200);
	});
});

describe("F3-b — scenario 4: collection routes are unaffected", () => {
	it("GET /projects reaches its handler (200, list)", async () => {
		const res = await call(userA, "GET", "/projects");
		expect(res.status).toBe(200);
		expect(Array.isArray(await res.json())).toBe(true);
	});

	it("POST /projects/import reaches its handler (not rejected by the project guard)", async () => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "POST", "/projects/import", {});
		expect(res.status).not.toBe(403);
		expect(await res.text()).not.toBe(uniform);
	});

	it("POST /projects/from-template reaches its handler (not rejected by the project guard)", async () => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "POST", "/projects/from-template", {});
		expect(res.status).not.toBe(403);
		expect(await res.text()).not.toBe(uniform);
	});
});

describe("F3-b — scenario 5: task stream", () => {
	const streamPath = (pid: string, tid: string) => `/projects/${pid}/tasks/${tid}/stream`;

	function emitOutput(projectId: string, agent: string, text: string) {
		eventBus.emitTransient({
			projectId,
			type: "agent:output",
			agentId: agent,
			payload: { output: text },
		} as never);
	}

	it("A's task requested under B's project id => 404 and nothing is written", async () => {
		const agent = `f3b-agent-${randomUUID().slice(0, 6)}`;
		const t = await seedTask(projA, TENANT_A, { status: "running", agent });
		const before = await taskLogs(t);
		const res = await call(userA, "GET", streamPath(projB, t));
		expect(res.status).toBe(404);
		emitOutput(projB, agent, "leak-1");
		emitOutput(projA, agent, "leak-2");
		await new Promise((r) => setTimeout(r, 150));
		expect(await taskLogs(t)).toEqual(before);
	});

	it("B's task requested under A's own project id => 404 (task.projectId must equal :id)", async () => {
		const uniformTask = await call(userA, "GET", streamPath(projA, `f3b-none-${randomUUID()}`));
		expect(uniformTask.status).toBe(404);
		const res = await call(userA, "GET", streamPath(projA, taskB));
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(await uniformTask.text());
	});

	it("the caller's own finished task streams its logs and a done event", async () => {
		const t = await seedTask(projA, TENANT_A, { status: "done", logs: ["hello-own"] });
		const res = await call(userA, "GET", streamPath(projA, t));
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("hello-own");
		expect(text).toContain("event: done");
	});

	it("two concurrent viewers see the backlog once and the stream endpoint does not write", async () => {
		const agent = `f3b-agent-${randomUUID().slice(0, 6)}`;
		const t = await seedTask(projA, TENANT_A, { status: "running", agent, logs: ["seed-line"] });
		const [v1, v2] = await Promise.all([
			call(userA, "GET", streamPath(projA, t)),
			call(userA, "GET", streamPath(projA, t)),
		]);
		expect(v1.status).toBe(200);
		expect(v2.status).toBe(200);
		// consume concurrently: SSE writes apply backpressure until a reader drains the body
		const bodies = Promise.all([v1.text(), v2.text()]);
		await new Promise((r) => setTimeout(r, 150));
		emitOutput(projA, agent, "live-line");
		await new Promise((r) => setTimeout(r, 150));
		eventBus.emitTransient({
			projectId: projA,
			type: "task:completed",
			taskId: t,
			payload: {},
		} as never);
		const [t1, t2] = await bodies;
		// NOTE: no assertion on live lines. Hono closes the task SSE stream after the callback, so live logs
		// never flow today (pre-existing bug, backlog — out of F3-b scope). Only the backlog is asserted.
		expect(t1.split("seed-line").length - 1).toBe(1);
		expect(t2.split("seed-line").length - 1).toBe(1);
		// persistence is the executor's job: viewers must not append anything
		expect(await taskLogs(t)).toEqual(["seed-line"]);
	});
});

describe("F3-b — scenario 5b: stream handler no longer persists logs per viewer (static check)", () => {
	it("the task stream handler does not call appendTaskLogs", () => {
		const src = readFileSync(join(__dirname, "../routes/task-routes.ts"), "utf8");
		const start = src.indexOf('taskRoutes.get("/projects/:id/tasks/:taskId/stream"');
		expect(start).toBeGreaterThan(-1);
		const rest = src.slice(start + 10);
		const next = rest.search(/\ntaskRoutes\.(get|post|put|patch|delete)\(/);
		const block = next === -1 ? rest : rest.slice(0, next);
		expect(block).not.toContain("appendTaskLogs");
	});
});

describe("F3-b — scenario 7: guard lookup count / cache", () => {
	let queryCalls: string[] = [];
	let spy: ReturnType<typeof vi.spyOn> | undefined;

	beforeEach(() => {
		queryCalls = [];
		const orig = pg.Client.prototype.query as (...a: unknown[]) => unknown;
		spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
			const first = args[0];
			const text = typeof first === "string" ? first : ((first as { text?: string } | undefined)?.text ?? "");
			if (text.includes("sys_project_tenant")) queryCalls.push(text);
			return orig.apply(this, args);
		} as never);
	});
	afterEach(() => spy?.mockRestore());

	it("first request performs exactly one guard lookup; cache hits add none (any sub-route)", async () => {
		const p = await seedProject(TENANT_A, { name: "f3b-perf" });
		const r1 = await call(userA, "GET", `/projects/${p}`);
		expect(r1.status).toBe(200);
		expect(queryCalls.length).toBe(1);

		const r2 = await call(userA, "GET", `/projects/${p}`);
		const r3 = await call(userA, "GET", `/projects/${p}/tasks`);
		expect(r2.status).toBe(200);
		expect(r3.status).toBe(200);
		expect(queryCalls.length).toBe(1);
	});

	it("negative results are not cached: a missing project is looked up on every request", async () => {
		const id = `f3b-missing-${randomUUID()}`;
		await call(userA, "GET", `/projects/${id}`);
		await call(userA, "GET", `/projects/${id}`);
		expect(queryCalls.length).toBe(2);
	});

	it("a foreign project is not served from another tenant's cache entry", async () => {
		// warm: owner A of projA hits the cache; the cached entry must not make B's project visible to A
		await call(userA, "GET", `/projects/${projA}`);
		const res = await call(userA, "GET", `/projects/${projB}`);
		expect(res.status).toBe(404);
	});
});

describe("F3-b — POST /scheduler/soak is platform-admin only", () => {
	it("a non-admin tenant user is rejected with 403", async () => {
		const res = await call(userA, "POST", "/scheduler/soak");
		expect(res.status).toBe(403);
	});
});
