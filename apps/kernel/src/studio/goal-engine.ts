// ---------------------------------------------------------------------------
// Oscorpex — Goal Engine: Goal-based execution model
// Shifts from "task as terminal command" to "goal as executable unit."
// A goal has constraints, success criteria, and the agent decomposes within bounds.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	query,
	queryOne,
	execute,
	getTask,
	updateTask,
	createTask,
	listProjectTasks,
	getProjectSetting,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import type { Task } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("goal-engine");

export type GoalEnforcementMode = "enforce" | "advisory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoalStatus = "pending" | "active" | "achieved" | "failed" | "partial";

export interface GoalDefinition {
	goal: string;
	constraints: string[];
	successCriteria: string[];
}

export interface ExecutionGoal {
	id: string;
	projectId: string;
	taskId?: string;
	definition: GoalDefinition;
	status: GoalStatus;
	criteriaResults: CriterionResult[];
	createdAt: string;
	completedAt?: string;
}

export interface CriterionResult {
	criterion: string;
	met: boolean;
	evidence?: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToGoal(row: Record<string, unknown>): ExecutionGoal {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		taskId: (row.task_id as string) ?? undefined,
		definition: row.definition as GoalDefinition,
		status: row.status as GoalStatus,
		criteriaResults: (row.criteria_results as CriterionResult[]) ?? [],
		createdAt: row.created_at as string,
		completedAt: (row.completed_at as string) ?? undefined,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createGoal(params: {
	projectId: string;
	taskId?: string;
	definition: GoalDefinition;
}): Promise<ExecutionGoal> {
	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO execution_goals (id, project_id, task_id, definition, status, criteria_results)
		 VALUES ($1, $2, $3, $4, 'pending', '[]'::jsonb)
		 RETURNING *`,
		[id, params.projectId, params.taskId ?? null, JSON.stringify(params.definition)],
	);
	return rowToGoal(row!);
}

export async function getGoal(id: string): Promise<ExecutionGoal | null> {
	const row = await queryOne(`SELECT * FROM execution_goals WHERE id = $1`, [id]);
	return row ? rowToGoal(row) : null;
}

export async function getGoalForTask(taskId: string): Promise<ExecutionGoal | null> {
	const row = await queryOne(`SELECT * FROM execution_goals WHERE task_id = $1`, [taskId]);
	return row ? rowToGoal(row) : null;
}

export async function ensureGoalForTask(params: {
	projectId: string;
	taskId: string;
	definition: GoalDefinition;
	activate?: boolean;
}): Promise<ExecutionGoal> {
	const existing = await getGoalForTask(params.taskId);
	if (existing) {
		const row = await queryOne(
			`UPDATE execution_goals
			 SET definition = $2, status = $3
			 WHERE id = $1
			 RETURNING *`,
			[existing.id, JSON.stringify(params.definition), params.activate === false ? existing.status : "active"],
		);
		return rowToGoal(row!);
	}

	const created = await createGoal({
		projectId: params.projectId,
		taskId: params.taskId,
		definition: params.definition,
	});

	return params.activate === false ? created : activateGoal(created.id);
}

export async function listGoals(projectId: string, status?: GoalStatus): Promise<ExecutionGoal[]> {
	if (status) {
		const rows = await query(
			`SELECT * FROM execution_goals WHERE project_id = $1 AND status = $2 ORDER BY created_at DESC`,
			[projectId, status],
		);
		return rows.map(rowToGoal);
	}
	const rows = await query(
		`SELECT * FROM execution_goals WHERE project_id = $1 ORDER BY created_at DESC`,
		[projectId],
	);
	return rows.map(rowToGoal);
}

// ---------------------------------------------------------------------------
// Goal lifecycle
// ---------------------------------------------------------------------------

export async function activateGoal(goalId: string): Promise<ExecutionGoal> {
	const row = await queryOne(
		`UPDATE execution_goals SET status = 'active' WHERE id = $1 RETURNING *`,
		[goalId],
	);
	return rowToGoal(row!);
}

export async function evaluateGoal(
	goalId: string,
	results: CriterionResult[],
): Promise<ExecutionGoal> {
	const goal = await getGoal(goalId);
	if (!goal) throw new Error(`Goal ${goalId} not found`);

	const allMet = results.every((r) => r.met);
	const someMet = results.some((r) => r.met);
	const status: GoalStatus = allMet ? "achieved" : someMet ? "partial" : "failed";

	const row = await queryOne(
		`UPDATE execution_goals
		 SET status = $2, criteria_results = $3, completed_at = CASE WHEN $2 IN ('achieved', 'failed') THEN now() ELSE completed_at END
		 WHERE id = $1 RETURNING *`,
		[goalId, status, JSON.stringify(results)],
	);

	const updated = rowToGoal(row!);

	eventBus.emit({
		projectId: goal.projectId,
		type: "goal:evaluated",
		taskId: goal.taskId,
		payload: {
			goalId,
			status,
			metCount: results.filter((r) => r.met).length,
			totalCount: results.length,
		},
	});

	return updated;
}

export async function failGoal(goalId: string, reason: string): Promise<ExecutionGoal> {
	const row = await queryOne(
		`UPDATE execution_goals SET status = 'failed', completed_at = now(),
		 criteria_results = criteria_results || $2::jsonb
		 WHERE id = $1 RETURNING *`,
		[goalId, JSON.stringify([{ criterion: "execution", met: false, evidence: reason }])],
	);
	return rowToGoal(row!);
}

// ---------------------------------------------------------------------------
// Goal prompt builder — format goal definition for agent context
// ---------------------------------------------------------------------------

export function formatGoalPrompt(goal: ExecutionGoal): string {
	const def = goal.definition;
	const lines: string[] = [
		`--- GOAL ---`,
		`Objective: ${def.goal}`,
		``,
		`Constraints:`,
		...def.constraints.map((c) => `  - ${c}`),
		``,
		`Success Criteria (ALL must be met):`,
		...def.successCriteria.map((sc, i) => `  ${i + 1}. ${sc}`),
		`--- END GOAL ---`,
	];
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Criteria validation — check if output satisfies criteria
// ---------------------------------------------------------------------------

export function validateCriteriaFromOutput(
	goal: ExecutionGoal,
	output: { filesCreated?: string[]; filesModified?: string[]; logs?: string[]; testResults?: { passed: number; failed: number; total: number } },
): CriterionResult[] {
	const testSummary = output.testResults ? `tests: ${output.testResults.passed} passed, ${output.testResults.failed} failed` : "";
	const allText = [
		...(output.filesCreated ?? []),
		...(output.filesModified ?? []),
		...(output.logs ?? []),
		testSummary,
	].join("\n").toLowerCase();

	return goal.definition.successCriteria.map((criterion) => {
		// Keyword-based heuristic — fast fallback when LLM validation unavailable
		const keywords = criterion.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
		const matchCount = keywords.filter((kw) => allText.includes(kw)).length;
		const confidence = keywords.length > 0 ? matchCount / keywords.length : 0;

		return {
			criterion,
			met: confidence >= 0.5,
			confidence,
			evidence: confidence >= 0.5
				? `Keyword match: ${Math.round(confidence * 100)}% of criteria terms found in output`
				: `Low match: only ${Math.round(confidence * 100)}% of criteria terms found`,
		};
	});
}

// ---------------------------------------------------------------------------
// v8.0: LLM-enhanced goal validation
// Uses a lightweight model (Haiku) to validate output against criteria.
// Falls back to keyword heuristic if LLM call fails.
// ---------------------------------------------------------------------------

/**
 * Validate goal criteria using LLM for higher accuracy.
 * Only called when task has explicit goals — skip for goalless tasks.
 */
export async function validateCriteriaWithLLM(
	goal: ExecutionGoal,
	output: { filesCreated?: string[]; filesModified?: string[]; logs?: string[]; testResults?: { passed: number; failed: number; total: number } },
): Promise<CriterionResult[]> {
	try {
		const { getAIModelWithFallback } = await import("./ai-provider-factory.js");
		const { generateObject } = await import("ai");
		const { z } = await import("zod");

		const outputSummary = [
			output.filesCreated?.length ? `Files created: ${output.filesCreated.join(", ")}` : "",
			output.filesModified?.length ? `Files modified: ${output.filesModified.join(", ")}` : "",
			output.logs?.slice(0, 10).join("\n") ?? "",
			output.testResults ? `Tests: ${output.testResults.passed}/${output.testResults.total} passed` : "",
		].filter(Boolean).join("\n").slice(0, 3000); // Cap for token budget

		const result = await getAIModelWithFallback(async (model: any) => {
			return generateObject({
				model,
				schema: z.object({
					criteria: z.array(z.object({
						criterion: z.string(),
						met: z.boolean(),
						confidence: z.number().min(0).max(1),
						evidence: z.string(),
					})),
				}),
				system: "You are a goal validation assistant. Evaluate whether the given output satisfies each success criterion. Be precise and evidence-based.",
				prompt: `Goal: ${goal.definition.goal}\n\nSuccess Criteria:\n${goal.definition.successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nTask Output:\n${outputSummary}\n\nFor each criterion, determine if it was met and provide evidence.`,
				maxOutputTokens: 500,
			});
		});

		return result.object.criteria.map((c: any) => ({
			criterion: c.criterion,
			met: c.met,
			confidence: c.confidence,
			evidence: c.evidence,
		}));
	} catch (err) {
		log.warn("[goal-engine] LLM validation failed, falling back to keyword heuristic:" + " " + String(err));
		return validateCriteriaFromOutput(goal, output);
	}
}

// ---------------------------------------------------------------------------
// v8.0: Goal enforcement — make goal failures actionable
// ---------------------------------------------------------------------------

/**
 * Resolve goal enforcement mode from project settings.
 * Default: "enforce" — goal failure triggers task revision.
 */
export async function resolveGoalEnforcement(projectId: string): Promise<GoalEnforcementMode> {
	const setting = await getProjectSetting(projectId, "goals", "enforcement");
	if (setting === "advisory") return "advisory";
	return "enforce";
}

/**
 * Check if goal results indicate failure and whether enforcement should trigger.
 * Returns true if goal failed AND enforcement mode requires action.
 */
export function shouldEnforceGoalFailure(
	results: CriterionResult[],
	mode: GoalEnforcementMode,
): boolean {
	if (mode !== "enforce") return false;
	// All criteria must be met for goal success
	const allMet = results.every((r) => r.met);
	if (allMet) return false;
	// Only enforce if at least one criterion has high confidence of failure
	const hasConfidentFailure = results.some(
		(r) => !r.met && (r as any).confidence !== undefined && (r as any).confidence >= 0.7,
	);
	// If no confidence data (keyword heuristic), enforce based on met/not-met
	const hasAnyConfidence = results.some((r) => (r as any).confidence !== undefined);
	return hasConfidentFailure || !hasAnyConfidence;
}
