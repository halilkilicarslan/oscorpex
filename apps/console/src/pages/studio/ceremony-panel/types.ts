export interface StandupAgent {
	agentId: string;
	agentName: string;
	role: string;
	completed: string[];
	inProgress: string[];
	blockers: string[];
}

export interface StandupResult {
	runAt?: string;
	agents: StandupAgent[];
}

export interface RetroSection {
	wentWell: string[];
	couldImprove: string[];
	actionItems: string[];
}

export interface RetroAgentStat {
	agentId: string;
	agentName: string;
	tasksCompleted: number;
	avgRevisions: number;
	successRate: number;
}

export interface RetroResult {
	runAt?: string;
	data: RetroSection;
	agentStats?: RetroAgentStat[];
}

export type Tab = 'standup' | 'retro';
