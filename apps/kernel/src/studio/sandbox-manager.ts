// ---------------------------------------------------------------------------
// Oscorpex — Sandbox Manager: Capability isolation for agent execution
// Protects the host environment as agent autonomy increases.
// Controls workspace scope, tool access, filesystem bounds, network policy.
// Pure enforcement logic is in @oscorpex/policy-kit; this module handles
// persistence (DB) and session management (kernel layer).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { normalize, resolve, sep } from "node:path";
import { SandboxViolationError as CoreSandboxViolationError } from "@oscorpex/core";
import {
	buildDefaultSandboxPolicy,
	checkOutputSize,
	checkPathAllowed,
	checkToolAllowed,
	isSecurityTask,
} from "@oscorpex/policy-kit";
import { execute, getProjectSetting, query, queryOne } from "./db.js";
import { createLogger } from "./logger.js";
import type { Task } from "./types.js";
const log = createLogger("sandbox-manager");

// Re-export for backward compatibility
export { checkToolAllowed, checkPathAllowed, checkOutputSize } from "@oscorpex/policy-kit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IsolationLevel = "none" | "workspace" | "container" | "vm";
export type NetworkPolicy = "unrestricted" | "project_only" | "no_network";
export type EnforcementMode = "hard" | "soft" | "off";

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
	enforcementMode: EnforcementMode;
}

export class SandboxViolationError extends Error {
	public readonly violation: SandboxViolation;
	constructor(violation: SandboxViolation) {
		super(`Sandbox violation (${violation.type}): ${violation.detail}`);
		this.name = "SandboxViolationError";
		this.violation = violation;
	}
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
		enforcementMode: (row.enforcement_mode as EnforcementMode) ?? "hard",
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
		  filesystem_scope, network_policy, max_execution_time_ms, max_output_size_bytes, elevated_capabilities, enforcement_mode)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING *`,
		[
			id,
			params.projectId,
			params.isolationLevel,
			JSON.stringify(params.allowedTools),
			JSON.stringify(params.deniedTools),
			JSON.stringify(params.filesystemScope),
			params.networkPolicy,
			params.maxExecutionTimeMs,
			params.maxOutputSizeBytes,
			JSON.stringify(params.elevatedCapabilities),
			params.enforcementMode ?? "hard",
		],
	);
	return rowToPolicy(row!);
}

export async function getSandboxPolicy(projectId: string): Promise<SandboxPolicy | null> {
	const row = await queryOne(`SELECT * FROM sandbox_policies WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`, [
		projectId,
	]);
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
	const effectivePolicy = policy ?? buildDefaultSandboxPolicy(params.projectId);

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
	await execute(`UPDATE sandbox_sessions SET ended_at = now() WHERE id = $1`, [sessionId]);
}

export async function recordViolation(sessionId: string, violation: SandboxViolation): Promise<void> {
	await execute(`UPDATE sandbox_sessions SET violations = violations || $2::jsonb WHERE id = $1`, [
		sessionId,
		JSON.stringify([violation]),
	]);
}

export async function getSessionViolations(sessionId: string): Promise<SandboxViolation[]> {
	const row = await queryOne(`SELECT violations FROM sandbox_sessions WHERE id = $1`, [sessionId]);
	return (row?.violations as SandboxViolation[]) ?? [];
}

/**
 * Resolve effective sandbox policy for a task.
 * Uses buildDefaultSandboxPolicy from @oscorpex/policy-kit for defaults.
 */
export async function resolveTaskPolicy(projectId: string, task: Task, agentRole: string): Promise<SandboxPolicy> {
	const projectPolicy = await getSandboxPolicy(projectId);
	const defaultPolicy = buildDefaultSandboxPolicy(projectId);
	const base: SandboxPolicy = projectPolicy ?? {
		id: "default",
		projectId,
		isolationLevel: "workspace" as IsolationLevel,
		...defaultPolicy,
		networkPolicy: "unrestricted" as NetworkPolicy,
		maxExecutionTimeMs: 300_000,
		elevatedCapabilities: [] as string[],
	};

	// Project-level enforcement_mode override from project_settings
	const settingOverride = await getProjectSetting(projectId, "sandbox", "enforcement_mode");
	if (settingOverride && (settingOverride === "hard" || settingOverride === "soft" || settingOverride === "off")) {
		base.enforcementMode = settingOverride as EnforcementMode;
	}

	// Security-sensitive tasks get stricter isolation
	if (isSecurityTask(task.title)) {
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
			networkPolicy: base.networkPolicy ?? "full_network",
			elevatedCapabilities: [...base.elevatedCapabilities, "docker", "network_access"],
		};
	}

	return base;
}

// ---------------------------------------------------------------------------
// Enforcement — check actions against policy
// ---------------------------------------------------------------------------

/**
 * Enforce tool check: In hard mode, throws SandboxViolationError.
 * In soft mode, records violation and returns. In off mode, skips.
 */
export async function enforceToolCheck(policy: SandboxPolicy, toolName: string, sessionId?: string): Promise<void> {
	if (policy.enforcementMode === "off") return;
	const result = checkToolAllowed(policy, toolName);
	if (result.allowed) return;
	const violation: SandboxViolation = {
		type: "tool_denied",
		detail: result.reason,
		timestamp: new Date().toISOString(),
	};
	if (sessionId)
		await recordViolation(sessionId, violation).catch((err) =>
			log.warn("[sandbox-manager] Non-blocking operation failed:", err?.message ?? err),
		);
	if (policy.enforcementMode === "hard") {
		throw new SandboxViolationError(violation);
	}
	// soft mode: log only
	log.warn(`[sandbox] Soft violation — tool denied: ${toolName} — ${result.reason}`);
}

/**
 * Enforce path check on a list of file paths.
 * Returns list of violations. In hard mode, throws on first violation.
 */
export async function enforcePathChecks(
	policy: SandboxPolicy,
	filePaths: string[],
	sessionId?: string,
): Promise<SandboxViolation[]> {
	if (policy.enforcementMode === "off") return [];
	const violations: SandboxViolation[] = [];
	for (const filePath of filePaths) {
		const result = checkPathAllowed(policy, filePath);
		if (result.allowed) continue;
		const violation: SandboxViolation = {
			type: "path_traversal",
			detail: result.reason,
			timestamp: new Date().toISOString(),
		};
		violations.push(violation);
		if (sessionId)
			await recordViolation(sessionId, violation).catch((err) =>
				log.warn("[sandbox-manager] Non-blocking operation failed:", err?.message ?? err),
			);
		if (policy.enforcementMode === "hard") {
			throw new SandboxViolationError(violation);
		}
		log.warn(`[sandbox] Soft violation — path blocked: ${filePath}`);
	}
	return violations;
}

/**
 * Enforce output size check. Hard mode throws, soft mode logs.
 */
export async function enforceOutputSizeCheck(
	policy: SandboxPolicy,
	sizeBytes: number,
	sessionId?: string,
): Promise<void> {
	if (policy.enforcementMode === "off") return;
	const result = checkOutputSize(policy, sizeBytes);
	if (result.allowed) return;
	const violation: SandboxViolation = {
		type: "output_overflow",
		detail: result.reason,
		timestamp: new Date().toISOString(),
	};
	if (sessionId)
		await recordViolation(sessionId, violation).catch((err) =>
			log.warn("[sandbox-manager] Non-blocking operation failed:", err?.message ?? err),
		);
	if (policy.enforcementMode === "hard") {
		throw new SandboxViolationError(violation);
	}
	log.warn(`[sandbox] Soft violation — output size exceeded: ${sizeBytes} bytes`);
}
