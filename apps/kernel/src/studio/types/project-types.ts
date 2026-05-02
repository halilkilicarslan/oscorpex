// ---------------------------------------------------------------------------
// Oscorpex — Project, Plan, Phase, Sprint Types
// Union types sourced from @oscorpex/core where matching.
// ---------------------------------------------------------------------------

import type { Task } from "./task-types.js";

// ---- Project (Workspace) --------------------------------------------------
// Note: core's ProjectStatus lacks "maintenance"|"archived" — keep local definition
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

// Re-export from @oscorpex/core (identical definition)
import type { PhaseStatus as _PhaseStatus } from "@oscorpex/core";
export type PhaseStatus = _PhaseStatus;

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
