// ---------------------------------------------------------------------------
// F3-e review fix round 1, item 4 — general rate limiter keying.
// Assumed API: rateLimiter() reads the client address from the Node socket (Hono env `incoming.socket.remoteAddress`),
// honours X-Forwarded-For only when OSCORPEX_TRUSTED_PROXY=true (existing flag; the right-most entry is the client,
// as seen by the single trusted proxy), and keys authenticated callers per user. The limiter is NOT mounted after auth:
// it runs before it and verifies the JWT signature in-process to learn the user id.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studioRoutes } from "../index.js";
import { rateLimiter } from "../middleware/rate-limiter.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { type SeededUser, removeUsers, seedUser } from "./helpers/identity.js";
import { TENANT_A, seedTestTenants } from "./helpers/tenancy.js";

const ENV_KEYS = ["OSCORPEX_AUTH_ENABLED", "OSCORPEX_TRUST_PROXY", "OSCORPEX_TRUSTED_PROXY", "NODE_ENV"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
	process.env.OSCORPEX_AUTH_ENABLED = "true";
	process.env.NODE_ENV = "test";
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

let seq = 0;
const nextPath = () => `/f3e-rl-${++seq}`;

function mkApp(
	path: string,
	max: number,
	userId?: (c: { req: { header(n: string): string | undefined } }) => string | undefined,
) {
	const app = new Hono();
	if (userId) {
		app.use("*", async (c, next) => {
			const id = userId(c);
			if (id) c.set("userId" as never, id as never);
			await next();
		});
	}
	app.use("*", rateLimiter({ windowMs: 60_000, max }));
	app.get(path, (c) => c.text("ok"));
	return app;
}

const hit = (app: Hono, path: string, ip: string | undefined, headers: Record<string, string> = {}) =>
	app.request(path, { headers }, ip ? { incoming: { socket: { remoteAddress: ip } } } : undefined);

async function exhaust(app: Hono, path: string, ip: string, n: number, headers: Record<string, string> = {}) {
	let last = 200;
	for (let i = 0; i < n; i++) last = (await hit(app, path, ip, headers)).status;
	return last;
}

describe("rate limiter — unauthenticated callers are keyed by client IP", () => {
	it("one IP exhausting its bucket does not block a different IP on the same path", async () => {
		const path = nextPath();
		const app = mkApp(path, 3);
		expect(await exhaust(app, path, "10.0.0.1", 4)).toBe(429);
		expect((await hit(app, path, "10.0.0.2")).status).toBe(200);
	});

	it("the same IP keeps its own bucket across requests", async () => {
		const path = nextPath();
		const app = mkApp(path, 3);
		expect(await exhaust(app, path, "10.0.0.3", 3)).toBe(200);
		expect((await hit(app, path, "10.0.0.3")).status).toBe(429);
	});

	it("a spoofed X-Forwarded-For is ignored by default: rotating it does not reset the bucket", async () => {
		const path = nextPath();
		const app = mkApp(path, 3);
		for (let i = 0; i < 3; i++) await hit(app, path, "10.0.0.4", { "x-forwarded-for": `9.9.9.${i}` });
		expect((await hit(app, path, "10.0.0.4", { "x-forwarded-for": "9.9.9.200" })).status).toBe(429);
	});

	it("a spoofed X-Forwarded-For cannot borrow another client's bucket by default", async () => {
		const path = nextPath();
		const app = mkApp(path, 3);
		expect(await exhaust(app, path, "10.0.0.5", 4)).toBe(429);
		expect((await hit(app, path, "10.0.0.6", { "x-forwarded-for": "10.0.0.5" })).status).toBe(200);
	});

	it("an unknown flag name (OSCORPEX_TRUST_PROXY) does not enable trust", async () => {
		process.env.OSCORPEX_TRUST_PROXY = "true";
		const path = nextPath();
		const app = mkApp(path, 2);
		for (let i = 0; i < 2; i++) await hit(app, path, "10.0.0.7", { "x-forwarded-for": `8.8.8.${i}` });
		expect((await hit(app, path, "10.0.0.7", { "x-forwarded-for": "8.8.8.99" })).status).toBe(429);
	});

	it("with OSCORPEX_TRUSTED_PROXY=true the right-most X-Forwarded-For entry is the client", async () => {
		process.env.OSCORPEX_TRUSTED_PROXY = "true";
		const path = nextPath();
		const app = mkApp(path, 2);
		const viaProxy = (spoofed: string, client: string) => ({ "x-forwarded-for": `${spoofed}, ${client}` });
		expect(await exhaust(app, path, "10.0.0.8", 3, viaProxy("1.1.1.1", "203.0.113.1"))).toBe(429);
		// Rotating the client-controlled left-most entry does not reset the bucket.
		expect((await hit(app, path, "10.0.0.8", viaProxy("1.1.1.2", "203.0.113.1"))).status).toBe(429);
		expect((await hit(app, path, "10.0.0.9", viaProxy("1.1.1.3", "203.0.113.1"))).status).toBe(429);
		// A different right-most entry is a different client.
		expect((await hit(app, path, "10.0.0.8", viaProxy("1.1.1.1", "203.0.113.2"))).status).toBe(200);
	});

	it("writing a victim's address in the left-most X-Forwarded-For position does not consume the victim's bucket", async () => {
		process.env.OSCORPEX_TRUSTED_PROXY = "true";
		const path = nextPath();
		const app = mkApp(path, 2);
		for (let i = 0; i < 5; i++) {
			await hit(app, path, "10.0.0.12", { "x-forwarded-for": "198.51.100.7, 203.0.113.50" });
		}
		const victim = await hit(app, path, "10.0.0.12", { "x-forwarded-for": "198.51.100.7" });
		expect(victim.status).toBe(200);
	});

	it("with trust enabled but no X-Forwarded-For the socket address is used", async () => {
		process.env.OSCORPEX_TRUSTED_PROXY = "true";
		const path = nextPath();
		const app = mkApp(path, 2);
		expect(await exhaust(app, path, "10.0.0.10", 3)).toBe(429);
		expect((await hit(app, path, "10.0.0.11")).status).toBe(200);
	});
});

describe("rate limiter — authenticated callers are keyed per user", () => {
	const byHeader = (c: { req: { header(n: string): string | undefined } }) => c.req.header("x-test-user");

	it("two users behind the same IP have separate buckets", async () => {
		const path = nextPath();
		const app = mkApp(path, 2, byHeader);
		for (let i = 0; i < 3; i++) await hit(app, path, "10.1.0.1", { "x-test-user": "u1" });
		expect((await hit(app, path, "10.1.0.1", { "x-test-user": "u1" })).status).toBe(429);
		expect((await hit(app, path, "10.1.0.1", { "x-test-user": "u2" })).status).toBe(200);
	});

	it("one user changing IP keeps the same bucket", async () => {
		const path = nextPath();
		const app = mkApp(path, 2, byHeader);
		for (let i = 0; i < 3; i++) await hit(app, path, `10.1.1.${i}`, { "x-test-user": "u3" });
		expect((await hit(app, path, "10.1.1.99", { "x-test-user": "u3" })).status).toBe(429);
	});
});

describe("rate limiter — mounted on the real router", () => {
	let a: SeededUser;
	let b: SeededUser;
	beforeAll(async () => {
		await seedTestTenants();
		a = await seedUser({ tenantId: TENANT_A, id: "f3e-rl-user-a" });
		b = await seedUser({ tenantId: TENANT_A, id: "f3e-rl-user-b" });
	});
	afterAll(async () => {
		await removeUsers(["f3e-rl-user-a", "f3e-rl-user-b"]);
	});

	const call = (path: string, ip: string, headers: Record<string, string> = {}) =>
		runOutsideScope(async () =>
			studioRoutes.request(path, { headers }, { incoming: { socket: { remoteAddress: ip } } }),
		);

	async function untilLimited(path: string, ip: string, headers: Record<string, string>): Promise<number> {
		for (let i = 1; i <= 260; i++) if ((await call(path, ip, headers)).status === 429) return i;
		return -1;
	}

	it("anonymous: exhausting one IP on a path does not block another IP", async () => {
		const path = "/f3e-rl-probe-anon";
		expect(await untilLimited(path, "10.2.0.1", {})).toBeGreaterThan(0);
		expect((await call(path, "10.2.0.2")).status).not.toBe(429);
	});

	it("authenticated: exhausting one user does not block another user on the same path and IP", async () => {
		const path = "/f3e-rl-probe-user";
		expect(await untilLimited(path, "10.2.1.1", { Authorization: `Bearer ${a.token}` })).toBeGreaterThan(0);
		expect((await call(path, "10.2.1.1", { Authorization: `Bearer ${b.token}` })).status).not.toBe(429);
	});
});
