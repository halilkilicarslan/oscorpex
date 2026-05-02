// ---------------------------------------------------------------------------
// Tests — DB Pool Metrics (EPIC 2)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { checkPoolHealth, getDbPoolSnapshot } from "../db-pool-metrics.js";

describe("getDbPoolSnapshot", () => {
	it("returns a snapshot with expected shape", () => {
		const snapshot = getDbPoolSnapshot();
		expect(snapshot).toHaveProperty("total");
		expect(snapshot).toHaveProperty("idle");
		expect(snapshot).toHaveProperty("waiting");
		expect(snapshot).toHaveProperty("active");
		expect(snapshot).toHaveProperty("max");
		expect(snapshot).toHaveProperty("connectionTimeoutMs");
		expect(snapshot).toHaveProperty("idleTimeoutMs");
	});

	it("active equals total minus idle", () => {
		const snapshot = getDbPoolSnapshot();
		expect(snapshot.active).toBe(snapshot.total - snapshot.idle);
	});

	it("values are non-negative", () => {
		const snapshot = getDbPoolSnapshot();
		expect(snapshot.total).toBeGreaterThanOrEqual(0);
		expect(snapshot.idle).toBeGreaterThanOrEqual(0);
		expect(snapshot.waiting).toBeGreaterThanOrEqual(0);
		expect(snapshot.active).toBeGreaterThanOrEqual(0);
	});

	it("max is a positive number", () => {
		const snapshot = getDbPoolSnapshot();
		expect(snapshot.max).toBeGreaterThan(0);
	});

	it("timeouts are positive numbers", () => {
		const snapshot = getDbPoolSnapshot();
		expect(snapshot.connectionTimeoutMs).toBeGreaterThan(0);
		expect(snapshot.idleTimeoutMs).toBeGreaterThan(0);
	});
});

describe("checkPoolHealth", () => {
	it("runs without throwing", () => {
		expect(() => checkPoolHealth()).not.toThrow();
	});
});
