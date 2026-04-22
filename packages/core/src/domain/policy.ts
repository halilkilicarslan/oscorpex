// @oscorpex/core — Policy and governance domain types
// Approval, risk classification, sandbox enforcement, and capability grants.

export type PolicyAction = "allow" | "warn" | "require_approval" | "block";

export interface PolicyDecision {
	runId: string;
	taskId?: string;
	action: PolicyAction;
	reasons: string[];
	policyVersion: string;
	createdAt: string;
}

export interface PolicyRule {
	id: string;
	projectId?: string;
	actionType: string;
	riskLevel: import("./task.js").RiskLevel;
	requiresApproval: boolean;
	autoApprove: boolean;
	maxPerRun?: number;
	description?: string;
	createdAt: string;
}

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

export type SandboxEnforcementMode = "hard" | "soft" | "off";

export interface SandboxPolicy {
	id: string;
	projectId: string;
	enforcementMode: SandboxEnforcementMode;
	allowedTools: string[];
	deniedTools: string[];
	filesystemScope: string[];
	networkPolicy: "allow" | "block" | "no_network";
	maxOutputBytes: number;
	elevatedCapabilities: string[];
}

export interface SandboxViolation {
	type: "tool" | "path" | "network" | "output_size";
	detail: string;
	severity: "warning" | "critical";
}

export interface SandboxSession {
	id: string;
	projectId: string;
	taskId: string;
	agentId: string;
	workspacePath: string;
	policy: SandboxPolicy;
	violations: SandboxViolation[];
	startedAt: string;
	endedAt?: string;
}

export interface PolicyEvaluationInput {
	run: import("./run.js").Run;
	task?: import("./task.js").Task;
	provider?: string;
	repoPath?: string;
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