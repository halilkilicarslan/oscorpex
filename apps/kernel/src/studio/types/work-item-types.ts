// ---------------------------------------------------------------------------
// Oscorpex — Work Items & Intake Questions
// ---------------------------------------------------------------------------

export type WorkItemType = "feature" | "bug" | "defect" | "security" | "hotfix" | "improvement";
export type WorkItemPriority = "critical" | "high" | "medium" | "low";
export type WorkItemSeverity = "blocker" | "major" | "minor" | "trivial";
export type WorkItemStatus = "open" | "planned" | "in_progress" | "done" | "closed" | "wontfix";
export type WorkItemSource = "user" | "agent" | "security_scan" | "runtime" | "review";

export interface WorkItem {
	id: string;
	projectId: string;
	type: WorkItemType;
	title: string;
	description: string;
	priority: WorkItemPriority;
	severity?: WorkItemSeverity;
	labels: string[];
	status: WorkItemStatus;
	source: WorkItemSource;
	sourceAgentId?: string;
	sourceTaskId?: string;
	plannedTaskId?: string;
	sprintId?: string;
	createdAt: string;
	updatedAt: string;
}

// ---- Interactive Planner: Intake Question (v3.0 B1) -----------------------

export type IntakeQuestionStatus = "pending" | "answered" | "skipped";

export type IntakeQuestionCategory = "scope" | "functional" | "nonfunctional" | "priority" | "technical" | "general";

export interface IntakeQuestion {
	id: string;
	projectId: string;
	question: string;
	options: string[];
	category: IntakeQuestionCategory;
	status: IntakeQuestionStatus;
	answer?: string;
	planVersion?: number;
	createdAt: string;
	answeredAt?: string;
}
