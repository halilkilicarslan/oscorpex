// @oscorpex/event-schema — Phase & Plan event payloads

export interface PhaseStartedPayload {
	phaseId?: string;
	phaseName?: string;
	stageIndex?: number;
}

export interface PhaseCompletedPayload {
	phaseId?: string;
	phaseName?: string;
	stageIndex?: number;
}

export interface PlanCreatedPayload {
	planId?: string;
	version?: number;
	phaseCount?: number;
}

export interface PlanApprovedPayload {
	planId?: string;
	version?: number;
	approvedBy?: string;
}

export interface PlanPhaseAddedPayload {
	planId?: string;
	phaseId?: string;
	phaseName?: string;
}

export interface PlanReplannedPayload {
	planId?: string;
	version?: number;
	reason?: string;
}