// ---------------------------------------------------------------------------
// P1-2: Child Process Environment Sanitization
// Prevents leaking DATABASE_URL, JWT secrets, API keys, etc. to child processes.
// Every child process spawn MUST use buildSafeChildEnv() instead of ...process.env.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";

const log = createLogger("env-sanitizer");

/** Sensitive env var patterns — these are DENIED by default */
const SENSITIVE_PATTERNS = [
	/^DATABASE_URL$/i,
	/^POSTGRES_URL$/i,
	/^OSCORPEX_JWT_SECRET$/i,
	/^OSCORPEX_API_KEY$/i,
	/^OSCORPEX_VAULT_KEY$/i,
	/_SECRET$/i,
	/_TOKEN$/i,
	/^ANTHROPIC_API_KEY$/i,
	/^OPENAI_API_KEY$/i,
	/^GITHUB_TOKEN$/i,
	/^CLOUDFLARE_API_TOKEN$/i,
	/^SUPABASE_SERVICE_ROLE_KEY$/i,
	/^AWS_SECRET_ACCESS_KEY$/i,
	/^AWS_SESSION_TOKEN$/i,
];

/** Safe env vars that are always allowed */
const ALWAYS_ALLOWED = new Set([
	"PATH",
	"HOME",
	"USER",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TMPDIR",
	"TMP",
	"TEMP",
	"NODE_ENV",
	"NODE_OPTIONS",
	"NODE_PATH",
	"CI",
	"FORCE_COLOR",
	"NO_COLOR",
	"npm_config_user_agent",
	"npm_lifecycle_event",
]);

export type ChildProcessEnvProfile = "provider" | "app_runner" | "db_provisioner" | "container_runtime" | "test" | "build_tool";

export interface BuildChildEnvOptions {
	profile: ChildProcessEnvProfile;
	base?: NodeJS.ProcessEnv;
	extra?: Record<string, string | undefined>;
	allow?: string[];
}

function isSensitive(key: string): boolean {
	return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

export function buildSafeChildEnv(options: BuildChildEnvOptions): NodeJS.ProcessEnv {
	const { profile, base = process.env, extra = {}, allow = [] } = options;
	const result: Record<string, string | undefined> = {};
	const allowSet = new Set(allow);

	// Copy only safe vars from base
	for (const [key, value] of Object.entries(base)) {
		if (ALWAYS_ALLOWED.has(key) || allowSet.has(key)) {
			result[key] = value;
		} else if (!isSensitive(key)) {
			result[key] = value;
		}
	}

	// Add extra vars — block sensitive ones unless explicitly allowed
	for (const [key, value] of Object.entries(extra)) {
		if (allowSet.has(key) || !isSensitive(key)) {
			result[key] = value;
		} else {
			log.warn({ key, profile }, "[env-sanitizer] Blocked sensitive var in extra");
		}
	}

	// Provider profile: allow explicitly passed provider keys in extra
	if (profile === "provider") {
		for (const [key, value] of Object.entries(extra)) {
			if (key === "ANTHROPIC_API_KEY" || key === "OPENAI_API_KEY") {
				result[key] = value;
			}
		}
	}

	return result as NodeJS.ProcessEnv;
}

/** Assert that an env object doesn't contain obvious sensitive values */
export function assertNoSensitiveEnv(env: NodeJS.ProcessEnv): void {
	for (const key of Object.keys(env)) {
		if (isSensitive(key) && !ALWAYS_ALLOWED.has(key)) {
			throw new Error(`[env-sanitizer] Sensitive env var leaked: ${key}`);
		}
	}
}
