// ---------------------------------------------------------------------------
// Boot Phase — Provider Registry Init
// Prefers native registration (registerDefaultProviders).
// Falls back to legacy initialization only if native yields zero adapters.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:provider-registry");

export async function providerRegistryPhase(): Promise<void> {
	const { providerRegistry } = await import("../studio/kernel/provider-registry.js");

	// Primary: native registration (no legacy dependency)
	providerRegistry.registerDefaultProviders();

	// Fallback: legacy bridge only if no adapters were registered
	if (providerRegistry.list().length === 0) {
		log.warn("No native adapters registered — falling back to legacy init");
		await providerRegistry.initializeFromLegacy().catch((err: unknown) => {
			log.warn({ err }, "Provider registry legacy init skipped");
		});
	}
}
