// ---------------------------------------------------------------------------
// Oscorpex — Data Models & Types
// ---------------------------------------------------------------------------

// ---- Project (Workspace) --------------------------------------------------

export type ProjectStatus = "planning" | "approved" | "running" | "paused" | "completed" | "failed";

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
	error?: string;
	startedAt?: string;
	completedAt?: string;
	// v2: review loop fields
	reviewStatus?: "approved" | "rejected" | null;
	reviewerAgentId?: string;
	revisionCount: number;
	assignedAgentId?: string; // FK to project_agents.id
	// Human-in-the-Loop onay alanları
	requiresApproval: boolean;
	approvalStatus?: ApprovalStatus | null;
	approvalRejectionReason?: string;
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

export type CLITool = "claude-code" | "codex" | "aider" | "none";

export interface AgentConfig {
	id: string;
	name: string;
	role: AgentRole;
	avatar: string;
	gender: "male" | "female";
	personality: string;
	model: string;
	cliTool: CLITool;
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
	| "agent:started"
	| "agent:stopped"
	| "agent:output"
	| "agent:error"
	| "phase:started"
	| "phase:completed"
	| "plan:created"
	| "plan:approved"
	| "execution:started"
	| "execution:error"
	| "escalation:user"
	| "git:commit"
	| "git:pr-created"
	| "task:timeout_warning"
	| "pipeline:completed"
	| "budget:warning"
	| "budget:exceeded"
	| "prompt:size";

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

export type AIProviderType = "openai" | "anthropic" | "google" | "ollama" | "custom";

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
	cliTool: CLITool;
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
	// agent_ids sütununda roller (ör: ["pm","frontend","qa"]) saklanır
	roles: string[];
	createdAt: string;
}

// ---- Agent Messages (ajan-arası iletişim) ----------------------------------

export type MessageType =
	| "task_assignment"
	| "task_complete"
	| "review_request"
	| "bug_report"
	| "feedback"
	| "notification";

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

export type DependencyType = "hierarchy" | "workflow" | "review" | "gate";

export interface AgentDependency {
	id: string;
	projectId: string;
	fromAgentId: string;
	toAgentId: string;
	type: DependencyType;
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
