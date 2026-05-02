// ---------------------------------------------------------------------------
// Correlation ID Propagation Tests
// Verifies x-correlation-id header propagation, logger injection,
// and event bus carry-through.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getCurrentCorrelationId, hasCorrelationContext, withCorrelation } from "../../correlation-context.js";
import { eventBus } from "../../event-bus.js";
import { createLogger } from "../../logger.js";
import { correlationMiddleware } from "../../middleware/correlation-middleware.js";

describe("Correlation ID Middleware", () => {
	it("reads x-correlation-id from request header and sets it on response", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test", {
			headers: { "x-correlation-id": "req-abc-123" },
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("x-correlation-id")).toBe("req-abc-123");
	});

	it("generates a new correlation-id when header is missing", async () => {
		const app = new Hono();
		app.use("*", correlationMiddleware);
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(200);
		const id = res.headers.get("x-correlation-id");
		expect(id).toBeDefined();
		expect(id).not.toBeNull();
		expect(id!.length).toBeGreaterThan(0);
	});
});

describe("Correlation ID Logger Injection", () => {
	it("createLogger includes correlationId when inside a correlation context", async () => {
		await withCorrelation(async () => {
			expect(hasCorrelationContext()).toBe(true);
			const log = createLogger("test-module");
			// Pino child bindings contain correlationId when context is active
			const bindings = (log as any).bindings();
			expect(bindings).toHaveProperty("correlationId");
			expect(typeof bindings.correlationId).toBe("string");
		}, "ctx-logger-1");
	});

	it("createLogger does NOT include correlationId outside any context", () => {
		const log = createLogger("test-module");
		const bindings = (log as any).bindings();
		expect(bindings).not.toHaveProperty("correlationId");
	});
});

describe("Correlation ID Event Bus Propagation", () => {
	it("event emit picks up correlationId from async context", async () => {
		await withCorrelation(async () => {
			const ctxId = getCurrentCorrelationId();

			const events: any[] = [];
			const unsubscribe = eventBus.on("task:completed", (event) => {
				events.push(event);
			});

			eventBus.emitTransient({
				projectId: "p-test",
				type: "task:completed",
				payload: { data: 1 },
			});

			expect(events.length).toBeGreaterThan(0);
			expect(events[0].correlationId).toBe(ctxId);

			unsubscribe();
		}, "ctx-event-1");
	});
});
