// @oscorpex/provider-claude — Claude Code CLI adapter (native)
// Spawns the `claude` CLI binary directly with stream-json parsing.

import type {
	ProviderAdapter,
	ProviderCapabilities,
	ProviderExecutionInput,
	ProviderExecutionResult,
	ProviderHealth,
} from "@oscorpex/core";
import {
	runCLI,
	classifyExit,
	checkBinaryAsync,
	buildToolGovernanceSection,
	hasFullToolAccess,
	calculateCost,
} from "@oscorpex/provider-sdk";
import { ProviderUnavailableError, ProviderExecutionError, ProviderTimeoutError } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function resolveBinary(): string {
	return process.env.CLAUDE_CLI_PATH ?? "claude";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeCodeAdapter implements ProviderAdapter {
	readonly id = "claude-code";
	private binary = resolveBinary();

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: true,
			supportsStreaming: true,
			supportsResume: true,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: true,
			supportedModels: ["sonnet", "opus", "haiku"],
		};
	}

	async isAvailable(): Promise<boolean> {
		const result = await checkBinaryAsync(this.binary, ["--version"]);
		return result.available;
	}

	async health(): Promise<ProviderHealth> {
		const result = await checkBinaryAsync(this.binary, ["--version"]);
		return {
			healthy: result.available,
			message: result.available ? result.version : result.error,
		};
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();

		// Availability pre-check
		const available = await this.isAvailable();
		if (!available) {
			throw new ProviderUnavailableError(this.id, `Claude CLI binary "${this.binary}" not found`);
		}

		// Tool governance
		const restricted = input.allowedTools && !hasFullToolAccess(input.allowedTools);
		const governanceSection = restricted ? buildToolGovernanceSection(input.allowedTools) : "";
		const fullPrompt = governanceSection ? `${governanceSection}\n\n${input.prompt}` : input.prompt;

		// Build CLI args (aligned with kernel cli-runtime.ts stable flags)
		const model = input.model ?? "sonnet";
		const timeoutMs = input.timeoutMs ?? 300_000;
		const maxTurns = Number.parseInt(process.env.OSCORPEX_CLAUDE_MAX_TURNS ?? "80", 10);
		const safeMaxTurns = Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 80;
		const args = [
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--permission-mode",
			"bypassPermissions",
			"--model",
			model,
			"--system-prompt",
			input.systemPrompt ?? "",
			"--max-turns",
			String(safeMaxTurns),
			"--tools",
			(input.allowedTools?.length ? input.allowedTools : ["Read", "Edit", "Write", "Bash", "Glob", "Grep"]).join(","),
			"--disable-slash-commands",
			"--no-session-persistence",
			"--max-budget-usd",
			String(Math.max(2, (timeoutMs / 60000) * 1)),
		];
		if (restricted && input.allowedTools) {
			args.push("--allowed-tools", input.allowedTools.join(","));
		}

		// Spawn
		let streamBuffer = "";
		const runResult = await runCLI({
			binary: this.binary,
			args,
			cwd: input.repoPath,
			timeoutMs,
			signal: input.signal,
			stdin: fullPrompt,
			onStdoutChunk: (chunk) => {
				if (!input.onLog) return;
				streamBuffer += chunk;
				const lines = streamBuffer.split("\n");
				streamBuffer = lines.pop() ?? "";
				for (const line of lines) {
					emitClaudeStreamLine(line, input.onLog);
				}
			},
			onStderrChunk: (chunk) => {
				if (!input.onLog) return;
				const text = chunk.trim();
				if (text) input.onLog(`[stderr] ${text}`);
			},
		});
		if (input.onLog && streamBuffer.trim()) {
			emitClaudeStreamLine(streamBuffer, input.onLog);
		}

		// Classify exit
		const classified = classifyExit(runResult);
		const completedAt = new Date().toISOString();

		if (classified.classification === "timeout") {
			throw new ProviderTimeoutError(this.id, input.taskId, runResult.durationMs);
		}
		if (classified.classification === "killed") {
			throw new ProviderExecutionError(
				this.id,
				input.taskId,
				runResult.exitCode,
				`Claude CLI killed: ${classified.message}`,
			);
		}
		if (classified.classification !== "success") {
			throw new ProviderExecutionError(
				this.id,
				input.taskId,
				runResult.exitCode,
				classified.message,
			);
		}

		const parsed = parseClaudeStreamJson(runResult.stdout);
		const text = parsed.text.trim();
		const filesCreated = parsed.filesCreated;
		const filesModified = parsed.filesModified;
		const usage = {
			inputTokens: parsed.inputTokens,
			outputTokens: parsed.outputTokens,
			cacheCreationTokens: parsed.cacheCreationTokens,
			cacheReadTokens: parsed.cacheReadTokens,
		};

		// Cost normalization
		const costUsd = calculateCost(model, usage.inputTokens, usage.outputTokens);

		return {
			provider: this.id,
			model,
			text,
			filesCreated,
			filesModified,
			logs: [...parsed.logs, ...(runResult.stderr ? [runResult.stderr] : [])],
			usage: {
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheCreationTokens,
				billedCostUsd: costUsd,
			},
			startedAt,
			completedAt,
			metadata: {
				durationMs: runResult.durationMs,
				exitCode: runResult.exitCode,
			},
		};
	}

	async cancel(input: { runId: string; taskId: string }): Promise<void> {
		// Registry-level cancel handles AbortController.signal;
		// adapter-level cancel is a no-op for now.
		void input;
	}
}

