import { describe, expect, it, vi } from "vitest";
import { AiderAdapter, ClaudeAdapter, CodexAdapter, getAdapter } from "../cli-adapter.js";

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

		it("should not be available", async () => {
			expect(await adapter.isAvailable()).toBe(false);
		});

		it("should throw on execute", async () => {
			await expect(
				adapter.execute({
					projectId: "p1",
					agentId: "a1",
					agentName: "Test",
					repoPath: "/tmp",
					prompt: "hello",
					systemPrompt: "sys",
					timeoutMs: 5000,
				}),
			).rejects.toThrow("not yet implemented");
		});
	});

	describe("AiderAdapter", () => {
		const adapter = new AiderAdapter();

		it('should have name "aider"', () => {
			expect(adapter.name).toBe("aider");
		});

		it("should not be available", async () => {
			expect(await adapter.isAvailable()).toBe(false);
		});
	});

	describe("getAdapter", () => {
		it('should return ClaudeAdapter for "claude-code"', () => {
			expect(getAdapter("claude-code").name).toBe("claude-code");
		});

		it('should return CodexAdapter for "codex"', () => {
			expect(getAdapter("codex").name).toBe("codex");
		});

		it('should return AiderAdapter for "aider"', () => {
			expect(getAdapter("aider").name).toBe("aider");
		});

		it('should fallback to ClaudeAdapter for "none"', () => {
			expect(getAdapter("none").name).toBe("claude-code");
		});
	});
});
