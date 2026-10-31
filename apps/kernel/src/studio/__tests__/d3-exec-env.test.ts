// ---------------------------------------------------------------------------
// D3 — B3: the main execution path must hand provider CLIs a sanitized, non-empty env.
//
// runCLI defaults to `env: {}`, so unless every layer forwards an env the claude CLI starts without PATH/HOME/
// CLAUDE_CONFIG_DIR. Contract:
//   ProviderExecutionService -> adapter.execute({ ..., env })        (buildSafeChildEnv provider profile +
//                                                                      pickEnv(providerEnvKeys(adapter)))
//   provider-resolver wrapper -> provider.execute({ ..., env })      (forwards opts.env)
//   every provider adapter    -> runCLI({ ..., env: input.env })
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCliCalls: { binary: string; env?: Record<string, string> }[] = [];

vi.mock("@oscorpex/provider-sdk", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		checkBinaryAsync: async () => ({ available: true, version: "1.0.0" }),
		runCLI: async (opts: { binary: string; env?: Record<string, string> }) => {
			runCliCalls.push({ binary: opts.binary, env: opts.env });
			return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false, killed: false };
		},
	};
});

vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ----- service-level mocks ---------------------------------------------------
const executeCalls: Record<string, unknown>[] = [];
let adapterName = "claude-code";

vi.mock("../kernel/provider-registry.js", () => ({
	providerRegistry: { list: () => [], get: () => undefined, registerDefaultProviders: () => undefined },
}));
vi.mock("../provider-resolver.js", () => ({
	createProviderResolver: async () => {
		let served = false;
		return {
			next: async () => {
				if (served) return null;
				served = true;
				return {
					name: adapterName,
					isAvailable: async () => true,
					execute: async (opts: Record<string, unknown>) => {
						executeCalls.push(opts);
						return {
							text: "ok",
							filesCreated: [],
							filesModified: [],
							logs: [],
							inputTokens: 0,
							outputTokens: 0,
							cacheCreationTokens: 0,
							cacheReadTokens: 0,
							totalCostUsd: 0,
							durationMs: 1,
							model: "m",
						};
					},
				};
			},
			recordFallbackReason: vi.fn(),
			getResult: () => ({
				finalProvider: adapterName,
				primaryProvider: adapterName,
				providerSource: "primary",
				cooldownState: {},
			}),
		};
	},
}));
vi.mock("../provider-state.js", () => ({
	providerState: {
		markSuccess: vi.fn(),
		markFailure: vi.fn(),
		markRateLimited: vi.fn(),
		isAllExhausted: () => false,
		getEarliestRecoveryMs: () => 0,
		isAvailable: () => true,
	},
}));
vi.mock("../provider-telemetry.js", () => ({
	CANCEL_REASONS: { pipeline_pause: "pipeline_pause" },
	classifyProviderErrorWithReason: () => ({ classification: "unknown", reason: "x" }),
	finishProviderTelemetry: vi.fn(),
	recordProviderCancel: vi.fn(),
	recordProviderDegraded: vi.fn(),
	recordProviderFallback: vi.fn(),
	startProviderTelemetry: () => ({ startedAt: new Date().toISOString() }),
}));

const SAVED: Record<string, string | undefined> = {};
const ENV_KEYS = [
	"DATABASE_URL",
	"OSCORPEX_JWT_SECRET",
	"CLAUDE_CONFIG_DIR",
	"DISABLE_AUTOUPDATER",
	"GEMINI_API_KEY",
	"ANTHROPIC_API_KEY",
	"CURSOR_API_KEY",
];

beforeEach(() => {
	for (const k of ENV_KEYS) SAVED[k] = process.env[k];
	process.env.DATABASE_URL = "postgres://u:p@db/x";
	process.env.OSCORPEX_JWT_SECRET = "jwt-secret";
	process.env.CLAUDE_CONFIG_DIR = "/home/oscorpex/.claude";
	process.env.DISABLE_AUTOUPDATER = "1";
	process.env.GEMINI_API_KEY = "gem-key";
	process.env.ANTHROPIC_API_KEY = "ant-key";
	process.env.CURSOR_API_KEY = "cur-key";
	executeCalls.length = 0;
	runCliCalls.length = 0;
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (SAVED[k] === undefined) delete process.env[k];
		else process.env[k] = SAVED[k];
	}
});

async function runService(provider: string) {
	adapterName = provider;
	const { ProviderExecutionService } = await import("../execution/provider-execution-service.js");
	const svc = new ProviderExecutionService({} as never);
	await svc.execute({
		projectId: "p",
		taskId: "t",
		agentId: "a",
		agentName: "n",
		repoPath: "/tmp",
		prompt: "hi",
		rawSystemPrompt: "sys",
		agentConfig: { name: "n", role: "backend" },
		model: "sonnet",
		cliTool: provider as never,
		allowedTools: ["Read"],
		timeoutMs: 1000,
	});
	expect(executeCalls.length).toBe(1);
	return executeCalls[0].env as Record<string, string> | undefined;
}

