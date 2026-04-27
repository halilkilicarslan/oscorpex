// ---------------------------------------------------------------------------
// CursorAdapter Tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { CursorAdapter } from "../src/index.js";

const mockRunCLI = vi.fn();
const mockCheckBinaryAsync = vi.fn();

vi.mock("@oscorpex/provider-sdk", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		runCLI: (...args: unknown[]) => mockRunCLI(...args),
		checkBinaryAsync: (...args: unknown[]) => mockCheckBinaryAsync(...args),
	};
});

describe("CursorAdapter", () => {
	let adapter: CursorAdapter;

	beforeEach(() => {
		adapter = new CursorAdapter();
		vi.clearAllMocks();
	});

	it("has correct id", () => {
		expect(adapter.id).toBe("cursor");
	});

	it("reports correct capabilities", () => {
		const caps = adapter.capabilities();
		expect(caps.supportsCancel).toBe(false);
		expect(caps.supportsToolRestriction).toBe(false);
		expect(caps.supportedModels).toEqual(["cursor-large"]);
	});

	it("isAvailable uses 'cursor agent --version'", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true, version: "1.0.0" });
		expect(await adapter.isAvailable()).toBe(true);
		expect(mockCheckBinaryAsync).toHaveBeenCalledWith("cursor", ["agent", "--version"]);
	});

	it("health returns true when available", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true, version: "1.0.0" });
		const health = await adapter.health();
		expect(health.healthy).toBe(true);
		expect(health.message).toBe("1.0.0");
	});

	it("health returns false when unavailable", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: false, error: "ENOENT" });
		const health = await adapter.health();
		expect(health.healthy).toBe(false);
	});

	it("execute throws ProviderUnavailableError when binary missing", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: false });
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "cursor",
				repoPath: "/tmp",
				prompt: "hello",
				timeoutMs: 5000,
			}),
		).rejects.toThrow("not found");
	});

	it("execute throws when tool restriction requested", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "cursor",
				repoPath: "/tmp",
				prompt: "hello",
				timeoutMs: 5000,
				allowedTools: ["Read"],
			}),
		).rejects.toThrow("cannot honor restricted tool policies");
	});

	it("execute returns normalized result on success", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		mockRunCLI.mockResolvedValue({
			exitCode: 0,
			signal: null,
			stdout: '{"result":"cursor output","usage":{"input_tokens":5,"output_tokens":10}}',
			stderr: "",
			durationMs: 2000,
			killedByTimeout: false,
			killedBySignal: false,
		});

		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "cursor",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
			model: "cursor-large",
		});

		expect(result.provider).toBe("cursor");
		expect(result.model).toBe("cursor-large");
		expect(result.text).toBe("cursor output");
		expect(result.usage?.inputTokens).toBe(5);
		expect(result.usage?.outputTokens).toBe(10);
		expect(result.usage?.billedCostUsd).toBe(0);
		expect(result.metadata?.durationMs).toBe(2000);
	});

	it("execute falls back to raw stdout on non-JSON", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		mockRunCLI.mockResolvedValue({
			exitCode: 0,
			signal: null,
			stdout: "plain text",
			stderr: "warn line",
			durationMs: 500,
			killedByTimeout: false,
			killedBySignal: false,
		});

		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "cursor",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		expect(result.text).toBe("plain text");
		expect(result.logs).toEqual(["warn line"]);
	});

	it("execute throws ProviderTimeoutError on timeout", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		mockRunCLI.mockResolvedValue({
			exitCode: null,
			signal: "SIGKILL",
			stdout: "",
			stderr: "",
			durationMs: 120_000,
			killedByTimeout: true,
			killedBySignal: false,
		});

		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "cursor",
				repoPath: "/tmp",
				prompt: "hello",
				timeoutMs: 120_000,
			}),
		).rejects.toThrow("timed out");
	});

	it("execute throws ProviderExecutionError on non-zero exit", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		mockRunCLI.mockResolvedValue({
			exitCode: 1,
			signal: null,
			stdout: "",
			stderr: "cursor error",
			durationMs: 1000,
			killedByTimeout: false,
			killedBySignal: false,
		});

		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "cursor",
				repoPath: "/tmp",
				prompt: "hello",
				timeoutMs: 5000,
			}),
		).rejects.toThrow("exited with code 1");
	});

	it("cancel is no-op", async () => {
		await expect(adapter.cancel({ runId: "r1", taskId: "t1" })).resolves.toBeUndefined();
	});
});
