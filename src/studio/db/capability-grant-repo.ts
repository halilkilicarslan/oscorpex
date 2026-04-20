// ---------------------------------------------------------------------------
// Oscorpex — Capability Grant Repo: CRUD for agent capability grants
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne, execute } from "../pg.js";
import type { CapabilityGrant, CapabilityToken } from "../types.js";

function rowToGrant(row: Record<string, unknown>): CapabilityGrant {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		agentRole: row.agent_role as string,
		capability: row.capability as CapabilityToken,
		granted: row.granted as boolean,
		grantedBy: row.granted_by as string,
		createdAt: String(row.created_at),
	};
}

export async function upsertCapabilityGrant(params: {
	projectId: string;
	agentRole: string;
	capability: CapabilityToken;
	granted: boolean;
	grantedBy?: string;
}): Promise<CapabilityGrant> {
	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO agent_capability_grants (id, project_id, agent_role, capability, granted, granted_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (project_id, agent_role, capability) DO UPDATE
		   SET granted = EXCLUDED.granted, granted_by = EXCLUDED.granted_by
		 RETURNING *`,
		[id, params.projectId, params.agentRole, params.capability, params.granted, params.grantedBy ?? "system"],
	);
	return rowToGrant(row!);
}

export async function getCapabilityGrants(projectId: string, agentRole?: string): Promise<CapabilityGrant[]> {
	const rows = agentRole
		? await query("SELECT * FROM agent_capability_grants WHERE project_id = $1 AND agent_role = $2 ORDER BY capability", [projectId, agentRole])
		: await query("SELECT * FROM agent_capability_grants WHERE project_id = $1 ORDER BY agent_role, capability", [projectId]);
	return rows.map(rowToGrant);
}

export async function hasCapability(projectId: string, agentRole: string, capability: CapabilityToken): Promise<boolean> {
	const row = await queryOne(
		"SELECT granted FROM agent_capability_grants WHERE project_id = $1 AND agent_role = $2 AND capability = $3",
		[projectId, agentRole, capability],
	);
	if (!row) return getDefaultGrant(agentRole, capability);
	return row.granted as boolean;
}

export async function deleteCapabilityGrant(projectId: string, agentRole: string, capability: CapabilityToken): Promise<boolean> {
	const result = await execute(
		"DELETE FROM agent_capability_grants WHERE project_id = $1 AND agent_role = $2 AND capability = $3",
		[projectId, agentRole, capability],
	);
	return (result?.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Default grants per role (when no explicit grant exists)
// ---------------------------------------------------------------------------

const ROLE_DEFAULTS: Record<string, CapabilityToken[]> = {
	pm: ["can_propose_task", "can_request_replan", "can_request_human_review"],
	tech_lead: ["can_propose_task", "can_inject_task_low_risk", "can_request_replan", "can_modify_graph_same_phase", "can_request_human_review"],
	backend_dev: ["can_propose_task", "can_inject_task_low_risk", "can_trigger_tests", "can_commit_code"],
	frontend_dev: ["can_propose_task", "can_inject_task_low_risk", "can_trigger_tests", "can_commit_code"],
	qa_engineer: ["can_trigger_tests", "can_propose_task", "can_request_human_review"],
	security_auditor: ["can_propose_task", "can_request_human_review"],
	devops: ["can_propose_task", "can_trigger_tests", "can_commit_code", "can_open_deploy_request"],
};

function getDefaultGrant(agentRole: string, capability: CapabilityToken): boolean {
	const defaults = ROLE_DEFAULTS[agentRole];
	if (!defaults) return false;
	return defaults.includes(capability);
}

export function getDefaultGrantsForRole(agentRole: string): CapabilityToken[] {
	return ROLE_DEFAULTS[agentRole] ?? [];
}
