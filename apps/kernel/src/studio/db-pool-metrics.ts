// ---------------------------------------------------------------------------
// Oscorpex — DB Pool Metrics (EPIC 2)
// Connection pool visibility and health monitoring.
// ---------------------------------------------------------------------------

import { getPool } from "./pg.js";
import { createLogger } from "./logger.js";
const log = createLogger("db-pool-metrics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbPoolSnapshot {
	/** Total connections in the pool (active + idle) */
	total: number;
	/** Idle connections available for use */
	idle: number;
	/** Clients waiting for a connection */
	waiting: number;
	/** Currently checked-out connections */
	active: number;
	/** Maximum allowed connections */
	max: number;
	/** Connection timeout in ms */
	connectionTimeoutMs: number;
	/** Idle timeout in ms */
	idleTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Snapshot helper
// ---------------------------------------------------------------------------

/**
 * Returns a snapshot of the current DB connection pool state.
 * Safe to call at any time — returns zeros if pool is not yet initialized.
 */
export function getDbPoolSnapshot(): DbPoolSnapshot {
	try {
		const pool = getPool();
		// pg.Pool internal properties (not in public types but available at runtime)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const total = (pool as any).totalCount ?? 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const idle = (pool as any).idleCount ?? 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const waiting = (pool as any).waitingCount ?? 0;

		return {
			total,
			idle,
			waiting,
			active: total - idle,
			max: (pool.options as any).max ?? 20,
			connectionTimeoutMs: (pool.options as any).connectionTimeoutMillis ?? 5_000,
			idleTimeoutMs: (pool.options as any).idleTimeoutMillis ?? 30_000,
		};
	} catch {
		// Pool not initialized yet
		return {
			total: 0,
			idle: 0,
			waiting: 0,
			active: 0,
			max: 20,
			connectionTimeoutMs: 5_000,
			idleTimeoutMs: 30_000,
		};
	}
}

// ---------------------------------------------------------------------------
// Warning threshold
// ---------------------------------------------------------------------------

const WAITING_THRESHOLD = 5;

/**
 * Checks pool health and emits a warning log if waiting clients exceed threshold.
 * Call this periodically (e.g., every 30s) or before heavy operations.
 */
export function checkPoolHealth(): void {
	const snapshot = getDbPoolSnapshot();
	if (snapshot.waiting >= WAITING_THRESHOLD) {
		log.warn(
			{ snapshot },
			`[db-pool-metrics] Pool pressure detected: ${snapshot.waiting} clients waiting (threshold=${WAITING_THRESHOLD}). Consider increasing pool size or reducing concurrency.`,
		);
	}
}
