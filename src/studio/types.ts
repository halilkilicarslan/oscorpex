// ---------------------------------------------------------------------------
// Oscorpex — Data Models & Types
// ---------------------------------------------------------------------------

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

// ---- Task ------------------------------------------------------------------

export type TaskStatus =
	| "queued"
	| "assigned"
	| "running"
	| "review"
	| "revision"
	| "waiting_approval"
	| "blocked"
	| "deferred"
	| "cancelled"
	| "done"
	| "failed";

// Human-in-the-Loop onay durumu
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type TaskComplexity = "S" | "M" | "L" | "XL";

export type TaskType = "ai" | "integration-test" | "run-app";

export interface TaskOutput {
	filesCreated: string[];
	filesModified: string[];
	testResults?: { passed: number; failed: number; total: number };
	logs: string[];
}

export interface Task {
	id: string;
	phaseId: string;
	title: string;
	description: string;
	assignedAgent: string;
	status: TaskStatus;
	complexity: TaskComplexity;
	dependsOn: string[]; // Task IDs
	branch: string;
	taskType?: TaskType;
	output?: TaskOutput;
	retryCount: number;
	error?: string | null;
	startedAt?: string;
	completedAt?: string;
	// v2: review loop fields
	reviewStatus?: "approved" | "rejected" | null;
	reviewerAgentId?: string;
	reviewTaskId?: string;
	revisionCount: number;
	assignedAgentId?: string; // FK to project_agents.id
	// Human-in-the-Loop onay alanları
	requiresApproval: boolean;
	approvalStatus?: ApprovalStatus | null;
	approvalRejectionReason?: string;
	// v3.0: Micro-task decomposition
	parentTaskId?: string;
	targetFiles?: string[];
	estimatedLines?: number;
	// v4.2: Direct project reference (eliminates JOIN chain for lookups)
	projectId?: string;
	// v8.0: Auto-classified risk level for governance enforcement
	riskLevel?: RiskLevel;
}

// ---- Agent Configuration ---------------------------------------------------

export type AgentRole =
	// v2 roles
	| "product-owner"
	| "scrum-master"
	| "tech-lead"
	| "business-analyst"
	| "design-lead"
	| "frontend-dev"
	| "backend-dev"
	| "frontend-qa"
	| "backend-qa"
	| "frontend-reviewer"
	| "backend-reviewer"
	| "devops"
	// legacy roles (backward compat)
	| "pm"
	| "designer"
	| "architect"
	| "frontend"
	| "backend"
	| "coder"
	| "qa"
	| "reviewer"
	// v2.5 roles
	| "security-reviewer"
	| "docs-writer";

export type AgentCliTool = "claude-code" | "codex" | "cursor" | "none";
/** @deprecated Use AgentCliTool instead. */
export type CLITool = AgentCliTool;

export interface AgentConfig {
	id: string;
	name: string;
	role: AgentRole;
	avatar: string;
	gender: "male" | "female";
	personality: string;
	model: string;
	cliTool: AgentCliTool;
	skills: string[];
	systemPrompt: string;
	isPreset: boolean;
	/** Task execution timeout in milliseconds. If not set, the engine default (5 min) is used. */
	taskTimeout?: number;
}

// ---- Agent Runtime State ---------------------------------------------------

export type AgentRuntimeStatus = "idle" | "working" | "waiting" | "error";

export interface AgentRuntime {
	agentId: string;
	projectId: string;
	containerId?: string;
	status: AgentRuntimeStatus;
	currentTaskId?: string;
	terminalBuffer: string[];
	branch: string;
	startedAt?: string;
}

// ---- Events ----------------------------------------------------------------

export type EventType =
	| "task:assigned"
	| "task:started"
	| "task:completed"
	| "task:failed"
	| "task:timeout"
	| "task:retry"
	| "task:approval_required"
	| "task:approved"
	| "task:rejected"
	| "task:added"
	| "agent:started"
	| "agent:stopped"
	| "agent:output"
	| "agent:error"
	| "phase:started"
	| "phase:completed"
	| "plan:created"
	| "plan:approved"
	| "plan:phase_added"
	| "execution:started"
	| "execution:error"
	| "escalation:user"
	| "git:commit"
	| "git:pr-created"
	| "task:timeout_warning"
	| "task:review_rejected"
	| "pipeline:completed"
	| "pipeline:failed"
	| "pipeline:paused"
	| "pipeline:resumed"
	| "pipeline:degraded"
	| "pipeline:rate_limited"
	| "pipeline:stage_started"
	| "pipeline:stage_completed"
	| "pipeline:branch_created"
	| "pipeline:branch_merged"
	| "budget:warning"
	| "budget:exceeded"
	| "prompt:size"
	// v3.x: lifecycle & governance events
	| "work_item:created"
	| "work_item:planned"
	| "sprint:started"
	| "sprint:completed"
	| "ceremony:standup"
	| "ceremony:retrospective"
	| "policy:violation"
	| "lifecycle:transition"
	| "message:created"
	// v7.0: agentic platform events
	| "agent:session_started"
	| "agent:strategy_selected"
	| "agent:requested_help"
	| "agent:memory_written"
	| "task:proposal_created"
	| "task:proposal_approved"
	| "graph:mutation_proposed"
	| "graph:mutation_applied"
	| "plan:replanned"
	| "goal:evaluated"
	| "verification:passed"
	| "verification:failed"
	| "budget:halted"
	| "provider:degraded"
	// v8.0: failure classification
	| "task:transient_failure";

