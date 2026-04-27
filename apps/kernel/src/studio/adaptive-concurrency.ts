// ---------------------------------------------------------------------------
// Oscorpex — Adaptive Concurrency Controller (TASK 8)
// Dynamic semaphore sizing based on queue depth, failure rate, and provider health.
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";
const log = createLogger("adaptive-concurrency");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MAX = Number(process.env.OSCORPEX_MAX_CONCURRENT_TASKS) || 3;
const MIN_MAX = 1;
const ABSOLUTE_MAX = 10;
const ADJUSTMENT_INTERVAL_MS = 30_000;

/** Failure rate threshold above which we reduce concurrency */
const FAILURE_RATE_THRESHOLD = 0.5;
/** Queue depth threshold above which we consider increasing concurrency */
const QUEUE_DEPTH_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConcurrencySnapshot {
	globalMax: number;
	globalActive: number;
	globalPending: number;
	projectCaps: Record<string, { active: number; cap: number }>;
	providerCaps: Record<string, { active: number; cap: number }>;
}

// ---------------------------------------------------------------------------
// Adaptive Semaphore
// ---------------------------------------------------------------------------

export class AdaptiveSemaphore {
	private current = 0;
	private queue: (() => void)[] = [];
	private max: number;

	constructor(initialMax = DEFAULT_MAX) {
		this.max = Math.max(MIN_MAX, Math.min(ABSOLUTE_MAX, initialMax));
	}

	get maxConcurrency(): number {
		return this.max;
	}

	set maxConcurrency(value: number) {
		const clamped = Math.max(MIN_MAX, Math.min(ABSOLUTE_MAX, value));
		if (clamped === this.max) return;
		const oldMax = this.max;
		this.max = clamped;
		log.info(`[adaptive-concurrency] max changed: ${oldMax} → ${clamped}`);
		// If max increased, wake up queued acquirers
		if (clamped > oldMax) {
			while (this.current < this.max && this.queue.length > 0) {
				const next = this.queue.shift();
				if (next) {
					this.current++;
					next();
				}
			}
		}
	}

	async acquire(): Promise<void> {
		if (this.current < this.max) {
			this.current++;
			return;
		}
		return new Promise<void>((resolve) => this.queue.push(resolve));
	}

	release(): void {
		this.current--;
		const next = this.queue.shift();
		if (next) {
			this.current++;
			next();
		}
	}

	get activeCount(): number {
		return this.current;
	}

	get pendingCount(): number {
		return this.queue.length;
	}
}

// ---------------------------------------------------------------------------
// Project / Provider concurrency tracking
// ---------------------------------------------------------------------------

export class ConcurrencyTracker {
	private projectActive = new Map<string, number>();
	private providerActive = new Map<string, number>();
	private projectCap = 2; // max concurrent per project
	private providerCap = 2; // max concurrent per provider

	getProjectCap(): number {
		return this.projectCap;
	}

	getProviderCap(): number {
		return this.providerCap;
	}

	canAcquire(projectId: string, providerId: string): boolean {
		const projectActive = this.projectActive.get(projectId) ?? 0;
		const providerActive = this.providerActive.get(providerId) ?? 0;
		return projectActive < this.projectCap && providerActive < this.providerCap;
	}

	acquire(projectId: string, providerId: string): void {
		this.projectActive.set(projectId, (this.projectActive.get(projectId) ?? 0) + 1);
		this.providerActive.set(providerId, (this.providerActive.get(providerId) ?? 0) + 1);
	}

	release(projectId: string, providerId: string): void {
		this.projectActive.set(projectId, Math.max(0, (this.projectActive.get(projectId) ?? 1) - 1));
		this.providerActive.set(providerId, Math.max(0, (this.providerActive.get(providerId) ?? 1) - 1));
	}

	snapshot(): ConcurrencySnapshot {
		const projectCaps: ConcurrencySnapshot["projectCaps"] = {};
		for (const [pid, active] of this.projectActive) {
			projectCaps[pid] = { active, cap: this.projectCap };
		}
		const providerCaps: ConcurrencySnapshot["providerCaps"] = {};
		for (const [prid, active] of this.providerActive) {
			providerCaps[prid] = { active, cap: this.providerCap };
		}
		return {
			globalMax: 0,
			globalActive: 0,
			globalPending: 0,
			projectCaps,
			providerCaps,
		};
	}
}

// ---------------------------------------------------------------------------
// Adaptive controller
// ---------------------------------------------------------------------------

export class AdaptiveConcurrencyController {
	private interval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private semaphore: AdaptiveSemaphore,
		private getFailureRate: () => number,
		private getQueueDepth: () => number,
	) {}

	start(): void {
		if (this.interval) return;
		this.interval = setInterval(() => this._adjust(), ADJUSTMENT_INTERVAL_MS);
		log.info("[adaptive-concurrency] Controller started");
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
			log.info("[adaptive-concurrency] Controller stopped");
		}
	}

	private _adjust(): void {
		const failureRate = this.getFailureRate();
		const queueDepth = this.getQueueDepth();
		const currentMax = this.semaphore.maxConcurrency;
		let newMax = currentMax;

		if (failureRate > FAILURE_RATE_THRESHOLD) {
			newMax = Math.max(MIN_MAX, currentMax - 1);
			log.info(`[adaptive-concurrency] Reducing concurrency: ${currentMax} → ${newMax} (failureRate=${failureRate.toFixed(2)})`);
		} else if (queueDepth > QUEUE_DEPTH_THRESHOLD && currentMax < ABSOLUTE_MAX && failureRate < 0.2) {
			newMax = Math.min(ABSOLUTE_MAX, currentMax + 1);
			log.info(`[adaptive-concurrency] Increasing concurrency: ${currentMax} → ${newMax} (queueDepth=${queueDepth}, failureRate=${failureRate.toFixed(2)})`);
		}

		this.semaphore.maxConcurrency = newMax;
	}
}

export { DEFAULT_MAX, MIN_MAX, ABSOLUTE_MAX };
