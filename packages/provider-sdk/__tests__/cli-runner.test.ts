// ---------------------------------------------------------------------------
// Provider SDK — CLI Runner Tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";

// We must mock child_process before any imports that use it
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();
const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
	execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
	execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import {
	runCLI,
	classifyExit,
	tryParseJson,
	extractUsage,
	extractText,
	checkBinary,
	checkBinaryAsync,
} from "../src/cli-runner.js";

function createMockChildProcess() {
	const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
	let stdinData = "";
	return {
		on(event: string, handler: (...args: unknown[]) => void) {
			if (!handlers[event]) handlers[event] = [];
			handlers[event]!.push(handler);
		},
		fire(event: string, ...args: unknown[]) {
			handlers[event]?.forEach((h) => h(...args));
		},
		stdout: {
			on(event: string, handler: (data: Buffer) => void) {
				if (!handlers[`stdout:${event}`]) handlers[`stdout:${event}`] = [];
				handlers[`stdout:${event}`]!.push(handler as (...args: unknown[]) => void);
			},
			fire(data: string) {
				handlers["stdout:data"]?.forEach((h) => h(Buffer.from(data)));
			},
		},
		stderr: {
			on(event: string, handler: (data: Buffer) => void) {
				if (!handlers[`stderr:${event}`]) handlers[`stderr:${event}`] = [];
				handlers[`stderr:${event}`]!.push(handler as (...args: unknown[]) => void);
			},
			fire(data: string) {
				handlers["stderr:data"]?.forEach((h) => h(Buffer.from(data)));
			},
		},
		stdin: {
			write(data: string) {
				stdinData += data;
			},
			end() {
				// no-op
			},
		},
		kill(signal?: string) {
			this.fire("close", null, signal ?? "SIGTERM");
		},
		getStdinData() {
			return stdinData;
		},
	};
}

describe("runCLI", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("collects stdout and returns exit code 0", async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const promise = runCLI({ binary: "echo", args: ["hi"], cwd: "/tmp" });
		child.stdout.fire("hello world");
		child.fire("close", 0, null);

		const result = await promise;
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("hello world");
		expect(result.killedByTimeout).toBe(false);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("collects stderr separately", async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const promise = runCLI({ binary: "cmd", args: [] });
		child.stdout.fire("out");
		child.stderr.fire("err");
		child.fire("close", 0, null);

		const result = await promise;
		expect(result.stdout).toBe("out");
		expect(result.stderr).toBe("err");
	});

	it("kills process on timeout", async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const promise = runCLI({ binary: "sleep", args: ["10"], timeoutMs: 50 });

		const result = await promise;
		expect(result.killedByTimeout).toBe(true);
		expect(result.exitCode).toBeNull();
	});

	it("kills process on abort signal", async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const controller = new AbortController();
		const promise = runCLI({ binary: "sleep", args: ["10"], signal: controller.signal });

		// Abort after a short delay
		setTimeout(() => controller.abort(), 50);

		const result = await promise;
		expect(result.killedBySignal).toBe(true);
	});

	it("writes stdin when provided", async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const promise = runCLI({ binary: "cat", args: [], stdin: "hello" });
		child.stdout.fire("hello");
		child.fire("close", 0, null);

		await promise;
		expect(child.getStdinData()).toBe("hello");
	});

	it("rejects on spawn error", async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const promise = runCLI({ binary: "missing", args: [] });
		child.fire("error", new Error("ENOENT"));

		await expect(promise).rejects.toThrow("ENOENT");
	});
});

