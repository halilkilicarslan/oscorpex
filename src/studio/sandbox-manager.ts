// ---------------------------------------------------------------------------
// Oscorpex — Sandbox Manager: Capability isolation for agent execution
// Protects the host environment as agent autonomy increases.
// Controls workspace scope, tool access, filesystem bounds, network policy.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne, execute, getProjectSetting } from "./db.js";
import type { Task } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IsolationLevel = "none" | "workspace" | "container" | "vm";
export type NetworkPolicy = "unrestricted" | "project_only" | "no_network";

export interface SandboxPolicy {
	id: string;
	projectId: string;
	isolationLevel: IsolationLevel;
	allowedTools: string[];
	deniedTools: string[];
	filesystemScope: string[];
	networkPolicy: NetworkPolicy;
	maxExecutionTimeMs: number;
	maxOutputSizeBytes: number;
	elevatedCapabilities: string[];
}

export interface SandboxSession {
	id: string;
	projectId: string;
	taskId: string;
	agentId: string;
	policy: SandboxPolicy;
	workspacePath: string;
	startedAt: string;
	endedAt?: string;
	violations: SandboxViolation[];
}

export interface SandboxViolation {
	type: "tool_denied" | "path_traversal" | "timeout" | "output_overflow" | "network_blocked";
	detail: string;
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPolicy(row: Record<string, unknown>): SandboxPolicy {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		isolationLevel: (row.isolation_level as IsolationLevel) ?? "workspace",
		allowedTools: (row.allowed_tools as string[]) ?? [],
		deniedTools: (row.denied_tools as string[]) ?? [],
		filesystemScope: (row.filesystem_scope as string[]) ?? [],
		networkPolicy: (row.network_policy as NetworkPolicy) ?? "project_only",
		maxExecutionTimeMs: (row.max_execution_time_ms as number) ?? 300_000,
		maxOutputSizeBytes: (row.max_output_size_bytes as number) ?? 10_485_760,
		elevatedCapabilities: (row.elevated_capabilities as string[]) ?? [],
	};
}

function rowToSession(row: Record<string, unknown>): SandboxSession {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		taskId: row.task_id as string,
		agentId: row.agent_id as string,
		policy: (row.policy as SandboxPolicy) ?? ({} as SandboxPolicy),
		workspacePath: row.workspace_path as string,
		startedAt: row.started_at as string,
		endedAt: (row.ended_at as string) ?? undefined,
		violations: (row.violations as SandboxViolation[]) ?? [],
	};
}

// ---------------------------------------------------------------------------
// Policy CRUD
// ---------------------------------------------------------------------------

