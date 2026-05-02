// ---------------------------------------------------------------------------
// Oscorpex — Preflight Warm-up (TASK 12)
// Startup health checks and cold-start telemetry tracking.
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";
import { getPreflightConfig } from "./performance-config.js";
import { providerRuntimeCache } from "./provider-runtime-cache.js";
const log = createLogger("preflight-warmup");

// ---------------------------------------------------------------------------
// Cold-start tracking
// ---------------------------------------------------------------------------

let firstExecution = true;

export function markExecutionStarted(): { isColdStart: boolean } {
	const isColdStart = firstExecution;
	if (firstExecution) {
		firstExecution = false;
		log.info("[preflight-warmup] First execution — cold start marked");
	}
	return { isColdStart };
}

export function isColdStart(): boolean {
	return firstExecution;
}

export function resetColdStart(): void {
	firstExecution = true;
}

// ---------------------------------------------------------------------------
// Preflight health checks
// ---------------------------------------------------------------------------

export interface PreflightResult {
	providerId: string;
	available: boolean;
	durationMs: number;
}

/** Telemetry for the most recent preflight run (TASK 7.2) */
export interface PreflightTelemetry {
	ranAt: string;
	totalProviders: number;
	successCount: number;
	failCount: number;
	results: PreflightResult[];
}

let lastPreflightTelemetry: PreflightTelemetry | null = null;

export function getLastPreflightTelemetry(): PreflightTelemetry | null {
	return lastPreflightTelemetry;
}

/**
 * Runs preflight health checks for all providers.
 * Populates the runtime availability cache so first real execution is warm.
 */
export async function runPreflightHealthChecks(
	adapters: Array<{ name: string; isAvailable: () => Promise<boolean> }>,
): Promise<PreflightResult[]> {
	const cfg = getPreflightConfig();
	if (!cfg.enabled) {
		log.info("[preflight-warmup] Preflight health checks disabled by config");
		return [];
	}

	const results: PreflightResult[] = [];
	log.info(`[preflight-warmup] Starting health checks for ${adapters.length} providers`);

	for (const adapter of adapters) {
		const start = Date.now();
		try {
			const available = await providerRuntimeCache.resolveAvailability(
				adapter.name,
				() => adapter.isAvailable(),
				"health_check",
			);
			const durationMs = Date.now() - start;
			results.push({ providerId: adapter.name, available, durationMs });
			log.info(`[preflight-warmup] ${adapter.name}: ${available ? "available" : "unavailable"} (${durationMs}ms)`);
		} catch (err) {
			const durationMs = Date.now() - start;
			results.push({ providerId: adapter.name, available: false, durationMs });
			log.warn(`[preflight-warmup] ${adapter.name} health check failed: ${String(err)}`);
		}
	}

	lastPreflightTelemetry = {
		ranAt: new Date().toISOString(),
		totalProviders: adapters.length,
		successCount: results.filter((r) => r.available).length,
		failCount: results.filter((r) => !r.available).length,
		results,
	};

	return results;
}

// ---------------------------------------------------------------------------
// Binary path resolution cache
// ---------------------------------------------------------------------------

const binaryPathCache = new Map<string, string | null>();

/**
 * Resolves the full path to a binary, caching the result.
 */
export async function resolveBinaryPath(binary: string): Promise<string | null> {
	const cached = binaryPathCache.get(binary);
	if (cached !== undefined) return cached;

	try {
		const { execFile } = await import("node:child_process");
		const result = await new Promise<string>((resolve, reject) => {
			execFile("which", [binary], { timeout: 5_000 }, (err, stdout) => {
				if (err) reject(err);
				else resolve(stdout.trim());
			});
		});
		binaryPathCache.set(binary, result);
		return result;
	} catch {
		binaryPathCache.set(binary, null);
		return null;
	}
}

export function getBinaryPathCache(): Record<string, string | null> {
	return Object.fromEntries(binaryPathCache);
}

export function clearBinaryPathCache(): void {
	binaryPathCache.clear();
}
