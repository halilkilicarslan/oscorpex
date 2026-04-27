// ---------------------------------------------------------------------------
// Tests — Provider Runtime Cache Layer (TASK 4)
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { providerRuntimeCache } from "../provider-runtime-cache.js";

describe("ProviderRuntimeCache", () => {
	beforeEach(() => {
		providerRuntimeCache.clear();
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("availability cache", () => {
		it("misses when empty and resolves via checkFn", async () => {
			const checkFn = vi.fn().mockResolvedValue(true);
			const result = await providerRuntimeCache.resolveAvailability("claude-code", checkFn);
			expect(result).toBe(true);
			expect(checkFn).toHaveBeenCalledTimes(1);
			expect(providerRuntimeCache.getStats().availabilityMisses).toBe(1);
			expect(providerRuntimeCache.getStats().availabilityHits).toBe(0);
		});

		it("hits when entry is still valid", async () => {
			const checkFn = vi.fn().mockResolvedValue(true);
			await providerRuntimeCache.resolveAvailability("claude-code", checkFn);
			const result = await providerRuntimeCache.resolveAvailability("claude-code", checkFn);
			expect(result).toBe(true);
			expect(checkFn).toHaveBeenCalledTimes(1);
			expect(providerRuntimeCache.getStats().availabilityHits).toBe(1);
		});

		it("misses after TTL expiry", async () => {
			const checkFn = vi.fn().mockResolvedValue(true);
			await providerRuntimeCache.resolveAvailability("claude-code", checkFn);
			// Fast-forward past default 30s TTL
			vi.advanceTimersByTime(31_000);
			const result = await providerRuntimeCache.resolveAvailability("claude-code", checkFn);
			expect(result).toBe(true);
			expect(checkFn).toHaveBeenCalledTimes(2);
		});

		it("uses shorter TTL for unavailable result", async () => {
			const checkFn = vi.fn().mockResolvedValue(false);
			await providerRuntimeCache.resolveAvailability("codex", checkFn);
			const entry = providerRuntimeCache.getAvailability("codex");
			expect(entry).toBeDefined();
			expect(entry!.available).toBe(false);
			// Unavailable TTL is 10s, so 5s should still be a hit
			vi.advanceTimersByTime(5_000);
			const hit = await providerRuntimeCache.resolveAvailability("codex", checkFn);
			expect(hit).toBe(false);
			expect(checkFn).toHaveBeenCalledTimes(1);
			// After 11s it should be a miss
			vi.advanceTimersByTime(6_000);
			const miss = await providerRuntimeCache.resolveAvailability("codex", checkFn);
			expect(miss).toBe(false);
			expect(checkFn).toHaveBeenCalledTimes(2);
		});

		it("invalidates availability on demand", async () => {
			const checkFn = vi.fn().mockResolvedValue(true);
			await providerRuntimeCache.resolveAvailability("cursor", checkFn);
			providerRuntimeCache.invalidateAvailability("cursor", "manual");
			const entry = providerRuntimeCache.getAvailability("cursor");
			expect(entry).toBeUndefined();
			await providerRuntimeCache.resolveAvailability("cursor", checkFn);
			expect(checkFn).toHaveBeenCalledTimes(2);
		});
	});

	describe("capability cache", () => {
		it("misses when empty and resolves via fetchFn", async () => {
			const fetchFn = vi.fn().mockResolvedValue({
				supportedModels: ["gpt-4o"],
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: false,
			});
			const result = await providerRuntimeCache.resolveCapability("codex", fetchFn);
			expect(result.supportedModels).toContain("gpt-4o");
			expect(fetchFn).toHaveBeenCalledTimes(1);
			expect(providerRuntimeCache.getStats().capabilityMisses).toBe(1);
		});

		it("hits when entry is still valid", async () => {
			const fetchFn = vi.fn().mockResolvedValue({
				supportedModels: ["cursor-small"],
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: false,
			});
			await providerRuntimeCache.resolveCapability("cursor", fetchFn);
			const result = await providerRuntimeCache.resolveCapability("cursor", fetchFn);
			expect(result.supportedModels).toContain("cursor-small");
			expect(fetchFn).toHaveBeenCalledTimes(1);
			expect(providerRuntimeCache.getStats().capabilityHits).toBe(1);
		});

		it("misses after TTL expiry", async () => {
			const fetchFn = vi.fn().mockResolvedValue({
				supportedModels: ["claude-sonnet-4-6"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			});
			await providerRuntimeCache.resolveCapability("claude-code", fetchFn);
			// Fast-forward past default 5min TTL
			vi.advanceTimersByTime(301_000);
			const result = await providerRuntimeCache.resolveCapability("claude-code", fetchFn);
			expect(result.supportedModels).toContain("claude-sonnet-4-6");
			expect(fetchFn).toHaveBeenCalledTimes(2);
		});

		it("invalidates capability on demand", async () => {
			const fetchFn = vi.fn().mockResolvedValue({
				supportedModels: ["gpt-4o"],
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: false,
			});
			await providerRuntimeCache.resolveCapability("codex", fetchFn);
			providerRuntimeCache.invalidateCapability("codex");
			const entry = providerRuntimeCache.getCapability("codex");
			expect(entry).toBeUndefined();
			await providerRuntimeCache.resolveCapability("codex", fetchFn);
			expect(fetchFn).toHaveBeenCalledTimes(2);
		});
	});

	describe("stats", () => {
		it("tracks hits and misses independently", async () => {
			const checkFn = vi.fn().mockResolvedValue(true);
			const fetchFn = vi.fn().mockResolvedValue({
				supportedModels: ["gpt-4o"],
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: false,
			});

			await providerRuntimeCache.resolveAvailability("a", checkFn);
			await providerRuntimeCache.resolveCapability("b", fetchFn);

			const stats = providerRuntimeCache.getStats();
			expect(stats.availabilityMisses).toBe(1);
			expect(stats.availabilityHits).toBe(0);
			expect(stats.capabilityMisses).toBe(1);
			expect(stats.capabilityHits).toBe(0);
		});
	});

	describe("clear", () => {
		it("removes all entries and resets stats", async () => {
			const checkFn = vi.fn().mockResolvedValue(true);
			const fetchFn = vi.fn().mockResolvedValue({
				supportedModels: ["gpt-4o"],
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: false,
			});

			await providerRuntimeCache.resolveAvailability("a", checkFn);
			await providerRuntimeCache.resolveCapability("b", fetchFn);
		providerRuntimeCache.clear();

		const stats = providerRuntimeCache.getStats();
		expect(stats.availabilityHits).toBe(0);
		expect(stats.availabilityMisses).toBe(0);
		expect(stats.capabilityHits).toBe(0);
		expect(stats.capabilityMisses).toBe(0);
		expect(providerRuntimeCache.getAvailability("a")).toBeUndefined();
		expect(providerRuntimeCache.getCapability("b")).toBeUndefined();
		});
	});
});
