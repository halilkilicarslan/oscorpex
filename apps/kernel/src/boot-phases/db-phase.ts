// ---------------------------------------------------------------------------
// Boot Phase — DB Schema Bootstrap
// Idempotent schema migrations. Fatal on failure.
// ---------------------------------------------------------------------------

import { applyDbBootstrap } from "../studio/db-bootstrap.js";
import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:db");

export async function dbPhase(): Promise<void> {
	await applyDbBootstrap();
	log.info("DB schema bootstrap complete");
}
