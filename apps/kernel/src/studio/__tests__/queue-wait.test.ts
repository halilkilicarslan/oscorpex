// ---------------------------------------------------------------------------
// Tests — Queue Wait Telemetry (TASK 2.4)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { computeQueueWaitMs } from "../execution-engine.js";

describe("computeQueueWaitMs", () => {
	it("returns 0 when both timestamps are missing", () => {
		expect(computeQueueWaitMs({})).toBe(0);
	});

	it("returns 0 when createdAt is missing", () => {
		expect(computeQueueWaitMs({ startedAt: new Date().toISOString() })).toBe(0);
	});

	it("returns 0 when startedAt is missing", () => {
		expect(computeQueueWaitMs({ createdAt: new Date().toISOString() })).toBe(0);
	});

	it("returns 0 when both timestamps are null", () => {
		expect(computeQueueWaitMs({ createdAt: null, startedAt: null })).toBe(0);
	});

	it("computes positive wait time for queued → running transition", () => {
		const createdAt = new Date(Date.now() - 5000).toISOString();
		const startedAt = new Date().toISOString();
		const wait = computeQueueWaitMs({ createdAt, startedAt });
		expect(wait).toBeGreaterThanOrEqual(4900);
		expect(wait).toBeLessThanOrEqual(5100);
	});

	it("computes exact wait time for known timestamps", () => {
		const createdAt = "2026-04-27T10:00:00.000Z";
		const startedAt = "2026-04-27T10:00:05.000Z";
		expect(computeQueueWaitMs({ createdAt, startedAt })).toBe(5000);
	});

	it("returns 0 when startedAt equals createdAt (instant start)", () => {
		const ts = new Date().toISOString();
		expect(computeQueueWaitMs({ createdAt: ts, startedAt: ts })).toBe(0);
	});

	it("returns 0 when startedAt is before createdAt (clock skew)", () => {
		const createdAt = "2026-04-27T10:00:05.000Z";
		const startedAt = "2026-04-27T10:00:00.000Z";
		expect(computeQueueWaitMs({ createdAt, startedAt })).toBe(0);
	});
});
