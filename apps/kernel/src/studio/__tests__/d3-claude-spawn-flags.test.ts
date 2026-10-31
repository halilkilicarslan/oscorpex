// ---------------------------------------------------------------------------
// D3 — every claude CLI invocation must ignore user-level settings and MCP config.
//
// The image shares one ~/.claude volume between all tenants' CLI runs, so a tenant could plant hooks or MCP
// servers in the user settings. Each claude invocation must pass `--setting-sources project,local` (lockdown mode
// uses the stricter empty list) and `--strict-mcp-config`.
//
// Two layers:
//   1. behavioural: capture the args the real arg builders hand to spawn()/runCLI() (mocked);
//   2. static (AST): every array literal that carries claude-only flags must include both flags, or be built
//      by a helper whose name mentions claude + safe/hardening/settings/flags.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

// ---------------------------------------------------------------------------
// Behavioural
// ---------------------------------------------------------------------------

const spawnCalls: { bin: string; args: string[] }[] = [];
const runCliCalls: { binary: string; args: string[] }[] = [];

function fakeProc() {
	const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.stdin = { write: vi.fn(), end: vi.fn() };
	proc.kill = vi.fn();
	proc.pid = 4242;
	setTimeout(() => proc.emit("close", 0, null), 5);
	return proc;
}

vi.mock("node:child_process", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		spawn: (bin: string, args: string[]) => {
			spawnCalls.push({ bin, args: [...args] });
			return fakeProc();
		},
	};
});

vi.mock("@oscorpex/provider-sdk", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		checkBinaryAsync: async () => ({ available: true, version: "2.1.302" }),
		runCLI: async (opts: { binary: string; args: string[] }) => {
			runCliCalls.push({ binary: opts.binary, args: [...opts.args] });
			return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false, killed: false };
		},
	};
});

vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../event-bus.js", () => ({
	eventBus: { emitTransient: vi.fn(), emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock("../agent-runtime.js", () => ({
	agentRuntime: {
		ensureVirtualProcess: vi.fn(),
		appendVirtualOutput: vi.fn(),
		recordVirtualOutput: vi.fn(),
		stopVirtualProcess: vi.fn(),
	},
}));

function expectSafeFlags(args: string[], opts: { allowEmptySources?: boolean } = {}) {
	const i = args.indexOf("--setting-sources");
	expect(i, `--setting-sources missing in: ${args.join(" ")}`).toBeGreaterThanOrEqual(0);
	const value = args[i + 1];
	if (opts.allowEmptySources && value === "") {
		// lockdown mode: no settings sources at all is stricter than project,local
	} else {
		expect(value).toBe("project,local");
	}
	expect(args).toContain("--strict-mcp-config");
	// never opt in to user-level settings
	expect(args.join(" ")).not.toMatch(/--setting-sources[ =]\S*user/);
}

async function settle(p: Promise<unknown> | (() => void) | undefined) {
	if (p && typeof (p as Promise<unknown>).then === "function") await (p as Promise<unknown>).catch(() => undefined);
	await new Promise((r) => setTimeout(r, 30));
}

describe("D3: claude CLI arg builders pass --setting-sources project,local and --strict-mcp-config", () => {
	beforeEach(() => {
		spawnCalls.length = 0;
		runCliCalls.length = 0;
		process.env.CLAUDE_CLI_PATH = "/opt/claude-cli/node_modules/.bin/claude";
	});

	it("provider-claude adapter execute()", async () => {
		const { ClaudeCodeAdapter } = await import("../../../../../adapters/provider-claude/src/index.js");
		const adapter = new ClaudeCodeAdapter();
		await settle(
			adapter
				.execute({
					taskId: "t1",
					prompt: "hi",
					systemPrompt: "sys",
					repoPath: "/tmp",
					model: "sonnet",
					timeoutMs: 1000,
				} as never)
				.catch(() => undefined),
		);
		expect(runCliCalls.length).toBeGreaterThan(0);
		for (const c of runCliCalls) expectSafeFlags(c.args);
	});

	it("kernel cli-language-model (claude tool)", async () => {
		const { CliLanguageModel } = await import("../cli-language-model.js");
		const model = new CliLanguageModel("claude", "sonnet");
		await settle(
			model
				.doGenerate({
					prompt: [
						{ role: "system", content: "sys" },
						{ role: "user", content: [{ type: "text", text: "hi" }] },
					],
				} as never)
				.catch(() => undefined),
		);
		const claudeCalls = spawnCalls.filter((c) => c.args.includes("-p"));
		expect(claudeCalls.length).toBeGreaterThan(0);
		for (const c of claudeCalls) expectSafeFlags(c.args);
	});

	it("legacy cli-runtime executeWithCLI", async () => {
		const mod = await import("../legacy/cli-runtime.js");
		await settle(
			mod
				.executeWithCLI({
					projectId: "p",
					agentId: "a",
					agentName: "n",
					repoPath: "/tmp",
					prompt: "hi",
					systemPrompt: "sys",
					timeoutMs: 1000,
				})
				.catch(() => undefined),
		);
		const calls = spawnCalls.filter((c) => c.args.includes("--permission-mode"));
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) expectSafeFlags(c.args);
	});

	for (const lockdown of [false, true]) {
		it(`legacy cli-runtime streamWithCLI (lockdown=${lockdown})`, async () => {
			const mod = await import("../legacy/cli-runtime.js");
			const cb = { onTextDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
			mod.streamWithCLI(
				{ repoPath: "/tmp", prompt: "hi", systemPrompt: "sys", timeoutMs: 1000, lockdown },
				cb as never,
			);
			await settle(undefined);
			const calls = spawnCalls.filter((c) => c.args.includes("--permission-mode"));
			expect(calls.length).toBeGreaterThan(0);
			for (const c of calls) expectSafeFlags(c.args, { allowEmptySources: lockdown });
		});
	}
});

// ---------------------------------------------------------------------------
// Static coverage (AST)
// ---------------------------------------------------------------------------

const SCAN_ROOTS = [
	join(REPO_ROOT, "apps/kernel/src"),
	join(REPO_ROOT, "packages/provider-sdk/src"),
	...readdirSync(join(REPO_ROOT, "adapters"), { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => join(REPO_ROOT, "adapters", d.name, "src")),
];
const EXCLUDED_DIRS = new Set(["__tests__", "node_modules", "dist"]);
/** Flags that only a claude invocation carries (codex/gemini/cursor use different ones). */
const CLAUDE_ONLY_FLAGS = new Set([
	"--permission-mode",
	"--print",
	"--dangerously-skip-permissions",
	"--output-format",
	"--disable-slash-commands",
	"--no-session-persistence",
	"--max-budget-usd",
	"--system-prompt",
]);
const HELPER_NAME = /(claude.*(safe|harden|setting|flag|arg))|((safe|harden).*claude)/i;

function* walk(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (EXCLUDED_DIRS.has(name)) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) yield* walk(p);
		else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts")) yield p;
	}
}

interface Site {
	file: string;
	line: number;
	ok: boolean;
	problem: string;
}

