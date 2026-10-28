// ---------------------------------------------------------------------------
// Boot Phase — Auth configuration validation (fail-closed for production)
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:auth");

export interface AuthMode {
	authEnabled: boolean;
	devNoAuth: boolean;
	production: boolean;
}

/**
 * Pure auth-mode resolution from an env map. Only the literal "true" enables a flag.
 * Throws on unsafe combinations: DEV_NO_AUTH together with AUTH_ENABLED, or DEV_NO_AUTH in production.
 * Request-time code reads the env flags directly (cheap) so tests/ops can flip them without a reboot;
 * this function is the single validation point and is called once at boot.
 */
export function resolveAuthMode(env: Record<string, string | undefined>): AuthMode {
	const authEnabled = env.OSCORPEX_AUTH_ENABLED === "true";
	const devNoAuth = env.OSCORPEX_DEV_NO_AUTH === "true";
	const production = env.NODE_ENV === "production";
	if (devNoAuth && authEnabled) {
		throw new Error(
			"Invalid auth config: OSCORPEX_DEV_NO_AUTH=true cannot be combined with OSCORPEX_AUTH_ENABLED=true",
		);
	}
	if (devNoAuth && production) {
		throw new Error("Invalid auth config: OSCORPEX_DEV_NO_AUTH=true is not allowed in production");
	}
	return { authEnabled, devNoAuth, production };
}

export function authConfigPhase(): void {
	const { authEnabled } = resolveAuthMode(process.env);
	const nodeEnv = process.env.NODE_ENV ?? "development";
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
