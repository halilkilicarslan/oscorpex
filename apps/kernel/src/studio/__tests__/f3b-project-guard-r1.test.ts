// ---------------------------------------------------------------------------
// F3-b review fix round 1 — contract tests (auth-enabled, real DB, both DB modes).
//   1. mid-path project routes (/policy/projects/:id, /usage/projects/:id, /cost/projects/:id)
//   3. writes carrying a foreign projectId in the body are rejected and write nothing
//   5. agent stream: membership check only when a virtual process would be created
//   6. guard cache: cross-tenant poisoning + delete invalidation
//   7. sandbox-policy: project check first, task.projectId must equal the route project, no existence oracle
//   8. hermes soak: missing x-project-id => 400 (no "soak-project" fallback)
// (gateway tenant selection lives in f3b-project-guard-r1-noauth.test.ts: it needs auth disabled)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// OSCORPEX_WORKSPACE_ROOT must be set before the routes are loaded (temp dir only)
const WS_ROOT = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "f3b-r1-ws-")));
	process.env.OSCORPEX_WORKSPACE_ROOT = root;
	return root;
});

import { rmSync } from "node:fs";
import { agentRuntime } from "../agent-runtime.js";
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

const MARK = `f3b-r1-${randomUUID().slice(0, 8)}`;
const MISSING = `f3b-r1-missing-${randomUUID()}`;

let userA: SeededUser;
let userB: SeededUser;
let projA: string;
let projB: string;
let agentB: string;
let taskA: string;
let taskB: string;
const seededPlans: string[] = [];

afterAll(async () => {
	rmSync(WS_ROOT, { recursive: true, force: true });
	await withMigrator(async (c) => {
		await c.query("DELETE FROM audit_events WHERE action LIKE $1", [`${MARK}%`]);
		await c.query("DELETE FROM incidents WHERE title LIKE $1", [`${MARK}%`]);
		await c.query("DELETE FROM runtime_heartbeats WHERE provider_id LIKE $1", [`${MARK}%`]);
		await c.query("DELETE FROM work_items WHERE title LIKE $1", [`${MARK}%`]);
		if (seededPlans.length) {
			await c.query("DELETE FROM tasks WHERE phase_id IN (SELECT id FROM phases WHERE plan_id = ANY($1))", [
				seededPlans,
			]);
			await c.query("DELETE FROM phases WHERE plan_id = ANY($1)", [seededPlans]);
			await c.query("DELETE FROM project_plans WHERE id = ANY($1)", [seededPlans]);
		}
	});
});

function call(
	who: { token: string },
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
) {
	return runOutsideScope(async () =>
		studioRoutes.request(path, {
			method,
			headers: { Authorization: `Bearer ${who.token}`, "content-type": "application/json", ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

/** Finished (non-stream) bodies are read; open streams are cancelled so the test never hangs. */
async function readBody(res: Response): Promise<string> {
	if (res.status === 404 || res.headers.get("content-type")?.includes("json")) return res.text();
	await res.body?.cancel().catch(() => undefined);
	return "";
}

async function uniformNotFound(): Promise<string> {
	const res = await call(userA, "GET", `/projects/${MISSING}`);
	expect(res.status).toBe(404);
	return res.text();
}

async function seedTask(projectId: string, tenantId: string): Promise<string> {
	const planId = `f3b-r1-plan-${randomUUID()}`;
	const phaseId = `f3b-r1-phase-${randomUUID()}`;
	const taskId = `f3b-r1-task-${randomUUID()}`;
	seededPlans.push(planId);
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
			"INSERT INTO tasks (id, phase_id, title, project_id, tenant_id, status, assigned_agent) VALUES ($1, $2, 'f3b', $3, $4, 'queued', '')",
			[taskId, phaseId, projectId, tenantId],
		);
	});
	return taskId;
}

async function count(sql: string, params: unknown[]): Promise<number> {
	return withMigrator(async (c) => Number((await c.query(sql, params)).rows[0].n));
}

beforeAll(async () => {
	userA = await mkUser({ tenantId: TENANT_A });
	userB = await mkUser({ tenantId: TENANT_B });
	projA = await seedProject(TENANT_A, { name: "f3b-r1-own" });
	projB = await seedProject(TENANT_B, { name: `${MARK}-secret` });
	agentB = await seedProjectAgent(projB);
	taskA = await seedTask(projA, TENANT_A);
	taskB = await seedTask(projB, TENANT_B);
});

// ---------------------------------------------------------------------------
describe("F3-b r1 — item 1: mid-path project routes", () => {
	const ROUTES: Array<[string, (p: string) => string]> = [
		["policy/projects/:id", (p) => `/policy/projects/${p}`],
		["usage/projects/:id", (p) => `/usage/projects/${p}`],
		["cost/projects/:id", (p) => `/cost/projects/${p}`],
	];

	it.each(ROUTES)("%s — foreign project => uniform 404 (no data)", async (_n, path) => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "GET", path(projB));
		const text = await res.text();
		expect(res.status).toBe(404);
		expect(text).toBe(uniform);
		expect(text).not.toContain(MARK);
	});

	it.each(ROUTES)("%s — missing project => the same uniform 404", async (_n, path) => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "GET", path(MISSING));
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(uniform);
	});

	it.each(ROUTES)("%s — own project is not rejected by the guard", async (_n, path) => {
		const res = await call(userA, "GET", path(projA));
		// policy summary currently 500s on a pre-existing SQL bug ("column project_id does not exist"); that is out of
		// F3-b scope, so only guard rejections (403/404) are excluded here
		expect([403, 404]).not.toContain(res.status);
	});
});

