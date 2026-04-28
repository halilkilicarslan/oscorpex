// ---------------------------------------------------------------------------
// Access Guard — Route Permission Matrix Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { accessGuard } from "../auth/access-guard.js";

function makeCtx(opts: {
	path: string;
	method?: string;
	authType?: string;
	userId?: string;
	userRole?: string;
	tenantId?: string;
}): any {
	const store: Record<string, unknown> = {};
	return {
		req: {
			path: opts.path,
			method: opts.method ?? "GET",
			header: (_name: string) => "",
		},
		set: (key: string, value: unknown) => { store[key] = value; },
		get: (key: string) => {
			if (key === "authType") return opts.authType ?? null;
			if (key === "userId") return opts.userId ?? null;
			if (key === "userRole") return opts.userRole ?? null;
			if (key === "tenantId") return opts.tenantId ?? null;
			return store[key] ?? null;
		},
		json: (body: unknown, status = 200) => ({ body, status }),
	};
}

describe("accessGuard — route permission matrix", () => {
	it("allows public route without auth", async () => {
		const c = makeCtx({ path: "/health" });
		const next = vi.fn();
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
	});

	it("denies unknown route (default deny)", async () => {
		const c = makeCtx({ path: "/unknown/mystery", method: "GET", authType: "jwt", userId: "u1", userRole: "owner", tenantId: "t1" });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(403);
		expect((result as any).body.error).toContain("unknown route");
	});

	it("denies known route without auth when auth is enabled", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		try {
			const c = makeCtx({ path: "/projects", method: "GET" });
			const next = vi.fn();
			const result = await accessGuard(c, next);
			expect(next).not.toHaveBeenCalled();
			expect((result as any).status).toBe(403); // requireTenantContext blocks
		} finally {
			delete process.env.OSCORPEX_AUTH_ENABLED;
		}
	});

	it("allows known route with auth in dev mode", async () => {
		// authType="none" in dev mode → authMiddleware allows through
		delete process.env.OSCORPEX_AUTH_ENABLED;
		const c = makeCtx({ path: "/projects", method: "GET", authType: "none" });
		const next = vi.fn();
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
	});

	it("denies known mutating route without proper permission", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		try {
			// owner role has projects:create permission
			const c = makeCtx({
				path: "/projects",
				method: "POST",
				authType: "jwt",
				userId: "u1",
				userRole: "viewer", // viewer does NOT have projects:create
				tenantId: "t1",
			});
			const next = vi.fn();
			const result = await accessGuard(c, next);
			expect(next).not.toHaveBeenCalled();
			expect((result as any).status).toBe(403);
		} finally {
			delete process.env.OSCORPEX_AUTH_ENABLED;
		}
	});

	it("allows known mutating route with proper permission", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		try {
			const c = makeCtx({
				path: "/projects",
				method: "POST",
				authType: "jwt",
				userId: "u1",
				userRole: "owner", // owner has projects:create
				tenantId: "t1",
			});
			const next = vi.fn();
			await accessGuard(c, next);
			expect(next).toHaveBeenCalled();
		} finally {
			delete process.env.OSCORPEX_AUTH_ENABLED;
		}
	});
});
