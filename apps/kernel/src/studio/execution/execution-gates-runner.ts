// ---------------------------------------------------------------------------
// Oscorpex — Execution Gates Runner
// Runs output verification, test gates, and goal evaluation.
// ---------------------------------------------------------------------------

import { runGoalEvaluation, runTestGateCheck, runVerificationGate } from "../execution-gates.js";
import { createLogger } from "../logger.js";
import type { AgentConfig, Task, TaskOutput } from "../types.js";

const log = createLogger("execution-gates-runner");

export async function runOutputAndTestGates(
	projectId: string,
	task: Task,
	repoPath: string,
	output: TaskOutput,
	agent: AgentConfig,
	sessionId?: string,
): Promise<void> {
	const verifyResult = await runVerificationGate(projectId, task, repoPath, output, agent.id, sessionId);
	if (!verifyResult.passed) {
		throw new Error(`Output verification failed: ${verifyResult.failedChecks}`);
	}

	const testResult = await runTestGateCheck(projectId, task, repoPath, output, agent.role, agent.id, sessionId);
	if (!testResult.passed) {
		throw new Error(testResult.failedChecks!);
	}
}

export async function runGoalGate(
	taskId: string,
	taskTitle: string,
	output: TaskOutput,
	projectId: string,
): Promise<void> {
	try {
		await runGoalEvaluation(taskId, taskTitle, output, projectId);
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("Goal validation failed")) throw err;
		log.warn({ err }, "Goal evaluation failed (non-blocking)");
	}
}