describe("D3 B3: ProviderExecutionService passes a sanitized env to the adapter", () => {
	it("claude: PATH/HOME/CLAUDE_CONFIG_DIR/DISABLE_AUTOUPDATER present; secrets and API keys absent", async () => {
		const env = await runService("claude-code");
		expect(env, "adapter.execute must receive env").toBeDefined();
		expect(env?.PATH).toBe(process.env.PATH);
		expect(env?.HOME).toBe(process.env.HOME);
		expect(env?.CLAUDE_CONFIG_DIR).toBe("/home/oscorpex/.claude");
		expect(env?.DISABLE_AUTOUPDATER).toBe("1");
		expect(env?.DATABASE_URL).toBeUndefined();
		expect(env?.OSCORPEX_JWT_SECRET).toBeUndefined();
		expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env?.GEMINI_API_KEY).toBeUndefined();
	});

	it("gemini: GEMINI_API_KEY is passed, other providers' keys are not", async () => {
		const env = await runService("gemini");
		expect(env?.GEMINI_API_KEY).toBe("gem-key");
		expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env?.CURSOR_API_KEY).toBeUndefined();
		expect(env?.DATABASE_URL).toBeUndefined();
	});

	it("cursor: CURSOR_API_KEY only", async () => {
		const env = await runService("cursor");
		expect(env?.CURSOR_API_KEY).toBe("cur-key");
		expect(env?.GEMINI_API_KEY).toBeUndefined();
		expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
	});
});

describe("D3 B3: the registry resolver wrapper forwards opts.env to provider.execute", () => {
	it("forwards env", async () => {
		const received: Record<string, unknown>[] = [];
		vi.resetModules();
		vi.doMock("../provider-resolver.js", async () => await vi.importActual("../provider-resolver.js"));
		vi.doMock("../kernel/provider-registry.js", () => ({
			providerRegistry: {
				list: () => [{ id: "claude-code" }],
				registerDefaultProviders: () => undefined,
				get: () => ({
					id: "claude-code",
					isAvailable: async () => true,
					capabilities: () => ({ supportedModels: [] }),
					execute: async (input: Record<string, unknown>) => {
						received.push(input);
						return { text: "ok", filesCreated: [], filesModified: [], logs: [] };
					},
				}),
			},
		}));
		vi.doMock("../fallback-decision.js", () => ({
			shouldSkipProvider: async () => ({ shouldSkip: false }),
			markProviderUnavailable: vi.fn(),
			sortAdapterChain: <T>(c: T) => c,
		}));
		vi.doMock("../provider-runtime-cache.js", () => ({
			providerRuntimeCache: { resolveAvailability: async (_n: string, fn: () => Promise<boolean>) => fn() },
		}));
		process.env.OSCORPEX_PROVIDER_RESOLVER_USE_REGISTRY = "true";
		try {
			const { createProviderResolver } = await import("../provider-resolver.js");
			const resolver = await createProviderResolver("claude-code" as never, [], {
				getLatencySnapshot: () => undefined,
			} as never);
			const adapter = await resolver.next({ allowedTools: [] } as never);
			expect(adapter).toBeTruthy();
			await adapter?.execute({
				projectId: "p",
				taskId: "t",
				agentId: "a",
				agentName: "n",
				repoPath: "/tmp",
				prompt: "hi",
				systemPrompt: "s",
				timeoutMs: 1000,
				env: { PATH: "/x", MARKER: "1" },
			} as never);
			expect(received.length).toBe(1);
			expect(received[0].env).toEqual({ PATH: "/x", MARKER: "1" });
		} finally {
			Reflect.deleteProperty(process.env, "OSCORPEX_PROVIDER_RESOLVER_USE_REGISTRY");
			vi.doUnmock("../kernel/provider-registry.js");
			vi.doUnmock("../fallback-decision.js");
			vi.doUnmock("../provider-runtime-cache.js");
		}
	});
});

describe("D3 B3: every provider adapter forwards input.env to runCLI", () => {
	const input = {
		runId: "r",
		taskId: "t",
		provider: "x",
		repoPath: "/tmp",
		prompt: "hi",
		systemPrompt: "sys",
		timeoutMs: 1000,
		env: { PATH: "/x", FORWARD_MARKER: "1" },
	};
	type Ctor = new () => { execute(i: unknown): Promise<unknown> };
	const adapters: [string, () => Promise<Record<string, unknown>>, string][] = [
		["claude", () => import("../../../../../adapters/provider-claude/src/index.js"), "ClaudeCodeAdapter"],
		["codex", () => import("../../../../../adapters/provider-codex/src/index.js"), "CodexAdapter"],
		["cursor", () => import("../../../../../adapters/provider-cursor/src/index.js"), "CursorAdapter"],
		["gemini", () => import("../../../../../adapters/provider-gemini/src/index.js"), "GeminiAdapter"],
	];
	for (const [name, load, cls] of adapters) {
		it(`${name} adapter`, async () => {
			const mod = await load();
			const AdapterCtor = mod[cls] as Ctor;
			await new AdapterCtor().execute(input).catch(() => undefined);
			expect(runCliCalls.length, `${name} adapter did not call runCLI`).toBeGreaterThan(0);
			expect(runCliCalls[0].env).toEqual({ PATH: "/x", FORWARD_MARKER: "1" });
		});
	}
});
