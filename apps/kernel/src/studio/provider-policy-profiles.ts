// @oscorpex/kernel — Provider Policy Profiles
// Defines profile-driven model selection behavior.
// Profiles influence primary provider, cost/quality tradeoff, and fallback ordering.

import { createLogger } from "./logger.js";

const log = createLogger("provider-policy-profiles");

// ---------------------------------------------------------------------------
// Profile type
// ---------------------------------------------------------------------------

export type ProviderPolicyProfile =
	| "balanced"
	| "cheap"
	| "quality"
	| "local-first"
	| "fallback-heavy";

export const VALID_PROFILES: ProviderPolicyProfile[] = [
	"balanced",
	"cheap",
	"quality",
	"local-first",
	"fallback-heavy",
];

export const DEFAULT_PROFILE: ProviderPolicyProfile = "balanced";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidProviderPolicyProfile(value: string): value is ProviderPolicyProfile {
	return VALID_PROFILES.includes(value as ProviderPolicyProfile);
}

export function normalizeProviderPolicyProfile(value: string | undefined): ProviderPolicyProfile {
	if (value && isValidProviderPolicyProfile(value)) return value;
	log.warn(`[provider-policy-profiles] Invalid profile "${value}" — falling back to "${DEFAULT_PROFILE}"`);
	return DEFAULT_PROFILE;
}

// ---------------------------------------------------------------------------
// Profile behavior definitions
// ---------------------------------------------------------------------------

export interface ProfileBehavior {
	/** Default primary provider when no explicit cliTool is given */
	defaultProvider: string;
	/** Provider preference order for fallback chains */
	providerOrder: string[];
	/** Whether cost-aware downgrading is enabled */
	allowCostDowngrade: boolean;
	/** Tiers that may be downgraded (empty = all tiers may downgrade) */
	downgradeTiers: string[];
	/** Whether to preserve quality after failures */
	preserveQualityOnFailure: boolean;
}

const PROFILE_BEHAVIORS: Record<ProviderPolicyProfile, ProfileBehavior> = {
	balanced: {
		defaultProvider: "claude-code",
		providerOrder: ["claude-code", "codex", "cursor", "gemini", "ollama"],
		allowCostDowngrade: true,
		downgradeTiers: ["S", "M"],
		preserveQualityOnFailure: true,
	},
	cheap: {
		defaultProvider: "gemini",
		providerOrder: ["ollama", "gemini", "codex", "claude-code", "cursor"],
		allowCostDowngrade: true,
		downgradeTiers: ["S", "M", "L", "XL"],
		preserveQualityOnFailure: false,
	},
	quality: {
		defaultProvider: "claude-code",
		providerOrder: ["claude-code", "cursor", "codex", "gemini", "ollama"],
		allowCostDowngrade: false,
		downgradeTiers: [],
		preserveQualityOnFailure: true,
	},
	"local-first": {
		defaultProvider: "ollama",
		providerOrder: ["ollama", "claude-code", "codex", "cursor", "gemini"],
		allowCostDowngrade: true,
		downgradeTiers: ["S", "M"],
		preserveQualityOnFailure: true,
	},
	"fallback-heavy": {
		defaultProvider: "claude-code",
		providerOrder: ["claude-code", "codex", "cursor", "gemini", "ollama"],
		allowCostDowngrade: true,
		downgradeTiers: ["S", "M"],
		preserveQualityOnFailure: true,
	},
};

export function getProfileBehavior(profile: ProviderPolicyProfile): ProfileBehavior {
	return PROFILE_BEHAVIORS[profile] ?? PROFILE_BEHAVIORS[DEFAULT_PROFILE];
}

// ---------------------------------------------------------------------------
// Provider → cliTool mapping
// ---------------------------------------------------------------------------

const PROVIDER_TO_CLI_TOOL: Record<string, string> = {
	"claude-code": "claude-code",
	anthropic: "claude-code",
	openai: "codex",
	codex: "codex",
	cursor: "cursor",
	gemini: "gemini",
	ollama: "ollama",
};

export function providerToCliTool(provider: string): string {
	return PROVIDER_TO_CLI_TOOL[provider] ?? provider;
}

// ---------------------------------------------------------------------------
// Model selection helpers per profile
// ---------------------------------------------------------------------------

export interface ProfileModelSelection {
	provider: string;
	cliTool: string;
	decisionReason: string;
}

/**
 * Selects the primary provider and cliTool for a task based on profile.
 * Does NOT select the specific model — that is still done by the model router
 * based on tier and cost-awareness.
 */
export function selectPrimaryProvider(
	profile: ProviderPolicyProfile,
	explicitCliTool?: string,
): ProfileModelSelection {
	const behavior = getProfileBehavior(profile);

	// If an explicit cliTool is provided, honor it regardless of profile
	if (explicitCliTool) {
		return {
			provider: cliToolToProvider(explicitCliTool),
			cliTool: explicitCliTool,
			decisionReason: `explicit_tool (${profile})`,
		};
	}

	return {
		provider: behavior.defaultProvider,
		cliTool: providerToCliTool(behavior.defaultProvider),
		decisionReason: `profile_default (${profile})`,
	};
}

function cliToolToProvider(cliTool: string): string {
	switch (cliTool) {
		case "claude-code":
			return "anthropic";
		case "codex":
			return "openai";
		case "cursor":
			return "cursor";
		case "gemini":
			return "gemini";
		case "ollama":
			return "ollama";
		default:
			return cliTool;
	}
}

// ---------------------------------------------------------------------------
// Fallback chain generation
// ---------------------------------------------------------------------------

/**
 * Generates the fallback provider chain for a given profile and primary provider.
 * The primary provider is excluded from fallbacks to avoid duplicates.
 */
export function getFallbackChain(
	profile: ProviderPolicyProfile,
	primaryProvider: string,
): string[] {
	const behavior = getProfileBehavior(profile);
	const chain = behavior.providerOrder.filter((p) => p !== primaryProvider);

	if (profile === "fallback-heavy") {
		// Include all remaining providers as fallbacks
		return chain;
	}

	// For other profiles, limit to first 2 fallbacks to keep latency reasonable
	return chain.slice(0, 2);
}
