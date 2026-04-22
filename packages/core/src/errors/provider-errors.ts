// @oscorpex/core — Provider error types

import { OscorpexError } from "./domain-errors.js";

export class ProviderUnavailableError extends OscorpexError {
	constructor(
		public readonly providerId: string,
		reason?: string,
	) {
		super("PROVIDER_UNAVAILABLE", `Provider ${providerId} is unavailable${reason ? `: ${reason}` : ""}`);
		this.name = "ProviderUnavailableError";
	}
}

export class ProviderTimeoutError extends OscorpexError {
	constructor(
		public readonly providerId: string,
		public readonly taskId: string,
		public readonly timeoutMs: number,
	) {
		super("PROVIDER_TIMEOUT", `Provider ${providerId} timed out after ${timeoutMs}ms for task ${taskId}`);
		this.name = "ProviderTimeoutError";
	}
}

export class ProviderExecutionError extends OscorpexError {
	constructor(
		public readonly providerId: string,
		public readonly taskId: string,
		public readonly exitCode: number | null,
		message: string,
	) {
		super("PROVIDER_EXECUTION_ERROR", `Provider ${providerId} failed for task ${taskId}: ${message}`, { exitCode });
		this.name = "ProviderExecutionError";
	}
}

export class ProviderRateLimitError extends OscorpexError {
	constructor(
		public readonly providerId: string,
		public readonly retryAfterMs?: number,
	) {
		super("PROVIDER_RATE_LIMITED", `Provider ${providerId} is rate limited${retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : ""}`);
		this.name = "ProviderRateLimitError";
	}
}