import { describe, it, expect, vi, beforeEach } from "vitest";
import { healthCache, checkBinaryCached } from "../health-cache.js";
import type { BinaryCheckResult } from "../cli-runner.js";

describe("healthCache", () => {
	beforeEach(() => {
		healthCache.clear();
	});

	it("returns undefined for uncached binary", () => {
		expect(healthCache.get("unknown-binary")).toBeUndefined();
	});

	it("caches and returns a result", () => {
		const result: BinaryCheckResult = { available: true, version: "1.0.0" };
		healthCache.set("codex", result);
		expect(healthCache.get("codex")).toEqual(result);
	});

	it("expires entries after TTL", async () => {
		const result: BinaryCheckResult = { available: true };
		healthCache.set("codex", result);
		// Manually backdate entry to simulate TTL expiry
		(healthCache as any).cache.set("codex", { result, cachedAt: Date.now() - 60_000 });
		expect(healthCache.get("codex")).toBeUndefined();
	});

	it("invalidate removes entry", () => {
		const result: BinaryCheckResult = { available: true };
		healthCache.set("codex", result);
		healthCache.invalidate("codex");
		expect(healthCache.get("codex")).toBeUndefined();
	});

	it("tracks hit/miss stats", async () => {
		const checkFn = vi.fn().mockResolvedValue({ available: true } as BinaryCheckResult);

		// First call — miss
		await checkBinaryCached(checkFn, "codex");
		// Second call — hit
		await checkBinaryCached(checkFn, "codex");

		const stats = healthCache.getStats();
		expect(stats.hits).toBe(1);
		expect(stats.misses).toBe(1);
		expect(stats.entries).toBe(1);
		expect(checkFn).toHaveBeenCalledTimes(1);
	});

	it("forceRefresh bypasses cache", async () => {
		const checkFn = vi.fn().mockResolvedValue({ available: true } as BinaryCheckResult);

		await checkBinaryCached(checkFn, "codex");
		await checkBinaryCached(checkFn, "codex", undefined, true);

		expect(checkFn).toHaveBeenCalledTimes(2);
	});

	it("caches negative results too", async () => {
		const checkFn = vi.fn().mockResolvedValue({ available: false, error: "not found" } as BinaryCheckResult);

		const r1 = await checkBinaryCached(checkFn, "missing");
		const r2 = await checkBinaryCached(checkFn, "missing");

		expect(r1.available).toBe(false);
		expect(r2.available).toBe(false);
		expect(checkFn).toHaveBeenCalledTimes(1);
	});
});
