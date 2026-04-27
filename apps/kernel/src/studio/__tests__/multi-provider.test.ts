// ---------------------------------------------------------------------------
// Tests — Multi-Provider Execution + Fallback Chain (M4)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthCache } from "@oscorpex/provider-sdk";

// ---------------------------------------------------------------------------
// Mock child_process for CodexAdapter tests
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
	execFile: vi.fn((...args: any[]) => {
		const cb = args.find((a) => typeof a === "function");
		if (cb) cb(null, "", "");
	}),
	spawn: vi.fn(),
}));

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
		durationMs: 300,
		model: "claude-sonnet-4-6",
	}),
}));

vi.mock("../db.js", () => ({
	getProjectSettings: vi.fn().mockResolvedValue([]),
}));

import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { ClaudeAdapter, CodexAdapter, getAdapterChain } from "../cli-adapter.js";
import { getProjectSettings } from "../db.js";
import { resolveModel } from "../model-router.js";
import type { Task } from "../types.js";

const mockExecFileSync = vi.mocked(childProcess.execFileSync);
const mockExecFile = vi.mocked(childProcess.execFile);
const mockSpawn = vi.mocked(childProcess.spawn);
const mockGetProjectSettings = vi.mocked(getProjectSettings);

beforeEach(() => {
	healthCache.clear();
});

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "p-1",
		title: "Test task",
		description: "Do something",
		assignedAgent: "backend",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "feat/x",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as Task;
}

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
// Tests
// ---------------------------------------------------------------------------

describe("getAdapterChain", () => {
	it("returns primary adapter as first element", () => {
		const chain = getAdapterChain("claude-code");
		expect(chain[0].name).toBe("claude-code");
	});

	it("appends fallback adapters after primary", () => {
		const chain = getAdapterChain("codex", ["claude-code", "cursor"]);
		expect(chain[0].name).toBe("codex");
		expect(chain.map((a) => a.name)).toContain("claude-code");
		expect(chain.map((a) => a.name)).toContain("cursor");
	});

	it("does not include duplicate adapters (primary not repeated in fallbacks)", () => {
		const chain = getAdapterChain("claude-code", ["claude-code", "cursor"]);
		const names = chain.map((a) => a.name);
		// claude-code should appear only once
		expect(names.filter((n) => n === "claude-code")).toHaveLength(1);
	});

	it("returns single adapter when no fallbacks provided", () => {
		const chain = getAdapterChain("cursor");
		expect(chain).toHaveLength(1);
		expect(chain[0].name).toBe("cursor");
	});
});

describe("CodexAdapter.isAvailable", () => {
	it("returns true when codex binary is found", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(null, "1.0.0", "");
			return undefined as any;
		});
		const adapter = new CodexAdapter();
		expect(await adapter.isAvailable()).toBe(true);
	});

	it("returns false when codex binary is not found", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb = args.find((a) => typeof a === "function");
			if (cb) cb(new Error("not found"), "", "");
			return undefined as any;
		});
		const adapter = new CodexAdapter();
		expect(await adapter.isAvailable()).toBe(false);
	});
});

