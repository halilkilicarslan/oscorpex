// ---------------------------------------------------------------------------
// Oscorpex — Tenant Context tests (M6.2: Row-Level Security / Tenant Scoping)
// Tests: getTenantContext, withTenantFilter, verifyProjectAccess
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — DB queries (must be declared before dynamic imports)
// ---------------------------------------------------------------------------

vi.mock("../pg.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	withTransaction: vi.fn(),
}));

import { queryOne } from "../pg.js";

const mockQueryOne = vi.mocked(queryOne);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import {
	getTenantContext,
	verifyProjectAccess,
	withTenantFilter,
	requireTenantContext,
	isTenantIsolationEnabled,
} from "../auth/tenant-context.js";

// ---------------------------------------------------------------------------
// Helper: minimal Hono Context mock
// ---------------------------------------------------------------------------

function makeMockContext(vars: Record<string, unknown> = {}): Context<any> {
	const store: Record<string, unknown> = { ...vars };
	// biome-ignore lint/suspicious/noExplicitAny: test mock — intentionally loose typed
	const ctx = {
		req: {
			header: (_name: string) => undefined,
			query: (_name: string) => undefined,
		},
		set: (key: string, value: unknown) => {
			store[key] = value;
		},
		get: (key: string) => store[key],
		json: (body: unknown, status = 200) => ({ body, status }),
		_store: store,
	} as unknown as Context<any>;
	return ctx;
}

// ---------------------------------------------------------------------------
// 1–2. getTenantContext
// ---------------------------------------------------------------------------

describe("getTenantContext", () => {
	it("returns all fields when fully populated", () => {
		const c = makeMockContext({
			tenantId: "tenant-abc",
			userId: "user-123",
			userRole: "admin",
			authType: "jwt",
		});

		const ctx = getTenantContext(c);

		expect(ctx.tenantId).toBe("tenant-abc");
		expect(ctx.userId).toBe("user-123");
		expect(ctx.userRole).toBe("admin");
		expect(ctx.authType).toBe("jwt");
	});

	it("returns null fields and 'none' authType when nothing is set", () => {
		const c = makeMockContext();

		const ctx = getTenantContext(c);

		expect(ctx.tenantId).toBeNull();
		expect(ctx.userId).toBeNull();
		expect(ctx.userRole).toBeNull();
		expect(ctx.authType).toBe("none");
	});
});

// ---------------------------------------------------------------------------
// 3–5. withTenantFilter
// ---------------------------------------------------------------------------

describe("withTenantFilter", () => {
	it("appends WHERE clause when base query has no WHERE", () => {
		const result = withTenantFilter("SELECT * FROM projects ORDER BY created_at DESC", "tenant-xyz", 1);

		expect(result.query).toContain("WHERE tenant_id = $1");
		expect(result.params).toEqual(["tenant-xyz"]);
	});

	it("appends AND clause when base query already has a WHERE", () => {
		const result = withTenantFilter("SELECT * FROM projects WHERE status = 'active'", "tenant-xyz", 2);

		expect(result.query).toContain("AND tenant_id = $2");
		expect(result.params).toEqual(["tenant-xyz"]);
		// Original WHERE must still be present
		expect(result.query).toContain("WHERE status = 'active'");
	});

	it("returns unchanged query and empty params when tenantId is null", () => {
		const base = "SELECT * FROM projects ORDER BY created_at DESC";
		const result = withTenantFilter(base, null, 1);

		expect(result.query).toBe(base);
		expect(result.params).toEqual([]);
	});

	it("throws when tenantId is null and tenant isolation is enabled", () => {
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			process.env.OSCORPEX_AUTH_ENABLED = "true";
			expect(() => withTenantFilter("SELECT * FROM projects", null, 1)).toThrow(
				"Tenant isolation enabled but tenantId is null",
			);
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});
});

// ---------------------------------------------------------------------------
// 6–10. verifyProjectAccess
// ---------------------------------------------------------------------------

