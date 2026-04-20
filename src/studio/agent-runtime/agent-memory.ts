// ---------------------------------------------------------------------------
// Oscorpex — Agent Memory: Behavioral memory that changes agent execution
// Retrieves episodic lessons and strategy patterns for prompt injection.
// ---------------------------------------------------------------------------

import { getBestStrategies, getFailureEpisodes, getRecentEpisodes } from "../db.js";
import type { AgentEpisode, AgentStrategyPattern } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BehavioralContext {
	/** Recent episodes for similar task type (successes + failures) */
	recentEpisodes: AgentEpisode[];
	/** High-confidence failure reasons to avoid */
	failureLessons: AgentEpisode[];
	/** Best-performing strategy patterns */
	bestStrategies: AgentStrategyPattern[];
}

// ---------------------------------------------------------------------------
// Memory retrieval
// ---------------------------------------------------------------------------

/**
 * Load behavioral context for an agent about to execute a task.
 * This is the core "memory that changes behavior" — not just retrieval.
 */
export async function loadBehavioralContext(
	projectId: string,
	agentId: string,
	agentRole: string,
	taskType: string,
): Promise<BehavioralContext> {
	const [recentEpisodes, failureLessons, bestStrategies] = await Promise.all([
		getRecentEpisodes(projectId, agentId, taskType, 5),
		getFailureEpisodes(projectId, agentId, 3),
		getBestStrategies(projectId, agentRole, taskType, 3),
	]);

	return { recentEpisodes, failureLessons, bestStrategies };
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Format behavioral context into a prompt section that materially changes
 * how the agent approaches the task.
 */
export function formatBehavioralPrompt(ctx: BehavioralContext): string {
	const sections: string[] = [];

	// Failure avoidance — highest priority behavioral change
	if (ctx.failureLessons.length > 0) {
		const lessons = ctx.failureLessons
			.filter((e) => e.failureReason)
			.map((e) => `- Strategy "${e.strategy}" on ${e.taskType}: FAILED — ${e.failureReason}`)
			.join("\n");
		if (lessons) {
			sections.push(`## LESSONS FROM PAST FAILURES — AVOID THESE MISTAKES\n${lessons}`);
		}
	}

	// Strategy recommendation — guide approach selection
	if (ctx.bestStrategies.length > 0) {
		const recs = ctx.bestStrategies
			.map(
				(p) =>
					`- "${p.strategy}": ${(p.successRate * 100).toFixed(0)}% success rate (${p.sampleCount} samples${p.avgQuality != null ? `, avg quality ${p.avgQuality.toFixed(1)}` : ""})`,
			)
			.join("\n");
		sections.push(`## RECOMMENDED STRATEGIES (ranked by success rate)\n${recs}`);
	}

	// Recent experience — what worked and what didn't
	if (ctx.recentEpisodes.length > 0) {
		const recent = ctx.recentEpisodes
			.slice(0, 3)
			.map((e) => `- ${e.outcome.toUpperCase()}: "${e.strategy}" — ${e.actionSummary.slice(0, 120)}`)
			.join("\n");
		sections.push(`## RECENT EXPERIENCE WITH SIMILAR TASKS\n${recent}`);
	}

	if (sections.length === 0) return "";
	return `\n--- BEHAVIORAL MEMORY ---\n${sections.join("\n\n")}\n--- END BEHAVIORAL MEMORY ---\n`;
}
