// ---------------------------------------------------------------------------
// Oscorpex — Task Session Inspector Types (read-only observability)
// ---------------------------------------------------------------------------

export interface TaskSessionInspector {
	projectId: string;
	taskId: string;
	task: InspectorTaskSummary;
	agent?: InspectorAgentSummary;
	session?: InspectorSessionSummary;
	strategy?: InspectorStrategySummary;
	execution?: InspectorExecutionSummary;
	usage?: InspectorUsageSummary;
	output?: InspectorOutputSummary;
	gates: InspectorGateSummary[];
	timeline: InspectorTimelineItem[];
	observations: InspectorObservation[];
	warnings: InspectorWarning[];
	raw?: {
		task?: unknown;
		session?: unknown;
		usage?: unknown[];
	};
}

export interface InspectorTaskSummary {
	id: string;
	title: string;
	status: string;
	complexity?: string;
	taskType?: string;
	assignedAgent?: string;
	assignedAgentId?: string;
	retryCount?: number;
	revisionCount?: number;
	createdAt?: string;
	startedAt?: string;
	completedAt?: string;
	error?: string;
}

export interface InspectorAgentSummary {
	id: string;
	name: string;
	role: string;
}

export interface InspectorSessionSummary {
	id: string;
	status: string;
	maxSteps?: number;
	stepsCompleted?: number;
	strategy?: string;
	createdAt?: string;
	completedAt?: string;
	durationMs?: number;
}

export interface InspectorStrategySummary {
	name?: string;
	confidence?: number;
	reason?: string;
}

export interface InspectorExecutionSummary {
	provider?: string;
	model?: string;
	latencyMs?: number;
	costUsd?: number;
	failureClassification?: string;
	error?: string;
}

export interface InspectorUsageSummary {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costUsd: number;
}

export interface InspectorOutputSummary {
	filesCreated: string[];
	filesModified: string[];
	logs: string[];
	error?: string;
}

export interface InspectorGateSummary {
	name: string;
	status: "passed" | "failed" | "warning" | "skipped" | "unknown";
	message?: string;
	timestamp?: string;
}

export interface InspectorTimelineItem {
	id: string;
	timestamp?: string;
	type: string;
	title: string;
	detail?: string;
	severity: "info" | "success" | "warning" | "error";
	source: "task" | "session" | "provider" | "usage" | "gate" | "review" | "event" | "system";
}

export interface InspectorObservation {
	step: number;
	type: string;
	summary: string;
	timestamp?: string;
}

export interface InspectorWarning {
	code: string;
	message: string;
}
