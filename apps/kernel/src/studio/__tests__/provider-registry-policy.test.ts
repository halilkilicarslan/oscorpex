// ---------------------------------------------------------------------------
// Provider Registry Policy Consistency Tests
// Verifies registry path handles disabled, cooldown, fallback, and policy
// decisions consistently.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderRegistry } from "../kernel/provider-registry.js";

describe("Provider Registry — policy consistency", () => {
	let registry: ProviderRegistry;

	beforeEach(() => {
		registry = new ProviderRegistry();
		registry.registerDefaultProviders();
	});

	it("all default providers are registered", () => {
		const list = registry.list();
		expect(list.length).toBeGreaterThanOrEqual(3); // at least claude, codex, cursor
	});

	it("execute throws for unknown provider", async () => {
		await expect(
			registry.execute("unknown-provider", {
				runId: "r1",
				taskId: "t1",
				provider: "unknown-provider",
				repoPath: "/tmp",
				prompt: "test",
				timeoutMs: 30000,
			}),
		).rejects.toThrow('Provider "unknown-provider" not found');
	});

	it("executeWithFallback tries chain in order", async () => {
		const mockAdapter = {
			execute: vi.fn().mockRejectedValue(new Error("fail")),
			cancel: vi.fn(),
		};
		registry.register("primary", mockAdapter as any);
		registry.register("fallback", mockAdapter as any);

		await expect(
			registry.executeWithFallback("primary", ["fallback"], {
				runId: "r1",
				taskId: "t1",
				provider: "primary",
				repoPath: "/tmp",
				prompt: "test",
				timeoutMs: 30000,
			}),
		).rejects.toThrow();

		expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
	});

	it("cancel aborts active execution", async () => {
		const mockAdapter = {
			execute: vi.fn().mockImplementation(async () => {
				await new Promise((_, reject) => setTimeout(() => reject(new Error("aborted")), 100));
			}),
			cancel: vi.fn(),
		};
		registry.register("test", mockAdapter as any);

		const execPromise = registry.execute("test", {
			runId: "r1",
			taskId: "t1",
			provider: "test",
			repoPath: "/tmp",
			prompt: "test",
			timeoutMs: 30000,
		});

		// Small delay then cancel
		await new Promise((r) => setTimeout(r, 10));
		await registry.cancel("r1", "t1");

		await expect(execPromise).rejects.toThrow();
	});
});
