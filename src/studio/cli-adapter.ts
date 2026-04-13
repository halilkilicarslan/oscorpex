// ---------------------------------------------------------------------------
// Oscorpex — Multi-CLI Adapter (Faz 4.1)
// CLITool bazlı adapter pattern: her CLI aracı için ayrı implementasyon.
// ---------------------------------------------------------------------------

import type { CLIExecutionResult } from "./cli-runtime.js";
import { executeWithCLI, isClaudeCliAvailable } from "./cli-runtime.js";
import type { CLITool } from "./types.js";

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface CLIAdapterOptions {
	projectId: string;
	agentId: string;
	agentName: string;
	repoPath: string;
	prompt: string;
	systemPrompt: string;
	timeoutMs: number;
	allowedTools?: string[];
	model?: string;
	signal?: AbortSignal;
}

export interface CLIAdapter {
	readonly name: string;
	isAvailable(): Promise<boolean>;
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

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		return executeWithCLI(opts);
	}
}

// ---------------------------------------------------------------------------
// CodexAdapter — OpenAI Codex CLI (skeleton)
// ---------------------------------------------------------------------------

export class CodexAdapter implements CLIAdapter {
	readonly name = "codex";

	async isAvailable(): Promise<boolean> {
		// TODO: codex CLI binary kontrolü
		return false;
	}

	async execute(_opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		throw new Error("Codex CLI adapter is not yet implemented. Use claude-code for now.");
	}
}

// ---------------------------------------------------------------------------
// AiderAdapter — Aider CLI (skeleton)
// ---------------------------------------------------------------------------

export class AiderAdapter implements CLIAdapter {
	readonly name = "aider";

	async isAvailable(): Promise<boolean> {
		// TODO: aider binary kontrolü
		return false;
	}

	async execute(_opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		throw new Error("Aider CLI adapter is not yet implemented. Use claude-code for now.");
	}
}

// ---------------------------------------------------------------------------
// Factory — CLITool tipine göre adapter döndürür
// ---------------------------------------------------------------------------

const adapters: Record<string, CLIAdapter> = {
	"claude-code": new ClaudeAdapter(),
	codex: new CodexAdapter(),
	aider: new AiderAdapter(),
};

export function getAdapter(cliTool: CLITool): CLIAdapter {
	const adapter = adapters[cliTool];
	if (!adapter) {
		// Bilinmeyen veya 'none' → default olarak Claude kullan
		return adapters["claude-code"];
	}
	return adapter;
}
