// @oscorpex/event-schema — Agent event payloads

export interface AgentStartedPayload {
	agentName?: string;
	role?: string;
	taskId?: string;
}

export interface AgentStoppedPayload {
	agentName?: string;
	role?: string;
	reason?: string;
}

export interface AgentOutputPayload {
	line: string;
	isError?: boolean;
}

export interface AgentErrorPayload {
	agentName?: string;
	error?: string;
	taskId?: string;
}

export interface AgentSessionStartedPayload {
	agentId?: string;
	strategy?: string;
	maxSteps?: number;
}

export interface AgentStrategySelectedPayload {
	agentId?: string;
	strategy?: string;
	taskType?: string;
}

export interface AgentRequestedHelpPayload {
	agentId?: string;
	agentName?: string;
	message?: string;
}

export interface AgentMemoryWrittenPayload {
	agentId?: string;
	scope?: string;
	key?: string;
}