describe("classifyExit", () => {
	it("classifies exit code 0 as success", () => {
		const result = classifyExit({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 100, killedByTimeout: false, killedBySignal: false });
		expect(result.classification).toBe("success");
		expect(result.retryable).toBe(false);
	});

	it("classifies timeout as retryable", () => {
		const result = classifyExit({ exitCode: null, signal: "SIGKILL", stdout: "", stderr: "", durationMs: 5000, killedByTimeout: true, killedBySignal: false });
		expect(result.classification).toBe("timeout");
		expect(result.retryable).toBe(true);
	});

	it("classifies signal kill as retryable", () => {
		const result = classifyExit({ exitCode: null, signal: "SIGTERM", stdout: "", stderr: "", durationMs: 100, killedByTimeout: false, killedBySignal: true });
		expect(result.classification).toBe("killed");
		expect(result.retryable).toBe(true);
	});

	it("classifies exit 127 as not retryable (binary missing)", () => {
		const result = classifyExit({ exitCode: 127, signal: null, stdout: "", stderr: "", durationMs: 10, killedByTimeout: false, killedBySignal: false });
		expect(result.classification).toBe("spawn_failure");
		expect(result.retryable).toBe(false);
	});

	it("classifies exit 1 as retryable", () => {
		const result = classifyExit({ exitCode: 1, signal: null, stdout: "", stderr: "error", durationMs: 100, killedByTimeout: false, killedBySignal: false });
		expect(result.classification).toBe("cli_error");
		expect(result.retryable).toBe(true);
	});
});

describe("tryParseJson", () => {
	it("parses valid JSON", () => {
		const result = tryParseJson('{"output":"hello"}');
		expect(result.ok).toBe(true);
		expect(result.data).toEqual({ output: "hello" });
	});

	it("falls back to last line JSON", () => {
		const result = tryParseJson("log line 1\nlog line 2\n{\"output\":\"hello\"}");
		expect(result.ok).toBe(true);
		expect(result.data).toEqual({ output: "hello" });
	});

	it("returns error for invalid JSON", () => {
		const result = tryParseJson("not json");
		expect(result.ok).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("returns error for empty string", () => {
		const result = tryParseJson("");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Empty stdout");
	});
});

describe("extractUsage", () => {
	it("extracts OpenAI shape", () => {
		const result = extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 20 } });
		expect(result.inputTokens).toBe(10);
		expect(result.outputTokens).toBe(20);
	});

	it("extracts Anthropic shape", () => {
		const result = extractUsage({ input_tokens: 5, output_tokens: 15, cache_creation_input_tokens: 2 });
		expect(result.inputTokens).toBe(5);
		expect(result.outputTokens).toBe(15);
		expect(result.cacheCreationTokens).toBe(2);
	});

	it("returns zeros for invalid input", () => {
		const result = extractUsage(null);
		expect(result.inputTokens).toBe(0);
		expect(result.outputTokens).toBe(0);
	});
});

describe("extractText", () => {
	it("extracts output field", () => {
		expect(extractText({ output: "hi" })).toBe("hi");
	});

	it("extracts result field", () => {
		expect(extractText({ result: "hi" })).toBe("hi");
	});

	it("returns empty for non-object", () => {
		expect(extractText(null)).toBe("");
	});
});

describe("checkBinary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns available when execFileSync succeeds", () => {
		mockExecFileSync.mockReturnValue("claude 1.2.3");
		const result = checkBinary("claude");
		expect(result.available).toBe(true);
		expect(result.version).toBe("claude 1.2.3");
	});

	it("returns unavailable when execFileSync throws", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		const result = checkBinary("claude");
		expect(result.available).toBe(false);
		expect(result.error).toContain("ENOENT");
	});
});

describe("checkBinaryAsync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves available on success", async () => {
		mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
			cb(null, "codex 2.0.0");
		});
		const result = await checkBinaryAsync("codex");
		expect(result.available).toBe(true);
		expect(result.version).toBe("codex 2.0.0");
	});

	it("resolves unavailable on error", async () => {
		mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
			cb(new Error("not found"), "");
		});
		const result = await checkBinaryAsync("codex");
		expect(result.available).toBe(false);
		expect(result.error).toContain("not found");
	});
});