// ---------------------------------------------------------------------------
describe("F3-b r1 — item 3: writes with a foreign body projectId", () => {
	const reject = (res: Response) => {
		expect([403, 404]).toContain(res.status);
	};

	it("POST /audit — foreign projectId rejected, nothing written; own project writes", async () => {
		const res = await call(userA, "POST", "/audit", {
			projectId: projB,
			category: "f3b",
			action: `${MARK}-audit-foreign`,
		});
		reject(res);
		expect(await count("SELECT count(*) AS n FROM audit_events WHERE action = $1", [`${MARK}-audit-foreign`])).toBe(0);

		const own = await call(userA, "POST", "/audit", { projectId: projA, category: "f3b", action: `${MARK}-audit-own` });
		expect(own.status).toBe(201);
		expect(
			await count("SELECT count(*) AS n FROM audit_events WHERE action = $1 AND project_id = $2", [
				`${MARK}-audit-own`,
				projA,
			]),
		).toBe(1);
	});

	it("POST /incidents — foreign projectId rejected, nothing written; own project writes", async () => {
		const res = await call(userA, "POST", "/incidents", {
			projectId: projB,
			type: "f3b",
			title: `${MARK}-inc-foreign`,
		});
		reject(res);
		expect(await count("SELECT count(*) AS n FROM incidents WHERE title = $1", [`${MARK}-inc-foreign`])).toBe(0);

		const own = await call(userA, "POST", "/incidents", { projectId: projA, type: "f3b", title: `${MARK}-inc-own` });
		expect(own.status).toBe(201);
		expect(
			await count("SELECT count(*) AS n FROM incidents WHERE title = $1 AND project_id = $2", [
				`${MARK}-inc-own`,
				projA,
			]),
		).toBe(1);
	});

	it("POST /presence/heartbeat — foreign projectId rejected, nothing written; own project writes", async () => {
		const res = await call(userA, "POST", "/presence/heartbeat", {
			projectId: projB,
			providerId: `${MARK}-hb-foreign`,
			state: "online",
		});
		reject(res);
		expect(
			await count("SELECT count(*) AS n FROM runtime_heartbeats WHERE provider_id = $1", [`${MARK}-hb-foreign`]),
		).toBe(0);

		const own = await call(userA, "POST", "/presence/heartbeat", {
			projectId: projA,
			providerId: `${MARK}-hb-own`,
			state: "online",
		});
		expect(own.status).toBe(200);
		expect(
			await count("SELECT count(*) AS n FROM runtime_heartbeats WHERE provider_id = $1 AND project_id = $2", [
				`${MARK}-hb-own`,
				projA,
			]),
		).toBe(1);
	});

	it("POST /projects/:id/work-items — a body projectId cannot override the path project", async () => {
		const title = `${MARK}-wi-override`;
		const res = await call(userA, "POST", `/projects/${projA}/work-items`, {
			projectId: projB,
			type: "feature",
			title,
		});
		if (res.status >= 200 && res.status < 300) {
			// accepted: the row must belong to the PATH project, never to the body project
			expect(
				await count("SELECT count(*) AS n FROM work_items WHERE title = $1 AND project_id = $2", [title, projB]),
			).toBe(0);
			expect(
				await count("SELECT count(*) AS n FROM work_items WHERE title = $1 AND project_id = $2", [title, projA]),
			).toBe(1);
		} else {
			reject(res);
			expect(await count("SELECT count(*) AS n FROM work_items WHERE title = $1", [title])).toBe(0);
		}
	});

	it("POST /projects/:id/work-items — own project still works", async () => {
		const title = `${MARK}-wi-own`;
		const res = await call(userA, "POST", `/projects/${projA}/work-items`, { type: "feature", title });
		expect(res.status).toBe(201);
		expect(
			await count("SELECT count(*) AS n FROM work_items WHERE title = $1 AND project_id = $2", [title, projA]),
		).toBe(1);
	});
});

