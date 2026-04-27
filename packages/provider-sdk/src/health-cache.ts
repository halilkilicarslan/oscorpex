// @oscorpex/provider-sdk — Provider health check cache
// Caches checkBinaryAsync results to avoid repeated process spawns.
// ---------------------------------------------------------------------------

import type { BinaryCheckResult } from "./cli-runner.js";

export interface HealthCacheEntry {
	result: BinaryCheckResult;
	cachedAt: number;
}

export interface HealthCacheStats {
	hits: number;
	misses: number;
	entries: number;
}

class HealthCache {
	private cache = new Map<string, HealthCacheEntry>();
	private ttlMs: number;
	private stats = { hits: 0, misses: 0 };

	constructor(ttlMs = 30_000) {
		this.ttlMs = ttlMs;
	}

	get(binary: string): BinaryCheckResult | undefined {
		const entry = this.cache.get(binary);
		if (!entry) return undefined;
		if (Date.now() - entry.cachedAt > this.ttlMs) {
			this.cache.delete(binary);
			return undefined;
		}
		this.stats.hits++;
		return entry.result;
	}

	set(binary: string, result: BinaryCheckResult): void {
		this.cache.set(binary, { result, cachedAt: Date.now() });
	}

	/** Force-remove a cached entry (e.g. after observing a health failure). */
	invalidate(binary: string): void {
		this.cache.delete(binary);
	}

	/** Clear all entries. */
	clear(): void {
		this.cache.clear();
		this.stats.hits = 0;
		this.stats.misses = 0;
	}

	recordMiss(): void {
		this.stats.misses++;
	}

	getStats(): HealthCacheStats {
		return {
			hits: this.stats.hits,
			misses: this.stats.misses,
			entries: this.cache.size,
		};
	}
}

// Global singleton — shared across all adapter instances
export const healthCache = new HealthCache();

/** Check binary with TTL caching. Returns cached result if fresh. */
export async function checkBinaryCached(
	checkFn: (binary: string, versionArgs?: string[]) => Promise<BinaryCheckResult>,
	binary: string,
	versionArgs?: string[],
	forceRefresh = false,
): Promise<BinaryCheckResult> {
	if (!forceRefresh) {
		const cached = healthCache.get(binary);
		if (cached) return cached;
	}
	healthCache.recordMiss();
	const result = await checkFn(binary, versionArgs);
	healthCache.set(binary, result);
	return result;
}