function emitClaudeStreamLine(rawLine: string, onLog: (line: string) => void): void {
	const line = rawLine.trim();
	if (!line) return;
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return;
	}
	if (!event || typeof event !== "object") return;
	if (event.type === "assistant" && event.message?.content) {
		for (const block of event.message.content as Array<any>) {
			if (block?.type === "tool_use" && typeof block.name === "string") {
				const input = block.input ?? {};
				const filePath = input.file_path ?? input.path;
				if (typeof filePath === "string" && filePath.length > 0) {
					onLog(`>> ${block.name}: ${filePath}`);
				} else {
					onLog(`>> ${block.name}`);
				}
			}
			if (block?.type === "text" && typeof block.text === "string") {
				const text = block.text.trim();
				if (text) onLog(text);
			}
		}
	}
	if (event.type === "result") {
		onLog(`[result] ${event.subtype ?? "completed"}`);
	}
}

interface ParsedClaudeStream {
	text: string;
	filesCreated: string[];
	filesModified: string[];
	logs: string[];
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
}

function parseClaudeStreamJson(stdout: string): ParsedClaudeStream {
	const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
	const filesCreated = new Set<string>();
	const filesModified = new Set<string>();
	const logs: string[] = [];
	let text = "";
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheCreationTokens = 0;
	let cacheReadTokens = 0;

	for (const line of lines) {
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!event || typeof event !== "object") continue;

		if (event.type === "assistant" && event.message?.content) {
			for (const block of event.message.content as Array<any>) {
				if (block?.type === "text" && typeof block.text === "string") {
					text += block.text + "\n";
				}
				if (block?.type === "tool_use" && typeof block.name === "string") {
					const input = block.input ?? {};
					const filePath = input.file_path ?? input.path;
					if (typeof filePath === "string" && filePath.length > 0) {
						if (block.name === "Write") filesCreated.add(filePath);
						if (block.name === "Edit") filesModified.add(filePath);
					}
					logs.push(`[tool] ${block.name}`);
				}
			}
			const usage = event.message.usage;
			if (usage) {
				inputTokens += usage.input_tokens ?? 0;
				outputTokens += usage.output_tokens ?? 0;
				cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
				cacheReadTokens += usage.cache_read_input_tokens ?? 0;
			}
		}

		if (event.type === "result") {
			const usage = event.usage;
			if (usage) {
				inputTokens = Math.max(inputTokens, usage.input_tokens ?? 0);
				outputTokens = Math.max(outputTokens, usage.output_tokens ?? 0);
				cacheCreationTokens = Math.max(cacheCreationTokens, usage.cache_creation_input_tokens ?? 0);
				cacheReadTokens = Math.max(cacheReadTokens, usage.cache_read_input_tokens ?? 0);
			}
		}
	}

	if (text.trim().length === 0 && stdout.trim().length > 0) {
		try {
			const data = JSON.parse(stdout.trim()) as any;
			const directText = data?.output ?? data?.result ?? data?.text ?? data?.content;
			if (typeof directText === "string" && directText.trim().length > 0) {
				text = directText;
			}
			const created = data?.files_created ?? data?.filesCreated;
			const modified = data?.files_modified ?? data?.filesModified;
			if (Array.isArray(created)) {
				for (const file of created) {
					if (typeof file === "string" && file) filesCreated.add(file);
				}
			}
			if (Array.isArray(modified)) {
				for (const file of modified) {
					if (typeof file === "string" && file) filesModified.add(file);
				}
			}
			const usage = data?.usage;
			inputTokens = Math.max(inputTokens, usage?.input_tokens ?? usage?.inputTokens ?? data?.input_tokens ?? data?.inputTokens ?? 0);
			outputTokens = Math.max(outputTokens, usage?.output_tokens ?? usage?.outputTokens ?? data?.output_tokens ?? data?.outputTokens ?? 0);
			cacheCreationTokens = Math.max(
				cacheCreationTokens,
				usage?.cache_creation_input_tokens ?? usage?.cacheCreationTokens ?? data?.cache_creation_input_tokens ?? data?.cacheCreationTokens ?? 0,
			);
			cacheReadTokens = Math.max(
				cacheReadTokens,
				usage?.cache_read_input_tokens ?? usage?.cacheReadTokens ?? data?.cache_read_input_tokens ?? data?.cacheReadTokens ?? 0,
			);
		} catch {
			text = stdout.trim();
		}
	}

	return {
		text,
		filesCreated: [...filesCreated],
		filesModified: [...filesModified],
		logs,
		inputTokens,
		outputTokens,
		cacheCreationTokens,
		cacheReadTokens,
	};
}
