// ---------------------------------------------------------------------------
// I0 item 10 / scenario 9 — filesystem paths never come from a request body.
//   * RAG codebase indexing (POST /rag/knowledge-bases/:id/index-codebase and /reindex) and the test-run route
//     (POST /tests/run/:projectId) answer 400 to a body that carries projectPath/repoPath (absolute, `..`, or
//     even alongside a valid projectId); they take a projectId and resolve the path server-side from the project;
//   * another tenant's projectId is a 404; a traversal-shaped projectId never resolves;
//   * the happy path uses the project's own repo_path from the database.
// ---------------------------------------------------------------------------

import { rmSync } from "node:fs";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware } from "../auth/auth-middleware.js";
import { call, cleanup, mkUser, registerCleanup, seedProject, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import { freshTmp } from "./helpers/i0-fakes.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

const seen = vi.hoisted(() => ({
	index: [] as Record<string, unknown>[],
	reindex: [] as unknown[][],
	runTests: [] as unknown[][],
}));

vi.mock("../document-indexer.js", () => ({
	documentIndexer: {
		indexCodebase: async (opts: Record<string, unknown>) => {
			seen.index.push(opts);
			return { indexed: 0 };
		},
		reindexChanged: async (...args: unknown[]) => {
			seen.reindex.push(args);
			return { reindexed: 0 };
		},
	},
}));
vi.mock("../test-runner.js", () => ({
	testRunner: {
		runTests: async (...args: unknown[]) => {
			seen.runTests.push(args);
			return { framework: "vitest", passed: 1, failed: 0, skipped: 0, total: 1, coverage: null, durationMs: 1 };
		},
	},
}));
vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, saveTestResult: async (r: Record<string, unknown>) => ({ id: "i0-result", ...r }) };
});

useAuthEnabledEnv();
registerCleanup();
void cleanup;

let admin: SeededUser;
let owner: SeededUser;
let ownProject: string;
let otherTenantProject: string;
let ownRepo: string;
let kbId: string;
let testApp: Hono;

beforeAll(async () => {
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
	owner = await mkUser({ tenantId: TENANT_A });
	ownProject = await seedProject(TENANT_A);
	otherTenantProject = await seedProject(TENANT_B);
	ownRepo = freshTmp("oscx-i0-paths-");
	await withMigrator((c) => c.query("UPDATE projects SET repo_path = $1 WHERE id = $2", [ownRepo, ownProject]));

	const { observabilityRoutes } = await import("../../observability/index.js");
	const { runOutsideScope } = await import("../tenancy/tenant-scope.js");
	const res = await runOutsideScope(async () =>
		observabilityRoutes.request("/rag/knowledge-bases", {
			method: "POST",
			headers: { Authorization: `Bearer ${admin.token}`, "content-type": "application/json" },
			body: JSON.stringify({ name: `i0-kb-${Date.now()}` }),
		}),
	);
	kbId = ((await res.json()) as { id: string }).id;

	const { testRoutes } = await import("../routes/test-routes.js");
	testApp = new Hono();
	testApp.use("*", authMiddleware);
	testApp.route("/tests", testRoutes);
});
afterAll(async () => {
	rmSync(ownRepo, { recursive: true, force: true });
	if (kbId) await withMigrator((c) => c.query("DELETE FROM rag_knowledge_bases WHERE id = $1", [kbId]));
});
beforeEach(() => {
	seen.index.length = 0;
	seen.reindex.length = 0;
	seen.runTests.length = 0;
});

