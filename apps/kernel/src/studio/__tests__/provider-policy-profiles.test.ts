// ---------------------------------------------------------------------------
// Tests — Provider Policy Profiles (EPIC 3)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROFILE,
	VALID_PROFILES,
	getFallbackChain,
	getProfileBehavior,
	isValidProviderPolicyProfile,
	normalizeProviderPolicyProfile,
	selectPrimaryProvider,
} from "../provider-policy-profiles.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("isValidProviderPolicyProfile", () => {
	it("returns true for valid profiles", () => {
		for (const p of VALID_PROFILES) {
			expect(isValidProviderPolicyProfile(p)).toBe(true);
		}
	});

	it("returns false for invalid profiles", () => {
		expect(isValidProviderPolicyProfile("fast")).toBe(false);
		expect(isValidProviderPolicyProfile("")).toBe(false);
		expect(isValidProviderPolicyProfile("random")).toBe(false);
	});
});

describe("normalizeProviderPolicyProfile", () => {
	it("returns the profile for valid values", () => {
		expect(normalizeProviderPolicyProfile("cheap")).toBe("cheap");
		expect(normalizeProviderPolicyProfile("quality")).toBe("quality");
	});

	it("returns default for invalid values", () => {
		expect(normalizeProviderPolicyProfile("invalid")).toBe(DEFAULT_PROFILE);
		expect(normalizeProviderPolicyProfile(undefined)).toBe(DEFAULT_PROFILE);
	});
});

// ---------------------------------------------------------------------------
// Profile behaviors
// ---------------------------------------------------------------------------

describe("getProfileBehavior", () => {
	it("balanced: defaultProvider=claude-code, allowCostDowngrade=true, downgradeTiers=[S,M]", () => {
		const b = getProfileBehavior("balanced");
		expect(b.defaultProvider).toBe("claude-code");
		expect(b.allowCostDowngrade).toBe(true);
		expect(b.downgradeTiers).toEqual(["S", "M"]);
		expect(b.preserveQualityOnFailure).toBe(true);
	});

	it("cheap: defaultProvider=gemini, allowCostDowngrade=true, downgradeTiers=[S,M,L,XL]", () => {
		const b = getProfileBehavior("cheap");
		expect(b.defaultProvider).toBe("gemini");
		expect(b.allowCostDowngrade).toBe(true);
		expect(b.downgradeTiers).toEqual(["S", "M", "L", "XL"]);
		expect(b.preserveQualityOnFailure).toBe(false);
	});

	it("quality: defaultProvider=claude-code, allowCostDowngrade=false", () => {
		const b = getProfileBehavior("quality");
		expect(b.defaultProvider).toBe("claude-code");
		expect(b.allowCostDowngrade).toBe(false);
		expect(b.downgradeTiers).toEqual([]);
		expect(b.preserveQualityOnFailure).toBe(true);
	});

	it("local-first: defaultProvider=ollama, providerOrder starts with ollama", () => {
		const b = getProfileBehavior("local-first");
		expect(b.defaultProvider).toBe("ollama");
		expect(b.providerOrder[0]).toBe("ollama");
	});

	it("fallback-heavy: defaultProvider=claude-code, providerOrder has all providers", () => {
		const b = getProfileBehavior("fallback-heavy");
		expect(b.defaultProvider).toBe("claude-code");
		expect(b.providerOrder).toContain("ollama");
		expect(b.providerOrder).toContain("gemini");
	});
});

// ---------------------------------------------------------------------------
// Primary provider selection
// ---------------------------------------------------------------------------

describe("selectPrimaryProvider", () => {
	it("honors explicit cliTool regardless of profile", () => {
		const result = selectPrimaryProvider("cheap", "claude-code");
		expect(result.provider).toBe("anthropic");
		expect(result.cliTool).toBe("claude-code");
		expect(result.decisionReason).toContain("explicit_tool");
	});

	it("balanced profile selects claude-code by default", () => {
		const result = selectPrimaryProvider("balanced");
		expect(result.provider).toBe("claude-code");
		expect(result.cliTool).toBe("claude-code");
	});

	it("cheap profile selects gemini by default", () => {
		const result = selectPrimaryProvider("cheap");
		expect(result.provider).toBe("gemini");
		expect(result.cliTool).toBe("gemini");
	});

	it("quality profile selects claude-code by default", () => {
		const result = selectPrimaryProvider("quality");
		expect(result.provider).toBe("claude-code");
		expect(result.cliTool).toBe("claude-code");
	});

	it("local-first profile selects ollama by default", () => {
		const result = selectPrimaryProvider("local-first");
		expect(result.provider).toBe("ollama");
		expect(result.cliTool).toBe("ollama");
	});

	it("maps codex to openai provider", () => {
		const result = selectPrimaryProvider("balanced", "codex");
		expect(result.provider).toBe("openai");
	});

	it("maps cursor to cursor provider", () => {
		const result = selectPrimaryProvider("balanced", "cursor");
		expect(result.provider).toBe("cursor");
	});

	it("maps gemini to gemini provider", () => {
		const result = selectPrimaryProvider("balanced", "gemini");
		expect(result.provider).toBe("gemini");
	});

	it("maps ollama to ollama provider", () => {
		const result = selectPrimaryProvider("balanced", "ollama");
		expect(result.provider).toBe("ollama");
	});
});

// ---------------------------------------------------------------------------
// Fallback chain generation
// ---------------------------------------------------------------------------

describe("getFallbackChain", () => {
	it("balanced: excludes primary, limits to 2 fallbacks", () => {
		const chain = getFallbackChain("balanced", "claude-code");
		expect(chain).not.toContain("claude-code");
		expect(chain.length).toBeLessThanOrEqual(2);
	});

	it("cheap: excludes primary, limits to 2 fallbacks", () => {
		const chain = getFallbackChain("cheap", "gemini");
		expect(chain).not.toContain("gemini");
		expect(chain.length).toBeLessThanOrEqual(2);
	});

	it("fallback-heavy: includes all remaining providers", () => {
		const chain = getFallbackChain("fallback-heavy", "claude-code");
		expect(chain).not.toContain("claude-code");
		expect(chain.length).toBeGreaterThanOrEqual(3);
	});

	it("local-first: ollama primary gives remote fallbacks", () => {
		const chain = getFallbackChain("local-first", "ollama");
		expect(chain).not.toContain("ollama");
		expect(chain.length).toBeGreaterThanOrEqual(1);
	});
});
