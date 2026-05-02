// ---------------------------------------------------------------------------
// Oscorpex — Report Generator (v3.8)
// Generates structured and human-readable project reports from aggregated data
// ---------------------------------------------------------------------------

import { getLatestPlan, getProject, getProjectCostSummary, listEvents, listProjectTasks } from "./db.js";
import { createLogger } from "./logger.js";
import type { Project, ProjectPlan, StudioEvent, Task } from "./types.js";
const log = createLogger("report-generator");

// ---------------------------------------------------------------------------
// Report types (exported for frontend/routes consumption)
// ---------------------------------------------------------------------------

export interface ProjectReport {
	projectName: string;
	status: string;
	totalTasks: number;
	completedTasks: number;
	failedTasks: number;
	totalCostUsd: number;
	durationMs: number;
	qualityMetrics: {
		reviewPassRate: number; // 0–1: tasks approved on first review
		avgRevisions: number; // average revision cycles across all tasks
		firstPassRate: number; // 0–1: tasks completed without any revision
	};
	topFileChanges: { path: string; changeCount: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeDate(iso: string | undefined): number {
	if (!iso) return 0;
	const d = new Date(iso).getTime();
	return Number.isNaN(d) ? 0 : d;
}

function calcDurationMs(project: Project, tasks: Task[]): number {
	// Try project-level timestamps first
	const created = safeDate(project.createdAt);
	if (created === 0) return 0;

	// Find the latest completedAt among done tasks
	const doneTasks = tasks.filter((t) => t.status === "done" && t.completedAt);
	if (doneTasks.length === 0) return Date.now() - created;

	const lastCompleted = Math.max(...doneTasks.map((t) => safeDate(t.completedAt)));
	return lastCompleted > created ? lastCompleted - created : Date.now() - created;
}

function extractTopFileChanges(tasks: Task[], limit = 10): { path: string; changeCount: number }[] {
	const fileCounts = new Map<string, number>();

	for (const task of tasks) {
		const files = [...(task.output?.filesCreated ?? []), ...(task.output?.filesModified ?? [])];
		for (const file of files) {
			fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
		}
	}

	return Array.from(fileCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([path, changeCount]) => ({ path, changeCount }));
}

function calcQualityMetrics(tasks: Task[], events: StudioEvent[]) {
	const doneTasks = tasks.filter((t) => t.status === "done");
	if (doneTasks.length === 0) {
		return { reviewPassRate: 1, avgRevisions: 0, firstPassRate: 1 };
	}

	// Review pass rate: tasks approved by reviewer vs total done tasks
	const reviewApprovedEvents = events.filter(
		(e) => e.type === "task:completed" && e.payload["reviewApproved"] === true,
	).length;
	const totalWithReview = events.filter((e) => e.type === "task:completed" && "reviewApproved" in e.payload).length;
	const reviewPassRate = totalWithReview > 0 ? reviewApprovedEvents / totalWithReview : 1;

	// Average revisions
	const totalRevisions = doneTasks.reduce((sum, t) => sum + (t.revisionCount ?? 0), 0);
	const avgRevisions = Math.round((totalRevisions / doneTasks.length) * 100) / 100;

	// First pass rate: tasks completed with zero revisions
	const firstPassCount = doneTasks.filter((t) => (t.revisionCount ?? 0) === 0).length;
	const firstPassRate = Math.round((firstPassCount / doneTasks.length) * 100) / 100;

	return { reviewPassRate: Math.round(reviewPassRate * 100) / 100, avgRevisions, firstPassRate };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a structured data report for a project.
 * Aggregates from tasks, events, and token_usage tables.
 */
export async function generateProjectReport(projectId: string): Promise<ProjectReport> {
	const [project, costs, tasks, events] = await Promise.all([
		getProject(projectId),
		getProjectCostSummary(projectId),
		listProjectTasks(projectId),
		listEvents(projectId, 1000),
	]);

	if (!project) {
		throw new Error(`Project ${projectId} not found`);
	}

	const totalTasks = tasks.length;
	const completedTasks = tasks.filter((t: Task) => t.status === "done").length;
	const failedTasks = tasks.filter((t: Task) => t.status === "failed").length;

	const durationMs = calcDurationMs(project, tasks);
	const qualityMetrics = calcQualityMetrics(tasks, events);
	const topFileChanges = extractTopFileChanges(tasks);

	const report: ProjectReport = {
		projectName: project.name,
		status: project.status,
		totalTasks,
		completedTasks,
		failedTasks,
		totalCostUsd: Math.round(costs.totalCostUsd * 10000) / 10000,
		durationMs,
		qualityMetrics,
		topFileChanges,
	};

	log.info(
		`[report-generator] Report generated for "${project.name}" — ` +
			`${completedTasks}/${totalTasks} tasks done, cost: $${report.totalCostUsd}`,
	);

	return report;
}

/**
 * Generates a human-readable, non-technical stakeholder summary.
 * Converts the structured ProjectReport into plain prose.
 */
export async function generateStakeholderReport(projectId: string): Promise<string> {
	const report = await generateProjectReport(projectId);

	const durationHours = Math.round((report.durationMs / (1000 * 60 * 60)) * 10) / 10;
	const completionPct = report.totalTasks > 0 ? Math.round((report.completedTasks / report.totalTasks) * 100) : 0;

	const successIndicator =
		completionPct >= 90
			? "successfully"
			: completionPct >= 70
				? "largely"
				: completionPct >= 50
					? "partially"
					: "with challenges";

	const qualitySummary =
		report.qualityMetrics.firstPassRate >= 0.8
			? "The team delivered high-quality work with minimal rework required."
			: report.qualityMetrics.avgRevisions > 2
				? "Some tasks required multiple revisions — quality improvements are recommended for the next phase."
				: "Quality was acceptable with a reasonable number of review cycles.";

	const costSummary =
		report.totalCostUsd === 0
			? "No AI processing costs were tracked for this project."
			: `Total AI processing cost was $${report.totalCostUsd.toFixed(4)} USD.`;

	const filesSummary =
		report.topFileChanges.length > 0
			? `Key files changed include: ${report.topFileChanges
					.slice(0, 5)
					.map((f) => f.path)
					.join(", ")}.`
			: "No file change data available.";

	const lines = [
		`# Project Report: ${report.projectName}`,
		"",
		`## Executive Summary`,
		`The project "${report.projectName}" completed ${successIndicator}. ` +
			`Out of ${report.totalTasks} total tasks, ${report.completedTasks} were completed (${completionPct}%) ` +
			`and ${report.failedTasks} failed.`,
		"",
		`## Duration`,
		`The project ran for approximately ${durationHours} hours.`,
		"",
		`## Quality`,
		qualitySummary,
		`First-pass success rate: ${Math.round(report.qualityMetrics.firstPassRate * 100)}%. ` +
			`Average revisions per task: ${report.qualityMetrics.avgRevisions}.`,
		"",
		`## Cost`,
		costSummary,
		"",
		`## Deliverables`,
		filesSummary,
		"",
		`## Status`,
		`Current project status: **${report.status}**.`,
		"",
		`_Report generated at ${new Date().toISOString()}_`,
	];

	return lines.join("\n");
}
