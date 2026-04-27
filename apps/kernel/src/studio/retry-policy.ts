// ---------------------------------------------------------------------------
// Oscorpex — Retry Policy (TASK 10)
// Deterministic retry / non-retry / fallback decisions per error classification.
// ---------------------------------------------------------------------------

import type { ProviderErrorClassification } from "@oscorpex/provider-sdk";
import { createLogger } from "./logger.js";
const log = createLogger("retry-policy");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const MAX_AUTO_RETRIES = 3;
export const BASE_BACKOFF_MS = process.env.VITEST === "true" ? 0 : 5_000;
export const MAX_BACKOFF_MS = 60_000;

// ---------------------------------------------------------------------------
// Retryability matrix
// ---------------------------------------------------------------------------

export type RetryDecision = "retry" | "fallback" | "fail";

const RETRY_MATRIX: Record<ProviderErrorClassification, RetryDecision> = {
	spawn_failure: "fallback",
	unavailable: "fallback",
	rate_limited: "fallback",
	tool_restriction_unsupported: "fallback",
	timeout: "retry",
	cli_error: "retry",
	killed: "retry",
	unknown: "retry",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether a failed execution should be retried, fall back, or fail.
 */
export function getRetryDecision(classification: ProviderErrorClassification): RetryDecision {
	return RETRY_MATRIX[classification] ?? "retry";
}

/**
 * Returns true if the error classification is retryable.
 */
export function isRetryable(classification: ProviderErrorClassification): boolean {
	return getRetryDecision(classification) === "retry";
}

/**
 * Computes exponential backoff delay for a given retry attempt.
 *   attempt 0 → 5s
 *   attempt 1 → 10s
 *   attempt 2 → 20s
 *   attempt 3 → 40s
 */
export function computeBackoffMs(attempt: number): number {
	const delay = BASE_BACKOFF_MS * 2 ** attempt;
	return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * Determines whether a task should be auto-retried based on classification + current retry count.
 * Returns { shouldRetry, delayMs }.
 */
export function evaluateRetry(
	classification: ProviderErrorClassification,
	currentRetryCount: number,
): { shouldRetry: boolean; delayMs: number } {
	const decision = getRetryDecision(classification);

	if (decision !== "retry") {
		return { shouldRetry: false, delayMs: 0 };
	}

	if (currentRetryCount >= MAX_AUTO_RETRIES) {
		log.info(`[retry-policy] Max retries (${MAX_AUTO_RETRIES}) reached — failing.`);
		return { shouldRetry: false, delayMs: 0 };
	}

	const delayMs = computeBackoffMs(currentRetryCount);
	log.info(`[retry-policy] Retry #${currentRetryCount + 1} after ${delayMs}ms (classification=${classification})`);
	return { shouldRetry: true, delayMs };
}

// ---------------------------------------------------------------------------
// Telemetry enrichment
// ---------------------------------------------------------------------------

export interface RetryTelemetry {
	retryDecision: RetryDecision;
	retryCount: number;
	maxRetries: number;
	backoffMs: number;
}

export function buildRetryTelemetry(
	classification: ProviderErrorClassification,
	currentRetryCount: number,
): RetryTelemetry {
	const decision = getRetryDecision(classification);
	const { delayMs } = decision === "retry" ? evaluateRetry(classification, currentRetryCount) : { delayMs: 0 };
	return {
		retryDecision: decision,
		retryCount: currentRetryCount,
		maxRetries: MAX_AUTO_RETRIES,
		backoffMs: delayMs,
	};
}