async function obs(path: string, body: unknown) {
	const { observabilityRoutes } = await import("../../observability/index.js");
	const { runOutsideScope } = await import("../tenancy/tenant-scope.js");
	return runOutsideScope(async () =>
		observabilityRoutes.request(path, {
			method: "POST",
			headers: { Authorization: `Bearer ${admin.token}`, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

async function runTestRoute(projectId: string, body: unknown) {
	const { runOutsideScope } = await import("../tenancy/tenant-scope.js");
	return runOutsideScope(async () =>
		testApp.request(`/tests/run/${encodeURIComponent(projectId)}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("RAG index-codebase / reindex take a projectId, never a path (scenario 9)", () => {
	for (const [name, suffix] of [
		["index-codebase", "index-codebase"],
		["reindex", "reindex"],
	] as const) {
		const route = () => `/rag/knowledge-bases/${kbId}/${suffix}`;
		const calls = () => (name === "index-codebase" ? seen.index : seen.reindex);

		it(`${name}: a body projectPath (absolute) → 400, nothing is indexed`, async () => {
			const res = await obs(route(), { projectPath: "/etc" });
			expect(res.status).toBe(400);
			expect(calls()).toEqual([]);
		});

		it(`${name}: a traversal projectPath → 400`, async () => {
			const res = await obs(route(), { projectPath: "../../../etc" });
			expect(res.status).toBe(400);
			expect(calls()).toEqual([]);
		});

		it(`${name}: projectPath next to a valid projectId is still rejected`, async () => {
			const res = await obs(route(), { projectId: ownProject, projectPath: "/etc" });
			expect(res.status).toBe(400);
			expect(calls()).toEqual([]);
		});

		it(`${name}: no projectId → 400`, async () => {
			const res = await obs(route(), {});
			expect(res.status).toBe(400);
			expect(calls()).toEqual([]);
		});

		it(`${name}: another tenant's projectId → 404`, async () => {
			const res = await obs(route(), { projectId: otherTenantProject });
			expect(res.status).toBe(404);
			expect(calls()).toEqual([]);
		});

		it(`${name}: a traversal-shaped projectId never resolves`, async () => {
			const res = await obs(route(), { projectId: "../../etc" });
			expect([400, 404]).toContain(res.status);
			expect(calls()).toEqual([]);
		});

		it(`${name}: own projectId → 200 and the server-resolved repo_path is what gets indexed`, async () => {
			const res = await obs(route(), { projectId: ownProject });
			expect(res.status).toBe(200);
			expect(calls().length).toBe(1);
			const first = calls()[0];
			const used = Array.isArray(first) ? first[0] : (first as Record<string, unknown>).projectPath;
			expect(used).toBe(ownRepo);
		});
	}
});

describe("POST /tests/run/:projectId takes no repoPath (scenario 9)", () => {
	it("a body repoPath (absolute) → 400, no test run", async () => {
		const res = await runTestRoute(ownProject, { repoPath: "/etc" });
		expect(res.status).toBe(400);
		expect(seen.runTests).toEqual([]);
	});

	it("a traversal repoPath → 400", async () => {
		const res = await runTestRoute(ownProject, { repoPath: "../../.." });
		expect(res.status).toBe(400);
		expect(seen.runTests).toEqual([]);
	});

	it("another tenant's projectId → 404 (with or without a repoPath)", async () => {
		expect((await runTestRoute(otherTenantProject, {})).status).toBe(404);
		expect([400, 404]).toContain((await runTestRoute(otherTenantProject, { repoPath: ownRepo })).status);
		expect(seen.runTests).toEqual([]);
	});

	it("a traversal-shaped projectId never resolves", async () => {
		const res = await runTestRoute("../../etc", {});
		expect([400, 404]).toContain(res.status);
		expect(seen.runTests).toEqual([]);
	});

	it("own projectId → the test run uses the project's repo_path from the database", async () => {
		const res = await runTestRoute(ownProject, { taskId: "t-1" });
		expect(res.status).toBe(201);
		expect(seen.runTests.length).toBe(1);
		expect(seen.runTests[0][0]).toBe(ownProject);
		expect(seen.runTests[0][1]).toBe(ownRepo);
	});

	it("an empty body `{}` is accepted too", async () => {
		const res = await runTestRoute(ownProject, {});
		expect(res.status).toBe(201);
		expect(seen.runTests[0][1]).toBe(ownRepo);
	});
});
