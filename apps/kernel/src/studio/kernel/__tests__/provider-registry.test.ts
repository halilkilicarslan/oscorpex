// ---------------------------------------------------------------------------
// Provider Registry Contract Tests (PVR-06)
// Verifies register, execute, cancel, list, and capability contracts.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderRegistry } from "../../kernel/provider-registry.js";
import type { ProviderAdapter, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";

class FakeAdapter implements ProviderAdapter {
	readonly id = "fake";
	executeCalls: ProviderExecutionInput[] = [];
	cancelCalls: { runId: string; taskId: string }[] = [];
	available = true;

	capabilities() {
		return {
			supportsToolRestriction: true,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: false,
			supportsSandboxHinting: false,
			supportedModels: ["fake-model"],
		};
	}

	async isAvailable(): Promise<boolean> {
		return this.available;
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		this.executeCalls.push(input);
		return {
			provider: this.id,
			model: input.model,
			text: "fake output",
			filesCreated: [],
			filesModified: [],
			logs: [],
			usage: { inputTokens: 10, outputTokens: 20, billedCostUsd: 0.001 },
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		};
	}

	async cancel(input: { runId: string; taskId: string }): Promise<void> {
		this.cancelCalls.push(input);
	}

	async health(): Promise<{ healthy: boolean }> {
		return { healthy: this.available };
	}
}

describe("ProviderRegistry contract", () => {
	let registry: ProviderRegistry;
	let adapter: FakeAdapter;

	beforeEach(() => {
		registry = new ProviderRegistry();
		adapter = new FakeAdapter();
	});

	it("registers and retrieves an adapter", () => {
		registry.register("fake", adapter);
		expect(registry.get("fake")).toBe(adapter);
	});

	it("lists registered adapters", () => {
		registry.register("fake", adapter);
		const list = registry.list();
		expect(list).toHaveLength(1);
		expect(list[0]!.id).toBe("fake");
	});

	it("executes through the adapter with signal injection", async () => {
		registry.register("fake", adapter);
		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "fake",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
			model: "fake-model",
		};

		const result = await registry.execute("fake", input);
		expect(result.provider).toBe("fake");
		expect(result.text).toBe("fake output");
		expect(adapter.executeCalls).toHaveLength(1);
		expect(adapter.executeCalls[0]!.signal).toBeDefined();
	});

	it("throws when executing unknown provider", async () => {
		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "unknown",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};
		await expect(registry.execute("unknown", input)).rejects.toThrow('Provider "unknown" not found');
	});

	it("cancels active execution and propagates to adapter", async () => {
		registry.register("fake", adapter);
		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "fake",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		// Start execution (don't await so we can cancel)
		const execPromise = registry.execute("fake", input);

		// Cancel immediately
		await registry.cancel("r1", "t1");

		// Execution may succeed or fail depending on timing; either is fine
		try {
			await execPromise;
		} catch {
			// expected if signal aborted before adapter completes
		}

		expect(adapter.cancelCalls).toHaveLength(1);
		expect(adapter.cancelCalls[0]).toEqual({ runId: "r1", taskId: "t1" });
	});

	it("does not throw when canceling non-active execution", async () => {
		registry.register("fake", adapter);
		await expect(registry.cancel("r1", "t99")).resolves.toBeUndefined();
	});

	it("removes controller after execution completes", async () => {
		registry.register("fake", adapter);
		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "fake",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		await registry.execute("fake", input);
		// After execution, cancel still propagates to all adapters for cleanup
		await registry.cancel("r1", "t1");
		expect(adapter.cancelCalls).toHaveLength(1);
		expect(adapter.cancelCalls[0]).toEqual({ runId: "r1", taskId: "t1" });
	});

	it("reports adapter capabilities correctly", () => {
		registry.register("fake", adapter);
		const retrieved = registry.get("fake");
		expect(retrieved!.capabilities().supportsCancel).toBe(true);
		expect(retrieved!.capabilities().supportedModels).toContain("fake-model");
	});

	it("registerDefaultProviders registers native adapters without legacy", () => {
		registry.registerDefaultProviders();
		expect(registry.get("claude-code")).toBeDefined();
		expect(registry.get("codex")).toBeDefined();
		expect(registry.get("cursor")).toBeDefined();
	});

	it("execution result includes duration metadata", async () => {
		registry.register("fake", adapter);
		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "fake",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		const result = await registry.execute("fake", input);
		expect(result.startedAt).toBeDefined();
		expect(result.completedAt).toBeDefined();
		expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(new Date(result.startedAt).getTime());
	});
});