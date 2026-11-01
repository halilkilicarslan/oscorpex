// ---------------------------------------------------------------------------
// I0 items 2 + 3 / scenarios 2 + 3.
//   2. A task prompt such as `--settings=/tmp/x` / `-c foo` / `--dangerously-skip-permissions` must never reach a
//      CLI as an option: it travels over stdin (or follows a `--` separator). Covered paths: agent-runtime
//      (claude-code, codex, cursor), planner-cli (claude, codex, gemini) and the legacy cli-runtime.
//   3. cli-language-model runs claude with all tools disabled (`--tools ""`), without bypassPermissions, inside a
//      fresh empty temp directory that is removed afterwards.
// Fake CLIs record argv/cwd/stdin (helpers/i0-fakes.ts); no real CLI is ever executed.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FakeInvocation,
	deliveredWithoutFlagParsing,
	freshTmp,
	makeFakeBin,
	prependPath,
	waitForInvocationWith,
} from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let work: string;
let repo: string;
const records: Record<string, string> = {};
let restorePath: () => void;
let savedClaudePath: string | undefined;

vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		queryOne: async () => ({ repo_path: process.env.I0_REPO }),
		execute: async () => undefined,
		query: async () => [],
	};
});

const INJECTIONS = ["--settings=/tmp/x", "-c foo", "--dangerously-skip-permissions"];

beforeAll(() => {
	work = freshTmp("oscx-i0-argv-");
	repo = join(work, "repo");
	process.env.I0_REPO = repo;
	mkdirSync(repo);
	const bin = join(work, "bin");
	mkdirSync(bin);
	const claudeJson = JSON.stringify({ result: "ok", usage: { input_tokens: 1, output_tokens: 1 } });
	records.claude = makeFakeBin(bin, "claude", { stdout: claudeJson });
	records.codex = makeFakeBin(bin, "codex", { stdout: "ok" });
	records.cursor = makeFakeBin(bin, "cursor", { stdout: "{}" });
	records.gemini = makeFakeBin(bin, "gemini", { stdout: "ok" });
	restorePath = prependPath(bin);
	savedClaudePath = process.env.CLAUDE_CLI_PATH;
	process.env.CLAUDE_CLI_PATH = join(bin, "claude");
});

beforeEach(() => {
	// every test reads only its own invocations
	for (const file of Object.values(records)) rmSync(file, { force: true });
});

afterAll(() => {
	restorePath();
	if (savedClaudePath === undefined) Reflect.deleteProperty(process.env, "CLAUDE_CLI_PATH");
	else process.env.CLAUDE_CLI_PATH = savedClaudePath;
	Reflect.deleteProperty(process.env, "I0_REPO");
	rmSync(work, { recursive: true, force: true });
});

function expectSafeDelivery(inv: FakeInvocation, prompt: string) {
	expect(
		deliveredWithoutFlagParsing(inv, prompt),
		`prompt ${JSON.stringify(prompt)} argv=${JSON.stringify(inv.argv)}`,
	).toBe(true);
	// whatever the prompt tried to smuggle in must not be a standalone option either
	for (const a of inv.argv.filter((_, i) => inv.argv.indexOf("--") === -1 || i < inv.argv.indexOf("--"))) {
		expect(a).not.toBe("--settings=/tmp/x");
		expect(a).not.toBe("-c foo");
		expect(a).not.toBe("--dangerously-skip-permissions");
	}
}

describe("agent-runtime: task prompt never becomes an option (scenario 2)", () => {
	for (const cliTool of ["claude-code", "codex", "cursor"] as const) {
		for (const [i, injection] of INJECTIONS.entries()) {
			it(`${cliTool}: ${injection}`, async () => {
				const { startAgent } = await import("../agent-runtime.js");
				const prompt = `${injection}`;
				const agentId = `i0-${cliTool}-${i}`;
				await startAgent("i0-proj", { id: agentId, name: agentId, cliTool }, prompt);
				const bin = cliTool === "claude-code" ? "claude" : cliTool;
				const inv = await waitForInvocationWith(records[bin], injection);
				expectSafeDelivery(inv, prompt);
			});
		}
	}
});

