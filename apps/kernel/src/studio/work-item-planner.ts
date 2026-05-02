// ---------------------------------------------------------------------------
// Oscorpex — Work Item Planner (v3.2)
// Converts a backlog work item into a concrete task attached to the project's
// latest plan. Creates a dedicated "Backlog" phase the first time one is
// needed and appends additional tasks to it on subsequent conversions.
// ---------------------------------------------------------------------------

import { createPhase, createTask, getLatestPlan, getWorkItem, listProjectAgents, updateWorkItem } from "./db.js";
import { createLogger } from "./logger.js";
import type {
	Phase,
	ProjectAgent,
	ProjectPlan,
	Task,
	TaskComplexity,
	WorkItem,
	WorkItemPriority,
	WorkItemType,
} from "./types.js";
const log = createLogger("work-item-planner");

const BACKLOG_PHASE_NAME = "Backlog";

/** Map a work item type → preferred agent role. */
function roleForType(type: WorkItemType): string {
	switch (type) {
		case "bug":
		case "defect":
			return "qa";
		case "security":
			return "security";
		case "hotfix":
			return "backend-dev";
		case "improvement":
			return "tech-lead";
		case "feature":
		default:
			return "backend-dev";
	}
}

/** Pick a project agent whose role matches, otherwise a sensible default. */
function pickAgent(agents: ProjectAgent[], preferredRole: string): ProjectAgent | undefined {
	const lower = preferredRole.toLowerCase();
	return (
		agents.find((a) => a.role.toLowerCase() === lower) ??
		agents.find((a) => a.role.toLowerCase().includes(lower)) ??
		agents.find((a) => a.role.toLowerCase() === "backend-dev") ??
		agents[0]
	);
}

/** Translate work item priority → initial task complexity. */
function complexityForPriority(priority: WorkItemPriority): TaskComplexity {
	switch (priority) {
		case "critical":
		case "high":
			return "M";
		case "medium":
			return "S";
		case "low":
		default:
			return "S";
	}
}

function testExpectationForType(type: WorkItemType): "none" | "optional" | "required" {
	if (type === "bug" || type === "defect" || type === "hotfix" || type === "security") {
		return "required";
	}
	return "optional";
}

/** Slug-safe branch suffix derived from the work item title. */
function branchForWorkItem(item: WorkItem): string {
	const slug =
		item.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "work-item";
	const prefix =
		item.type === "bug" || item.type === "defect" || item.type === "hotfix"
			? "fix"
			: item.type === "security"
				? "sec"
				: "feat";
	return `${prefix}/${slug}`;
}

/** Find an existing Backlog phase on the plan, or create one appended at the end. */
async function resolveBacklogPhase(plan: ProjectPlan): Promise<Phase> {
	const existing = plan.phases.find((p) => p.name === BACKLOG_PHASE_NAME);
	if (existing) return existing;

	const maxOrder = plan.phases.reduce((max, p) => Math.max(max, p.order), 0);
	return createPhase({
		planId: plan.id,
		name: BACKLOG_PHASE_NAME,
		order: maxOrder + 1,
		dependsOn: [],
	});
}

export interface PlanWorkItemResult {
	workItem: WorkItem;
	phase: Phase;
	task: Task;
}

/**
 * Convert a single work item into a task attached to the project's latest plan.
 * Throws if the plan or work item is missing.
 */
export async function planWorkItem(itemId: string): Promise<PlanWorkItemResult> {
	const item = await getWorkItem(itemId);
	if (!item) throw new Error(`Work item ${itemId} not found`);
	if (item.status !== "open") {
		throw new Error(`Work item ${itemId} is not open (status: ${item.status})`);
	}

	const plan = await getLatestPlan(item.projectId);
	if (!plan) throw new Error(`No plan found for project ${item.projectId}`);

	const [phase, agents] = await Promise.all([resolveBacklogPhase(plan), listProjectAgents(item.projectId)]);

	const preferredRole = roleForType(item.type);
	const agent = pickAgent(agents, preferredRole);

	const complexity = complexityForPriority(item.priority);
	const typeHint = item.type === "bug" || item.type === "defect" ? "Bug fix" : item.type;

	const descriptionParts = [
		`[${typeHint}] ${item.description || item.title}`.trim(),
		item.severity ? `Severity: ${item.severity}` : null,
		item.labels.length > 0 ? `Labels: ${item.labels.join(", ")}` : null,
		item.sourceTaskId ? `Source task: ${item.sourceTaskId}` : null,
	].filter(Boolean);

	const task = await createTask({
		phaseId: phase.id,
		title: item.title,
		description: descriptionParts.join("\n"),
		assignedAgent: agent?.role ?? preferredRole,
		assignedAgentId: agent?.id,
		complexity,
		dependsOn: [],
		branch: branchForWorkItem(item),
		testExpectation: testExpectationForType(item.type),
	});

	const updatedItem = (await updateWorkItem(item.id, { status: "planned", plannedTaskId: task.id })) ?? item;

	return { workItem: updatedItem, phase, task };
}
