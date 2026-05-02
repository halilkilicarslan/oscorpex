// ---------------------------------------------------------------------------
// Oscorpex — Provider Task Runner
// Coordinates provider execution and degraded-provider deferral behavior.
// ---------------------------------------------------------------------------

import type { ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import { agentRuntime } from "../agent-runtime.js";
import { recordStep } from "../agent-runtime/index.js";
import { getTask, updateTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import type { AgentCliTool, AgentConfig, Task } from "../types.js";
import {
	ProviderExecutionService,
	isProvidersExhausted,
	type NormalizedProviderResult,
} from "./provider-execution-service.js";

const log = createLogger("provider-task-runner");

export interface ProviderTaskRunInput {
	projectId: string;
	task: Task;
	agent: AgentConfig;
	runtimeRepoPath: string;
	prompt: string;
	routedModel: string;
	primaryCliTool: AgentCliTool;
	allowedTools: string[];
	timeoutMs: number;
	signal: AbortSignal;
	queueWaitMs: number;
	isColdStart: boolean;
	sessionId?: string;
	telemetry: ProviderTelemetryCollector;
	executeTask: (projectId: string, task: Task) => Promise<void>;
	formatTaskLog: (line: string) => string;
}

export interface ProviderTaskRunResult {
	deferred: boolean;
	result?: NormalizedProviderResult;
}

export async function runProviderTask(input: ProviderTaskRunInput): Promise<ProviderTaskRunResult> {
	const {
		projectId,
		task,
		agent,
		runtimeRepoPath,
		prompt,
		routedModel,
		primaryCliTool,
		allowedTools,
		timeoutMs,
		signal,
		queueWaitMs,
		isColdStart,
		sessionId,
		telemetry,
		executeTask,
		formatTaskLog,
	} = input;

	if (sessionId) {
		recordStep(sessionId, {
			step: 1,
			type: "action_executed",
			summary: `CLI execution started: ${primaryCliTool}`,
		}).catch((err) =>
			log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
		);
	}

	eventBus.emitTransient({
		projectId,
		type: "agent:output",
		agentId: agent.id,
		taskId: task.id,
		payload: { output: `[execution] CLI started: ${primaryCliTool}` },
	});
	agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
	agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(`[execution] CLI started: ${primaryCliTool}`));

	const providerService = new ProviderExecutionService(telemetry);
	const providerExecResult = await providerService.execute({
		projectId,
		taskId: task.id,
		agentId: agent.id,
		agentName: agent.name,
		repoPath: runtimeRepoPath,
		prompt,
		rawSystemPrompt: agent.systemPrompt || undefined,
		agentConfig: { name: agent.name, role: agent.role, model: agent.model, skills: agent.skills ?? [] },
		model: routedModel,
		cliTool: primaryCliTool,
		allowedTools,
		timeoutMs,
		signal,
		onLog: (line: string) => {
			agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
			agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(line));
			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				agentId: agent.id,
				taskId: task.id,
				payload: { output: line },
			});
		},
		queueWaitMs,
		isColdStart,
	});

	if (!isProvidersExhausted(providerExecResult)) {
		return { deferred: false, result: providerExecResult };
	}

	const { retryMs } = providerExecResult;
	log.warn(`[task-executor] All providers exhausted — deferring "${task.title}" for ${Math.round(retryMs / 1000)}s`);
	await updateTask(task.id, { status: "queued" });
	eventBus.emit({
		projectId,
		type: "pipeline:degraded",
		agentId: agent.id,
		taskId: task.id,
		payload: {
			message: `All providers exhausted. Task "${task.title}" deferred. Retry in ${Math.round(retryMs / 1000)}s.`,
			retryMs,
		},
	});

	setTimeout(() => {
		getTask(task.id).then((currentTask) => {
			if (currentTask && currentTask.status === "queued") {
				executeTask(projectId, currentTask).catch((err) =>
					log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
				);
			}
		});
	}, retryMs + 1000);

	return { deferred: true };
}
