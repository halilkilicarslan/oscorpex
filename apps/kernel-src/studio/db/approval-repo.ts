// ---------------------------------------------------------------------------
// Oscorpex — Approval Repository: Risk-based governance rules CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { ApprovalRule, RiskLevel } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("approval-repo");

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToRule(row: any): ApprovalRule {
	return {
		id: row.id,
		projectId: row.project_id ?? undefined,
		actionType: row.action_type,
		riskLevel: row.risk_level as RiskLevel,
		requiresApproval: Boolean(row.requires_approval),
		autoApprove: Boolean(row.auto_approve),
		maxPerRun: row.max_per_run != null ? Number(row.max_per_run) : undefined,
		description: row.description ?? undefined,
		createdAt: row.created_at?.toISOString?.() ?? row.created_at,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createApprovalRule(
	data: Omit<ApprovalRule, "id" | "createdAt">,
): Promise<ApprovalRule> {
	const id = randomUUID();
	await execute(
		`INSERT INTO approval_rules (id, project_id, action_type, risk_level, requires_approval, auto_approve, max_per_run, description)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (project_id, action_type, risk_level) DO UPDATE SET
			requires_approval = EXCLUDED.requires_approval,
			auto_approve = EXCLUDED.auto_approve,
			max_per_run = EXCLUDED.max_per_run,
			description = EXCLUDED.description`,
		[
			id,
			data.projectId ?? null,
			data.actionType,
			data.riskLevel,
			data.requiresApproval,
			data.autoApprove,
			data.maxPerRun ?? null,
			data.description ?? null,
		],
	);
	return { ...data, id, createdAt: new Date().toISOString() };
}

/** Get the applicable rule for an action type and risk level.
 *  Checks project-specific rule first, then global (project_id IS NULL). */
export async function getApprovalRule(
	projectId: string,
	actionType: string,
	riskLevel: RiskLevel,
): Promise<ApprovalRule | undefined> {
	// Project-specific first
	const projectRule = await queryOne<any>(
		`SELECT * FROM approval_rules WHERE project_id = $1 AND action_type = $2 AND risk_level = $3`,
		[projectId, actionType, riskLevel],
	);
	if (projectRule) return rowToRule(projectRule);

	// Global fallback
	const globalRule = await queryOne<any>(
		`SELECT * FROM approval_rules WHERE project_id IS NULL AND action_type = $1 AND risk_level = $2`,
		[actionType, riskLevel],
	);
	return globalRule ? rowToRule(globalRule) : undefined;
}

/** Check if an action requires approval */
export async function requiresApproval(
	projectId: string,
	actionType: string,
	riskLevel: RiskLevel,
): Promise<boolean> {
	const rule = await getApprovalRule(projectId, actionType, riskLevel);
	if (!rule) {
		// Default: high/critical require approval, low/medium auto-approve
		return riskLevel === "high" || riskLevel === "critical";
	}
	return rule.requiresApproval && !rule.autoApprove;
}

/** List all rules for a project (including globals) */
export async function listApprovalRules(projectId: string): Promise<ApprovalRule[]> {
	const rows = await query<any>(
		`SELECT * FROM approval_rules WHERE project_id = $1 OR project_id IS NULL ORDER BY action_type, risk_level`,
		[projectId],
	);
	return rows.map(rowToRule);
}