export interface StudioEvent {
	id: string;
	projectId: string;
	type: EventType;
	agentId?: string;
	taskId?: string;
	payload: Record<string, unknown>;
	timestamp: string;
}

// ---- Chat Messages ---------------------------------------------------------

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
	id: string;
	projectId: string;
	role: ChatRole;
	content: string;
	agentId?: string;
	createdAt: string;
}

// ---- Container Config (used by Container Manager) --------------------------

export interface VolumeMount {
	source: string;
	target: string;
	readonly?: boolean;
}

export interface ContainerConfig {
	image: string;
	name: string;
	volumes: VolumeMount[];
	env: Record<string, string>;
	networkMode: string;
	memoryLimit: string;
	cpuLimit: number;
}

// ---- AI Providers ----------------------------------------------------------

export type AIProviderType = "openai" | "anthropic" | "google" | "ollama" | "custom" | "cli";

/** CLI subtype for type="cli" providers. Each CLI uses its own auth (no api key). */
export type ProviderCliTool = "claude" | "codex" | "gemini" | "cursor";
/** @deprecated Use ProviderCliTool instead. */
export type CliTool = ProviderCliTool;

export interface AIProvider {
	id: string;
	name: string;
	type: AIProviderType;
	apiKey: string;
	baseUrl: string;
	model: string;
	isDefault: boolean;
	isActive: boolean;
	/** Fallback zincirindeki sıra. 0 = primary (default), küçük değer = daha önce denenir. */
	fallbackOrder: number;
	/** Only for type="cli": which CLI to spawn (claude/codex/gemini). */
	cliTool?: ProviderCliTool;
	createdAt: string;
	updatedAt: string;
}

// ---- Project Agent (proje bazlı takım üyesi) --------------------------------

export interface ProjectAgent {
	id: string;
	projectId: string;
	sourceAgentId?: string;
	name: string;
	role: AgentRole | string;
	avatar: string;
	gender: "male" | "female";
	personality: string;
	model: string;
	cliTool: AgentCliTool;
	skills: string[];
	systemPrompt: string;
	createdAt: string;
	reportsTo?: string; // ID of parent agent (null = top-level)
	color: string; // hex color for org chart visualization
	pipelineOrder: number; // execution order in workflow (0 = unordered)
}

// ---- Team Template (hazır takım şablonu) ------------------------------------

export interface TeamTemplate {
	id: string;
	name: string;
	description: string;
	roles: string[];
	dependencies: { from: string; to: string; type: string }[];
	createdAt: string;
}

// ---- Agent Messages (ajan-arası iletişim) ----------------------------------

export type MessageType =
	| "task_assignment"
	| "task_complete"
	| "review_request"
	| "bug_report"
	| "feedback"
	| "notification"
	// v3.6: Agent ceremonies & communication
	| "standup"
	| "retrospective"
	| "conflict"
	| "help_request"
	| "pair_session"
	| "handoff_doc";

export type MessageStatus = "unread" | "read" | "archived";

export interface AgentMessage {
	id: string;
	projectId: string;
	fromAgentId: string;
	toAgentId: string;
	type: MessageType;
	subject: string;
	content: string;
	metadata: Record<string, any>;
	status: MessageStatus;
	parentMessageId?: string;
	createdAt: string;
	readAt?: string;
}

// ---- Pipeline Engine -------------------------------------------------------

// Bir pipeline aşamasının (stage) durumu
export type PipelineStageStatus = "pending" | "running" | "completed" | "failed";

// Genel pipeline durumu
export type PipelineStatus = "idle" | "running" | "paused" | "completed" | "failed";

// Pipeline aşaması: aynı pipeline_order değerine sahip agent'lar ve görevler bir arada
export interface PipelineStage {
	order: number;
	agents: ProjectAgent[];
	tasks: Task[];
	status: PipelineStageStatus;
	/** Eşleşen plan phase ID'si; stage → phase mapping için kullanılır */
	phaseId?: string;
}

// Bir projenin anlık pipeline durumu (hem bellekte hem DB'de saklanır)
export interface PipelineState {
	projectId: string;
	stages: PipelineStage[];
	currentStage: number;
	status: PipelineStatus;
	startedAt?: string;
	completedAt?: string;
}

