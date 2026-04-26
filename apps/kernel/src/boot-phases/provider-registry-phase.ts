// ---------------------------------------------------------------------------
// Boot Phase — Provider Registry Init
// Native registration only. Legacy bridge removed.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:provider-registry");

export async function providerRegistryPhase(): Promise<void> {
	const { providerRegistry } = await import("../studio/kernel/provider-registry.js");
	providerRegistry.registerDefaultProviders();
	log.info(`Provider registry initialized with ${providerRegistry.list().length} adapters`);
}