// ---------------------------------------------------------------------------
describe("F3-b r1 — item 5: agent stream membership check", () => {
	const streamPath = (p: string, a: string) => `/projects/${p}/agents/${a}/stream`;

	it("an existing in-memory process for (own project, agentId) streams even when the agent is not a project agent", async () => {
		const presetId = `f3b-r1-preset-${randomUUID().slice(0, 8)}`;
		agentRuntime.ensureVirtualProcess(projA, presetId, "preset");
		const res = await call(userA, "GET", streamPath(projA, presetId));
		expect(res.status).toBe(200);
		await readBody(res);
	});

	it("A's project + an agent of B's project => 404 and no virtual process is created", async () => {
		expect(agentRuntime.streamAgentOutput(projA, agentB)).toBeNull();
		const res = await call(userA, "GET", streamPath(projA, agentB));
		expect(res.status).toBe(404);
		expect(agentRuntime.streamAgentOutput(projA, agentB)).toBeNull();
	});

	it("an unknown agent id on the own project => 404 and no virtual process", async () => {
		const ghost = `f3b-r1-ghost-${randomUUID().slice(0, 8)}`;
		const res = await call(userA, "GET", streamPath(projA, ghost));
		expect(res.status).toBe(404);
		expect(agentRuntime.streamAgentOutput(projA, ghost)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
describe("F3-b r1 — item 6: guard cache", () => {
	it("cross-tenant poisoning: B warms the cache for B's project, A still gets 404", async () => {
		const warm = await call(userB, "GET", `/projects/${projB}`);
		expect(warm.status).toBe(200);
		const uniform = await uniformNotFound();
		const res = await call(userA, "GET", `/projects/${projB}`);
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(uniform);
		// and through an assertProjectInTenant route too
		const ci = await call(userA, "GET", `/ci/status/${projB}`);
		expect(ci.status).toBe(404);
	});

	it("delete invalidation: a deleted project with a warm cache entry gives 404", async () => {
		const p = await seedProject(TENANT_A, { name: "f3b-r1-del" });
		expect((await call(userA, "GET", `/projects/${p}`)).status).toBe(200); // warms the cache
		const del = await call(userA, "DELETE", `/projects/${p}`);
		expect(del.status).toBe(200);
		const after = await call(userA, "GET", `/projects/${p}`);
		expect(after.status).toBe(404);
		expect((await call(userA, "GET", `/ci/status/${p}`)).status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
describe("F3-b r1 — item 7: sandbox-policy", () => {
	const path = (task: string, project: string) => `/tasks/${task}/sandbox-policy?projectId=${project}`;

	it("foreign task id under the caller's own project => 404, identical to a missing task (no existence oracle)", async () => {
		const missing = await call(userA, "GET", path(`f3b-r1-none-${randomUUID()}`, projA));
		expect(missing.status).toBe(404);
		const foreign = await call(userA, "GET", path(taskB, projA));
		expect(foreign.status).toBe(404);
		expect(await foreign.text()).toBe(await missing.text());
	});

	it("the project check runs before any task read: foreign project + missing/foreign/own task => the uniform project 404", async () => {
		const uniform = await uniformNotFound();
		for (const task of [`f3b-r1-none-${randomUUID()}`, taskB, taskA]) {
			const res = await call(userA, "GET", path(task, projB));
			expect(res.status).toBe(404);
			expect(await res.text()).toBe(uniform);
		}
	});

	it("own task under own project still resolves", async () => {
		const res = await call(userA, "GET", path(taskA, projA));
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
describe("F3-b r1 — item 8: hermes soak requires x-project-id", () => {
	it("missing x-project-id => 400 (no soak-project fallback)", async () => {
		const res = await call(userA, "POST", "/hermes/soak", {});
		expect(res.status).toBe(400);
	});

	it("foreign x-project-id => uniform 404", async () => {
		const uniform = await uniformNotFound();
		const res = await call(userA, "POST", "/hermes/soak", {}, { "x-project-id": projB });
		expect(res.status).toBe(404);
		expect(await res.text()).toBe(uniform);
	});
});
