// ---------------------------------------------------------------------------
// Oscorpex — Task Decomposer (v3.0 B2)
// Breaks L/XL tasks into focused micro-tasks. Uses an AI Scrum Master
// (LLM + Zod-typed structured output) when a provider is configured, and
// falls back to a deterministic heuristic split when AI is unavailable.
// ---------------------------------------------------------------------------

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { generateObject } from "ai";
import { z } from "zod";
import { getAIModelWithFallback } from "./ai-provider-factory.js";
import { createTask, getProject, listProjectAgents } from "./db.js";
import { execute } from "./pg.js";
import type { Project, Task, TaskComplexity } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("task-decomposer");

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

// ---------------------------------------------------------------------------
// Codebase context gathering
// ---------------------------------------------------------------------------

/** Skip noisy directories regardless of where they appear in the path. */
const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".turbo",
	".oscorpex",
	"coverage",
	".cache",
]);

/** Recursively list project files (paths only) up to a depth limit. */
async function listProjectFiles(repoPath: string, maxDepth = 3, maxEntries = 200): Promise<string[]> {
	const out: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > maxDepth || out.length >= maxEntries) return;
		let entries: Dirent[];
		try {
			entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
		} catch {
			return;
		}
		for (const entry of entries) {
			if (out.length >= maxEntries) return;
			if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
			if (IGNORE_DIRS.has(entry.name)) continue;
			const full = join(dir, entry.name);
			const rel = relative(repoPath, full) || entry.name;
			if (entry.isDirectory()) {
				await walk(full, depth + 1);
			} else if (entry.isFile()) {
				out.push(rel);
			}
		}
	}

	await walk(repoPath, 0);
	return out.sort();
}

