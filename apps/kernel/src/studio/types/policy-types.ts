// ---------------------------------------------------------------------------
// Oscorpex — Policy & Approval Rule Types
// ---------------------------------------------------------------------------

import type { RiskLevel } from "./task-types.js";

export interface PolicyRule {
	id: string;
	projectId: string;
	name: string;
	condition: string;
	action: string;
	enabled: boolean;
}

export interface ApprovalRule {
	id: string;
	projectId?: string;
	actionType: string;
	riskLevel: RiskLevel;
	requiresApproval: boolean;
	autoApprove: boolean;
	maxPerRun?: number;
	description?: string;
	createdAt: string;
}
