// ---------------------------------------------------------------------------
// Tests — Timeout Policy (TASK 7)
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import {
	TIMEOUT_WARNING_THRESHOLD,
	getTimeoutConfig,
	getTimeoutWarningMs,
	resolveTaskTimeoutMs,
} from "../timeout-policy.js";

vi.mock("../db.js", () => ({
	getProjectSetting: vi.fn().mockResolvedValue(undefined),
}));

describe("resolveTaskTimeoutMs", () => {
	it("returns agent timeout when explicitly set", async () => {
		const result = await resolveTaskTimeoutMs("p1", "M", 120_000, "claude-code");
		expect(result).toBe(120_000);
	});

	it("uses complexity base for claude-code with 1.0 multiplier", async () => {
		const result = await resolveTaskTimeoutMs("p1", "M", undefined, "claude-code");
		expect(result).toBe(30 * 60 * 1000);
	});

	it("applies codex 1.2x multiplier", async () => {
		const result = await resolveTaskTimeoutMs("p1", "M", undefined, "codex");
		expect(result).toBe(Math.round(30 * 60 * 1000 * 1.2));
	});

	it("applies cursor 1.1x multiplier", async () => {
		const result = await resolveTaskTimeoutMs("p1", "M", undefined, "cursor");
		expect(result).toBe(Math.round(30 * 60 * 1000 * 1.1));
	});

	it("clamps to maxMs when multiplier produces too high value", async () => {
		const { getProjectSetting } = await import("../db.js");
		vi.mocked(getProjectSetting).mockResolvedValue("3.0");
		const result = await resolveTaskTimeoutMs("p1", "XL", undefined, "codex");
		expect(result).toBe(90 * 60 * 1000); // maxMs
	});
});

describe("getTimeoutConfig", () => {
	it("returns full config object", async () => {
		const config = await getTimeoutConfig("p1", "L", "claude-code");
		expect(config.baseMs).toBe(45 * 60 * 1000);
		expect(config.providerMultiplier).toBe(1.0);
		expect(config.warningThreshold).toBe(TIMEOUT_WARNING_THRESHOLD);
		expect(config.minMs).toBe(5 * 60 * 1000);
		expect(config.maxMs).toBe(90 * 60 * 1000);
	});
});

describe("getTimeoutWarningMs", () => {
	it("returns 80% of timeout by default", () => {
		expect(getTimeoutWarningMs(30 * 60 * 1000)).toBe(Math.round(30 * 60 * 1000 * 0.8));
	});

	it("returns custom threshold when provided", () => {
		expect(getTimeoutWarningMs(10_000, 0.5)).toBe(5_000);
	});
});
