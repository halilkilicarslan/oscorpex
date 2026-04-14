// ---------------------------------------------------------------------------
// Oscorpex — Ceremony Engine (v3.6)
// Scrum ceremonies: standup reports and retrospectives from event/task data
// ---------------------------------------------------------------------------

import { listEvents, listProjectAgents, listProjectTasks } from "./db.js";
import { eventBus } from "./event-bus.js";
import type { ProjectAgent, StudioEvent, Task } from "./types.js";

// ---------------------------------------------------------------------------
// Report types (exported for frontend/routes consumption)
// ---------------------------------------------------------------------------

export interface StandupReport {
	agentId: string;
	agentName: string;
	completedTasks: string[];
	inProgressTasks: string[];
	blockers: string[];
}

export interface RetrospectiveReport {
	whatWentWell: string[];
	whatCouldImprove: string[];
	actionItems: string[];
	agentStats: {
		agentId: string;
		agentName: string;
		tasksCompleted: number;
		avgRevisions: number;
		successRate: number;
	}[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function isRecent(timestamp: string): boolean {
	return Date.now() - new Date(timestamp).getTime() <= TWENTY_FOUR_HOURS_MS;
}

function buildBlockers(agentId: string, events: StudioEvent[]): string[] {
	return events
		.filter(
			(e) =>
				(e.agentId === agentId || e.payload["agentId"] === agentId) &&
				(e.type === "task:failed" || e.type === "escalation:user") &&
				isRecent(e.timestamp),
		)
		.map((e) => String(e.payload["error"] ?? e.payload["question"] ?? e.type));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Aggregates a standup report for each agent in the project.
 * Uses tasks and events from the last 24 hours — no AI call needed.
 */
export async function runStandup(projectId: string): Promise<StandupReport[]> {
	const [agents, allTasks, allEvents] = await Promise.all([
		listProjectAgents(projectId),
		listProjectTasks(projectId),
		listEvents(projectId, 500),
	]);

	const reports: StandupReport[] = agents.map((agent: ProjectAgent) => {
		// Tasks assigned to this agent (by id or role name)
		const agentTasks = allTasks.filter(
			(t: Task) =>
				t.assignedAgentId === agent.id ||
				t.assignedAgent === agent.id ||
				t.assignedAgent?.toLowerCase() === agent.role.toLowerCase() ||
				t.assignedAgent?.toLowerCase() === agent.name.toLowerCase(),
		);

		const completedTasks = agentTasks
			.filter((t: Task) => t.status === "done" && t.completedAt && isRecent(t.completedAt))
			.map((t: Task) => t.title);

		const inProgressTasks = agentTasks
			.filter((t: Task) => t.status === "running" || t.status === "revision" || t.status === "review")
			.map((t: Task) => t.title);

		const blockers = buildBlockers(agent.id, allEvents);

		return {
			agentId: agent.id,
			agentName: agent.name,
			completedTasks,
			inProgressTasks,
			blockers,
		};
	});

	eventBus.emit({
		projectId,
		type: "ceremony:standup",
		payload: { agentCount: reports.length, generatedAt: new Date().toISOString() },
	});

	console.log(`[ceremony-engine] Standup generated for ${reports.length} agents (project=${projectId})`);

	return reports;
}

/**
 * Aggregates a retrospective report from all project events and tasks.
 * Pure data aggregation — no AI call needed.
 */
export async function runRetrospective(projectId: string): Promise<RetrospectiveReport> {
	const [agents, allTasks, allEvents] = await Promise.all([
		listProjectAgents(projectId),
		listProjectTasks(projectId),
		listEvents(projectId, 1000),
	]);

	// ---- Agent stats -------------------------------------------------------

	const agentStats = agents.map((agent: ProjectAgent) => {
		const agentTasks = allTasks.filter(
			(t: Task) =>
				t.assignedAgentId === agent.id ||
				t.assignedAgent === agent.id ||
				t.assignedAgent?.toLowerCase() === agent.role.toLowerCase() ||
				t.assignedAgent?.toLowerCase() === agent.name.toLowerCase(),
		);

		const tasksCompleted = agentTasks.filter((t: Task) => t.status === "done").length;
		const tasksFailed = agentTasks.filter((t: Task) => t.status === "failed").length;
		const totalFinished = tasksCompleted + tasksFailed;

		const totalRevisions = agentTasks.reduce((sum: number, t: Task) => sum + (t.revisionCount ?? 0), 0);
		const avgRevisions = agentTasks.length > 0 ? totalRevisions / agentTasks.length : 0;

		const successRate = totalFinished > 0 ? tasksCompleted / totalFinished : 1;

		return {
			agentId: agent.id,
			agentName: agent.name,
			tasksCompleted,
			avgRevisions: Math.round(avgRevisions * 100) / 100,
			successRate: Math.round(successRate * 100) / 100,
		};
	});

	// ---- What went well ----------------------------------------------------

	const totalDone = allTasks.filter((t: Task) => t.status === "done").length;
	const totalTasks = allTasks.length;
	const completionRate = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

	const whatWentWell: string[] = [];
	if (completionRate >= 80) whatWentWell.push(`High task completion rate: ${completionRate}%`);
	if (agentStats.some((s) => s.successRate >= 0.9)) {
		const topAgent = agentStats.find((s) => s.successRate >= 0.9);
		if (topAgent) whatWentWell.push(`${topAgent.agentName} achieved ${Math.round(topAgent.successRate * 100)}% success rate`);
	}
	const zeroRevisionAgents = agentStats.filter((s) => s.avgRevisions === 0 && s.tasksCompleted > 0);
	if (zeroRevisionAgents.length > 0) {
		whatWentWell.push(`${zeroRevisionAgents.length} agent(s) completed tasks with no revisions needed`);
	}

	// ---- What could improve ------------------------------------------------

	const whatCouldImprove: string[] = [];
	const highRevisionAgents = agentStats.filter((s) => s.avgRevisions > 1.5);
	if (highRevisionAgents.length > 0) {
		whatCouldImprove.push(
			`${highRevisionAgents.map((a) => a.agentName).join(", ")} averaged >1.5 revisions per task — review quality guidelines`,
		);
	}

	const failureCount = allEvents.filter((e: StudioEvent) => e.type === "task:failed").length;
	if (failureCount > 3) whatCouldImprove.push(`${failureCount} task failures detected — improve test coverage or task scoping`);

	const escalations = allEvents.filter((e: StudioEvent) => e.type === "escalation:user").length;
	if (escalations > 0) whatCouldImprove.push(`${escalations} escalation(s) required user intervention — refine agent policies`);

	if (completionRate < 80) whatCouldImprove.push(`Overall completion rate ${completionRate}% is below target — review planning accuracy`);

	// ---- Action items -------------------------------------------------------

	const actionItems: string[] = [];
	if (highRevisionAgents.length > 0) actionItems.push("Schedule code quality workshop with high-revision agents");
	if (failureCount > 3) actionItems.push("Add integration tests for commonly failing task types");
	if (escalations > 0) actionItems.push("Review escalation policies and adjust thresholds");
	if (whatWentWell.length === 0) actionItems.push("Define clearer success metrics for next sprint");

	const report: RetrospectiveReport = {
		whatWentWell: whatWentWell.length > 0 ? whatWentWell : ["Project progressed — review completed tasks for specific wins"],
		whatCouldImprove,
		actionItems,
		agentStats,
	};

	eventBus.emit({
		projectId,
		type: "ceremony:retrospective",
		payload: {
			agentCount: agents.length,
			completionRate,
			actionItemCount: actionItems.length,
			generatedAt: new Date().toISOString(),
		},
	});

	console.log(`[ceremony-engine] Retrospective generated (project=${projectId}, completion=${completionRate}%)`);

	return report;
}
