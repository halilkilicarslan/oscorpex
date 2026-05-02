// ---------------------------------------------------------------------------
// Legacy CLI Adapter Deprecation Boundary Tests (P1 E5)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdapter, getAdapterChain } from "../cli-adapter.js";

// Mock performance-config so we can toggle legacyCliAdapter
vi.mock("../performance-config.js", async () => {
	const actual = await vi.importActual<typeof import("../performance-config.js")>("../performance-config.js");
	return {
		...actual,
		getFeatureFlags: vi.fn().mockReturnValue({
			adaptiveConcurrency: true,
			fairScheduling: true,
			fallbackDecisionMotor: true,
			retryPolicy: true,
			providerRuntimeCache: true,
			providerHealthCache: true,
			costAwareModelSelection: true,
			preflightWarmup: true,
			providerCooldown: true,
			timeoutPolicy: true,
			queueWaitTelemetry: true,
			legacyCliAdapter: true,
		}),
	};
});

describe("E5: Legacy CLI Adapter Deprecation Boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		// Reset to default (enabled)
		const { getFeatureFlags } = await import("../performance-config.js");
		vi.mocked(getFeatureFlags).mockReturnValue({
			adaptiveConcurrency: true,
			fairScheduling: true,
			fallbackDecisionMotor: true,
			retryPolicy: true,
			providerRuntimeCache: true,
			providerHealthCache: true,
			costAwareModelSelection: true,
			preflightWarmup: true,
			providerCooldown: true,
			timeoutPolicy: true,
			queueWaitTelemetry: true,
			legacyCliAdapter: true,
		});
	});

	it("returns legacy adapter when registry missing and legacyCliAdapter=true", async () => {
		const adapter = await getAdapter("claude-code");
		expect(adapter.name).toBe("claude-code");
	});

	it("returns legacy adapter for unknown tool when legacyCliAdapter=true", async () => {
		const adapter = await getAdapter("none" as any);
		expect(adapter.name).toBe("claude-code");
	});

	it("throws when registry missing and legacyCliAdapter=false", async () => {
		const { getFeatureFlags } = await import("../performance-config.js");
		vi.mocked(getFeatureFlags).mockReturnValue({
			adaptiveConcurrency: true,
			fairScheduling: true,
			fallbackDecisionMotor: true,
			retryPolicy: true,
			providerRuntimeCache: true,
			providerHealthCache: true,
			costAwareModelSelection: true,
			preflightWarmup: true,
			providerCooldown: true,
			timeoutPolicy: true,
			queueWaitTelemetry: true,
			legacyCliAdapter: false,
		});

		await expect(getAdapter("claude-code")).rejects.toThrow("Legacy CLI adapter fallback is disabled");
	});

	it("throws for unknown tool when legacyCliAdapter=false", async () => {
		const { getFeatureFlags } = await import("../performance-config.js");
		vi.mocked(getFeatureFlags).mockReturnValue({
			adaptiveConcurrency: true,
			fairScheduling: true,
			fallbackDecisionMotor: true,
			retryPolicy: true,
			providerRuntimeCache: true,
			providerHealthCache: true,
			costAwareModelSelection: true,
			preflightWarmup: true,
			providerCooldown: true,
			timeoutPolicy: true,
			queueWaitTelemetry: true,
			legacyCliAdapter: false,
		});

		await expect(getAdapter("none" as any)).rejects.toThrow("Legacy CLI adapter fallback is disabled");
	});

	it("getAdapterChain falls back to legacy for each item when registry missing", async () => {
		const chain = await getAdapterChain("claude-code", ["codex", "cursor"]);
		expect(chain).toHaveLength(3);
		expect(chain[0]!.name).toBe("claude-code");
		expect(chain[1]!.name).toBe("codex");
		expect(chain[2]!.name).toBe("cursor");
	});

	it("getAdapterChain deduplicates primary from fallbacks", async () => {
		const chain = await getAdapterChain("claude-code", ["claude-code", "cursor"]);
		expect(chain).toHaveLength(2);
		expect(chain[0]!.name).toBe("claude-code");
		expect(chain[1]!.name).toBe("cursor");
	});
});
