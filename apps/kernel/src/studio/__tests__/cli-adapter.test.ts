import { describe, expect, it, vi } from "vitest";
import { ClaudeAdapter, CodexAdapter, CursorAdapter, buildToolGovernanceSection, getAdapter } from "../cli-adapter.js";

vi.mock("../cli-runtime.js", () => ({
	isClaudeCliAvailable: vi.fn().mockResolvedValue(true),
	executeWithCLI: vi.fn().mockResolvedValue({
		text: "done",
		filesCreated: [],
		filesModified: [],
		logs: [],
		inputTokens: 10,
		outputTokens: 5,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		totalCostUsd: 0.001,
		durationMs: 500,
		model: "claude-sonnet-4-6",
	}),
}));

describe("CLI Adapter (Faz 4.1)", () => {
	describe("ClaudeAdapter", () => {
		const adapter = new ClaudeAdapter();

		it('should have name "claude-code"', () => {
			expect(adapter.name).toBe("claude-code");
		});

		it("should delegate isAvailable to isClaudeCliAvailable", async () => {
			expect(await adapter.isAvailable()).toBe(true);
		});

		it("should delegate execute to executeWithCLI", async () => {
			const result = await adapter.execute({
				projectId: "p1",
				agentId: "a1",
				agentName: "Test",
				repoPath: "/tmp",
				prompt: "hello",
				systemPrompt: "sys",
				timeoutMs: 5000,
			});
			expect(result.text).toBe("done");
		});
	});

	describe("CodexAdapter", () => {
		const adapter = new CodexAdapter();

		it('should have name "codex"', () => {
			expect(adapter.name).toBe("codex");
		});

		// isAvailable and execute are tested in multi-provider.test.ts with proper spawn mocks
	});

	describe("CursorAdapter", () => {
		const adapter = new CursorAdapter();

		it('should have name "cursor"', () => {
			expect(adapter.name).toBe("cursor");
		});
	});

	describe("getAdapter", () => {
		it('should return ClaudeAdapter for "claude-code"', async () => {
			const adapter = await getAdapter("claude-code");
			expect(adapter.name).toBe("claude-code");
		});

		it('should return CodexAdapter for "codex"', async () => {
			const adapter = await getAdapter("codex");
			expect(adapter.name).toBe("codex");
		});

		it('should return CursorAdapter for "cursor"', async () => {
			const adapter = await getAdapter("cursor");
			expect(adapter.name).toBe("cursor");
		});

		it('should fallback to ClaudeAdapter for "none"', async () => {
			const adapter = await getAdapter("none");
			expect(adapter.name).toBe("claude-code");
		});
	});

	describe("buildToolGovernanceSection", () => {
		it("returns empty string when no allowed tools are provided", () => {
			expect(buildToolGovernanceSection()).toBe("");
			expect(buildToolGovernanceSection([])).toBe("");
		});

		it("renders a restrictive tool list when allowed tools are provided", () => {
			const text = buildToolGovernanceSection(["Read", "Write"]);
			expect(text).toContain("Tool Governance");
			expect(text).toContain("Read, Write");
		});
	});
});
