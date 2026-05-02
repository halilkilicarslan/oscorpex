// ---------------------------------------------------------------------------
// Oscorpex — DB Reset: close pool (used by tests)
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import { closePool } from "../pg.js";
const log = createLogger("reset");

/** Reset DB connection pool (used by tests). */
export async function resetDb(): Promise<void> {
	await closePool();
}