// Veritabanındaki pipeline_runs tablosuna karşılık gelen arayüz
export interface PipelineRun {
	id: string;
	projectId: string;
	currentStage: number;
	status: PipelineStatus;
	stagesJson: string; // PipelineStage[] JSON olarak serileştirilmiş hali
	version: number;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
}

// ---- Agent Process (yerel CLI süreç kaydı) ----------------------------------

/** Yerel agent sürecinin anlık durum değerleri */
export type AgentProcessStatus = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";

/** Bellek içi süreç kaydı — ChildProcess referansını da taşır */
export interface AgentProcessRecord {
	/** Benzersiz çalışma kimliği (agent_runs tablosunda da kullanılır) */
	id: string;
	projectId: string;
	agentId: string;
	agentName: string;
	cliTool: string;
	/** Node.js ChildProcess nesnesi — null ise süreç henüz başlamamış veya bitmiş */
	process: import("node:child_process").ChildProcess | null;
	status: AgentProcessStatus;
	/** Son OUTPUT_BUFFER_MAX satırı tutar (ring buffer) */
	output: string[];
	startedAt?: string;
	stoppedAt?: string;
	/** İşletim sistemi süreç kimliği */
	pid?: number;
	/** Süreç çıkış kodu; çalışırken undefined, sinyal ile sonlanırsa null */
	exitCode?: number | null;
}

// ---- Agent Run (veritabanı çalışma geçmişi) ---------------------------------

/** agent_runs tablosunun TypeScript yansıması */
export interface AgentRun {
	id: string;
	projectId: string;
	agentId: string;
	cliTool: string;
	status: AgentProcessStatus;
	taskPrompt?: string;
	outputSummary?: string;
	pid?: number;
	exitCode?: number | null;
	startedAt?: string;
	stoppedAt?: string;
	createdAt: string;
}

// ---- Token Usage & Cost Tracking -------------------------------------------

export interface TokenUsage {
	id: string;
	projectId: string;
	taskId: string;
	agentId: string;
	model: string;
	provider: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	createdAt: string;
}

export interface ProjectCostSummary {
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	taskCount: number;
	totalCacheCreationTokens: number;
	totalCacheReadTokens: number;
}

export interface CostBreakdownEntry {
	agentId: string;
	agentName?: string;
	model: string;
	taskCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
}

// ---- Git types -------------------------------------------------------------

export interface GitLogEntry {
	hash: string;
	message: string;
	author: string;
	date: string;
}

export interface FileTreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: FileTreeNode[];
}

export interface MergeResult {
	success: boolean;
	conflicts?: string[];
}

export interface GitStatus {
	modified: string[];
	untracked: string[];
	staged: string[];
	deleted: string[];
}

// ---- Agent Dependencies (v2 org structure) ---------------------------------

export type DependencyType =
	| "hierarchy"
	| "workflow"
	| "review"
	| "gate"
	// v3.1: New edge types
	| "escalation"
	| "pair"
	| "conditional"
	| "fallback"
	| "notification"
	| "handoff"
	| "approval"
	| "mentoring";

export interface AgentDependencyMetadata {
	condition?: string;
	maxFailures?: number;
	priority?: number;
	documentRequired?: boolean;
}

export interface AgentDependency {
	id: string;
	projectId: string;
	fromAgentId: string;
	toAgentId: string;
	type: DependencyType;
	metadata?: AgentDependencyMetadata;
	createdAt: string;
}

// ---- Agent Capabilities (file scope restrictions) --------------------------

export type CapabilityScopeType = "path" | "filetype" | "module" | "tool";
export type CapabilityPermission = "read" | "write" | "readwrite" | "allow";

export interface AgentCapability {
	id: string;
	agentId: string;
	projectId: string;
	scopeType: CapabilityScopeType;
	pattern: string;
	permission: CapabilityPermission;
}

// ---- Agent Capability Grants (v7.0 Section 14.3) ---------------------------

export type CapabilityToken =
	| "can_propose_task"
	| "can_inject_task_low_risk"
	| "can_request_replan"
	| "can_modify_graph_same_phase"
	| "can_trigger_tests"
	| "can_request_human_review"
	| "can_commit_code"
	| "can_open_deploy_request";

export interface CapabilityGrant {
	id: string;
	projectId: string;
	agentRole: string;
	capability: CapabilityToken;
	granted: boolean;
	grantedBy: string;
	createdAt: string;
}

// ---- Work Items (v3.2 Backlog) ---------------------------------------------

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

// ---------------------------------------------------------------------------
// v3.0 B1 — Interactive Planner: Intake Question
// ---------------------------------------------------------------------------

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

// ---- Memory Architecture (v3.4) --------------------------------------------

