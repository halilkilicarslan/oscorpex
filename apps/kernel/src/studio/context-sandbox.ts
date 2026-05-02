// ---------------------------------------------------------------------------
// Oscorpex — Context Sandbox (v4.0 Faz 2)
// Output sandboxing: large outputs → indexed compact references.
// Replaces raw file listing with FTS-ranked relevant context.
// ---------------------------------------------------------------------------

import { indexContent, searchContext } from "./context-store.js";
import { getProjectSetting, listProjectTasks } from "./db.js";
import { createLogger } from "./logger.js";
import type { ContextSearchResult, Task, TaskOutput } from "./types.js";
const log = createLogger("context-sandbox");

// ---------------------------------------------------------------------------
// Threshold Logic
// ---------------------------------------------------------------------------

const DEFAULT_INLINE_THRESHOLD = 20_000; // <20KB: return as-is
const DEFAULT_COMPACT_THRESHOLD = 100_000; // 20-100KB: compact reference
// >100KB: force FTS index

export type OutputStrategy = "inline" | "compact" | "index";

export function classifyOutput(
	output: string,
	inlineThreshold = DEFAULT_INLINE_THRESHOLD,
	compactThreshold = DEFAULT_COMPACT_THRESHOLD,
): OutputStrategy {
	const bytes = Buffer.byteLength(output, "utf-8");
	if (bytes < inlineThreshold) return "inline";
	if (bytes < compactThreshold) return "compact";
	return "index";
}

/** Read thresholds from project settings, falling back to defaults. */
export async function getOutputThresholds(projectId: string): Promise<{ inline: number; compact: number }> {
	try {
		const [inlineVal, compactVal] = await Promise.all([
			getProjectSetting(projectId, "context", "inline_threshold"),
			getProjectSetting(projectId, "context", "compact_threshold"),
		]);
		return {
			inline: inlineVal ? Number.parseInt(inlineVal, 10) || DEFAULT_INLINE_THRESHOLD : DEFAULT_INLINE_THRESHOLD,
			compact: compactVal ? Number.parseInt(compactVal, 10) || DEFAULT_COMPACT_THRESHOLD : DEFAULT_COMPACT_THRESHOLD,
		};
	} catch {
		return { inline: DEFAULT_INLINE_THRESHOLD, compact: DEFAULT_COMPACT_THRESHOLD };
	}
}

// ---------------------------------------------------------------------------
// Index Task Output
// ---------------------------------------------------------------------------

export async function indexTaskOutput(
	projectId: string,
	taskId: string,
	taskTitle: string,
	output: TaskOutput,
): Promise<void> {
	const parts: string[] = [];

	if (output.filesCreated.length > 0) {
		parts.push(`## Files Created\n${output.filesCreated.map((f) => `- ${f}`).join("\n")}`);
	}
	if (output.filesModified.length > 0) {
		parts.push(`## Files Modified\n${output.filesModified.map((f) => `- ${f}`).join("\n")}`);
	}
	if (output.testResults) {
		const tr = output.testResults;
		parts.push(`## Test Results\n- Passed: ${tr.passed}, Failed: ${tr.failed}, Total: ${tr.total}`);
	}
	if (output.logs && output.logs.length > 0) {
		parts.push(`## Logs\n${output.logs.join("\n")}`);
	}

	if (parts.length === 0) return;

	const content = `# Task: ${taskTitle}\n\n${parts.join("\n\n")}`;
	const sourceLabel = `task:${taskId}:${taskTitle}`;

	await indexContent(projectId, content, sourceLabel, "markdown");
}

// ---------------------------------------------------------------------------
// Compact Cross-Agent Context
// ---------------------------------------------------------------------------

interface CompactContextOptions {
	projectId: string;
	taskTitle: string;
	taskDescription: string;
	maxTokens?: number;
	maxFiles?: number;
}

interface CompactContext {
	prompt: string;
	totalFiles: number;
	relevantFiles: number;
	totalCompletedTasks: number;
}

export async function compactCrossAgentContext(opts: CompactContextOptions): Promise<CompactContext> {
	const { projectId, taskTitle, taskDescription, maxTokens = 3000, maxFiles = 10 } = opts;

	// Gather completed tasks for raw file count
	const allTasks = await listProjectTasks(projectId);
	const completedTasks = allTasks.filter((t) => t.status === "done" && t.output);

	const allFiles = new Map<string, { agent: string; task: string }>();
	for (const ct of completedTasks) {
		for (const f of [...(ct.output?.filesCreated ?? []), ...(ct.output?.filesModified ?? [])]) {
			allFiles.set(f, { agent: ct.assignedAgent, task: ct.title });
		}
	}

	if (allFiles.size === 0) {
		return { prompt: "", totalFiles: 0, relevantFiles: 0, totalCompletedTasks: completedTasks.length };
	}

	// FTS search for relevant context
	const descSnippet = (taskDescription ?? "").slice(0, 200);
	const queries = [taskTitle, descSnippet].filter(Boolean);

	let searchResults: ContextSearchResult[] = [];
	try {
		searchResults = await searchContext({
			projectId,
			queries,
			limit: maxFiles,
			maxTokens,
		});
	} catch {
		// FTS unavailable — fall back to raw listing
	}

	const lines: string[] = [];

	if (searchResults.length > 0) {
		lines.push(
			`## Cross-Agent Context (${completedTasks.length} tasks completed, ${allFiles.size} files)`,
			"",
			`### Relevant Context (search: "${taskTitle}")`,
			"",
		);

		for (const r of searchResults) {
			lines.push(`#### ${r.title} (${r.source})`);
			lines.push(r.content);
			lines.push("");
		}
	} else {
		// Fallback: compact file listing (no FTS results)
		lines.push(
			`## Cross-Agent Context (${completedTasks.length} tasks completed, ${allFiles.size} files)`,
			"",
			"The following files already exist in the project. Read them with readFile before making changes:",
			"",
		);

		const sorted = [...allFiles.entries()].sort(([a], [b]) => a.localeCompare(b));
		for (const [filePath, info] of sorted.slice(0, maxFiles)) {
			lines.push(`- \`${filePath}\` (by ${info.agent}: ${info.task})`);
		}
		if (allFiles.size > maxFiles) {
			lines.push(`- ... and ${allFiles.size - maxFiles} more files`);
		}
	}

	// Recent errors for context
	const recentFailed = allTasks.filter((t) => t.status === "failed" && t.error).slice(-2);

	if (recentFailed.length > 0) {
		lines.push("", "### Recent Errors", "");
		for (const ft of recentFailed) {
			lines.push(`- **${ft.title}** (${ft.assignedAgent}): ${ft.error!.slice(0, 150)}`);
		}
	}

	return {
		prompt: lines.join("\n"),
		totalFiles: allFiles.size,
		relevantFiles: searchResults.length,
		totalCompletedTasks: completedTasks.length,
	};
}
