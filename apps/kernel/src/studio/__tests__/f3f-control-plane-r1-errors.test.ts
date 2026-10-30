// ---------------------------------------------------------------------------
// F3-f review fix round 1 — policy routes must not leak raw error text on internal failures.
// Separate file: vi.mock of the control-plane package is file-wide.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, vi } from "vitest";
import { call, mkUser, registerCleanup, seedProject, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A } from "./helpers/tenancy.js";

const SECRET = "SECRET-f3f-r1-boom-relation-xyz";

vi.mock("@oscorpex/control-plane", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getGlobalPolicySummary: vi.fn(async () => {
			throw new Error(SECRET);
		}),
		getProjectPolicySummary: vi.fn(async () => {
			throw new Error(SECRET);
		}),
	};
});

useAuthEnabledEnv();
registerCleanup();

let owner: SeededUser;
let proj: string;

beforeAll(async () => {
	owner = await mkUser({ tenantId: TENANT_A });
	proj = await seedProject(TENANT_A);
});
afterAll(() => vi.restoreAllMocks());

describe("policy routes do not leak internal error text", () => {
	it("GET /policy/summary returns 500 without the raw error", async () => {
		const res = await call(owner, "GET", "/policy/summary");
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain(SECRET);
	});

	it("GET /policy/projects/:id returns 500 without the raw error", async () => {
		const res = await call(owner, "GET", `/policy/projects/${proj}`);
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain(SECRET);
	});
});