export interface ProjectContextSnapshot {
	projectId: string;
	kind: string;
	summaryJson: Record<string, unknown>;
	sourceVersion: number;
	updatedAt: string;
}

export interface ConversationCompaction {
	projectId: string;
	channel: string;
	lastMessageId: string;
	summary: string;
	updatedAt: string;
}

export interface MemoryFact {
	projectId: string;
	scope: string;
	key: string;
	value: string;
	confidence: number;
	source: string;
	updatedAt: string;
}

// ---- Policy Engine (v3.7) --------------------------------------------------

export interface PolicyRule {
	id: string;
	projectId: string;
	name: string;
	condition: string;
	action: string;
	enabled: boolean;
}

// ---- Context Store (v4.0) --------------------------------------------------

export type ContextContentType = "code" | "prose";
export type ContextMatchLayer = "tsvector" | "trigram";

export interface ContextSource {
	id: string;
	projectId: string;
	label: string;
	chunkCount: number;
	codeChunkCount: number;
	indexedAt: string;
}

export interface ContextChunk {
	id: number;
	sourceId: string;
	title: string;
	content: string;
	contentType: ContextContentType;
}

export interface ContextSearchOptions {
	projectId: string;
	queries: string[];
	limit?: number;
	source?: string;
	contentType?: ContextContentType;
	maxTokens?: number;
}

export interface ContextSearchResult {
	title: string;
	content: string;
	source: string;
	rank: number;
	contentType: ContextContentType;
	matchLayer: ContextMatchLayer;
}

// ---- Context Packet (v3.4) -------------------------------------------------

export type ContextPacketMode = "planner" | "execution" | "review" | "team_architect";

export interface ContextPacketOptions {
	projectId: string;
	taskId?: string;
	agentId?: string;
	mode: ContextPacketMode;
	maxTokens?: number;
}

// ---- Agent Runtime (v7.0 Phase 2) ------------------------------------------

export type AgentSessionStatus = "active" | "completed" | "failed" | "aborted";

export interface AgentSession {
	id: string;
	projectId: string;
	agentId: string;
	taskId?: string;
	strategy?: string;
	status: AgentSessionStatus;
	stepsCompleted: number;
	maxSteps: number;
	observations: AgentObservation[];
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
}

export interface AgentObservation {
	step: number;
	type: "context_loaded" | "strategy_selected" | "action_executed" | "result_inspected" | "decision_made";
	summary: string;
	timestamp: string;
}

export type EpisodeOutcome = "success" | "failure" | "partial" | "skipped";

export interface AgentEpisode {
	id: string;
	projectId: string;
	agentId: string;
	taskId?: string;
	taskType: string;
	strategy: string;
	actionSummary: string;
	outcome: EpisodeOutcome;
	failureReason?: string;
	qualityScore?: number;
	costUsd?: number;
	durationMs?: number;
	createdAt: string;
}

export interface AgentStrategyPattern {
	id: string;
	projectId: string;
	agentRole: string;
	taskType: string;
	strategy: string;
	successRate: number;
	avgCostUsd?: number;
	avgQuality?: number;
	sampleCount: number;
	updatedAt: string;
}

export interface AgentStrategy {
	id: string;
	agentRole: string;
	name: string;
	description: string;
	promptAddendum?: string;
	allowedTaskTypes: string[];
	isDefault: boolean;
}

export type ProposalType = "sub_task" | "dependency_patch" | "fix_task" | "refactor" | "test_task";
export type ProposalStatus = "pending" | "approved" | "rejected" | "auto_approved";

export interface TaskProposal {
	id: string;
	projectId: string;
	originatingTaskId?: string;
	originatingAgentId: string;
	proposalType: ProposalType;
	title: string;
	description: string;
	severity?: string;
	suggestedRole?: string;
	phaseId?: string;
	complexity?: TaskComplexity;
	createdTaskId?: string;
	status: ProposalStatus;
	approvedBy?: string;
	rejectedReason?: string;
	createdAt: string;
}

export type ProtocolMessageType =
	| "request_info"
	| "provide_info"
	| "request_review"
	| "dependency_warning"
	| "handoff_artifact"
	| "design_decision"
	| "blocker_alert"
	| "plan_adjustment_request";

export type ProtocolMessageStatus = "unread" | "read" | "actioned" | "dismissed";

export interface AgentProtocolMessage {
	id: string;
	projectId: string;
	fromAgentId: string;
	toAgentId?: string;
	relatedTaskId?: string;
	messageType: ProtocolMessageType;
	payload: Record<string, unknown>;
	status: ProtocolMessageStatus;
	createdAt: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRule {
	id: string;
	projectId?: string;
	actionType: string;
	riskLevel: RiskLevel;
	requiresApproval: boolean;
	autoApprove: boolean;
	maxPerRun?: number;
	description?: string;
	createdAt: string;
}
