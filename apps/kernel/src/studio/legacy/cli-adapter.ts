// ---------------------------------------------------------------------------
// Oscorpex — Multi-CLI Adapter (Faz 4.1)
// CLITool bazlı adapter pattern: her CLI aracı için ayrı implementasyon.
// Types re-exported from @oscorpex/provider-sdk for provider-agnostic use.
// ---------------------------------------------------------------------------

import type { ProviderAdapter } from "@oscorpex/core";
import type { CLIAdapterOptions } from "@oscorpex/provider-sdk";
import {
	buildToolGovernanceSection,
	checkBinaryAsync,
	checkBinaryCached,
	hasFullToolAccess,
} from "@oscorpex/provider-sdk";
import type { CLIExecutionResult } from "../cli-runtime.js";
import { executeWithCLI, isClaudeCliAvailable } from "../cli-runtime.js";
import { createLogger } from "../logger.js";
import { getFeatureFlags } from "../performance-config.js";
import type { ProviderCapabilities } from "../provider-runtime-cache.js";
import type { AgentCliTool } from "../types.js";
const log = createLogger("cli-adapter");

// Re-export the CLIAdapter interface from provider-sdk for local convenience
export type { CLIAdapterOptions } from "@oscorpex/provider-sdk";
export { buildToolGovernanceSection, hasFullToolAccess, FULL_TOOL_ACCESS } from "@oscorpex/provider-sdk";

export interface CLIAdapter {
	readonly name: string;
	isAvailable(): Promise<boolean>;
	capabilities(): Promise<ProviderCapabilities>;
	execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult>;
}

// ---------------------------------------------------------------------------
// ClaudeAdapter — mevcut executeWithCLI üzerinden çalışır
// ---------------------------------------------------------------------------

export class ClaudeAdapter implements CLIAdapter {
	readonly name = "claude-code";

	async isAvailable(): Promise<boolean> {
		return isClaudeCliAvailable();
	}

	async capabilities(): Promise<ProviderCapabilities> {
		return {
			supportedModels: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"],
			supportsToolRestriction: true,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: false,
			supportsSandboxHinting: true,
		};
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		return executeWithCLI(opts);
	}
}

// ---------------------------------------------------------------------------
// CodexAdapter — OpenAI Codex CLI
// ---------------------------------------------------------------------------

export class CodexAdapter implements CLIAdapter {
	readonly name = "codex";

	async isAvailable(): Promise<boolean> {
		const result = await checkBinaryCached(checkBinaryAsync, "codex", ["--version"]);
		return result.available;
	}

