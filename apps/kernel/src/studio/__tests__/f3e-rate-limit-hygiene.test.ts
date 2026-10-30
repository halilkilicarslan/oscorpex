// ---------------------------------------------------------------------------
// F3-e final fix round, item 3 — rate limiter hygiene.
// Assumed API (middleware/rate-limiter.ts):
//  - rateLimiter({ maxKeys?: number }) caps the shared store (default 10_000); beyond it the oldest keys are evicted.
//  - rateLimitStoreSize(): number is exported as a test hook.
//  - Limiters with different `name`s never share or double-count buckets.
//  - The JWT in Authorization is signature-verified at most once per request, however many limiters are stacked.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../auth/jwt.js";
import { rateLimitStoreSize, rateLimiter } from "../middleware/rate-limiter.js";

const verifySpy = vi.hoisted(() => vi.fn());
vi.mock("../auth/jwt.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth/jwt.js")>();
	verifySpy.mockImplementation(actual.verifyJwt);
	return { ...actual, verifyJwt: verifySpy };
});

let seq = 0;
const nextPath = () => `/f3e-rlh-${++seq}`;
const hit = (app: Hono, path: string, ip: string, headers: Record<string, string> = {}) =>
	app.request(path, { headers }, { incoming: { socket: { remoteAddress: ip } } });

beforeEach(() => {
	verifySpy.mockClear();
});

describe("rate limiter — bounded store", () => {
	it("evicts the oldest keys once over the cap, keeping memory bounded", async () => {
		const path = nextPath();
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60_000, max: 1, maxKeys: 5, name: "cap" }));
		app.get(path, (c) => c.text("ok"));

		expect((await hit(app, path, "10.9.0.1")).status).toBe(200);
		expect((await hit(app, path, "10.9.0.1")).status).toBe(429);
		for (let i = 2; i < 30; i++) await hit(app, path, `10.9.0.${i}`);

		expect(rateLimitStoreSize()).toBeLessThanOrEqual(5);
		// The first caller's bucket was the oldest, so it is gone and the caller starts fresh.
		expect((await hit(app, path, "10.9.0.1")).status).toBe(200);
	});

	it("the newest keys survive eviction", async () => {
		const path = nextPath();
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60_000, max: 1, maxKeys: 5, name: "cap2" }));
		app.get(path, (c) => c.text("ok"));
		for (let i = 1; i <= 20; i++) await hit(app, path, `10.9.1.${i}`);
		expect((await hit(app, path, "10.9.1.20")).status).toBe(429);
	});
});

describe("rate limiter — stacked limiters", () => {
	it("a route limiter and the global one do not double count: N requests still pass", async () => {
		const path = nextPath();
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60_000, max: 3, name: "global" }));
		app.use(path, rateLimiter({ windowMs: 60_000, max: 3, name: "route" }));
		app.get(path, (c) => c.text("ok"));
		for (let i = 0; i < 3; i++) expect((await hit(app, path, "10.9.2.1")).status).toBe(200);
		expect((await hit(app, path, "10.9.2.1")).status).toBe(429);
	});

	it("verifies the JWT at most once per request across stacked limiters", async () => {
		const path = nextPath();
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60_000, max: 50, name: "global" }));
		app.use(path, rateLimiter({ windowMs: 60_000, max: 50, name: "route" }));
		app.use(path, rateLimiter({ windowMs: 60_000, max: 50, name: "route2" }));
		app.get(path, (c) => c.text("ok"));
		const token = signJwt({ sub: "f3e-rlh-user", email: "x@f3e.test", tenantId: "t", role: "owner" });

		expect((await hit(app, path, "10.9.3.1", { Authorization: `Bearer ${token}` })).status).toBe(200);
		expect(verifySpy).toHaveBeenCalledTimes(1);
	});
});
