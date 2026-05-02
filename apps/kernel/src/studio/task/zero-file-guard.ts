// ---------------------------------------------------------------------------
// Oscorpex — Zero-File Guard
// Validates that fix/bug tasks produce at least one file change.
// isStrictFixTask: detects whether a task is a strict-fix (bug/security/hotfix)
// that must not produce zero files.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import { syncDeclaredDependencies } from "../repo-dependency-sync.js";
import type { Task, TaskOutput } from "../types.js";
import type { TaskReviewManager } from "./review-loop-service.js";

const log = createLogger("zero-file-guard");

/**
 * Returns true when the task title/description signals a strict fix task
 * (bug fix, hotfix, defect, security fix, import error) that must produce
 * at least one concrete file change.
 */
export function isStrictFixTask(task: Task): boolean {
	const text = `${task.title} ${task.description}`.toLowerCase();
	return (
		text.includes("[bug fix]") ||
		text.includes("bug fix") ||
		text.includes("hotfix") ||
		text.includes("defect") ||
		text.includes("security fix") ||
		text.includes("import hatası") ||
		text.includes("import error")
	);
}

export interface ZeroFileGuardOptions {
	executionRepoPath?: string;
}

export interface ZeroFileGuardResult {
	/** true = task should proceed to review/done with the (possibly mutated) output */
	proceed: boolean;
	/** mutated output with any extra log lines appended */
	output: TaskOutput;
}

/**
 * Applies zero-file protection rules to a completing coding task.
 *
 * Cases:
 *   1. Strict-fix task with zero files + dependency-sync heals it → proceed, add heal log
 *   2. Strict-fix task with zero files + no heal → throws (blocks completion)
 *   3. Non-fix task with zero files → writes decision.md and lets reviewer decide
 *   4. Any task with ≥1 changed file → no-op, proceeds immediately
 */
export async function applyZeroFileGuard(
	task: Task,
	projectId: string,
	output: TaskOutput,
	review: TaskReviewManager,
	options?: ZeroFileGuardOptions,
): Promise<ZeroFileGuardResult> {
	const isReviewTask = task.title.startsWith("Code Review: ");
	const isCodingTask = !task.taskType || task.taskType === "ai";
	const changedFileCount = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0);

	// Fast path: files were produced — nothing to guard
	if (!isCodingTask || isReviewTask || changedFileCount > 0) {
		return { proceed: true, output };
	}

	// Case 1 & 2: strict-fix task with zero files
	if (isStrictFixTask(task)) {
		const { getProject } = await import("../db.js");
		const proj = await getProject(projectId);
		const repoRoot = options?.executionRepoPath ?? proj?.repoPath;

		if (repoRoot) {
			const sync = syncDeclaredDependencies(repoRoot);
			if (sync.ranInstall && sync.ok && sync.missingBefore.length > 0 && sync.missingAfter.length === 0) {
				// Healed by dependency sync
				const healedOutput: TaskOutput = {
					...output,
					logs: [
						...(output.logs ?? []),
						`[kernel] node_modules synced (${sync.command}); resolved missing packages: ${sync.missingBefore.join(", ")}`,
					],
				};
				log.info(
					`[zero-file-guard] Fix task "${task.title}" healed by dependency sync (${sync.missingBefore.length} packages).`,
				);
				return { proceed: true, output: healedOutput };
			}
		}

		// No heal available — block completion
		throw new Error(
			`Zero-file output is not allowed for fix task "${task.title}" — task must include concrete file changes`,
		);
	}

	// Case 3: non-fix coding task with zero files — write decision.md, route to reviewer
	const decisionContent = review.buildDecisionContent(task);
	const fileWritten = await review.writeZeroFileDecision(projectId, task, decisionContent);
	const decisionPath = review.decisionMdPath(projectId, task);

	const guardedOutput: TaskOutput = {
		...output,
		filesCreated: fileWritten ? [decisionPath] : [],
		logs: [
			...(output.logs ?? []),
			"[zero-file-guard] Task hiçbir dosya üretmedi. Reviewer inceleyecek.",
			"--- DECISION ---",
			decisionContent,
			"--- /DECISION ---",
		],
	};

	log.warn(`[zero-file-guard] Task "${task.title}" zero-file output — decision.md ${fileWritten ? "written" : "skipped (no repoPath)"}`);

	return { proceed: true, output: guardedOutput };
}
