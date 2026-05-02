// ---------------------------------------------------------------------------
// Tests — Fallback Decision Motor (TASK 5)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getFallbackSeverity,
	markProviderUnavailable,
	shouldSkipProvider,
	sortAdapterChain,
} from "../fallback-decision.js";
import { providerRuntimeCache } from "../provider-runtime-cache.js";
import { providerState } from "../provider-state.js";

vi.mock("../provider-runtime-cache.js", () => ({
	providerRuntimeCache: {
		resolveCapability: vi.fn(),
	},
}));

vi.mock("../provider-state.js", () => ({
	providerState: {
		isAvailable: vi.fn().mockReturnValue(true),
		markRateLimited: vi.fn(),
		markCooldown: vi.fn(),
	},
}));

function makeAdapter(name: string, caps?: Record<string, unknown>) {
	return {
		name,
		isAvailable: vi.fn().mockResolvedValue(true),
		capabilities: vi.fn().mockResolvedValue(
			caps ?? {
				supportedModels: ["model-1"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			},
		),
		execute: vi.fn(),
	};
}

describe("getFallbackSeverity", () => {
	it("returns highest severity for tool_restriction_unsupported", () => {
		expect(getFallbackSeverity("tool_restriction_unsupported")).toBe(100);
	});

	it("returns lowest severity for unknown", () => {
		expect(getFallbackSeverity("unknown")).toBe(20);
	});

	it("returns moderate severity for timeout", () => {
		expect(getFallbackSeverity("timeout")).toBe(60);
	});
});

describe("shouldSkipProvider", () => {
	beforeEach(() => {
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(true);
	});

	it("skips provider that does not support tool restriction when tools are restricted", async () => {
		const adapter = makeAdapter("codex", {
			supportedModels: ["gpt-4o"],
			supportsToolRestriction: false,
		});
		vi.mocked(providerRuntimeCache.resolveCapability).mockResolvedValue({
			supportedModels: ["gpt-4o"],
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: false,
		});

		const result = await shouldSkipProvider(adapter, {
			allowedTools: ["Read", "Edit"],
		});
		expect(result.shouldSkip).toBe(true);
		expect(result.reason).toBe("tool_restriction_unsupported");
	});

	it("does not skip provider with full tool access even if restriction unsupported", async () => {
		const adapter = makeAdapter("codex", {
			supportedModels: ["gpt-4o"],
			supportsToolRestriction: false,
		});
		vi.mocked(providerRuntimeCache.resolveCapability).mockResolvedValue({
			supportedModels: ["gpt-4o"],
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: false,
		});

		const result = await shouldSkipProvider(adapter, {
			allowedTools: ["Read", "Edit", "Glob", "Grep", "Bash", "Write", "Replace"],
		});
		expect(result.shouldSkip).toBe(false);
	});

	it("skips same provider after timeout", async () => {
		const adapter = makeAdapter("claude-code");
		const result = await shouldSkipProvider(adapter, {
			lastFailureProvider: "claude-code",
			lastFailureClassification: "timeout",
		});
		expect(result.shouldSkip).toBe(true);
		expect(result.reason).toBe("timeout_retry_avoided");
	});

	it("does not skip different provider after timeout", async () => {
		const adapter = makeAdapter("cursor");
		const result = await shouldSkipProvider(adapter, {
			lastFailureProvider: "claude-code",
			lastFailureClassification: "timeout",
		});
		expect(result.shouldSkip).toBe(false);
	});

	it("skips provider in cooldown", async () => {
		const adapter = makeAdapter("claude-code");
		vi.mocked(providerState.isAvailable).mockReturnValue(false);
		const result = await shouldSkipProvider(adapter, {});
		expect(result.shouldSkip).toBe(true);
		expect(result.reason).toBe("cooldown_active");
	});

	it("does not skip compatible provider with no restrictions", async () => {
		const adapter = makeAdapter("claude-code");
		vi.mocked(providerRuntimeCache.resolveCapability).mockResolvedValue({
			supportedModels: ["claude-sonnet-4-6"],
			supportsToolRestriction: true,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: false,
			supportsSandboxHinting: true,
		});

		const result = await shouldSkipProvider(adapter, {});
		expect(result.shouldSkip).toBe(false);
	});
});

describe("sortAdapterChain", () => {
	it("places available provider with high success rate first", () => {
		const adapters = [makeAdapter("codex"), makeAdapter("claude-code"), makeAdapter("cursor")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name !== "cursor");

		const sorted = sortAdapterChain(adapters, (id) => {
			if (id === "claude-code") return { successRate: 0.9, avgLatencyMs: 500 };
			if (id === "codex") return { successRate: 0.5, avgLatencyMs: 1000 };
			return undefined;
		});

		expect(sorted[0]!.name).toBe("claude-code");
		expect(sorted[1]!.name).toBe("codex");
		expect(sorted[2]!.name).toBe("cursor");
	});

	it("penalizes unavailable providers", () => {
		const adapters = [makeAdapter("cursor"), makeAdapter("claude-code")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name === "claude-code");

		const sorted = sortAdapterChain(adapters, () => ({ successRate: 0.5, avgLatencyMs: 1000 }));

		expect(sorted[0]!.name).toBe("claude-code");
		expect(sorted[1]!.name).toBe("cursor");
	});
});

describe("markProviderUnavailable", () => {
	it("calls providerState.markCooldown with unavailable trigger", () => {
		markProviderUnavailable("codex");
		expect(providerState.markCooldown).toHaveBeenCalledWith("codex", "unavailable");
	});
});
