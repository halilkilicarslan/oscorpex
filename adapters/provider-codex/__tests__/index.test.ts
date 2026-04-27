// ---------------------------------------------------------------------------
// CodexAdapter Tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { CodexAdapter } from "../src/index.js";

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

describe("CodexAdapter", () => {
	let adapter: CodexAdapter;

	beforeEach(() => {
		adapter = new CodexAdapter();
		vi.clearAllMocks();
	});

	it("has correct id", () => {
		expect(adapter.id).toBe("codex");
	});

	it("reports correct capabilities", () => {
		const caps = adapter.capabilities();
		expect(caps.supportsCancel).toBe(false);
		expect(caps.supportsToolRestriction).toBe(false);
		expect(caps.supportedModels).toContain("gpt-4o");
		expect(caps.supportedModels).toContain("o3-mini");
	});

	it("isAvailable delegates to checkBinaryAsync", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true, version: "2.0.0" });
		expect(await adapter.isAvailable()).toBe(true);
		expect(mockCheckBinaryAsync).toHaveBeenCalledWith("codex", ["--version"]);
	});

	it("health returns true when available", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true, version: "2.0.0" });
		const health = await adapter.health();
		expect(health.healthy).toBe(true);
		expect(health.message).toBe("2.0.0");
	});

	it("health returns false when unavailable", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: false, error: "ENOENT" });
		const health = await adapter.health();
		expect(health.healthy).toBe(false);
		expect(health.message).toContain("ENOENT");
	});

	it("execute throws ProviderUnavailableError when binary missing", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: false });
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "codex",
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
				provider: "codex",
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
			stdout: '{"output":"result text","usage":{"prompt_tokens":10,"completion_tokens":20}}',
			stderr: "",
			durationMs: 1500,
			killedByTimeout: false,
			killedBySignal: false,
		});

		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "codex",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
			model: "gpt-4o",
		});

		expect(result.provider).toBe("codex");
		expect(result.model).toBe("gpt-4o");
		expect(result.text).toBe("result text");
		expect(result.usage?.inputTokens).toBe(10);
		expect(result.usage?.outputTokens).toBe(20);
		expect(result.metadata?.durationMs).toBe(1500);
		expect(result.startedAt).toBeDefined();
		expect(result.completedAt).toBeDefined();
	});

	it("execute falls back to raw stdout on non-JSON", async () => {
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		mockRunCLI.mockResolvedValue({
			exitCode: 0,
			signal: null,
			stdout: "plain text output",
			stderr: "",
			durationMs: 800,
			killedByTimeout: false,
			killedBySignal: false,
		});

		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "codex",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		expect(result.text).toBe("plain text output");
		expect(result.usage?.inputTokens).toBe(0);
		expect(result.usage?.outputTokens).toBe(0);
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
				provider: "codex",
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
			stderr: "something went wrong",
			durationMs: 1000,
			killedByTimeout: false,
			killedBySignal: false,
		});

		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "codex",
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
