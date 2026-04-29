export interface ComparisonRow {
	providerId: string;
	avgLatencyMs: number;
	p95LatencyMs: number;
	totalExecutions: number;
	successfulExecutions: number;
	failedExecutions: number;
	failureRate: number;
	fallbackRate: number;
	timeoutRate: number;
	costScore: number;
}
