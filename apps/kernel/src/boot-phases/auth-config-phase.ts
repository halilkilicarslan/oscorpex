// ---------------------------------------------------------------------------
// Boot Phase — Auth configuration validation (fail-closed for production)
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:auth");

export function authConfigPhase(): void {
	const nodeEnv = process.env.NODE_ENV ?? "development";
	const authEnabled = process.env.OSCORPEX_AUTH_ENABLED === "true";
	const jwtSecret = process.env.OSCORPEX_JWT_SECRET;
	const apiKey = process.env.OSCORPEX_API_KEY;

	if (nodeEnv === "production") {
		if (!authEnabled) {
			log.error("[boot:auth] FATAL: Production requires OSCORPEX_AUTH_ENABLED=true");
			throw new Error("Production boot failed: auth must be enabled (OSCORPEX_AUTH_ENABLED=true)");
		}

		if (!jwtSecret && !apiKey) {
			log.error("[boot:auth] FATAL: Production auth enabled but no secret configured");
			throw new Error(
				"Production boot failed: auth enabled but no mechanism configured (set OSCORPEX_JWT_SECRET or OSCORPEX_API_KEY)",
			);
		}

		log.info("[boot:auth] Production auth validated — fail-closed mode active");
	} else {
		log.info(`[boot:auth] Development mode — auth ${authEnabled ? "enabled" : "disabled"}`);
	}
}