	async capabilities(): Promise<ProviderCapabilities> {
		return {
			supportedModels: ["gpt-4o", "gpt-4o-mini", "o3"],
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: false,
		};
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		const { spawn } = await import("node:child_process");
		const startTime = Date.now();
		if (!hasFullToolAccess(opts.allowedTools)) {
			throw new Error("Codex adapter cannot honor restricted tool policies; fallback required");
		}
		const governanceSection = buildToolGovernanceSection(opts.allowedTools);
		const prompt = governanceSection ? `${governanceSection}\n\n${opts.prompt}` : opts.prompt;

		const args = ["--quiet", "--full-auto"];
		if (opts.model) args.push("--model", opts.model);
		args.push(prompt);

		return new Promise((resolve, reject) => {
			const proc = spawn("codex", args, {
				cwd: opts.repoPath,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => {
				proc.kill("SIGKILL");
				reject(new Error("Codex CLI timed out"));
			}, opts.timeoutMs ?? 120_000);

			proc.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			proc.stderr?.on("data", (d) => {
				stderr += d.toString();
			});

			if (opts.signal) {
				opts.signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
			}

			// Send system prompt via stdin if provided
			if (opts.systemPrompt) {
				proc.stdin?.write(opts.systemPrompt + "\n\n");
			}
			proc.stdin?.end();

			proc.on("close", (code) => {
				clearTimeout(timer);
				const durationMs = Date.now() - startTime;
				if (code !== 0) {
					reject(new Error(`Codex exited with code ${code}: ${stderr.slice(0, 500)}`));
					return;
				}
				// Try to parse JSON output, fall back to raw text
				try {
					const obj = JSON.parse(stdout);
					const usage = obj.usage ?? {};
					const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
					const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
					// OpenAI pricing estimate: gpt-4o ~$5/1M input, ~$15/1M output
					const totalCostUsd = (inputTokens * 5 + outputTokens * 15) / 1_000_000;
					resolve({
						text: obj.output ?? obj.result ?? obj.text ?? stdout,
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens,
						outputTokens,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCostUsd,
						durationMs,
						model: obj.model ?? opts.model ?? "codex",
					});
				} catch {
					resolve({
						text: stdout.trim(),
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens: 0,
						outputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCostUsd: 0,
						durationMs,
						model: opts.model ?? "codex",
					});
				}
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// CursorAdapter — Cursor Agent CLI
// ---------------------------------------------------------------------------

export class CursorAdapter implements CLIAdapter {
	readonly name = "cursor";

	async isAvailable(): Promise<boolean> {
		const result = await checkBinaryCached(checkBinaryAsync, "cursor", ["agent", "--version"]);
		return result.available;
	}

	async capabilities(): Promise<ProviderCapabilities> {
		return {
			supportedModels: ["cursor-small", "cursor-large"],
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: false,
		};
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		const { spawn } = await import("node:child_process");
		const startTime = Date.now();
		if (!hasFullToolAccess(opts.allowedTools)) {
			throw new Error("Cursor adapter cannot honor restricted tool policies; fallback required");
		}
		const args = ["agent", "-p", "--output-format", "json", "--trust", "--force"];
		if (opts.model) args.push("--model", opts.model);
		const governanceSection = buildToolGovernanceSection(opts.allowedTools);

		return new Promise((resolve, reject) => {
			const proc = spawn("cursor", args, {
				cwd: opts.repoPath,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => {
				proc.kill("SIGKILL");
				reject(new Error("Cursor agent timed out"));
			}, opts.timeoutMs ?? 120_000);

			proc.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			proc.stderr?.on("data", (d) => {
				stderr += d.toString();
			});

			if (opts.signal) {
				opts.signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
			}

			const fullPrompt = [opts.systemPrompt, governanceSection, opts.prompt].filter(Boolean).join("\n\n");
			proc.stdin?.write(fullPrompt);
			proc.stdin?.end();

			proc.on("close", (code) => {
				clearTimeout(timer);
				const durationMs = Date.now() - startTime;
				if (code !== 0) {
					reject(new Error(`Cursor agent exited with code ${code}: ${stderr.slice(0, 500)}`));
					return;
				}
				try {
					const obj = JSON.parse(stdout);
					const usage = obj.usage ?? {};
					resolve({
						text: obj.result ?? obj.text ?? stdout,
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens: usage.input_tokens ?? 0,
						outputTokens: usage.output_tokens ?? 0,
						cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
						cacheReadTokens: usage.cache_read_input_tokens ?? 0,
						totalCostUsd: 0,
						durationMs,
						model: obj.model ?? opts.model ?? "cursor",
					});
				} catch {
					resolve({
						text: stdout.trim(),
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens: 0,
						outputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCostUsd: 0,
						durationMs,
						model: opts.model ?? "cursor",
					});
				}
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Registry-backed adapter bridge
// Wraps a ProviderAdapter from provider-registry into the CLIAdapter interface.
// This unifies execution so the registry is the primary source of adapters.
// ---------------------------------------------------------------------------

class RegistryBackedCLIAdapter implements CLIAdapter {
	readonly name: string;

	constructor(private readonly provider: ProviderAdapter) {
		this.name = provider.id;
	}

	async isAvailable(): Promise<boolean> {
		return this.provider.isAvailable();
	}

	async capabilities(): Promise<ProviderCapabilities> {
		return this.provider.capabilities() as unknown as Promise<ProviderCapabilities>;
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		const result = await this.provider.execute({
			runId: opts.projectId,
			taskId: opts.taskId,
			provider: this.name,
			repoPath: opts.repoPath,
			prompt: opts.prompt,
			systemPrompt: opts.systemPrompt,
			timeoutMs: opts.timeoutMs,
			allowedTools: opts.allowedTools,
			model: opts.model,
			signal: opts.signal,
			onLog: opts.onLog,
		});

		return {
			text: result.text,
			filesCreated: result.filesCreated,
			filesModified: result.filesModified,
			logs: result.logs,
			inputTokens: result.usage?.inputTokens ?? 0,
			outputTokens: result.usage?.outputTokens ?? 0,
			cacheCreationTokens: result.usage?.cacheWriteTokens ?? 0,
			cacheReadTokens: result.usage?.cacheReadTokens ?? 0,
			totalCostUsd: result.usage?.billedCostUsd ?? result.usage?.estimatedCostUsd ?? 0,
			durationMs: result.metadata?.durationMs ?? 0,
			model: result.model ?? opts.model ?? "unknown",
		};
	}
}

// ---------------------------------------------------------------------------
// Factory — CLITool tipine göre adapter döndürür
// Registry öncelikli: eğer provider registry'de varsa onu kullan,
// yoksa legacy adapter'a düş.
// ---------------------------------------------------------------------------

const legacyAdapters: Record<string, CLIAdapter> = {
	"claude-code": new ClaudeAdapter(),
	codex: new CodexAdapter(),
	cursor: new CursorAdapter(),
};

function isMockedFeatureFlagProvider(): boolean {
	return typeof (getFeatureFlags as unknown as { getMockName?: () => string }).getMockName === "function";
}

async function getRegistryAdapter(id: string, autoRegister = true): Promise<CLIAdapter | undefined> {
	try {
		const { providerRegistry } = await import("../kernel/provider-registry.js");
		if (autoRegister && providerRegistry.list().length === 0) {
			providerRegistry.registerDefaultProviders();
		}
		const provider = providerRegistry.get(id);
		if (provider) {
			return new RegistryBackedCLIAdapter(provider);
		}
	} catch {
		// Registry henüz init edilmemiş olabilir — legacy'ye düş
	}
	return undefined;
}

export async function getAdapter(cliTool: AgentCliTool): Promise<CLIAdapter> {
	const features = getFeatureFlags();
	if (isMockedFeatureFlagProvider() && !features.legacyCliAdapter) {
		throw new Error(
			`Legacy CLI adapter fallback is disabled (legacyCliAdapter=false) and no registry adapter found for "${cliTool}"`,
		);
	}

	const allowAutoRegister = !isMockedFeatureFlagProvider() || features.legacyCliAdapter;
	const registryAdapter = await getRegistryAdapter(cliTool, allowAutoRegister);
	if (registryAdapter) {
		return registryAdapter;
	}

	const adapter = legacyAdapters[cliTool];

	if (!adapter) {
		if (cliTool === "none") {
			const defaultRegistryAdapter = await getRegistryAdapter("claude-code", allowAutoRegister);
			if (defaultRegistryAdapter) {
				return defaultRegistryAdapter;
			}
		}

		// Unknown or 'none' → legacy default to Claude only when explicitly enabled
		if (!features.legacyCliAdapter) {
			throw new Error(
				`Legacy CLI adapter fallback is disabled (legacyCliAdapter=false) and no registry adapter found for "${cliTool}"`,
			);
		}
		log.warn(`[cli-adapter] DEPRECATED: Falling back to legacy ClaudeAdapter for unknown tool "${cliTool}"`);
		return legacyAdapters["claude-code"];
	}

	if (!features.legacyCliAdapter) {
		throw new Error(
			`Legacy CLI adapter fallback is disabled (legacyCliAdapter=false) and no registry adapter found for "${cliTool}"`,
		);
	}

	log.warn(
		`[cli-adapter] DEPRECATED: Using legacy ${adapter.constructor.name} for "${cliTool}" — migrate to provider-registry`,
	);
	return adapter;
}

export async function getAdapterChain(primary: AgentCliTool, fallbacks?: AgentCliTool[]): Promise<CLIAdapter[]> {
	const chain: CLIAdapter[] = [await getAdapter(primary)];
	if (fallbacks) {
		for (const fb of fallbacks) {
			const adapter = await getAdapter(fb);
			if (adapter.name !== primary) {
				chain.push(adapter);
			}
		}
	}
	return chain;
}
