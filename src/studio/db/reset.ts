// ---------------------------------------------------------------------------
// Oscorpex — DB Reset: close pool (used by tests)
// ---------------------------------------------------------------------------

import { closePool } from "../pg.js";

/** Reset DB connection pool (used by tests). */
export async function resetDb(): Promise<void> {
	await closePool();
}