export async function createSandboxPolicy(params: Omit<SandboxPolicy, "id">): Promise<SandboxPolicy> {
	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO sandbox_policies (id, project_id, isolation_level, allowed_tools, denied_tools,
		  filesystem_scope, network_policy, max_execution_time_ms, max_output_size_bytes, elevated_capabilities)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING *`,
		[
			id, params.projectId, params.isolationLevel,
			JSON.stringify(params.allowedTools), JSON.stringify(params.deniedTools),
			JSON.stringify(params.filesystemScope), params.networkPolicy,
			params.maxExecutionTimeMs, params.maxOutputSizeBytes,
			JSON.stringify(params.elevatedCapabilities),
		],
	);
	return rowToPolicy(row!);
}

export async function getSandboxPolicy(projectId: string): Promise<SandboxPolicy | null> {
	const row = await queryOne(
		`SELECT * FROM sandbox_policies WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
		[projectId],
	);
	return row ? rowToPolicy(row) : null;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function startSandboxSession(params: {
	projectId: string;
	taskId: string;
	agentId: string;
	workspacePath: string;
}): Promise<SandboxSession> {
	const policy = await getSandboxPolicy(params.projectId);
	const effectivePolicy = policy ?? buildDefaultPolicy(params.projectId);

	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO sandbox_sessions (id, project_id, task_id, agent_id, policy, workspace_path, violations)
		 VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
		 RETURNING *`,
		[id, params.projectId, params.taskId, params.agentId, JSON.stringify(effectivePolicy), params.workspacePath],
	);
	return rowToSession(row!);
}

export async function endSandboxSession(sessionId: string): Promise<void> {
	await execute(
		`UPDATE sandbox_sessions SET ended_at = now() WHERE id = $1`,
		[sessionId],
	);
}

export async function recordViolation(sessionId: string, violation: SandboxViolation): Promise<void> {
	await execute(
		`UPDATE sandbox_sessions SET violations = violations || $2::jsonb WHERE id = $1`,
		[sessionId, JSON.stringify([violation])],
	);
}

export async function getSessionViolations(sessionId: string): Promise<SandboxViolation[]> {
	const row = await queryOne(`SELECT violations FROM sandbox_sessions WHERE id = $1`, [sessionId]);
	return (row?.violations as SandboxViolation[]) ?? [];
}

// ---------------------------------------------------------------------------
// Enforcement — check actions against policy
// ---------------------------------------------------------------------------

export function checkToolAllowed(policy: SandboxPolicy, toolName: string): { allowed: boolean; reason: string } {
	if (policy.deniedTools.includes(toolName)) {
		return { allowed: false, reason: `Tool "${toolName}" is explicitly denied by sandbox policy` };
	}
	if (policy.allowedTools.length > 0 && !policy.allowedTools.includes(toolName)) {
		return { allowed: false, reason: `Tool "${toolName}" is not in the allowed tools list` };
	}
	return { allowed: true, reason: "allowed" };
}

export function checkPathAllowed(policy: SandboxPolicy, filePath: string): { allowed: boolean; reason: string } {
	if (policy.filesystemScope.length === 0) {
		return { allowed: true, reason: "no filesystem scope restriction" };
	}
	const withinScope = policy.filesystemScope.some((scope) => filePath.startsWith(scope));
	if (!withinScope) {
		return { allowed: false, reason: `Path "${filePath}" is outside sandbox scope: ${policy.filesystemScope.join(", ")}` };
	}
	return { allowed: true, reason: "within scope" };
}

export function checkOutputSize(policy: SandboxPolicy, sizeBytes: number): { allowed: boolean; reason: string } {
	if (sizeBytes > policy.maxOutputSizeBytes) {
		return { allowed: false, reason: `Output size (${sizeBytes} bytes) exceeds limit (${policy.maxOutputSizeBytes} bytes)` };
	}
	return { allowed: true, reason: "within limit" };
}

// ---------------------------------------------------------------------------
// Default policy builder
// ---------------------------------------------------------------------------

function buildDefaultPolicy(projectId: string): SandboxPolicy {
	return {
		id: "default",
		projectId,
		isolationLevel: "workspace",
		allowedTools: [],
		deniedTools: ["rm_rf", "format_disk", "sudo"],
		filesystemScope: [],
		networkPolicy: "project_only",
		maxExecutionTimeMs: 300_000,
		maxOutputSizeBytes: 10_485_760,
		elevatedCapabilities: [],
	};
}

/**
 * Resolve effective sandbox policy for a task.
 * Merges project policy with task-level overrides.
 */
export async function resolveTaskPolicy(
	projectId: string,
	task: Task,
	agentRole: string,
): Promise<SandboxPolicy> {
	const projectPolicy = await getSandboxPolicy(projectId);
	const base = projectPolicy ?? buildDefaultPolicy(projectId);

	// Security-sensitive tasks get stricter isolation
	const isSecurityTask = /security|auth|permission|secret/i.test(task.title);
	if (isSecurityTask) {
		return {
			...base,
			networkPolicy: "no_network",
			deniedTools: [...base.deniedTools, "shell_exec", "process_spawn"],
		};
	}

	// DevOps tasks may need elevated capabilities
	if (agentRole === "devops") {
		return {
			...base,
			elevatedCapabilities: [...base.elevatedCapabilities, "docker", "network_access"],
		};
	}

	return base;
}
