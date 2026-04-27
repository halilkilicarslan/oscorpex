// ---------------------------------------------------------------------------
// Tests — Gemini Adapter (EPIC 1)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiAdapter } from "../index.js";
import { healthCache } from "@oscorpex/provider-sdk";

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
	execFile: vi.fn((...args: any[]) => {
		const cb = args.find((a) => typeof a === "function");
		if (cb) cb(null, "", "");
	}),
	spawn: vi.fn(),
}));

import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";

const mockExecFile = vi.mocked(childProcess.execFile);
const mockSpawn = vi.mocked(childProcess.spawn);

beforeEach(() => {
	healthCache.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function makeMockProc(exitCode = 0, stdout = "", stderr = "") {
	const proc = new EventEmitter() as any;
	proc.stdin = { write: vi.fn(), end: vi.fn() };
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();

	setTimeout(() => {
		proc.stdout.emit("data", Buffer.from(stdout));
		if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
		proc.emit("close", exitCode);
	}, 10);

	return proc;
}

// ---------------------------------------------------------------------------
// Adapter identity
// ---------------------------------------------------------------------------

describe("GeminiAdapter identity", () => {
	it("has id 'gemini'", () => {
		const adapter = new GeminiAdapter();
		expect(adapter.id).toBe("gemini");
	});
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe("GeminiAdapter.capabilities", () => {
	it("returns expected capability flags", () => {
		const adapter = new GeminiAdapter();
		const caps = adapter.capabilities();
		expect(caps.supportsToolRestriction).toBe(false);
		expect(caps.supportsStreaming).toBe(true);
		expect(caps.supportsResume).toBe(false);
		expect(caps.supportsCancel).toBe(true);
		expect(caps.supportsStructuredOutput).toBe(true);
		expect(caps.supportsSandboxHinting).toBe(false);
		expect(caps.supportedModels).toEqual([
			"gemini-1.5-pro",
			"gemini-1.5-flash",
			"gemini-2.0-flash",
		]);
	});
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe("GeminiAdapter.isAvailable", () => {
	it("returns true when gemini binary is found", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});
		const adapter = new GeminiAdapter();
		expect(await adapter.isAvailable()).toBe(true);
	});

	it("returns false when gemini binary is not found", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(new Error("not found"), "", "");
			return undefined as any;
		});
		const adapter = new GeminiAdapter();
		expect(await adapter.isAvailable()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe("GeminiAdapter.health", () => {
	it("returns healthy when binary is available", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});
		const adapter = new GeminiAdapter();
		const health = await adapter.health();
		expect(health.healthy).toBe(true);
		expect(health.message).toContain("gemini 1.0.0");
	});

	it("returns unhealthy when binary is missing", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(new Error("command not found"), "", "");
			return undefined as any;
		});
		const adapter = new GeminiAdapter();
		const health = await adapter.health();
		expect(health.healthy).toBe(false);
		expect(health.message).toContain("not found");
	});
});

// ---------------------------------------------------------------------------
// execute shape
// ---------------------------------------------------------------------------

describe("GeminiAdapter.execute", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves with parsed JSON output when gemini returns JSON", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});

		const jsonOutput = JSON.stringify({
			text: "Task completed successfully",
			usage: { input_tokens: 120, output_tokens: 60 },
		});
		mockSpawn.mockReturnValueOnce(makeMockProc(0, jsonOutput) as any);

		const adapter = new GeminiAdapter();
		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "gemini",
			repoPath: "/tmp/repo",
			prompt: "Implement the feature",
			systemPrompt: "You are a helpful assistant",
			timeoutMs: 30_000,
		});

		expect(result.text).toBe("Task completed successfully");
		expect(result.provider).toBe("gemini");
		expect(result.model).toBe("gemini-1.5-flash");
		expect(result.usage?.inputTokens).toBe(120);
		expect(result.usage?.outputTokens).toBe(60);
		expect(result.filesCreated).toEqual([]);
		expect(result.filesModified).toEqual([]);
		expect(result.startedAt).toBeDefined();
		expect(result.completedAt).toBeDefined();
		expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("resolves with raw text when gemini returns plain text", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});

		mockSpawn.mockReturnValueOnce(makeMockProc(0, "plain text output") as any);

		const adapter = new GeminiAdapter();
		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "gemini",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 30_000,
		});

		expect(result.text).toBe("plain text output");
		expect(result.usage?.inputTokens).toBe(0);
		expect(result.usage?.outputTokens).toBe(0);
	});

	it("uses the requested model", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});

		mockSpawn.mockReturnValueOnce(
			makeMockProc(
				0,
				JSON.stringify({
					text: "ok",
					usage: { input_tokens: 10, output_tokens: 5 },
				}),
			) as any,
		);

		const adapter = new GeminiAdapter();
		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "gemini",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 30_000,
			model: "gemini-1.5-pro",
		});

		expect(result.model).toBe("gemini-1.5-pro");
	});
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("GeminiAdapter.execute timeout", () => {
	it("throws ProviderTimeoutError when killed by timeout", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});

		const proc = new EventEmitter() as any;
		proc.stdin = { write: vi.fn(), end: vi.fn() };
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();
		proc.kill = vi.fn(() => {
			setTimeout(() => proc.emit("close", null, "SIGKILL"), 10);
		});

		mockSpawn.mockReturnValueOnce(proc);

		const adapter = new GeminiAdapter();
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "gemini",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 50,
			}),
		).rejects.toThrow("timed out");
	}, 10_000);
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe("GeminiAdapter.execute errors", () => {
	it("throws ProviderUnavailableError when binary is missing", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(new Error("not found"), "", "");
			return undefined as any;
		});

		const adapter = new GeminiAdapter();
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "gemini",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
			}),
		).rejects.toThrow("unavailable");
	});

	it("throws ProviderExecutionError on non-zero exit code", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});

		mockSpawn.mockReturnValueOnce(makeMockProc(1, "", "API error") as any);

		const adapter = new GeminiAdapter();
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "gemini",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
			}),
		).rejects.toThrow("exited with code 1");
	});

	it("throws ProviderExecutionError on spawn failure", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "gemini 1.0.0", "");
			return undefined as any;
		});

		mockSpawn.mockReturnValueOnce(makeMockProc(null, "", "spawn failed") as any);

		const adapter = new GeminiAdapter();
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "gemini",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
			}),
		).rejects.toThrow("spawn failed");
	});
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("GeminiAdapter.cancel", () => {
	it("resolves without error", async () => {
		const adapter = new GeminiAdapter();
		await expect(adapter.cancel({ runId: "r1", taskId: "t1" })).resolves.toBeUndefined();
	});
});
