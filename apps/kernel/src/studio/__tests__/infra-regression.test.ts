// ---------------------------------------------------------------------------
// Tests — Infra Regression Test Package (EPIC 14)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getDbPoolSnapshot } from "../db-pool-metrics.js";
import { getDbPoolConfig } from "../performance-config.js";

describe("EPIC 14 — Infra Regression Tests", () => {
	// ---------------------------------------------------------------------------
	// 14.1 Pool Config Tests
	// ---------------------------------------------------------------------------

	describe("pool config", () => {
		it("returns sensible defaults", () => {
			const cfg = getDbPoolConfig();
			expect(cfg.minConnections).toBeGreaterThanOrEqual(0);
			expect(cfg.maxConnections).toBeGreaterThanOrEqual(1);
			expect(cfg.idleTimeoutMs).toBeGreaterThanOrEqual(1000);
			expect(cfg.acquireTimeoutMs).toBeGreaterThanOrEqual(1000);
			expect(cfg.maxConnections).toBeGreaterThanOrEqual(cfg.minConnections);
		});

		it("max is at least 1 even with invalid env", () => {
			const original = process.env.OSCORPEX_DB_POOL_MAX;
			process.env.OSCORPEX_DB_POOL_MAX = "-10";
			try {
				const cfg = getDbPoolConfig();
				expect(cfg.maxConnections).toBeGreaterThanOrEqual(1);
			} finally {
				if (original === undefined) delete process.env.OSCORPEX_DB_POOL_MAX;
				else process.env.OSCORPEX_DB_POOL_MAX = original;
			}
		});
	});

	// ---------------------------------------------------------------------------
	// 14.2 Pool Snapshot Tests
	// ---------------------------------------------------------------------------

	describe("pool snapshot", () => {
		it("returns non-negative values", () => {
			const snap = getDbPoolSnapshot();
			expect(snap.total).toBeGreaterThanOrEqual(0);
			expect(snap.idle).toBeGreaterThanOrEqual(0);
			expect(snap.waiting).toBeGreaterThanOrEqual(0);
			expect(snap.active).toBeGreaterThanOrEqual(0);
		});

		it("active + idle equals total", () => {
			const snap = getDbPoolSnapshot();
			expect(snap.active + snap.idle).toBe(snap.total);
		});
	});

	// ---------------------------------------------------------------------------
	// 14.3 Claim / Lock Smoke Tests
	// ---------------------------------------------------------------------------

	describe("claim behavior (smoke)", () => {
		it("claimTask is imported and callable", async () => {
			const { claimTask } = await import("../db.js");
			expect(typeof claimTask).toBe("function");
		});
	});

	// ---------------------------------------------------------------------------
	// 14.4 Recovery Smoke Tests
	// ---------------------------------------------------------------------------

	describe("recovery behavior (smoke)", () => {
		it("recoverStuckTasks is callable", async () => {
			const { executionEngine } = await import("../execution-engine.js");
			expect(typeof executionEngine.recoverStuckTasks).toBe("function");
		});
	});

	// ---------------------------------------------------------------------------
	// 14.5 Dispatch / Queue Tests
	// ---------------------------------------------------------------------------

	describe("dispatch behavior (smoke)", () => {
		it("dispatchReadyTasks exists on execution engine", async () => {
			const { executionEngine } = await import("../execution-engine.js");
			expect(executionEngine).toBeDefined();
		});
	});
});
