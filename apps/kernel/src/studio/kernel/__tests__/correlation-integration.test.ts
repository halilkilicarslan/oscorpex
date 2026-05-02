// ---------------------------------------------------------------------------
// Correlation ID Integration Tests
// Tests correlation propagation through auth, replay, and notification routes.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { correlationMiddleware } from "../../middleware/correlation-middleware.js";
import { guaranteedCorrelationHeader } from "../../middleware/guaranteed-correlation-header.js";
import { replayRoutes } from "../../routes/replay-routes.js";

describe("Correlation ID + Auth Integration", () => {
	it("preserves correlationId through auth middleware rejection", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.use("*", guaranteedCorrelationHeader);
		app.use("*", async (c, next) => {
			// Simulate auth middleware rejecting
			return c.json({ error: "Unauthorized" }, 401);
		});

		const res = await app.request("/protected", {
			headers: { "x-correlation-id": "auth-test-123" },
		});

		expect(res.status).toBe(401);
		expect(res.headers.get("x-correlation-id")).toBe("auth-test-123");
	});

	it("generates correlationId on auth rejection when header missing", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.use("*", guaranteedCorrelationHeader);
		app.use("*", async (c, next) => {
			return c.json({ error: "Unauthorized" }, 401);
		});

		const res = await app.request("/protected");

		expect(res.status).toBe(401);
		const id = res.headers.get("x-correlation-id");
		expect(id).toBeDefined();
		expect(id).not.toBeNull();
		expect(id!.length).toBeGreaterThan(0);
	});
});

describe("Correlation ID in Replay Routes", () => {
	it("returns x-correlation-id on replay list endpoint", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.use("*", guaranteedCorrelationHeader);
		app.route("/replay", replayRoutes);

		const res = await app.request("/replay/runs/test/snapshots", {
			headers: { "x-correlation-id": "replay-test-456" },
		});

		expect(res.headers.get("x-correlation-id")).toBe("replay-test-456");
	});

	it("returns x-correlation-id on replay 404 responses", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.use("*", guaranteedCorrelationHeader);
		app.route("/replay", replayRoutes);

		const res = await app.request("/replay/runs/nonexistent/inspect");

		expect(res.status).toBe(404);
		const id = res.headers.get("x-correlation-id");
		expect(id).toBeDefined();
		expect(id).not.toBeNull();
		expect(id!.length).toBeGreaterThan(0);
	});
});

describe("Correlation ID Guaranteed Header", () => {
	it("adds x-correlation-id even when normal middleware is bypassed by early return", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.use("*", guaranteedCorrelationHeader);
		app.get("/early", (c) => {
			// Early return without explicit header
			return c.json({ ok: true });
		});

		const res = await app.request("/early");

		expect(res.status).toBe(200);
		const id = res.headers.get("x-correlation-id");
		expect(id).toBeDefined();
		expect(id).not.toBeNull();
		expect(id!.length).toBeGreaterThan(0);
	});
});
