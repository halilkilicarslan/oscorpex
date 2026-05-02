// ---------------------------------------------------------------------------
// Oscorpex — Project, Plan, Phase, Sprint Types
// ---------------------------------------------------------------------------

import type { Task } from "./task-types.js";

// ---- Project (Workspace) --------------------------------------------------

export type ProjectStatus =
	| "planning"
	| "approved"
	| "running"
	| "paused"
	| "completed"
	| "failed"
	| "maintenance"
	| "archived";

export interface Project {
	id: string;
	name: string;
	description: string;
	status: ProjectStatus;
	techStack: string[];
	repoPath: string;
	createdAt: string; // ISO-8601
	updatedAt: string;
}

// ---- Project Plan ----------------------------------------------------------

export type PlanStatus = "draft" | "approved" | "rejected";

export interface ProjectPlan {
	id: string;
	projectId: string;
	version: number;
	status: PlanStatus;
	phases: Phase[];
	createdAt: string;
}

// ---- Phase -----------------------------------------------------------------

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

export interface Phase {
	id: string;
	planId: string;
	name: string;
	order: number;
	status: PhaseStatus;
	tasks: Task[];
	dependsOn: string[]; // Phase IDs
}

// ---- Sprints (v3.9) --------------------------------------------------------

export type SprintStatus = "planned" | "active" | "completed" | "cancelled";

export interface Sprint {
	id: string;
	projectId: string;
	name: string;
	goal?: string;
	startDate: string;
	endDate: string;
	status: SprintStatus;
	createdAt: string;
}
