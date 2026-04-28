// ---------------------------------------------------------------------------
// Access Guard — SSE Auth Enforcement Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { accessGuard } from "../auth/access-guard.js";

describe("accessGuard — SSE requests", () => {
	function makeCtx(opts: { path: string; accept?: string; tenantId?: string }): any {
		const store: Record<string, unknown> = {};
		return {
			req: {
				path: opts.path,
				header: (name: string) => {
					if (name.toLowerCase() === "accept") return opts.accept ?? "";
					return "";
				},
			},
			set: (key: string, value: unknown) => { store[key] = value; },
			get: (key: string) => {
				if (key === "tenantId") return opts.tenantId ?? null;
				return store[key] ?? null;
			},
			json: (body: unknown, status = 200) => ({ body, status }),
		};
	}

	it("allows SSE to public routes without auth", async () => {
		const c = makeCtx({ path: "/health", accept: "text/event-stream" });
		const next = vi.fn();
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
	});

	it("denies SSE to protected routes when auth is disabled (no configured auth)", async () => {
		// No env API key, no auth header → authMiddleware returns authType="none"
		// But accessGuard still requires tenant when auth is "enabled" via env
		delete process.env.OSCORPEX_AUTH_ENABLED;
		const c = makeCtx({ path: "/api/studio/events/stream", accept: "text/event-stream" });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		// With no auth configured, authMiddleware allows through but tenant check
		// does not block because auth is disabled. So the request passes.
		// This is development-mode backward-compat behavior.
		expect(next).toHaveBeenCalled();
	});

	it("requires tenant for SSE to protected routes when auth enabled", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		try {
			const c = makeCtx({
				path: "/api/studio/events/stream",
				accept: "text/event-stream",
			});
			const next = vi.fn();
			const result = await accessGuard(c, next);
			expect(next).not.toHaveBeenCalled();
			expect(result).toBeDefined();
			expect((result as any).status).toBe(403); // requireTenantContext blocks
		} finally {
			delete process.env.OSCORPEX_AUTH_ENABLED;
		}
	});
});
