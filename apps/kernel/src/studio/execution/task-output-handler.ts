// ---------------------------------------------------------------------------
// Oscorpex — Task Output Handler
// Normalizes provider output and runs completion side effects.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { recordStep } from "../agent-runtime/index.js";
import { enforceBudgetGuard } from "../budget-guard.js";
import { recordTokenUsage } from "../db.js";
import { updateDocsAfterTask } from "../docs-generator.js";
import { eventBus } from "../event-bus.js";
import { runLintFix } from "../lint-runner.js";
import { createLogger } from "../logger.js";
import { persistAgentLog } from "../agent-log-store.js";
import { processAgentProposals } from "../proposal-processor.js";
import type { ExecutionWorkspace } from "../execution-workspace.js";
import type { AgentConfig, Project, Task, TaskOutput } from "../types.js";
import type { NormalizedProviderResult } from "./provider-execution-service.js";
import type { agentRuntime as agentRuntimeApi } from "../agent-runtime.js";

const log = createLogger("task-output-handler");

export function resolveFilePaths(files: string[], repoPath: string): string[] {
	return files
		.filter(Boolean)
		.map((file) => {
			if (file.startsWith(repoPath)) {
				return file.slice(repoPath.length + 1);
			}
			const absolutePath = resolve(repoPath, file);
			if (existsSync(absolutePath)) {
				return file;
			}
			return file;
		})
		.filter((file, index, allFiles) => allFiles.indexOf(file) === index);
}

export async function buildTaskOutput(
	cliResult: NormalizedProviderResult,
	runtimeRepoPath: string,
	isolatedWorkspace?: ExecutionWorkspace,
): Promise<TaskOutput> {
	const output: TaskOutput = {
		filesCreated: resolveFilePaths(cliResult.filesCreated, runtimeRepoPath),
		filesModified: resolveFilePaths(cliResult.filesModified, runtimeRepoPath),
		logs: cliResult.logs,
	};

	if (isolatedWorkspace?.isolated) {
		const synced = await isolatedWorkspace.writeBack([...(output.filesCreated ?? []), ...(output.filesModified ?? [])]);
		output.filesCreated = output.filesCreated.filter((file) => synced.includes(file));
		output.filesModified = output.filesModified.filter((file) => synced.includes(file));
	}

	return output;
}

export function recordOutputReceived(sessionId: string | undefined, output: TaskOutput): void {
	if (!sessionId) return;

	const fileCount = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0);
	recordStep(sessionId, {
		step: 2,
		type: "result_inspected",
		summary: `Output received: ${fileCount} files (${output.filesCreated?.length ?? 0} created, ${output.filesModified?.length ?? 0} modified)`,
	}).catch((err) =>
		log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
	);
}

export async function runTaskCompletionEffects(input: {
	projectId: string;
	project: Project;
	task: Task;
	agent: AgentConfig;
	output: TaskOutput;
	cliResult: NormalizedProviderResult;
	agentRuntime: typeof agentRuntimeApi;
	formatTaskLog: (line: string) => string;
}): Promise<void> {
	const { projectId, project, task, agent, output, cliResult, agentRuntime, formatTaskLog } = input;

	if (cliResult.inputTokens || cliResult.outputTokens) {
		const totalTokens = cliResult.inputTokens + cliResult.outputTokens;
		await recordTokenUsage({
			projectId,
			taskId: task.id,
			agentId: agent.id,
			model: cliResult.model || "claude-sonnet-4-6",
			provider: cliResult.provider || "anthropic",
			inputTokens: cliResult.inputTokens,
			outputTokens: cliResult.outputTokens,
			totalTokens,
			costUsd: cliResult.costUsd,
			cacheCreationTokens: cliResult.cacheCreationTokens,
			cacheReadTokens: cliResult.cacheReadTokens,
		});

		const budgetExceeded = await enforceBudgetGuard(projectId);
		if (budgetExceeded) {
			log.warn(`[task-executor] Budget exceeded — completing "${task.title}" but pausing pipeline`);
		}
	}

	eventBus.emitTransient({
		projectId,
		type: "agent:output",
		agentId: agent.id,
		taskId: task.id,
		payload: { output: "[execution] Mode: cli" },
	});
	agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
	agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog("[execution] Mode: cli"));

	const allFiles = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
	if (allFiles.length > 0 && project.repoPath) {
		try {
			const termLog = (msg: string) => {
				agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
				agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(msg));
			};
			const lintResult = await runLintFix(project.repoPath, allFiles, termLog);
			if (lintResult.eslint.errors.length > 0 || lintResult.prettier.errors.length > 0) {
				eventBus.emitTransient({
					projectId,
					type: "agent:output",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						output: `[lint] Uyarılar: eslint(${lintResult.eslint.errors.length}), prettier(${lintResult.prettier.errors.length})`,
					},
				});
			}
		} catch (err) {
			log.warn({ err }, "Lint/format failed (non-blocking)");
		}
	}

	try {
		await updateDocsAfterTask(project, { ...task, output }, agent, (msg) => {
			agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
			agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(msg));
		});
	} catch (err) {
		log.warn({ err }, "Docs update failed (non-blocking)");
	}

	const agentOutputLines = agentRuntime.getAgentOutput(projectId, agent.id);
	if (agentOutputLines.length > 0) {
		persistAgentLog(projectId, agent.id, agentOutputLines).catch((err) =>
			log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
		);
	}

	if (cliResult.proposals && cliResult.proposals.length > 0) {
		try {
			await processAgentProposals(projectId, task, agent, cliResult.proposals);
		} catch (err) {
			log.warn("[task-executor] Proposal processing failed (non-blocking):" + " " + String(err));
		}
	}
}