function findSites(): Site[] {
	const sites: Site[] = [];
	for (const root of SCAN_ROOTS) {
		for (const file of walk(root)) {
			const text = readFileSync(file, "utf8");
			if (!/claude/i.test(text)) continue;
			const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
			const visit = (node: ts.Node) => {
				if (ts.isArrayLiteralExpression(node)) {
					const strings = node.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
					// cursor shares --output-format; its arrays carry --trust / start with "agent"
					const isCursor = strings.includes("--trust") || strings[0] === "agent";
					if (!isCursor && strings.some((s) => CLAUDE_ONLY_FLAGS.has(s))) {
						const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
						const hasSources = strings.includes("--setting-sources");
						const hasStrict = strings.includes("--strict-mcp-config");
						const viaHelper = node.elements.some(
							(e) =>
								(ts.isSpreadElement(e) && HELPER_NAME.test(e.expression.getText(sf))) ||
								(ts.isCallExpression(e) && HELPER_NAME.test(e.expression.getText(sf))),
						);
						// a wrapping call such as buildClaudeArgs([...]) also counts
						const parent = node.parent;
						const wrapped = parent && ts.isCallExpression(parent) && HELPER_NAME.test(parent.expression.getText(sf));
						let problem = "";
						if (!viaHelper && !wrapped) {
							if (!hasSources) problem = "no --setting-sources";
							else if (!hasStrict) problem = "no --strict-mcp-config";
							else {
								const idx = node.elements.findIndex((e) => ts.isStringLiteralLike(e) && e.text === "--setting-sources");
								const next = node.elements[idx + 1];
								const val = next && ts.isStringLiteralLike(next) ? next.text : undefined;
								if (val !== "project,local" && val !== "")
									problem = `--setting-sources value is ${val ?? "non-literal"}`;
							}
						}
						sites.push({ file: relative(REPO_ROOT, file), line, ok: problem === "", problem });
					}
				}
				// `{ cmd: "claude", args: [...] }` command specs, including the flag-less interactive one
				if (ts.isObjectLiteralExpression(node)) {
					const prop = (n: string) =>
						node.properties.find(
							(x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && x.name.getText(sf) === n,
						);
					const cmd = prop("cmd");
					const args = prop("args");
					if (cmd && args && ts.isStringLiteralLike(cmd.initializer) && cmd.initializer.text === "claude") {
						const init = args.initializer;
						const strings = ts.isArrayLiteralExpression(init)
							? init.elements.filter(ts.isStringLiteralLike).map((e) => e.text)
							: [];
						const viaHelper = HELPER_NAME.test(init.getText(sf));
						const ok = viaHelper || (strings.includes("--setting-sources") && strings.includes("--strict-mcp-config"));
						const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
						sites.push({
							file: relative(REPO_ROOT, file),
							line,
							ok,
							problem: ok ? "" : "claude command spec without hardening flags",
						});
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(sf);
		}
	}
	return sites;
}

describe("D3: static coverage of claude CLI argument lists", () => {
	const sites = findSites();

	it("finds the known claude invocation sites", () => {
		const files = new Set(sites.map((s) => s.file));
		for (const f of [
			"adapters/provider-claude/src/index.ts",
			"apps/kernel/src/studio/cli-language-model.ts",
			"apps/kernel/src/studio/legacy/cli-runtime.ts",
			"apps/kernel/src/studio/agent-runtime.ts",
			"apps/kernel/src/studio/container-manager.ts",
		]) {
			expect(files, `no claude arg list found in ${f}`).toContain(f);
		}
	});

	it("every claude arg list carries --setting-sources project,local and --strict-mcp-config", () => {
		const bad = sites.filter((s) => !s.ok).map((s) => `${s.file}:${s.line} ${s.problem}`);
		expect(bad, `claude arg lists missing hardening flags:\n${bad.join("\n")}`).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// claude-probe runs the claude binary through binary-locator's runCommand (/usage, /cost). Those runs read the
// same shared ~/.claude, so they need the same hardening flags.
// ---------------------------------------------------------------------------

describe("D3: claude-probe runCommand calls carry the safe setting args", () => {
	const file = join(REPO_ROOT, "apps/kernel/src/studio/cli-usage/probes/claude-probe.ts");
	const text = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const calls: { line: number; text: string }[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "runCommand") {
			calls.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.getText(sf) });
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);

	it("finds the /usage and /cost runCommand calls", () => {
		expect(calls.length).toBeGreaterThanOrEqual(2);
	});

	for (const c of calls) {
		it(`claude-probe.ts:${c.line} runCommand uses claudeSafeSettingArgs() or the literal flags`, () => {
			const ok =
				/claudeSafeSettingArgs\(/.test(c.text) ||
				(c.text.includes("--setting-sources") && c.text.includes("--strict-mcp-config"));
			expect(ok, c.text.slice(0, 120)).toBe(true);
		});
	}
});
