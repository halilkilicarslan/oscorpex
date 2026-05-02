// ---------------------------------------------------------------------------
// Oscorpex — Task Timeout
// TaskTimeoutError class and withTimeout helper for task execution.
// ---------------------------------------------------------------------------

import { TIMEOUT_WARNING_THRESHOLD } from "../timeout-policy.js";

// ---------------------------------------------------------------------------
// TaskTimeoutError
// ---------------------------------------------------------------------------

/** Thrown when a task exceeds its configured timeout */
export class TaskTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		const minutes = (timeoutMs / 60_000).toFixed(1);
		super(`Task timed out after ${minutes} minute(s) (${timeoutMs}ms). The task was aborted.`);
		this.name = "TaskTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

// ---------------------------------------------------------------------------
// withTimeout helper
// ---------------------------------------------------------------------------

/**
 * Wraps a promise with a timeout using AbortController.
 * If the promise does not resolve within `timeoutMs`, the AbortController is
 * aborted and a TaskTimeoutError is thrown.
 *
 * @param operation   - Factory that receives an AbortSignal and returns the promise to race.
 * @param timeoutMs   - Maximum allowed duration in milliseconds.
 * @param onWarning   - Timeout'un %80'i dolduğunda çağrılır (opsiyonel).
 * @returns The resolved value of the operation promise.
 */
export function withTimeout<T>(
	operation: (signal: AbortSignal, extendTimeout: (ms: number) => void) => Promise<T>,
	timeoutMs: number,
	onWarning?: () => void,
): Promise<T> {
	const controller = new AbortController();
	let remainingMs = timeoutMs;
	let timer: ReturnType<typeof setTimeout>;
	let warningTimer: ReturnType<typeof setTimeout> | null = null;

	const resetTimers = () => {
		clearTimeout(timer);
		if (warningTimer) clearTimeout(warningTimer);

		const warningMs = Math.round(remainingMs * TIMEOUT_WARNING_THRESHOLD);
		warningTimer = onWarning
			? setTimeout(() => {
					onWarning();
				}, warningMs)
			: null;

		timer = setTimeout(() => {
			if (warningTimer) clearTimeout(warningTimer);
			controller.abort();
		}, remainingMs);
	};

	const extendTimeout = (ms: number) => {
		remainingMs += ms;
		resetTimers();
	};

	resetTimers();

	const timeoutPromise = new Promise<never>((_, reject) => {
		controller.signal.addEventListener("abort", () => {
			clearTimeout(timer);
			if (warningTimer) clearTimeout(warningTimer);
			reject(new TaskTimeoutError(timeoutMs));
		});
	});

	return Promise.race([operation(controller.signal, extendTimeout), timeoutPromise]);
}
