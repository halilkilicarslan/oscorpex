// ---------------------------------------------------------------------------
// Oscorpex — DB Helpers: row mappers + utility
// ---------------------------------------------------------------------------

import type {
	AIProvider,
	AIProviderType,
	AgentCapability,
	AgentConfig,
	AgentDependency,
	AgentProcessStatus,
	AgentRole,
	AgentRun,
	CLITool,
	CapabilityPermission,
	CapabilityScopeType,
	ChatMessage,
	ChatRole,
	DependencyType,
	EventType,
	Phase,
	PhaseStatus,
	PipelineRun,
	PipelineStatus,
	PlanStatus,
	Project,
	ProjectAgent,
	ProjectPlan,
	ProjectStatus,
	StudioEvent,
	Task,
	TaskComplexity,
	TaskStatus,
	TeamTemplate,
} from "../types.js";

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function now(): string {
	return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

export function rowToProject(row: any): Project {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		status: row.status as ProjectStatus,
		techStack: JSON.parse(row.tech_stack),
		repoPath: row.repo_path,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function rowToTask(row: any): Task {
	return {
		id: row.id,
		phaseId: row.phase_id,
		title: row.title,
		description: row.description,
		assignedAgent: row.assigned_agent,
		status: row.status as TaskStatus,
		complexity: row.complexity as TaskComplexity,
		dependsOn: JSON.parse(row.depends_on),
		branch: row.branch,
		taskType: row.task_type !== "ai" ? row.task_type : undefined,
		output: row.output ? JSON.parse(row.output) : undefined,
		retryCount: row.retry_count,
		error: row.error ?? undefined,
		startedAt: row.started_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		reviewStatus: row.review_status ?? undefined,
		reviewerAgentId: row.reviewer_agent_id ?? undefined,
		revisionCount: row.revision_count ?? 0,
		assignedAgentId: row.assigned_agent_id ?? undefined,
		// Human-in-the-Loop onay alanları
		requiresApproval: Boolean(row.requires_approval),
		approvalStatus: (row.approval_status as Task["approvalStatus"]) ?? undefined,
		approvalRejectionReason: row.approval_rejection_reason ?? undefined,
	};
}

export function rowToPhase(row: any, tasks: Task[]): Phase {
	return {
		id: row.id,
		planId: row.plan_id,
		name: row.name,
		order: row.order,
		status: row.status as PhaseStatus,
		tasks,
		dependsOn: JSON.parse(row.depends_on),
	};
}

export function rowToAgentConfig(row: any): AgentConfig {
	return {
		id: row.id,
		name: row.name,
		role: row.role as AgentRole,
		avatar: row.avatar,
		gender: row.gender ?? "male",
		personality: row.personality,
		model: row.model,
		cliTool: row.cli_tool as CLITool,
		skills: JSON.parse(row.skills),
		systemPrompt: row.system_prompt,
		isPreset: Boolean(row.is_preset),
	};
}

export function rowToProjectAgent(row: any): ProjectAgent {
	return {
		id: row.id,
		projectId: row.project_id,
		sourceAgentId: row.source_agent_id ?? undefined,
		name: row.name,
		role: row.role as AgentRole | string,
		avatar: row.avatar,
		gender: row.gender ?? "male",
		personality: row.personality,
		model: row.model,
		cliTool: row.cli_tool as CLITool,
		skills: JSON.parse(row.skills),
		systemPrompt: row.system_prompt,
		createdAt: row.created_at,
		reportsTo: row.reports_to || undefined,
		color: row.color || "#22c55e",
		pipelineOrder: row.pipeline_order ?? 0,
	};
}

export function rowToTeamTemplate(row: any): TeamTemplate {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		// agent_ids sütununda roller saklanır
		roles: JSON.parse(row.agent_ids),
		createdAt: row.created_at,
	};
}

export function rowToProvider(row: any, masked = false): AIProvider {
	return {
		id: row.id,
		name: row.name,
		type: row.type as AIProviderType,
		apiKey: masked ? maskApiKey(row.api_key) : row.api_key,
		baseUrl: row.base_url,
		model: row.model,
		isDefault: Boolean(row.is_default),
		isActive: Boolean(row.is_active),
		// fallback_order kolonu sonradan migration ile eklendi; null gelebilir
		fallbackOrder: row.fallback_order ?? 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function rowToEvent(row: any): StudioEvent {
	return {
		id: row.id,
		projectId: row.project_id,
		type: row.type as EventType,
		agentId: row.agent_id ?? undefined,
		taskId: row.task_id ?? undefined,
		payload: JSON.parse(row.payload),
		timestamp: row.timestamp,
	};
}

export function rowToPipelineRun(row: any): PipelineRun {
	return {
		id: row.id,
		projectId: row.project_id,
		currentStage: row.current_stage,
		status: row.status as PipelineStatus,
		stagesJson: row.stages_json,
		startedAt: row.started_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		createdAt: row.created_at,
	};
}

export function rowToAgentRun(row: any): AgentRun {
	return {
		id: row.id,
		projectId: row.project_id,
		agentId: row.agent_id,
		cliTool: row.cli_tool,
		status: row.status as AgentProcessStatus,
		taskPrompt: row.task_prompt ?? undefined,
		outputSummary: row.output_summary ?? undefined,
		pid: row.pid ?? undefined,
		exitCode: row.exit_code ?? undefined,
		startedAt: row.started_at ?? undefined,
		stoppedAt: row.stopped_at ?? undefined,
		createdAt: row.created_at,
	};
}

export function rowToDependency(row: any): AgentDependency {
	return {
		id: row.id,
		projectId: row.project_id,
		fromAgentId: row.from_agent_id,
		toAgentId: row.to_agent_id,
		type: row.type as DependencyType,
		createdAt: row.created_at,
	};
}

export function rowToCapability(row: any): AgentCapability {
	return {
		id: row.id,
		agentId: row.agent_id,
		projectId: row.project_id,
		scopeType: row.scope_type as CapabilityScopeType,
		pattern: row.pattern,
		permission: row.permission as CapabilityPermission,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
	if (!key || key.length <= 8) return key ? "***" : "";
	return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4);
}