/** Build a compact textual snapshot of the relevant codebase area. */
async function gatherCodebaseContext(project: Project, parentTask: Task): Promise<string> {
	if (!project.repoPath) return "(No repo path configured for this project.)";

	const sections: string[] = [];

	// 1) Top-level file listing
	try {
		const files = await listProjectFiles(project.repoPath, 3, 150);
		if (files.length > 0) {
			sections.push(`Project files (max 150, depth 3):\n${files.map((f) => `- ${f}`).join("\n")}`);
		}
	} catch (err) {
		sections.push(`(Could not enumerate files: ${err instanceof Error ? err.message : String(err)})`);
	}

	// 2) Sizes of any explicitly-targeted files (helps the SM size sub-tasks)
	const targets = parentTask.targetFiles ?? inferTargetFiles(parentTask.description);
	if (targets.length > 0) {
		const sizeLines: string[] = [];
		for (const t of targets.slice(0, 12)) {
			try {
				const s = await stat(join(project.repoPath, t));
				sizeLines.push(`- ${t} (${s.size} bytes${s.isDirectory() ? ", directory" : ""})`);
			} catch {
				sizeLines.push(`- ${t} (does not exist yet)`);
			}
		}
		sections.push(`Target files referenced by parent task:\n${sizeLines.join("\n")}`);
	}

	return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// AI Scrum Master decomposer
// ---------------------------------------------------------------------------

const SCRUM_MASTER_SYSTEM_PROMPT = `You are an expert Scrum Master and senior software engineer.
Your single responsibility is to split one large engineering task into a small set of focused micro-tasks
that an AI developer agent can complete independently and reliably.

Hard rules — NEVER violate:
1. Each micro-task must touch at most 3 files. Prefer 1 file per task.
2. Complexity must be S or M only. Never L or XL.
   - S: 1 file, 1-20 lines changed (a function, a small component, a single test).
   - M: 1-3 files, 20-80 lines changed (a small feature slice).
3. Produce between 2 and 8 micro-tasks. If the parent feels small enough for fewer than 2 micro-tasks,
   still split into exactly 2 (e.g. implementation + tests).
4. Use real, plausible file paths. Reuse paths from the parent's targetFiles or the codebase listing
   whenever possible. Do not invent paths in directories that clearly do not exist.
5. Each task title must be short, action-oriented, and unique within the set.
6. Each description must be specific enough that a coding agent can act without further clarification:
   mention the file, the function/class/component, and the expected behavior.
7. Provide an estimatedLines integer (S: 5-20, M: 20-80).
8. Provide rationale: one sentence explaining why this slice exists and what it delivers.
9. Output language: match the parent task's language. If parent is Turkish, write Turkish; otherwise English.

Decomposition heuristics (in priority order):
- File-driven: if multiple distinct files are involved, one task per file (or per tightly coupled file pair).
- Layer-driven: split implementation, integration wiring, and tests into separate tasks.
- Behavior-driven: split independent user-visible behaviors into separate tasks.
- Risk-driven: isolate the riskiest change (e.g. schema migration, auth) into its own task so it can be reviewed.

Do not include any prose outside of the structured output.`;

const subTaskSchema = z.object({
	title: z.string().min(3).max(120).describe("Short action-oriented title, unique within the set"),
	description: z.string().min(10).max(800).describe("Specific instructions: file, function/component, behavior"),
	complexity: z.enum(["S", "M"]).describe("S: 1 file 1-20 lines; M: 1-3 files 20-80 lines"),
	targetFiles: z.array(z.string()).min(1).max(3).describe("Real file paths this task creates or modifies"),
	estimatedLines: z.number().int().min(1).max(120).describe("Approximate lines changed"),
	rationale: z.string().min(5).max(240).describe("One sentence explaining why this slice exists"),
});

const decompositionSchema = z.object({
	subTasks: z.array(subTaskSchema).min(2).max(8),
});

type AISubTask = z.infer<typeof subTaskSchema>;

/** Build the user prompt with parent task + codebase context. */
function buildDecomposerPrompt(project: Project, parentTask: Task, codebaseContext: string): string {
	const targets = parentTask.targetFiles?.length ? parentTask.targetFiles.join(", ") : "(none specified)";

	return `# Project
Name: ${project.name}
Tech stack: ${project.techStack.length > 0 ? project.techStack.join(", ") : "(unspecified)"}
Description: ${project.description || "(no description)"}

# Parent Task to decompose
Title: ${parentTask.title}
Complexity: ${parentTask.complexity}
Branch: ${parentTask.branch || "(not set)"}
Assigned role/agent: ${parentTask.assignedAgent}
Pre-declared target files: ${targets}
${parentTask.estimatedLines ? `Pre-declared estimated lines: ${parentTask.estimatedLines}` : ""}

Description:
${parentTask.description}

# Codebase context
${codebaseContext}

# Your job
Produce 2-8 micro-tasks that, when completed in any order, fully satisfy the parent task above.
Strictly follow the system rules. Output only the structured object.`;
}

/**
 * AI-powered decomposition. Returns null if no provider is reachable or the
 * model output is unusable — the caller will then fall back to the heuristic.
 */
async function aiDecompose(project: Project, parentTask: Task): Promise<AISubTask[] | null> {
	let codebaseContext: string;
	try {
		codebaseContext = await gatherCodebaseContext(project, parentTask);
	} catch (err) {
		log.warn("[task-decomposer] Codebase context gather failed:" + " " + String(err));
		codebaseContext = "(codebase context unavailable)";
	}

	try {
		const result = await getAIModelWithFallback(async (model) => {
			return generateObject({
				model,
				schema: decompositionSchema,
				system: SCRUM_MASTER_SYSTEM_PROMPT,
				prompt: buildDecomposerPrompt(project, parentTask, codebaseContext),
				maxOutputTokens: 2000,
			});
		});

		const subTasks = result.object.subTasks;
		if (!Array.isArray(subTasks) || subTasks.length === 0) return null;
		return subTasks;
	} catch (err) {
		log.warn(
			`[task-decomposer] AI decomposition failed for "${parentTask.title}", will fall back to heuristic: ` + (err instanceof Error ? err.message : String(err)),
		);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Heuristic fallback decomposer (v3.0 B1 behavior, retained as safety net)
// ---------------------------------------------------------------------------

interface HeuristicSubTask {
	title: string;
	description: string;
	complexity: "S" | "M";
	targetFiles: string[];
	estimatedLines: number;
	rationale?: string;
}

function heuristicDecompose(parentTask: Task): HeuristicSubTask[] {
	let segments = splitDescription(parentTask.description);

	// File-based split if no natural conjunction split found
	if (segments.length < 2) {
		const files = inferTargetFiles(parentTask.description);
		if (files.length >= 2) {
			segments = files.map((f) => `Implement changes in ${f}: ${parentTask.description}`);
		}
	}

	// Implementation + test split
	const desc = parentTask.description.toLowerCase();
	const hasImpl = /implement|create|build|add|write/i.test(desc);
	const hasTest = /test|spec|coverage|unit|integration/i.test(desc);
	if (segments.length < 2 && hasImpl && hasTest) {
		segments = [
			`Implementation: ${parentTask.description}`,
			`Tests: Write tests for the changes described in — ${parentTask.title}`,
		];
	}

	// Final fallback
	if (segments.length < 2) {
		segments = [
			`${parentTask.title} — Part 1: Core implementation`,
			`${parentTask.title} — Part 2: Integration and verification`,
		];
	}

	if (segments.length > 8) segments = segments.slice(0, 8);

	return segments.map((segment, i) => {
		const complexity = subTaskComplexity(segment);
		const targetFiles = inferTargetFiles(segment);
		return {
			title: `${parentTask.title} [${i + 1}/${segments.length}]`,
			description: segment,
			complexity,
			targetFiles,
			estimatedLines: estimatedLinesForComplexity(complexity),
		};
	});
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistSubTasks(parentTask: Task, subTasks: Array<HeuristicSubTask | AISubTask>): Promise<Task[]> {
	const created: Task[] = [];

	for (const sub of subTasks) {
		const complexity = sub.complexity as TaskComplexity;
		const baseTask = await createTask({
			phaseId: parentTask.phaseId,
			title: sub.title,
			description: sub.description,
			assignedAgent: parentTask.assignedAgent,
			complexity,
			dependsOn: [],
			branch: parentTask.branch,
		});

		await execute(
			`UPDATE tasks
			 SET parent_task_id = $1,
			     target_files = $2,
			     estimated_lines = $3,
			     assigned_agent_id = $4
			 WHERE id = $5`,
			[
				parentTask.id,
				JSON.stringify(sub.targetFiles ?? []),
				sub.estimatedLines,
				parentTask.assignedAgentId ?? null,
				baseTask.id,
			],
		);

		created.push({
			...baseTask,
			parentTaskId: parentTask.id,
			targetFiles: sub.targetFiles?.length ? sub.targetFiles : undefined,
			estimatedLines: sub.estimatedLines,
			assignedAgentId: parentTask.assignedAgentId,
		});
	}

	return created;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Decompose an L/XL task into 2-8 focused sub-tasks.
 *
 * Strategy:
 *  1. Try AI-powered decomposition (Scrum Master prompt + structured output).
 *  2. Fall back to deterministic heuristic split if AI is unavailable.
 *
 * Returns the created sub-tasks (never the parent).
 */
export async function decomposeTask(task: Task, projectId: string): Promise<Task[]> {
	if (!shouldDecompose(task)) return [];

	const project = await getProject(projectId);
	if (!project) throw new Error(`Project ${projectId} not found`);

	// Validate assigned agent still exists in the team (best-effort sanity check)
	await listProjectAgents(projectId).catch(() => []);

	const ai = await aiDecompose(project, task);
	const subTasks: Array<HeuristicSubTask | AISubTask> = ai && ai.length >= 2 ? ai : heuristicDecompose(task);

	if (ai && ai.length >= 2) {
		log.info(`[task-decomposer] AI produced ${ai.length} micro-tasks for "${task.title}" (${task.complexity})`);
	} else {
		log.info(
			`[task-decomposer] Heuristic produced ${subTasks.length} micro-tasks for "${task.title}" (${task.complexity})`,
		);
	}

	return persistSubTasks(task, subTasks);
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export const __testables = {
	heuristicDecompose,
	subTaskComplexity,
	estimatedLinesForComplexity,
	splitDescription,
	gatherCodebaseContext,
	listProjectFiles,
	buildDecomposerPrompt,
};