describe("agent-runtime: codex and cursor prompts are delivered on stdin, never in argv (L2)", () => {
	const SECRET_PROMPT = "round3-prompt-body ship the feature --settings=/tmp/x";

	it("codex: `exec -` with the prompt on stdin", async () => {
		const { startAgent } = await import("../agent-runtime.js");
		await startAgent("i0-proj", { id: "i0-codex-stdin", name: "i0-codex-stdin", cliTool: "codex" }, SECRET_PROMPT);
		const inv = await waitForInvocationWith(records.codex, "round3-prompt-body");
		expect(inv.argv).toEqual(["exec", "-"]);
		expect(inv.stdin).toContain(SECRET_PROMPT);
		expect(inv.argv.join("\n")).not.toContain("round3-prompt-body");
	});

	it("cursor: the same stdin form the cursor adapter uses; the prompt is not in argv at all", async () => {
		const { startAgent } = await import("../agent-runtime.js");
		await startAgent("i0-proj", { id: "i0-cursor-stdin", name: "i0-cursor-stdin", cliTool: "cursor" }, SECRET_PROMPT);
		const inv = await waitForInvocationWith(records.cursor, "round3-prompt-body");
		expect(inv.argv.join("\n")).not.toContain("round3-prompt-body");
		expect(inv.argv.join("\n")).not.toContain("--settings=/tmp/x");
		expect(inv.argv.slice(0, 2)).toEqual(["agent", "-p"]);
		expect(inv.stdin).toContain(SECRET_PROMPT);
	});

	it("claude-code: still on stdin (regression)", async () => {
		const { startAgent } = await import("../agent-runtime.js");
		await startAgent(
			"i0-proj",
			{ id: "i0-claude-stdin", name: "i0-claude-stdin", cliTool: "claude-code" },
			SECRET_PROMPT,
		);
		const inv = await waitForInvocationWith(records.claude, "round3-prompt-body");
		expect(inv.argv.join("\n")).not.toContain("round3-prompt-body");
		expect(inv.stdin).toContain(SECRET_PROMPT);
	});
});

describe("planner-cli: prompt never becomes an option (scenario 2)", () => {
	async function run(provider: "claude-code" | "codex" | "gemini", prompt: string) {
		const { streamPlannerWithCLI } = await import("../planner-cli.js");
		await new Promise<void>((resolve) => {
			streamPlannerWithCLI(
				{ repoPath: repo, prompt, systemPrompt: "", provider, timeoutMs: 20_000 },
				{ onTextDelta: () => undefined, onDone: () => resolve(), onError: () => resolve() },
			);
		});
	}

	for (const provider of ["claude-code", "codex", "gemini"] as const) {
		for (const injection of INJECTIONS) {
			it(`${provider}: ${injection}`, async () => {
				await run(provider, injection);
				const bin = provider === "claude-code" ? "claude" : provider;
				expectSafeDelivery(await waitForInvocationWith(records[bin], injection), injection);
			});
		}
	}
});

describe("legacy cli-runtime: prompt never becomes an option (scenario 2)", () => {
	for (const injection of INJECTIONS) {
		it(`executeWithCLI: ${injection}`, async () => {
			const { executeWithCLI } = await import("../legacy/cli-runtime.js");
			await executeWithCLI({
				projectId: "i0-proj",
				agentId: "i0-legacy",
				agentName: "legacy",
				repoPath: repo,
				prompt: injection,
				systemPrompt: "sys",
				timeoutMs: 20_000,
			}).catch(() => undefined);
			expectSafeDelivery(await waitForInvocationWith(records.claude, injection), injection);
		});
	}
});

describe("cli-language-model: tool-less, empty throw-away cwd (scenario 3)", () => {
	async function generate() {
		const { CliLanguageModel } = await import("../cli-language-model.js");
		const model = new CliLanguageModel("claude", "sonnet");
		// each call must observe only its own invocation
		rmSync(records.claude, { force: true });
		await model.doGenerate({
			prompt: [
				{ role: "system", content: "be brief" },
				{ role: "user", content: [{ type: "text", text: "--settings=/tmp/x hello" }] },
			],
		} as never);
		return waitForInvocationWith(records.claude, "--settings=/tmp/x hello");
	}

	it("passes --tools with an empty value", async () => {
		const inv = await generate();
		const i = inv.argv.indexOf("--tools");
		expect(i).toBeGreaterThanOrEqual(0);
		expect(inv.argv[i + 1]).toBe("");
	});

	it("never uses bypassPermissions", async () => {
		const inv = await generate();
		expect(inv.argv).not.toContain("bypassPermissions");
		expect(inv.argv.join(" ")).not.toMatch(/bypassPermissions|dangerously-skip-permissions/);
	});

	it("keeps the safe settings flags and delivers the prompt without flag parsing", async () => {
		const inv = await generate();
		expect(inv.argv).toContain("--setting-sources");
		expect(inv.argv).toContain("--strict-mcp-config");
		expect(deliveredWithoutFlagParsing(inv, "--settings=/tmp/x hello")).toBe(true);
	});

	it("runs in a fresh empty temp directory (not the kernel cwd) that is removed afterwards", async () => {
		const inv = await generate();
		const kernelCwd = realpathSync(process.cwd());
		expect(inv.cwd).not.toBe(kernelCwd);
		expect(inv.cwdEntries).toEqual([]);
		expect(existsSync(inv.cwd)).toBe(false);
	});

	it("each call gets its own directory", async () => {
		const a = await generate();
		const b = await generate();
		expect(a.cwd).not.toBe(b.cwd);
		expect(readdirSync(work).includes("repo")).toBe(true); // sanity: the fixture repo was never used as cwd
		expect(a.cwd.startsWith(repo)).toBe(false);
	});
});
