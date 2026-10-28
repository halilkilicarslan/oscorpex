// ---------------------------------------------------------------------------
// Boot Phase — DB Schema Bootstrap
// Idempotent schema migrations. Fatal on failure.
// ---------------------------------------------------------------------------

import { initDb } from "@oscorpex/control-plane";
import { applyDbBootstrap } from "../studio/db-bootstrap.js";
import { createLogger } from "../studio/logger.js";
import { execute, query, queryOne, withTransaction } from "../studio/pg.js";

const log = createLogger("boot:db");

export async function dbPhase(): Promise<void> {
	await applyDbBootstrap();

	// Control-plane delegates to the kernel's tenant-scoped helpers (no separate pool)
	initDb({ query, queryOne, execute, withTransaction });

	log.info("DB schema bootstrap complete");
}