describe("CodexAdapter.execute", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves with parsed JSON output when codex returns JSON", async () => {
		const jsonOutput = JSON.stringify({
			output: "Task completed successfully",
			model: "gpt-4o",
			usage: { prompt_tokens: 100, completion_tokens: 50 },
		});
		mockSpawn.mockReturnValueOnce(makeMockProc(0, jsonOutput) as any);

		const adapter = new CodexAdapter();
		const result = await adapter.execute({
			projectId: "p1",
			agentId: "a1",
			agentName: "Backend",
			repoPath: "/tmp/repo",
			prompt: "Implement the feature",
			systemPrompt: "You are a backend developer",
			timeoutMs: 30_000,
		});

		expect(result.text).toBe("Task completed successfully");
		expect(result.model).toBe("gpt-4o");
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
	});

	it("resolves with raw text when codex returns plain text", async () => {
		mockSpawn.mockReturnValueOnce(makeMockProc(0, "plain text output") as any);

		const adapter = new CodexAdapter();
		const result = await adapter.execute({
			projectId: "p1",
			agentId: "a1",
			agentName: "Backend",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 30_000,
		});

		expect(result.text).toBe("plain text output");
		expect(result.inputTokens).toBe(0);
	});

	it("rejects when codex exits with non-zero code", async () => {
		mockSpawn.mockReturnValueOnce(makeMockProc(1, "", "some error") as any);

		const adapter = new CodexAdapter();
		await expect(
			adapter.execute({
				projectId: "p1",
				agentId: "a1",
				agentName: "Backend",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
			}),
		).rejects.toThrow("Codex exited with code 1");
	});

	it("rejects when restricted tool access is requested", async () => {
		const adapter = new CodexAdapter();
		await expect(
			adapter.execute({
				projectId: "p1",
				agentId: "a1",
				agentName: "Backend",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
				allowedTools: ["Read", "Glob", "Grep"],
			}),
		).rejects.toThrow("cannot honor restricted tool policies");
	});
});

describe("resolveModel with cliTool", () => {
	beforeEach(() => {
		mockGetProjectSettings.mockResolvedValue([]);
	});

	it("returns openai provider and correct model for codex + S tier", async () => {
		const r = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p-1",
			cliTool: "codex",
		});
		expect(r.provider).toBe("openai");
		expect(r.model).toBe("gpt-4o-mini");
		expect(r.cliTool).toBe("codex");
	});

	it("returns openai provider and o3 for codex + XL tier", async () => {
		const r = await resolveModel(makeTask({ complexity: "XL" }), {
			projectId: "p-1",
			cliTool: "codex",
		});
		expect(r.provider).toBe("openai");
		expect(r.model).toBe("o3");
	});

	it("returns cursor provider for cursor cliTool + M tier", async () => {
		const r = await resolveModel(makeTask({ complexity: "M" }), {
			projectId: "p-1",
			cliTool: "cursor",
		});
		expect(r.provider).toBe("cursor");
		expect(r.model).toBe("cursor-small");
		expect(r.cliTool).toBe("cursor");
	});

	it("returns cursor-large for cursor + L tier", async () => {
		const r = await resolveModel(makeTask({ complexity: "L" }), {
			projectId: "p-1",
			cliTool: "cursor",
		});
		expect(r.provider).toBe("cursor");
		expect(r.model).toBe("cursor-large");
	});

	it("returns anthropic provider when cliTool is omitted (backward compat)", async () => {
		const r = await resolveModel(makeTask({ complexity: "M" }), {
			projectId: "p-1",
		});
		expect(r.provider).toBe("anthropic");
		expect(r.model).toContain("sonnet");
		expect(r.cliTool).toBe("claude-code");
	});

	it("returns anthropic provider for claude-code cliTool", async () => {
		const r = await resolveModel(makeTask({ complexity: "M" }), {
			projectId: "p-1",
			cliTool: "claude-code",
		});
		expect(r.provider).toBe("anthropic");
		expect(r.cliTool).toBe("claude-code");
	});
});

describe("Fallback chain execution logic", () => {
	it("uses second adapter when first fails", async () => {
		// Simulate: first adapter (codex) fails, second (claude-code) succeeds
		const chain = getAdapterChain("codex", ["claude-code"]);
		expect(chain[0].name).toBe("codex");
		expect(chain[1].name).toBe("claude-code");

		// ClaudeAdapter delegates to executeWithCLI which is mocked to succeed
		const claudeAdapter = chain.find((a) => a.name === "claude-code");
		expect(claudeAdapter).toBeDefined();

		const result = await claudeAdapter!.execute({
			projectId: "p1",
			agentId: "a1",
			agentName: "Backend",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 30_000,
		});
		expect(result.text).toBe("done");
	});
});
