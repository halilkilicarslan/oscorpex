// ---------------------------------------------------------------------------
// Boot Phase — Provider State Load
// Non-blocking warning on failure.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";
import { providerState } from "../studio/provider-state.js";

const log = createLogger("boot:provider-state");

export async function providerStatePhase(): Promise<void> {
	await providerState.loadFromDb().catch((err) => {
		log.warn({ err }, "Provider state load skipped");
	});
}
