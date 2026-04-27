// ---------------------------------------------------------------------------
// Provider Telemetry Wiring Smoke Test
// Verifies execution-engine telemetry field is wired and accessible.
// Detailed telemetry behavior is covered in provider-registry.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { executionEngine } from "../execution-engine.js";

describe("Execution Engine Telemetry Wiring", () => {
	it("exposes a telemetry collector instance", () => {
		expect(executionEngine.telemetry).toBeDefined();
		expect(typeof executionEngine.telemetry.startExecution).toBe("function");
		expect(typeof executionEngine.telemetry.finishExecution).toBe("function");
		expect(typeof executionEngine.telemetry.getRecord).toBe("function");
		expect(typeof executionEngine.telemetry.getRecentRecords).toBe("function");
		expect(typeof executionEngine.telemetry.getLatencySnapshot).toBe("function");
	});

	it("latency snapshot returns valid shape even when empty", () => {
		const snapshot = executionEngine.telemetry.getLatencySnapshot("claude-code");
		expect(snapshot).toHaveProperty("providerId", "claude-code");
		expect(snapshot).toHaveProperty("totalExecutions");
		expect(snapshot).toHaveProperty("successfulExecutions");
		expect(snapshot).toHaveProperty("failedExecutions");
		expect(snapshot).toHaveProperty("averageLatencyMs");
		expect(snapshot).toHaveProperty("p95LatencyMs");
		expect(typeof snapshot.totalExecutions).toBe("number");
	});

	it("getRecentRecords returns an array", () => {
		const records = executionEngine.telemetry.getRecentRecords(10);
		expect(Array.isArray(records)).toBe(true);
	});
});
