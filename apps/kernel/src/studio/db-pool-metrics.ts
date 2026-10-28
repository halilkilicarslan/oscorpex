// ---------------------------------------------------------------------------
// Oscorpex — DB Pool Metrics (EPIC 2)
// Connection pool visibility and health monitoring.
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";
import { getPoolStats } from "./pg.js";
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
		const pool = getPoolStats();
		if (!pool) throw new Error("Pool not initialized");
		const total = pool.totalCount;
		const idle = pool.idleCount;
		const waiting = pool.waitingCount;

		return {
			total,
			idle,
			waiting,
			active: total - idle,
			max: pool.max,
			connectionTimeoutMs: pool.connectionTimeoutMillis,
			idleTimeoutMs: pool.idleTimeoutMillis,
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