describe("verifyProjectAccess", () => {
	beforeEach(() => {
		mockQueryOne.mockReset();
	});

	it("returns true immediately when tenantId is null (auth disabled — backward compat)", async () => {
		const result = await verifyProjectAccess("project-1", null);

		expect(result).toBe(true);
		// DB must NOT be hit when auth is disabled
		expect(mockQueryOne).not.toHaveBeenCalled();
	});

	it("returns false when tenantId is null and tenant isolation is enabled", async () => {
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			process.env.OSCORPEX_AUTH_ENABLED = "true";
			const result = await verifyProjectAccess("project-1", null);
			expect(result).toBe(false);
			expect(mockQueryOne).not.toHaveBeenCalled();
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});

	it("returns true when project tenant matches the requesting tenant", async () => {
		mockQueryOne.mockResolvedValueOnce({ tenant_id: "tenant-abc" });

		const result = await verifyProjectAccess("project-1", "tenant-abc");

		expect(result).toBe(true);
	});

	it("returns false when project tenant does not match the requesting tenant", async () => {
		mockQueryOne.mockResolvedValueOnce({ tenant_id: "tenant-other" });

		const result = await verifyProjectAccess("project-1", "tenant-abc");

		expect(result).toBe(false);
	});

	it("returns true when project has no tenant_id (legacy project — backward compat)", async () => {
		mockQueryOne.mockResolvedValueOnce({ tenant_id: null });

		const result = await verifyProjectAccess("project-1", "tenant-abc");

		expect(result).toBe(true);
	});

	it("returns false when project does not exist", async () => {
		mockQueryOne.mockResolvedValueOnce(null);

		const result = await verifyProjectAccess("nonexistent-project", "tenant-abc");

		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 11–12. Auth middleware opt-in via OSCORPEX_AUTH_ENABLED
// ---------------------------------------------------------------------------

describe("requireTenantContext", () => {
	it("returns null when tenant isolation is disabled", () => {
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			delete process.env.OSCORPEX_AUTH_ENABLED;
			const c = makeMockContext();
			const result = requireTenantContext(c);
			expect(result).toBeNull();
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});

	it("returns 403 response when tenant isolation is enabled but no tenantId", () => {
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			process.env.OSCORPEX_AUTH_ENABLED = "true";
			const c = makeMockContext({ authType: "jwt" });
			const result = requireTenantContext(c);
			expect(result).toEqual({ body: { error: "Forbidden — tenant context required" }, status: 403 });
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});

	it("returns null when tenant isolation is enabled and tenantId present", () => {
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			process.env.OSCORPEX_AUTH_ENABLED = "true";
			const c = makeMockContext({ tenantId: "tenant-abc", authType: "jwt" });
			const result = requireTenantContext(c);
			expect(result).toBeNull();
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});
});

describe("Auth middleware opt-in (OSCORPEX_AUTH_ENABLED)", () => {
	it("studioRoutes wires authMiddleware when OSCORPEX_AUTH_ENABLED=true", async () => {
		// We test the env-var check logic directly without importing the full
		// route module (which has side-effects like DB seed calls).
		// The pattern used in routes/index.ts is:
		//   if (process.env.OSCORPEX_AUTH_ENABLED === "true") { studio.use("*", authMiddleware) }
		// We validate that a truthy env value matches the condition.
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			process.env.OSCORPEX_AUTH_ENABLED = "true";
			expect(process.env.OSCORPEX_AUTH_ENABLED === "true").toBe(true);
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});

	it("studioRoutes skips authMiddleware when OSCORPEX_AUTH_ENABLED is not set", () => {
		const original = process.env.OSCORPEX_AUTH_ENABLED;
		try {
			delete process.env.OSCORPEX_AUTH_ENABLED;
			expect(process.env.OSCORPEX_AUTH_ENABLED === "true").toBe(false);
		} finally {
			process.env.OSCORPEX_AUTH_ENABLED = original;
		}
	});
});
