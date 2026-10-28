// ---------------------------------------------------------------------------
// Access Guard — SSE Auth Enforcement Tests
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { it } from "./helpers/outside-scope.js";
import { accessGuard } from "../auth/access-guard.js";
import { currentScope } from "../tenancy/tenant-scope.js";

const ENV_KEYS = ["OSCORPEX_AUTH_ENABLED", "OSCORPEX_DEV_NO_AUTH", "OSCORPEX_API_KEY"] as const;

describe("accessGuard — SSE requests", () => {
	let saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const k of ENV_KEYS) delete process.env[k];
	});
	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

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

	it("allows SSE to known routes only with explicit dev bypass (OSCORPEX_DEV_NO_AUTH=true), in local tenant scope", async () => {
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		const c = makeCtx({ path: "/projects", accept: "text/event-stream" });
		let scope: unknown;
		const next = vi.fn(async () => {
			scope = currentScope();
		});
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
		expect(scope).toEqual({ kind: "tenant", tenantId: "00000000-0000-0000-0000-000000000001" });
	});

	it("denies SSE to known routes when auth is not configured and no dev bypass", async () => {
		const c = makeCtx({ path: "/projects", accept: "text/event-stream" });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(401);
	});

	it("requires authentication for SSE to protected routes when auth enabled", async () => {
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
			expect((result as any).status).toBe(401); // unauthenticated → 401 from authMiddleware
		} finally {
			delete process.env.OSCORPEX_AUTH_ENABLED;
		}
	});
});
