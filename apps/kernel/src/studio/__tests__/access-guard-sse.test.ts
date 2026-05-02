// ---------------------------------------------------------------------------
// Access Guard — SSE Auth Enforcement Tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import { accessGuard } from "../auth/access-guard.js";

describe("accessGuard — SSE requests", () => {
	function makeCtx(opts: {
		path: string;
		method?: string;
		accept?: string;
		tenantId?: string;
		authType?: string;
	}): any {
		const store: Record<string, unknown> = {};
		return {
			req: {
				path: opts.path,
				method: opts.method ?? "GET",
				header: (name: string) => {
					if (name.toLowerCase() === "accept") return opts.accept ?? "";
					return "";
				},
			},
			set: (key: string, value: unknown) => {
				store[key] = value;
			},
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

	it("denies SSE to unknown routes even when auth is disabled", async () => {
		// Unknown route → default deny regardless of auth mode
		delete process.env.OSCORPEX_AUTH_ENABLED;
		const c = makeCtx({ path: "/api/studio/nonexistent/stream", accept: "text/event-stream" });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(403);
		expect((result as any).body.error).toContain("unknown route");
	});

	it("allows SSE to known routes when auth is disabled (backward compat)", async () => {
		delete process.env.OSCORPEX_AUTH_ENABLED;
		const c = makeCtx({ path: "/projects", accept: "text/event-stream", authType: "none" });
		const next = vi.fn();
		await accessGuard(c, next);
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
