// @oscorpex/task-graph — Lightweight input interfaces for DAG operations
// These are minimal shapes needed for pure graph logic.
// Kernel's full types (ProjectAgent, AgentDependency, Phase, Task) satisfy these via structural typing.

export interface GraphAgent {
	id: string;
	name: string;
	role: string;
	skills: string[];
	sourceAgentId?: string;
	reportsTo?: string;
	pipelineOrder?: number;
	personality?: string;
}

export interface DependencyEdge {
	fromAgentId: string;
	toAgentId: string;
	type: string;
	metadata?: { condition?: string; maxFailures?: number; priority?: number; documentRequired?: boolean };
}

export type DependencyType =
	| "hierarchy"
	| "workflow"
	| "review"
	| "gate"
	| "escalation"
	| "pair"
	| "conditional"
	| "fallback"
	| "notification"
	| "handoff"
	| "approval"
	| "mentoring";

export interface PlanTask {
	id: string;
	title: string;
	status: string;
	assignedAgent?: string;
	complexity: string;
	description: string;
	targetFiles?: string[];
	dependsOn: string[];
	phaseId: string;
	output?: { filesCreated: string[]; filesModified: string[] };
}

export interface PlanPhase {
	id: string;
	order: number;
	name: string;
	status: string;
	tasks: PlanTask[];
}

export interface StagePlan {
	order: number;
	agents: GraphAgent[];
	tasks: PlanTask[];
	status: "pending" | "running" | "completed" | "failed";
	phaseId?: string;
}