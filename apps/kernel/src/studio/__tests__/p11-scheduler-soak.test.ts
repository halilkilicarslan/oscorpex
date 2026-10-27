// ---------------------------------------------------------------------------
// Oscorpex — P11-H Scheduler Soak Mode Tests
// Verifies soak mode behavior and artifact existence for P11 tasks.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("P11-H: Scheduler Soak Mode", () => {
	it("soak returns empty result when scheduler disabled", async () => {
		// Ensure scheduler is off
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;

		const { runSoakCycle } = await import("../scheduler/scheduler-soak.js");
		const result = await runSoakCycle();

		expect(result.totalJobs).toBe(0);
		expect(result.completed).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.results).toEqual([]);
		expect(result.duration).toBe(0);
		expect(typeof result.timestamp).toBe("string");
	});

	it("soak mode source file exists and exports runSoakCycle", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/scheduler/scheduler-soak.ts"), "utf8");
		expect(src).toContain("runSoakCycle");
		expect(src).toContain("read-only");
	});

	it("soak result has required shape fields", async () => {
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
		const { runSoakCycle } = await import("../scheduler/scheduler-soak.js");
		const result = await runSoakCycle();

		expect(result).toMatchObject({
			totalJobs: expect.any(Number),
			completed: expect.any(Number),
			failed: expect.any(Number),
			skipped: expect.any(Number),
			results: expect.any(Array),
			duration: expect.any(Number),
			timestamp: expect.any(String),
		});
	});

	it("scheduler index re-exports runSoakCycle", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/scheduler/index.ts"), "utf8");
		expect(src).toContain("runSoakCycle");
		expect(src).toContain("scheduler-soak.js");
	});
});

describe("P11-I: Scheduler API Routes", () => {
	it("mcp-routes.ts contains scheduler/jobs endpoint", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/mcp-routes.ts"), "utf8");
		expect(src).toContain("/scheduler/jobs");
		expect(src).toContain("listJobs");
		expect(src).toContain("isSchedulerEnabled");
	});

	it("mcp-routes.ts contains scheduler/soak endpoint", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/mcp-routes.ts"), "utf8");
		expect(src).toContain("/scheduler/soak");
		expect(src).toContain("runSoakCycle");
		expect(src).toContain("production");
	});
});

describe("P11-J: Memory Pruning UI", () => {
	it("MemoryPruningPage.tsx exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(
			existsSync(join(process.cwd(), "../../apps/console/src/pages/studio/MemoryPruningPage.tsx")),
		).toBe(true);
	});

	it("MemoryPruningPage.tsx contains expected component elements", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(
			join(process.cwd(), "../../apps/console/src/pages/studio/MemoryPruningPage.tsx"),
			"utf8",
		);
		expect(src).toContain("MemoryPruningPage");
		expect(src).toContain("PruningCandidate");
		expect(src).toContain("/api/studio/scheduler/jobs");
		expect(src).toContain("memory-pruning");
	});

	it("main.tsx registers MemoryPruningPage route", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(src).toContain("MemoryPruningPage");
		expect(src).toContain("/studio/memory-pruning");
	});
});

describe("P11-K: Hermes Design", () => {
	it("hermes-bridge-design-v2.md exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/architecture/hermes-bridge-design-v2.md"))).toBe(
			true,
		);
	});

	it("hermes-bridge-design-v2.md covers required sections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(
			join(process.cwd(), "../../docs/architecture/hermes-bridge-design-v2.md"),
			"utf8",
		);
		expect(src).toContain("Auth Flow");
		expect(src).toContain("Tenant Isolation");
		expect(src).toContain("Rate Limiting");
		expect(src).toContain("Audit");
		expect(src).toContain("No-Go Criteria");
		expect(src).toContain("Preconditions");
		expect(src).toContain("Read-Only");
	});
});

describe("P11-M: Coverage Thresholds", () => {
	// Floor set in P11; later phases may only ratchet thresholds up.
	it("vitest.config.ts keeps coverage thresholds at or above the P11 floor", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");
		const block = src.match(/thresholds:\s*\{([^}]*)\}/)?.[1] ?? "";
		const threshold = (key: string) => Number(block.match(new RegExp(`\\b${key}:\\s*(\\d+)`))?.[1] ?? Number.NaN);
		expect(threshold("lines")).toBeGreaterThanOrEqual(70);
		expect(threshold("functions")).toBeGreaterThanOrEqual(70);
		expect(threshold("statements")).toBeGreaterThanOrEqual(70);
		expect(threshold("branches")).toBeGreaterThanOrEqual(65);
	});

	it("vitest.p11.config.ts exists with P11 thresholds", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "vitest.p11.config.ts"), "utf8");
		expect(src).toContain("lines: 70");
		expect(src).toContain("functions: 70");
		expect(src).toContain("coverage-p11");
	});
});
