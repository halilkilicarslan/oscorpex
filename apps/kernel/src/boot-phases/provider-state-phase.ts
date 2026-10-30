// ---------------------------------------------------------------------------
// Boot Phase — Provider State Load
// Non-blocking warning on failure.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";
import { providerState } from "../studio/provider-state.js";
import { runAsSystemInBackground } from "../studio/tenancy/tenant-scope.js";

const log = createLogger("boot:provider-state");

export async function providerStatePhase(): Promise<void> {
	await runAsSystemInBackground("provider-state-load", () => providerState.loadFromDb()).catch((err) => {
		log.warn({ err }, "Provider state load skipped");
	});
}
