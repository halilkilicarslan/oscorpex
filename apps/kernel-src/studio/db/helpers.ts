// ---------------------------------------------------------------------------
// Oscorpex — DB Helpers: row mappers + utility
// ---------------------------------------------------------------------------

import type {
	AIProvider,
	AIProviderType,
	AgentCapability,
	AgentCliTool,
	AgentConfig,
	AgentDependency,
	AgentDependencyMetadata,
	AgentProcessStatus,
	AgentRole,
	AgentRun,
	CapabilityPermission,
	CapabilityScopeType,
	ChatMessage,
	ChatRole,
	ContextChunk,
	ContextContentType,
	ContextSource,
	ConversationCompaction,
	DependencyType,
	EventType,
	IntakeQuestion,
	IntakeQuestionCategory,
	IntakeQuestionStatus,
	MemoryFact,
	Phase,
	PhaseStatus,
	PipelineRun,
	PipelineStatus,
	PlanStatus,
	Project,
	ProjectAgent,
	ProjectContextSnapshot,
	ProjectPlan,
	ProjectStatus,
	Sprint,
	SprintStatus,
	StudioEvent,
	Task,
	TaskComplexity,
	TaskStatus,
	TeamTemplate,
	WorkItem,
	WorkItemPriority,
	WorkItemSource,
	WorkItemStatus,
	WorkItemType,
} from "../types.js";
import { canonicalizeAgentRole } from "../roles.js";
import { createLogger } from "../logger.js";
const log = createLogger("helpers");

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
		reviewTaskId: row.review_task_id ?? undefined,
		revisionCount: row.revision_count ?? 0,
		assignedAgentId: row.assigned_agent_id ?? undefined,
		// Human-in-the-Loop onay alanları
		requiresApproval: Boolean(row.requires_approval),
		approvalStatus: (row.approval_status as Task["approvalStatus"]) ?? undefined,
		approvalRejectionReason: row.approval_rejection_reason ?? undefined,
		// v3.0: Micro-task decomposition
		parentTaskId: row.parent_task_id ?? undefined,
		targetFiles: row.target_files ? JSON.parse(row.target_files) : undefined,
		estimatedLines: row.estimated_lines ?? undefined,
		// v4.2: Direct project reference
		projectId: row.project_id ?? undefined,
		// v8.0: Auto-classified risk level
		riskLevel: row.risk_level ?? undefined,
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
		role: canonicalizeAgentRole(row.role) as AgentRole,
		avatar: row.avatar,
		gender: row.gender ?? "male",
		personality: row.personality,
		model: row.model,
		cliTool: row.cli_tool as AgentCliTool,
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
		role: canonicalizeAgentRole(row.role) as AgentRole | string,
		avatar: row.avatar,
		gender: row.gender ?? "male",
		personality: row.personality,
		model: row.model,
		cliTool: row.cli_tool as AgentCliTool,
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
		roles: JSON.parse(row.agent_ids),
		dependencies: JSON.parse(row.dependencies ?? "[]"),
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
		cliTool: row.cli_tool ?? undefined,
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
		version: row.version ?? 1,
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
		metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
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
// v3.x Row Mappers
// ---------------------------------------------------------------------------

export function rowToWorkItem(row: any): WorkItem {
	return {
		id: row.id,
		projectId: row.project_id,
		type: row.type as WorkItemType,
		title: row.title,
		description: row.description,
		priority: row.priority as WorkItemPriority,
		severity: row.severity ?? undefined,
		labels: JSON.parse(row.labels),
		status: row.status as WorkItemStatus,
		source: row.source as WorkItemSource,
		sourceAgentId: row.source_agent_id ?? undefined,
		sourceTaskId: row.source_task_id ?? undefined,
		plannedTaskId: row.planned_task_id ?? undefined,
		sprintId: row.sprint_id ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function rowToIntakeQuestion(row: any): IntakeQuestion {
	let options: string[] = [];
	try {
		const parsed = row.options ? JSON.parse(row.options) : [];
		if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
	} catch {
		options = [];
	}
	return {
		id: row.id,
		projectId: row.project_id,
		question: row.question,
		options,
		category: (row.category as IntakeQuestionCategory) ?? "general",
		status: (row.status as IntakeQuestionStatus) ?? "pending",
		answer: row.answer ?? undefined,
		planVersion: row.plan_version ?? undefined,
		createdAt: row.created_at,
		answeredAt: row.answered_at ?? undefined,
	};
}

export function rowToSprint(row: any): Sprint {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		goal: row.goal ?? undefined,
		startDate: row.start_date,
		endDate: row.end_date,
		status: row.status as SprintStatus,
		createdAt: row.created_at,
	};
}

export function rowToMemoryFact(row: any): MemoryFact {
	return {
		projectId: row.project_id,
		scope: row.scope,
		key: row.key,
		value: row.value,
		confidence: row.confidence,
		source: row.source,
		updatedAt: row.updated_at,
	};
}

export function rowToContextSnapshot(row: any): ProjectContextSnapshot {
	return {
		projectId: row.project_id,
		kind: row.kind,
		summaryJson: JSON.parse(row.summary_json),
		sourceVersion: row.source_version,
		updatedAt: row.updated_at,
	};
}

export function rowToConversationCompaction(row: any): ConversationCompaction {
	return {
		projectId: row.project_id,
		channel: row.channel,
		lastMessageId: row.last_message_id,
		summary: row.summary,
		updatedAt: row.updated_at,
	};
}

export function rowToContextSource(row: any): ContextSource {
	return {
		id: row.id,
		projectId: row.project_id,
		label: row.label,
		chunkCount: row.chunk_count,
		codeChunkCount: row.code_chunk_count,
		indexedAt: row.indexed_at,
	};
}

export function rowToContextChunk(row: any): ContextChunk {
	return {
		id: row.id,
		sourceId: row.source_id,
		title: row.title,
		content: row.content,
		contentType: row.content_type as ContextContentType,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
	if (!key || key.length <= 8) return key ? "***" : "";
	return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4);
}
