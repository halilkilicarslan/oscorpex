// ---------------------------------------------------------------------------
// P1-2: Child Process Environment Sanitization
// Prevents leaking DATABASE_URL, JWT secrets, API keys, etc. to child processes.
// Every child process spawn MUST use buildSafeChildEnv() instead of ...process.env.
// ---------------------------------------------------------------------------

import { mergeGitCeilings } from "../git/git-safe-config.js";
import { createLogger } from "../logger.js";

const log = createLogger("env-sanitizer");

/** Sensitive env var patterns — these are DENIED by default */
const SENSITIVE_PATTERNS = [
	/DATABASE_URL/i,
	/^PG[A-Z_]*$/,
	/_DSN$/i,
	/^POSTGRES/i,
	/^OSCORPEX_JWT_SECRET$/i,
	/^OSCORPEX_API_KEY$/i,
	/^OSCORPEX_VAULT_KEY$/i,
	/SECRET/i,
	/PASSWD/i,
	/_TOKEN$/i,
	/_API_KEY$/i,
	/_PRIVATE_KEY$/i,
	/PASSWORD/i,
	/CREDENTIAL/i,
	/ADMIN.*KEY/i,
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

const ALLOWLIST_PROFILES = new Set<string>(["app_runner", "build_tool", "test"]);

const BASE_ALLOWLIST = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TMPDIR",
	"TMP",
	"TEMP",
	"NODE_ENV",
	"CI",
	"FORCE_COLOR",
	"NO_COLOR",
	"COREPACK_HOME",
	"COREPACK_DEFAULT_TO_LATEST",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"SystemRoot",
	"ComSpec",
	"PATHEXT",
	"WINDIR",
]);

export type ChildProcessEnvProfile =
	| "provider"
	| "app_runner"
	| "db_provisioner"
	| "container_runtime"
	| "test"
	| "build_tool";

export interface BuildChildEnvOptions {
	profile: ChildProcessEnvProfile;
	base?: NodeJS.ProcessEnv;
	extra?: Record<string, string | undefined>;
	allow?: string[];
}

/**
 * Names that match the broad credential patterns but only carry a file PATH (no secret value). Cloud SDKs inside
 * tenant tooling need them, so they are exempt from the deny patterns.
 */
const SENSITIVE_EXEMPT = new Set(["GOOGLE_APPLICATION_CREDENTIALS", "AWS_SHARED_CREDENTIALS_FILE"]);

function isSensitive(key: string): boolean {
	if (SENSITIVE_EXEMPT.has(key)) return false;
	return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
	gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	cursor: ["CURSOR_API_KEY"],
};

/**
 * API key variables a provider CLI may receive. Claude/Codex are deliberately empty: their keys are only ever passed
 * explicitly (agent-runtime), because an inherited ANTHROPIC_API_KEY would override OAuth billing.
 */
export function providerEnvKeys(provider: string): string[] {
	return [...(PROVIDER_ENV_KEYS[provider] ?? [])];
}

/** `extra` entries for the given keys that are set in `source`. */
export function pickEnv(keys: string[], source: NodeJS.ProcessEnv = process.env): Record<string, string> {
	return Object.fromEntries(keys.flatMap((k) => (source[k] !== undefined ? [[k, source[k] as string]] : [])));
}

export function buildSafeChildEnv(options: BuildChildEnvOptions): NodeJS.ProcessEnv {
	const { profile, base = process.env, extra = {}, allow = [] } = options;
	const result: Record<string, string | undefined> = {};
	const allowSet = new Set(allow);

	const strict = ALLOWLIST_PROFILES.has(profile);

	// Copy only safe vars from base
	for (const [key, value] of Object.entries(base)) {
		if (strict) {
			if (BASE_ALLOWLIST.has(key) || key.startsWith("LC_") || allowSet.has(key)) result[key] = value;
		} else if (ALWAYS_ALLOWED.has(key) || allowSet.has(key)) {
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

	// Stop git walking up from a project dir into the Oscorpex checkout; caller entries extend, never replace
	result.GIT_CEILING_DIRECTORIES = mergeGitCeilings(result.GIT_CEILING_DIRECTORIES, extra.GIT_CEILING_DIRECTORIES);

	return result as NodeJS.ProcessEnv;
}

/** Provider-profile child env carrying only that provider's own API keys (for adapters' runCLI env). */
export function providerChildEnv(provider: string): Record<string, string> {
	const keys = providerEnvKeys(provider);
	const env = buildSafeChildEnv({ profile: "provider", extra: pickEnv(keys), allow: keys });
	return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** Assert that an env object doesn't contain obvious sensitive values */
export function assertNoSensitiveEnv(env: NodeJS.ProcessEnv): void {
	for (const key of Object.keys(env)) {
		if (isSensitive(key) && !ALWAYS_ALLOWED.has(key)) {
			throw new Error(`[env-sanitizer] Sensitive env var leaked: ${key}`);
		}
	}
}
