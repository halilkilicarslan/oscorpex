// ---------------------------------------------------------------------------
// Oscorpex — Agent Constraints: Governance and approval enforcement
// Checks approval rules before allowing agent actions.
// ---------------------------------------------------------------------------

import { getApprovalRule, requiresApproval } from "../db.js";
import { createLogger } from "../logger.js";
import type { RiskLevel, TaskProposal } from "../types.js";
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

/**
 * Input signals for multi-signal risk classification.
 * Backward-compatible superset of Pick<TaskProposal, "proposalType" | "severity" | "title">.
 */
export interface RiskSignals {
	title: string;
	proposalType?: string;
	severity?: string;
	/** Task size: "S" | "M" | "L" | "XL" */
	complexity?: string;
	/** Canonical hyphen-case agent role, e.g. "devops", "backend-dev", "reviewer" */
	agentRole?: string;
	/** Number of upstream task dependencies */
	dependsOnCount?: number;
	/** Git branch name — main/master increases risk */
	branch?: string;
	/** File paths that will be modified */
	filesAffected?: string[];
}

/** Transparent, observable risk assessment with per-signal breakdown. */
export interface RiskAssessment {
	level: RiskLevel;
	/** Weighted composite score in [0, 1] */
	score: number;
	/** Per-signal scores (each in [0, 1]) keyed by signal name */
	signals: Record<string, number>;
	/** Human-readable explanation of the dominant signals */
	reason: string;
}

// ---------------------------------------------------------------------------
// Risk classification — multi-signal weighted scorer
// ---------------------------------------------------------------------------

// Signal 1: Title keyword patterns
const CRITICAL_TITLE = /schema|migration|deploy|production|security|auth|permission|delete.*table|drop|seed|truncate/i;
const HIGH_TITLE = /refactor|restructure|upgrade|dependency|package|database|api.*break|breaking/i;
const LOW_TITLE = /test|doc|readme|comment|typo|lint|format|style|cleanup|chore/i;

// Signal 6: Sensitive file path fragments
const SENSITIVE_FILE_PATTERNS = [
	/init\.sql$/i,
	/migration/i,
	/\.env/i,
	/^package\.json$/i,
	/dockerfile/i,
	/\.github\//i,
	/\.gitlab-ci/i,
	/docker-compose/i,
];

/** Score a single signal — returns a value in [0, 1] and a short label. */
function scoreTitleKeywords(title: string): { score: number; label: string } {
	if (CRITICAL_TITLE.test(title)) return { score: 1.0, label: "critical-keyword" };
	if (HIGH_TITLE.test(title)) return { score: 0.7, label: "high-keyword" };
	if (LOW_TITLE.test(title)) return { score: 0.1, label: "low-keyword" };
	return { score: 0.4, label: "medium-keyword" };
}

function scoreSeverity(severity: string | undefined): number {
	switch (severity) {
		case "critical":
			return 1.0;
		case "high":
			return 0.7;
		case "medium":
			return 0.4;
		case "low":
			return 0.1;
		default:
			return 0.3;
	}
}

function scoreComplexity(complexity: string | undefined): number {
	switch (complexity) {
		case "XL":
			return 0.9;
		case "L":
			return 0.6;
		case "M":
			return 0.3;
		case "S":
			return 0.1;
		default:
			return 0.3;
	}
}

function scoreAgentRole(role: string | undefined): number {
	if (!role) return 0.3;
	if (role === "devops") return 0.8;
	if (role === "backend-dev" || role === "architect") return 0.5;
	if (role === "frontend-dev") return 0.3;
	if (role === "reviewer" || role === "qa") return 0.1;
	return 0.3;
}

function scoreProposalType(proposalType: string | undefined): number {
	switch (proposalType) {
		case "infrastructure_task":
		case "deployment_task":
			return 0.8;
		case "new_task":
			return 0.5;
		case "bug_fix":
		case "fix_task":
			return 0.3;
		case "test_task":
			return 0.1;
		default:
			return 0.4;
	}
}

function scoreFileScope(signals: Pick<RiskSignals, "filesAffected" | "branch">): number {
	const { filesAffected, branch } = signals;

	// Branch name check — main/master is inherently riskier
	if (branch && /^(main|master)$/i.test(branch)) return 0.8;

	if (!filesAffected || filesAffected.length === 0) return 0.2;

	// Count how many sensitive pattern matches across all file paths
	let hits = 0;
	for (const filePath of filesAffected) {
		const base = filePath.split("/").pop() ?? filePath;
		for (const pattern of SENSITIVE_FILE_PATTERNS) {
			if (pattern.test(filePath) || pattern.test(base)) {
				hits++;
				break; // one hit per file is enough
			}
		}
	}

	return Math.min(1.0, 0.2 + hits * 0.3);
}

/**
 * Assess risk using a weighted multi-signal scorer.
 * Returns a full RiskAssessment with per-signal transparency.
 */
export function assessRisk(signals: RiskSignals): RiskAssessment {
	const titleResult = scoreTitleKeywords(signals.title);
	const titleScore = titleResult.score;
	const severityScore = scoreSeverity(signals.severity);
	const complexityScore = scoreComplexity(signals.complexity);
	const roleScore = scoreAgentRole(signals.agentRole);
	const typeScore = scoreProposalType(signals.proposalType);
	const fileScore = scoreFileScope({ filesAffected: signals.filesAffected, branch: signals.branch });

	// Weights must sum to 1.0
	const composite =
		titleScore * 0.3 +
		severityScore * 0.25 +
		complexityScore * 0.15 +
		roleScore * 0.1 +
		typeScore * 0.1 +
		fileScore * 0.1;

	const perSignal: Record<string, number> = {
		titleKeywords: titleScore,
		severity: severityScore,
		complexity: complexityScore,
		agentRole: roleScore,
		proposalType: typeScore,
		fileScope: fileScore,
	};

	let level: RiskLevel;
	if (composite >= 0.49) {
		level = "critical";
	} else if (composite >= 0.4) {
		level = "high";
	} else if (composite >= 0.25) {
		level = "medium";
	} else {
		level = "low";
	}

	// Build a concise human-readable reason from the dominant signals
	const dominantSignals: string[] = [];
	if (titleScore >= 0.7) dominantSignals.push(`title (${titleResult.label})`);
	if (severityScore >= 0.7) dominantSignals.push(`severity=${signals.severity}`);
	if (fileScore >= 0.6) dominantSignals.push(signals.branch ? `branch=${signals.branch}` : "sensitive-files");
	if (roleScore >= 0.7) dominantSignals.push(`role=${signals.agentRole}`);
	if (typeScore >= 0.7) dominantSignals.push(`type=${signals.proposalType}`);
	if (dominantSignals.length === 0) dominantSignals.push("no dominant risk signals");

	const reason = `${level} risk (score=${composite.toFixed(2)}): ${dominantSignals.join(", ")}`;

	log.debug({ score: composite, level, signals: perSignal }, "[agent-constraints] Risk assessed");

	return { level, score: composite, signals: perSignal, reason };
}

/**
 * Classify the risk level of a task proposal or action.
 * Accepts the legacy Pick<TaskProposal, …> shape or the richer RiskSignals interface.
 */
export function classifyRisk(signals: RiskSignals): RiskLevel {
	return assessRisk(signals).level;
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
