// ---------------------------------------------------------------------------
// Boot Phase — Container Pool Warm-up
// Skip-allowed: fails silently if Docker not available.
// ---------------------------------------------------------------------------

import { containerPool } from "../studio/container-pool.js";
import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:container-pool");

export function containerPoolPhase(): void {
	containerPool.initialize().catch((err) => {
		log.warn({ err }, "Container pool init skipped");
	});
}
