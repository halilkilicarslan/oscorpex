// ---------------------------------------------------------------------------
// Oscorpex — Agent Constraints: Governance and approval enforcement
// Checks approval rules before allowing agent actions.
// ---------------------------------------------------------------------------

import { getApprovalRule, requiresApproval } from "../db.js";
import type { RiskLevel, TaskProposal } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("agent-constraints");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConstraintCheck {
	allowed: boolean;
	requiresApproval: boolean;
	reason: string;
	riskLevel: RiskLevel;
}

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

/** Classify the risk level of a task proposal or action */
export function classifyRisk(proposal: Pick<TaskProposal, "proposalType" | "severity" | "title">): RiskLevel {
	// High-risk: schema changes, deployment, security-related
	const highRiskPatterns = /schema|migration|deploy|security|auth|permission|delete.*table|drop/i;
	if (highRiskPatterns.test(proposal.title) || proposal.severity === "critical") {
		return "critical";
	}

	// Medium-risk: refactors, dependency changes
	const mediumRiskPatterns = /refactor|restructure|upgrade|dependency|package/i;
	if (mediumRiskPatterns.test(proposal.title) || proposal.severity === "high") {
		return "high";
	}

	// Low-risk: tests, docs, minor fixes
	const lowRiskPatterns = /test|doc|readme|comment|typo|lint|format/i;
	if (lowRiskPatterns.test(proposal.title) || proposal.proposalType === "test_task") {
		return "low";
	}

	return "medium";
}

// ---------------------------------------------------------------------------
// Constraint checking
// ---------------------------------------------------------------------------

/**
 * Check if an action is allowed under the current governance rules.
 * Returns whether it's allowed, needs approval, and why.
 */
export async function checkConstraints(
	projectId: string,
	actionType: string,
	riskLevel: RiskLevel,
): Promise<ConstraintCheck> {
	const needsApproval = await requiresApproval(projectId, actionType, riskLevel);

	if (needsApproval) {
		return {
			allowed: false,
			requiresApproval: true,
			reason: `Action "${actionType}" at risk level "${riskLevel}" requires human approval`,
			riskLevel,
		};
	}

	// Check for per-run limits
	const rule = await getApprovalRule(projectId, actionType, riskLevel);
	if (rule?.autoApprove) {
		return {
			allowed: true,
			requiresApproval: false,
			reason: `Auto-approved: "${actionType}" at "${riskLevel}" risk`,
			riskLevel,
		};
	}

	return {
		allowed: true,
		requiresApproval: false,
		reason: `Allowed: "${actionType}" at "${riskLevel}" risk`,
		riskLevel,
	};
}

/**
 * Check if a task proposal can be auto-approved based on governance rules.
 */
export async function canAutoApprove(
	projectId: string,
	proposal: Pick<TaskProposal, "proposalType" | "severity" | "title">,
): Promise<{ autoApprove: boolean; riskLevel: RiskLevel; reason: string }> {
	const riskLevel = classifyRisk(proposal);

	// Low risk → auto-approve
	if (riskLevel === "low") {
		return { autoApprove: true, riskLevel, reason: "Low-risk task — auto-approved" };
	}

	// Check explicit rules
	const rule = await getApprovalRule(projectId, proposal.proposalType, riskLevel);
	if (rule?.autoApprove) {
		return { autoApprove: true, riskLevel, reason: `Rule-based auto-approve for ${proposal.proposalType}` };
	}

	// Medium+ risk → require approval
	return { autoApprove: false, riskLevel, reason: `${riskLevel} risk requires approval` };
}
