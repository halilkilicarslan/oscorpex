// ---------------------------------------------------------------------------
// Oscorpex — Execution Gates
// Post-execution verification, test, and goal validation gates.
// Extracted from execution-engine.ts for single-responsibility.
// ---------------------------------------------------------------------------

import { eventBus } from "./event-bus.js";
import { getGoalForTask, validateCriteriaFromOutput, validateCriteriaWithLLM, evaluateGoal, resolveGoalEnforcement, shouldEnforceGoalFailure } from "./goal-engine.js";
import { verifyTaskOutput, resolveStrictness } from "./output-verifier.js";
import { runTestGate } from "./test-gate.js";
import { recordStep } from "./agent-runtime/index.js";
import type { Task, TaskOutput } from "./types.js";

// ---------------------------------------------------------------------------
// Verification gate
// ---------------------------------------------------------------------------

export interface GateResult {
	passed: boolean;
	failedChecks?: string;
}

export async function runVerificationGate(
	projectId: string,
	task: Task,
	repoPath: string,
	output: TaskOutput,
	agentId: string,
	sessionId?: string,
): Promise<GateResult> {
	const strictness = await resolveStrictness(projectId);
	const verification = await verifyTaskOutput(task.id, repoPath, output, { projectId, strictness });

	if (!verification.allPassed) {
		const failedChecks = verification.results
			.filter((r) => !r.passed)
			.map((r) => `${r.type}: ${r.details.map((d) => d.file ?? d.actual).join(", ")}`)
			.join("; ");

		console.warn(`[execution-gates] Output verification failed for "${task.title}": ${failedChecks}`);
		eventBus.emitTransient({
			projectId,
			type: "agent:output",
			agentId,
			taskId: task.id,
			payload: { output: `[verify] Output verification failed: ${failedChecks}` },
		});

		const hasEmptyFail = verification.results.some((r) => !r.passed && r.type === "output_non_empty");
		const hasFileFail = verification.results.some(
			(r) => !r.passed && (r.type === "files_exist" || r.type === "files_modified"),
		);

		if (sessionId) {
			recordStep(sessionId, { step: 3, type: "decision_made", summary: "Verification: failed" })
				.catch((err) => console.warn("[execution-gates] recordStep failed:", err?.message ?? err));
		}

		if (hasEmptyFail || (strictness === "strict" && hasFileFail)) {
			return { passed: false, failedChecks };
		}
	} else if (sessionId) {
		recordStep(sessionId, { step: 3, type: "decision_made", summary: "Verification: passed" })
			.catch((err) => console.warn("[execution-gates] recordStep failed:", err?.message ?? err));
	}

	return { passed: true };
}

// ---------------------------------------------------------------------------
// Test gate
// ---------------------------------------------------------------------------

export async function runTestGateCheck(
	projectId: string,
	task: Task,
	repoPath: string,
	output: TaskOutput,
	agentRole: string,
	agentId: string,
	sessionId?: string,
): Promise<GateResult> {
	const testResult = await runTestGate(projectId, task, repoPath, output, agentRole);

	if (!testResult.passed) {
		console.warn(`[execution-gates] Test gate failed for "${task.title}": ${testResult.summary}`);
		eventBus.emitTransient({
			projectId,
			type: "agent:output",
			agentId,
			taskId: task.id,
			payload: { output: `[test-gate] ${testResult.summary}` },
		});

		if (sessionId) {
			recordStep(sessionId, { step: 4, type: "decision_made", summary: `Test gate: failed: ${testResult.summary}` })
				.catch((err) => console.warn("[execution-gates] recordStep failed:", err?.message ?? err));
		}

		if (testResult.policy === "required") {
			return { passed: false, failedChecks: `Test gate failed (required): ${testResult.summary}` };
		}
	} else {
		if (testResult.testsTotal > 0) {
			output.testResults = {
				passed: testResult.testsPassed,
				failed: testResult.testsFailed,
				total: testResult.testsTotal,
			};
		}
		if (sessionId) {
			recordStep(sessionId, { step: 4, type: "decision_made", summary: `Test gate: passed (${testResult.testsTotal} tests)` })
				.catch((err) => console.warn("[execution-gates] recordStep failed:", err?.message ?? err));
		}
	}

	return { passed: true };
}

// ---------------------------------------------------------------------------
// Goal evaluation gate
// ---------------------------------------------------------------------------

export async function runGoalEvaluation(
	goalId: string,
	taskTitle: string,
	output: TaskOutput,
	projectId: string,
): Promise<void> {
	const goal = await getGoalForTask(goalId);
	if (!goal) return;

	const results = await validateCriteriaWithLLM(goal, output).catch(() =>
		validateCriteriaFromOutput(goal, output),
	);
	await evaluateGoal(goalId, results);

	const enforcement = await resolveGoalEnforcement(projectId);
	if (shouldEnforceGoalFailure(results, enforcement)) {
		const failedCriteria = results.filter((r) => !r.met).map((r) => r.criterion).join("; ");
		console.warn(`[execution-gates] Goal enforcement: "${taskTitle}" failed criteria — triggering revision`);
		throw new Error(`Goal validation failed (${enforcement}): ${failedCriteria}`);
	}
}
