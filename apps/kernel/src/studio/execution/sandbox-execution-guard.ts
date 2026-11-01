// ---------------------------------------------------------------------------
// Oscorpex — Sandbox Execution Guard
// Owns sandbox setup and pre/post execution checks.
// ---------------------------------------------------------------------------

import { type ExecutionWorkspace, resolveWorkspace } from "../execution-workspace.js";
import { createLogger } from "../logger.js";
import {
	type SandboxPolicy,
	SandboxViolationError,
	endSandboxSession,
	enforceOutputSizeCheck,
	enforcePathChecks,
	enforceToolCheck,
	resolveTaskPolicy,
	startSandboxSession,
} from "../sandbox-manager.js";
import type { RiskLevel, Task, TaskOutput } from "../types.js";

const log = createLogger("sandbox-execution-guard");

/** The isolation the policy demands cannot be provided; the task must fail, never run in the source repo. */
export class IsolationUnavailableError extends Error {
	constructor(taskId: string, cause: unknown) {
		super(`Isolation unavailable for task ${taskId}: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = "IsolationUnavailableError";
	}
}

export interface SandboxExecutionContext {
	sandboxSessionId?: string;
	sandboxPolicy?: SandboxPolicy;
	isolatedWorkspace?: ExecutionWorkspace;
	runtimeRepoPath: string;
}

export async function setupSandboxExecution(
	projectId: string,
	task: Task,
	agentId: string,
	agentRole: string,
	repoPath: string,
	riskLevel?: RiskLevel,
): Promise<SandboxExecutionContext> {
	const context: SandboxExecutionContext = { runtimeRepoPath: repoPath };

	// Fail closed: without a resolvable policy the isolation level is unknown, so the task must not run
	try {
		context.sandboxPolicy = await resolveTaskPolicy(projectId, task, agentRole, riskLevel);
	} catch (err) {
		throw new IsolationUnavailableError(task.id, err);
	}

	if (repoPath) {
		// Fail closed: a workspace that cannot be resolved (container/vm/unknown level, copy failure) fails the task
		// instead of silently running in the source repo.
		try {
			context.isolatedWorkspace = await resolveWorkspace(repoPath, task.id, context.sandboxPolicy);
		} catch (err) {
			throw new IsolationUnavailableError(task.id, err);
		}
		context.runtimeRepoPath = context.isolatedWorkspace.repoPath || repoPath;
		try {
			const session = await startSandboxSession({
				projectId,
				taskId: task.id,
				agentId,
				workspacePath: context.runtimeRepoPath,
			});
			context.sandboxSessionId = session.id;
		} catch (err) {
			log.warn(`[task-executor] Sandbox session start failed (non-blocking): ${String(err)}`);
		}
	}

	return context;
}

export async function enforceSandboxPreExecution(
	sandboxPolicy: SandboxPolicy | undefined,
	allowedTools: string[],
	sandboxSessionId: string | undefined,
): Promise<void> {
	if (!sandboxPolicy || sandboxPolicy.enforcementMode === "off") return;

	for (const tool of allowedTools) {
		await enforceToolCheck(sandboxPolicy, tool, sandboxSessionId);
	}
	for (const denied of sandboxPolicy.deniedTools) {
		if (allowedTools.includes(denied)) {
			await enforceToolCheck(sandboxPolicy, denied, sandboxSessionId);
		}
	}
}

export function enforceSandboxHardPreflight(sandboxPolicy: SandboxPolicy | undefined, allowedTools: string[]): void {
	if (sandboxPolicy?.enforcementMode !== "hard" || sandboxPolicy.deniedTools.length === 0) return;

	const deniedInAllowed = allowedTools.filter((tool) => sandboxPolicy.deniedTools.includes(tool));
	if (deniedInAllowed.length > 0) {
		throw new SandboxViolationError({
			type: "tool_denied",
			detail: `Pre-execution tool check: denied tools in allowedTools list: ${deniedInAllowed.join(", ")}`,
			timestamp: new Date().toISOString(),
		});
	}
}

export async function enforceSandboxPostExecution(
	sandboxPolicy: SandboxPolicy | undefined,
	output: TaskOutput,
	sandboxSessionId: string | undefined,
): Promise<void> {
	if (!sandboxPolicy || sandboxPolicy.enforcementMode === "off") return;

	const allPaths = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
	if (allPaths.length > 0) {
		await enforcePathChecks(sandboxPolicy, allPaths, sandboxSessionId);
	}
	const outputSizeEstimate = JSON.stringify(output).length;
	await enforceOutputSizeCheck(sandboxPolicy, outputSizeEstimate, sandboxSessionId);
}

export function closeSandboxExecution(
	context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace">,
): void {
	if (context.sandboxSessionId) {
		endSandboxSession(context.sandboxSessionId).catch((err) =>
			log.warn(`[task-executor] Sandbox end failed: ${String(err)}`),
		);
	}
	if (context.isolatedWorkspace?.isolated) {
		context.isolatedWorkspace
			.cleanup()
			.catch((err) => log.warn(`[task-executor] Workspace cleanup failed: ${String(err)}`));
	}
}
