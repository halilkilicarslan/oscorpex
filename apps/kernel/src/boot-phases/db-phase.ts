// ---------------------------------------------------------------------------
// Boot Phase — DB Schema Bootstrap
// Idempotent schema migrations. Fatal on failure.
// ---------------------------------------------------------------------------

import { initPool } from "@oscorpex/control-plane";
import { applyDbBootstrap } from "../studio/db-bootstrap.js";
import { createLogger } from "../studio/logger.js";
import { getPool } from "../studio/pg.js";

const log = createLogger("boot:db");

export async function dbPhase(): Promise<void> {
	await applyDbBootstrap();

	// Share kernel's DB pool with control-plane to avoid dual pool overhead
	initPool(getPool());

	log.info("DB schema bootstrap complete");
}
