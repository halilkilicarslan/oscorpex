// ---------------------------------------------------------------------------
// Oscorpex — Agent Configuration & Runtime Types
// ---------------------------------------------------------------------------

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
