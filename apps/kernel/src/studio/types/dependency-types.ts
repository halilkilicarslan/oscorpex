// ---------------------------------------------------------------------------
// Oscorpex — Agent Dependencies, Capabilities & Grants
// ---------------------------------------------------------------------------

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
