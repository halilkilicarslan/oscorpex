// ---------------------------------------------------------------------------
// Oscorpex — Memory Manager: Working memory + context assembly
// ---------------------------------------------------------------------------

import { getLatestPlan, getProject, listProjectAgents } from "./db.js";
import { getContextSnapshot, getMemoryFacts, upsertContextSnapshot, upsertMemoryFact } from "./db.js";
import { createLogger } from "./logger.js";
import type { MemoryFact, ProjectContextSnapshot } from "./types.js";
const log = createLogger("memory-manager");

// ---------------------------------------------------------------------------
// Working Memory
// ---------------------------------------------------------------------------

/**
 * Creates or refreshes the "working_summary" context snapshot for a project.
 * Captures current state: project info, active phase, task stats, team, tech stack.
 */
export async function updateWorkingMemory(projectId: string): Promise<void> {
	const [project, plan, agents] = await Promise.all([
		getProject(projectId),
		getLatestPlan(projectId),
		listProjectAgents(projectId),
	]);

	if (!project) return;

	// Task completion stats across all phases
	let totalTasks = 0;
	let doneTasks = 0;
	let failedTasks = 0;
	let currentPhaseName: string | undefined;

	if (plan) {
		const runningPhase = plan.phases.find((p: any) => p.status === "running");
		const pendingPhase = plan.phases.find((p: any) => p.status === "pending");
		currentPhaseName = runningPhase?.name ?? pendingPhase?.name;

		for (const phase of plan.phases) {
			for (const task of phase.tasks) {
				totalTasks++;
				if (task.status === "done") doneTasks++;
				if (task.status === "failed") failedTasks++;
			}
		}
	}

	const summaryJson: Record<string, unknown> = {
		project: {
			id: project.id,
			name: project.name,
			status: project.status,
			techStack: project.techStack,
		},
		plan: plan
			? {
					id: plan.id,
					version: plan.version,
					status: plan.status,
					phaseCount: plan.phases.length,
					currentPhase: currentPhaseName,
				}
			: null,
		tasks: {
			total: totalTasks,
			done: doneTasks,
			failed: failedTasks,
			remaining: totalTasks - doneTasks - failedTasks,
			completionPct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
		},
		team: agents.map((a: any) => ({
			id: a.id,
			name: a.name,
			role: a.role,
			model: a.model,
		})),
		generatedAt: new Date().toISOString(),
	};

	await upsertContextSnapshot(projectId, "working_summary", summaryJson, plan?.version ?? 0);
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

/**
 * Assembles a human-readable project context string from snapshots and facts,
 * suitable for injection into agent prompts.
 */
export async function getProjectContext(projectId: string): Promise<string> {
	const [snapshot, facts] = await Promise.all([
		getContextSnapshot(projectId, "working_summary"),
		getMemoryFacts(projectId),
	]);

	const lines: string[] = [];

	if (snapshot) {
		const s = snapshot.summaryJson as any;

		if (s.project) {
			lines.push(`## Project: ${s.project.name}`);
			lines.push(`Status: ${s.project.status}`);
			if (s.project.techStack?.length) {
				lines.push(`Tech Stack: ${(s.project.techStack as string[]).join(", ")}`);
			}
		}

		if (s.plan) {
			lines.push(`\n## Current Plan (v${s.plan.version})`);
			lines.push(`Phase: ${s.plan.currentPhase ?? "—"}`);
			lines.push(`Progress: ${s.tasks?.done ?? 0}/${s.tasks?.total ?? 0} tasks (${s.tasks?.completionPct ?? 0}%)`);
		}

		if (Array.isArray(s.team) && s.team.length > 0) {
			lines.push(`\n## Team (${s.team.length} agents)`);
			for (const member of s.team as any[]) {
				lines.push(`- ${member.name} (${member.role})`);
			}
		}
	}

	if (facts.length > 0) {
		// Group by scope
		const byScope = new Map<string, MemoryFact[]>();
		for (const fact of facts) {
			const list = byScope.get(fact.scope) ?? [];
			list.push(fact);
			byScope.set(fact.scope, list);
		}

		lines.push("\n## Known Facts");
		for (const [scope, scopeFacts] of byScope) {
			lines.push(`### ${scope}`);
			for (const fact of scopeFacts) {
				lines.push(`- ${fact.key}: ${fact.value}`);
			}
		}
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fact Extraction
// ---------------------------------------------------------------------------

/**
 * Batch upsert memory facts for a project.
 */
export async function extractFacts(
	projectId: string,
	data: { key: string; value: string; scope?: string; source?: string }[],
): Promise<void> {
	await Promise.all(
		data.map((item) =>
			upsertMemoryFact(projectId, item.scope ?? "general", item.key, item.value, 1.0, item.source ?? "system"),
		),
	);
}
