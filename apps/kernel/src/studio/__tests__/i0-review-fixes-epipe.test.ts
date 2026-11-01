// ---------------------------------------------------------------------------
// I0 review fixes — S5: a CLI that exits without reading stdin must not crash the kernel.
// A fake CLI exits immediately; the prompt is ≥ 1 MB, so the kernel's write to the dead child's stdin fails with
// EPIPE asynchronously. That `error` event on `proc.stdin` must be handled: no uncaughtException / unhandled error.
// ---------------------------------------------------------------------------

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp, prependPath } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, queryOne: async () => undefined, execute: async () => undefined, query: async () => [] };
});

const BIG = "x".repeat(2 * 1024 * 1024);
let work: string;
let restorePath: () => void;
let savedClaudePath: string | undefined;
const uncaught: unknown[] = [];
const onUncaught = (err: unknown) => uncaught.push(err);

beforeAll(() => {
	work = freshTmp("oscx-i0-rf-epipe-");
	const bin = join(work, "bin");
	mkdirSync(bin);
	for (const name of ["claude", "codex", "gemini"]) {
		const p = join(bin, name);
		writeFileSync(p, "#!/bin/sh\nexit 0\n");
		chmodSync(p, 0o755);
	}
	restorePath = prependPath(bin);
	savedClaudePath = process.env.CLAUDE_CLI_PATH;
	process.env.CLAUDE_CLI_PATH = join(bin, "claude");
});
afterAll(() => {
	restorePath();
	if (savedClaudePath === undefined) Reflect.deleteProperty(process.env, "CLAUDE_CLI_PATH");
	else process.env.CLAUDE_CLI_PATH = savedClaudePath;
	rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
	uncaught.length = 0;
	process.on("uncaughtException", onUncaught);
	process.on("unhandledRejection", onUncaught);
});
afterEach(() => {
	process.off("uncaughtException", onUncaught);
	process.off("unhandledRejection", onUncaught);
});

const settleLate = () => new Promise((r) => setTimeout(r, 500));

describe("S5: EPIPE on the child's stdin is handled", () => {
	it("cli-language-model: doGenerate settles cleanly with a 2 MB prompt and a CLI that never reads stdin", async () => {
		const { CliLanguageModel } = await import("../cli-language-model.js");
		const model = new CliLanguageModel("claude", "sonnet");
		await model
			.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: BIG }] }] } as never)
			.catch(() => undefined);
		await settleLate();
		expect(uncaught).toEqual([]);
	});

	it("planner-cli (codex): the stream ends without an uncaught EPIPE", async () => {
		const { streamPlannerWithCLI } = await import("../planner-cli.js");
		await new Promise<void>((resolve) => {
			streamPlannerWithCLI(
				{ repoPath: work, prompt: BIG, systemPrompt: "sys", provider: "codex", timeoutMs: 10_000 },
				{ onTextDelta: () => undefined, onDone: () => resolve(), onError: () => resolve() },
			);
		});
		await settleLate();
		expect(uncaught).toEqual([]);
	});

	it("planner-cli (gemini): handled already (regression)", async () => {
		const { streamPlannerWithCLI } = await import("../planner-cli.js");
		await new Promise<void>((resolve) => {
			streamPlannerWithCLI(
				{ repoPath: work, prompt: BIG, systemPrompt: "sys", provider: "gemini", timeoutMs: 10_000 },
				{ onTextDelta: () => undefined, onDone: () => resolve(), onError: () => resolve() },
			);
		});
		await settleLate();
		expect(uncaught).toEqual([]);
	});

	it("planner-cli (claude-code, legacy runtime): the stream ends without an uncaught EPIPE", async () => {
		const { streamPlannerWithCLI } = await import("../planner-cli.js");
		await new Promise<void>((resolve) => {
			streamPlannerWithCLI(
				{ repoPath: work, prompt: BIG, systemPrompt: "sys", provider: "claude-code", timeoutMs: 10_000 },
				{ onTextDelta: () => undefined, onDone: () => resolve(), onError: () => resolve() },
			);
		});
		await settleLate();
		expect(uncaught).toEqual([]);
	});

	it("agent-runtime: startAgent with a 2 MB task prompt survives a CLI that never reads stdin (regression)", async () => {
		const { agentRuntime } = await import("../agent-runtime.js");
		await agentRuntime.startAgent("p-epipe", { id: "a-epipe", name: "a", cliTool: "claude-code" }, BIG);
		await settleLate();
		agentRuntime.stopAgent("p-epipe", "a-epipe");
		expect(uncaught).toEqual([]);
	});
});
