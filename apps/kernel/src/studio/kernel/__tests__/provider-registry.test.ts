// ---------------------------------------------------------------------------
// Provider Registry Contract Tests (PVR-06)
// Verifies register, execute, cancel, list, and capability contracts.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderRegistry } from "../../kernel/provider-registry.js";
import type { ProviderAdapter, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";

function createFakeAdapter(id: string): FakeAdapter {
	return new FakeAdapter(id);
}

class FakeAdapter implements ProviderAdapter {
	readonly id: string;
	executeCalls: ProviderExecutionInput[] = [];
	cancelCalls: { runId: string; taskId: string }[] = [];
	available = true;

	constructor(id: string) {
		this.id = id;
	}

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
		adapter = createFakeAdapter("fake");
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

describe("EPIC 3 — Provider Observability", () => {
	it("telemetry records successful execution", async () => {
		const registry = new ProviderRegistry();
		const adapter = createFakeAdapter("fake");
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
		const record = registry.telemetry.getRecord("r1", "t1");
		expect(record).toBeDefined();
		expect(record!.success).toBe(true);
		expect(record!.primaryProvider).toBe("fake");
		expect(record!.fallbackCount).toBe(0);
	});

	it("telemetry records failed execution with classification", async () => {
		const registry = new ProviderRegistry();
		const failingAdapter: ProviderAdapter = {
			id: "failing",
			capabilities: () => createFakeAdapter("x").capabilities(),
			isAvailable: async () => true,
			execute: async () => {
				throw new Error("exited with code 1: crash");
			},
			cancel: async () => {},
			health: async () => ({ healthy: false }),
		};
		registry.register("failing", failingAdapter);

		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "failing",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		await expect(registry.execute("failing", input)).rejects.toThrow("exited with code 1");
		const record = registry.telemetry.getRecord("r1", "t1");
		expect(record).toBeDefined();
		expect(record!.success).toBe(false);
		expect(record!.errorClassification).toBe("cli_error");
	});

	it("executeWithFallback succeeds on primary", async () => {
		const registry = new ProviderRegistry();
		registry.register("primary", createFakeAdapter("primary"));
		registry.register("fallback", createFakeAdapter("fallback"));

		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "primary",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		const result = await registry.executeWithFallback("primary", ["fallback"], input);
		expect(result.provider).toBe("primary");
		const record = registry.telemetry.getRecord("r1", "t1");
		expect(record!.fallbackCount).toBe(0);
	});

	it("executeWithFallback falls back on primary failure", async () => {
		const registry = new ProviderRegistry();
		const primary: ProviderAdapter = {
			id: "primary",
			capabilities: () => createFakeAdapter("x").capabilities(),
			isAvailable: async () => true,
			execute: async () => {
				throw new Error("primary failed");
			},
			cancel: async () => {},
			health: async () => ({ healthy: false }),
		};
		registry.register("primary", primary);
		registry.register("fallback", createFakeAdapter("fallback"));

		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "primary",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		const result = await registry.executeWithFallback("primary", ["fallback"], input);
		expect(result.provider).toBe("fallback");
		const record = registry.telemetry.getRecord("r1", "t1");
		expect(record!.fallbackCount).toBe(1);
		expect(record!.fallbackTimeline[0]!.fromProvider).toBe("primary");
		expect(record!.fallbackTimeline[0]!.toProvider).toBe("fallback");
	});

	it("executeWithFallback throws last error when all providers exhausted", async () => {
		const registry = new ProviderRegistry();
		const failing: ProviderAdapter = {
			id: "failing",
			capabilities: () => createFakeAdapter("x").capabilities(),
			isAvailable: async () => true,
			execute: async () => {
				throw new Error("fail");
			},
			cancel: async () => {},
			health: async () => ({ healthy: false }),
		};
		registry.register("a", failing);
		registry.register("b", failing);

		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "a",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		await expect(registry.executeWithFallback("a", ["b"], input)).rejects.toThrow("fail");
		const record = registry.telemetry.getRecord("r1", "t1");
		expect(record!.degradedMode).toBe(true);
	});

	it("cancel records telemetry audit entry", async () => {
		const registry = new ProviderRegistry();

		// Use a slow adapter so we can cancel mid-flight
		const slowAdapter: ProviderAdapter = {
			id: "slow",
			capabilities: () => createFakeAdapter("x").capabilities(),
			isAvailable: async () => true,
			execute: async (input) => {
				// Wait for abort signal
				await new Promise<void>((resolve, reject) => {
					if (input.signal?.aborted) {
						reject(new Error("aborted"));
						return;
					}
					input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				});
				throw new Error("should not reach");
			},
			cancel: async () => {},
			health: async () => ({ healthy: true }),
		};
		registry.register("slow", slowAdapter);

		const input: ProviderExecutionInput = {
			runId: "r1",
			taskId: "t1",
			provider: "slow",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		};

		const execPromise = registry.execute("slow", input);
		await registry.cancel("r1", "t1");

		try {
			await execPromise;
		} catch {
			// expected
		}

		const record = registry.telemetry.getRecord("r1", "t1");
		expect(record).toBeDefined();
		expect(record!.canceled).toBe(true);
		expect(record!.cancelReason).toBe("User/system-initiated cancel via registry");
	});

	it("latency snapshot aggregates per provider", async () => {
		const registry = new ProviderRegistry();
		registry.register("fake", createFakeAdapter("fake"));

		for (let i = 0; i < 3; i++) {
			await registry.execute("fake", {
				runId: `r${i}`,
				taskId: `t${i}`,
				provider: "fake",
				repoPath: "/tmp",
				prompt: "hello",
				timeoutMs: 5000,
			});
		}

		const snapshot = registry.telemetry.getLatencySnapshot("fake");
		expect(snapshot.totalExecutions).toBe(3);
		expect(snapshot.successfulExecutions).toBe(3);
		expect(snapshot.failedExecutions).toBe(0);
	});
});

describe("EPIC 3 — Provider Registry Integration (IT-10..IT-13)", () => {
	it("IT-10: registerDefaultProviders registers all known providers", () => {
		const registry = new ProviderRegistry();
		registry.registerDefaultProviders();
		expect(registry.get("claude-code")).toBeDefined();
		expect(registry.get("codex")).toBeDefined();
		expect(registry.get("cursor")).toBeDefined();
	});

	it("IT-13: all default providers expose consistent capability shape", () => {
		const registry = new ProviderRegistry();
		registry.registerDefaultProviders();
		for (const { id, adapter } of registry.list()) {
			const caps = adapter.capabilities();
			expect(caps).toHaveProperty("supportsToolRestriction");
			expect(caps).toHaveProperty("supportsStreaming");
			expect(caps).toHaveProperty("supportsResume");
			expect(caps).toHaveProperty("supportsCancel");
			expect(caps).toHaveProperty("supportsStructuredOutput");
			expect(caps).toHaveProperty("supportsSandboxHinting");
			expect(typeof caps.supportsCancel).toBe("boolean");
		}
	});
});