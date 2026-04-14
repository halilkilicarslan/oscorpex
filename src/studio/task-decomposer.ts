// ---------------------------------------------------------------------------
// Oscorpex — Task Decomposer (v3.0)
// Breaks L/XL tasks into smaller micro-tasks for parallel execution.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createTask, getProject, listProjectAgents } from "./db.js";
import { execute } from "./pg.js";
import type { Task, TaskComplexity } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the task should be decomposed into sub-tasks.
 * Only L/XL tasks without a parent are eligible.
 */
export function shouldDecompose(task: Task): boolean {
	return (task.complexity === "L" || task.complexity === "XL") && !task.parentTaskId;
}

/**
 * Infer file paths mentioned in a task description.
 * Matches common path patterns: src/..., *.ts, PascalCase components, etc.
 */
export function inferTargetFiles(description: string): string[] {
	const patterns = [
		// Explicit paths: src/foo/bar.ts, console/src/..., scripts/init.sql
		/(?:src|console|scripts|tests?|lib|dist)\/[\w/.-]+\.\w+/g,
		// Relative file refs: ./foo.ts, ../bar.js
		/\.\.?\/[\w/.-]+\.\w+/g,
		// Glob-like: *.ts, *.tsx, *.sql
		/\*\.(?:ts|tsx|js|jsx|sql|json|yaml|yml|css|md)\b/g,
	];

	const found = new Set<string>();
	for (const re of patterns) {
		for (const match of description.matchAll(re)) {
			found.add(match[0]);
		}
	}
	return Array.from(found);
}

/**
 * Split a task description into logical segments using sentence-level
 * conjunctions and common split keywords.
 */
function splitDescription(description: string): string[] {
	// Split on common separators that indicate separate concerns
	const segments = description
		.split(/\s+(?:and also|additionally|then|also|and)\s+/i)
		.map((s) => s.trim())
		.filter((s) => s.length > 10);

	return segments.length >= 2 ? segments : [description];
}

/**
 * Estimate lines of code for S/M tasks.
 *   S → 1-20 lines
 *   M → 20-80 lines
 */
function estimatedLinesForComplexity(complexity: "S" | "M"): number {
	return complexity === "S" ? 15 : 50;
}

/**
 * Determine sub-task complexity. Sub-tasks are always S or M — never L/XL.
 * Longer segments get M; shorter ones get S.
 */
function subTaskComplexity(segment: string): "S" | "M" {
	return segment.length > 120 ? "M" : "S";
}

/**
 * Decompose an L/XL task into 2-8 focused sub-tasks.
 *
 * Decomposition strategy (deterministic, based on description content):
 *  1. Split on conjunction keywords ("and", "also", "then", "additionally")
 *  2. Detect multiple file references → each file group becomes a sub-task
 *  3. Detect impl + test mentions → split into implementation + test sub-tasks
 *  4. Guarantee min 2, max 8 sub-tasks
 *
 * Returns the created sub-tasks (NOT the parent task).
 */
export async function decomposeTask(task: Task, projectId: string): Promise<Task[]> {
	if (!shouldDecompose(task)) return [];

	const project = await getProject(projectId);
	if (!project) throw new Error(`Project ${projectId} not found`);

	// ------------------------------------------------------------------
	// Build candidate sub-task descriptions
	// ------------------------------------------------------------------
	let segments = splitDescription(task.description);

	// If no natural split found, use file-based split
	if (segments.length < 2) {
		const files = inferTargetFiles(task.description);
		if (files.length >= 2) {
			// Group files: each file or pair → own segment
			segments = files.map((f) => `Implement changes in ${f}: ${task.description}`);
		}
	}

	// Check for implementation + test split
	const desc = task.description.toLowerCase();
	const hasImpl = /implement|create|build|add|write/i.test(desc);
	const hasTest = /test|spec|coverage|unit|integration/i.test(desc);
	if (segments.length < 2 && hasImpl && hasTest) {
		segments = [
			`Implementation: ${task.description}`,
			`Tests: Write tests for the changes described in — ${task.title}`,
		];
	}

	// Ensure we have at least 2 segments (fallback: split title + description)
	if (segments.length < 2) {
		segments = [
			`${task.title} — Part 1: Core implementation`,
			`${task.title} — Part 2: Integration and verification`,
		];
	}

	// Cap at 8 sub-tasks
	if (segments.length > 8) {
		segments = segments.slice(0, 8);
	}

	// ------------------------------------------------------------------
	// Create sub-tasks in DB
	// ------------------------------------------------------------------
	const subTasks: Task[] = [];

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const complexity = subTaskComplexity(segment) as TaskComplexity;
		const targetFiles = inferTargetFiles(segment);

		// Create base task (existing createTask signature)
		const subTask = await createTask({
			phaseId: task.phaseId,
			title: `${task.title} [${i + 1}/${segments.length}]`,
			description: segment,
			assignedAgent: task.assignedAgent,
			complexity,
			dependsOn: i === 0 ? [] : [], // sub-tasks are parallel by default
			branch: task.branch,
		});

		// Set v3.0 decomposition fields via direct update
		await execute(
			`UPDATE tasks
       SET parent_task_id = $1,
           target_files    = $2,
           estimated_lines = $3,
           assigned_agent_id = $4
       WHERE id = $5`,
			[
				task.id,
				JSON.stringify(targetFiles),
				estimatedLinesForComplexity(complexity as "S" | "M"),
				task.assignedAgentId ?? null,
				subTask.id,
			],
		);

		subTasks.push({
			...subTask,
			parentTaskId: task.id,
			targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
			estimatedLines: estimatedLinesForComplexity(complexity as "S" | "M"),
			assignedAgentId: task.assignedAgentId,
		});
	}

	return subTasks;
}
