// ---------------------------------------------------------------------------
// Oscorpex — Agentic Metrics: Section 18 observability metrics aggregation
// ---------------------------------------------------------------------------

import { query, queryOne } from "./db.js";

export interface AgenticMetrics {
	taskClaimLatency: { avgMs: number; p95Ms: number; samples: number };
	duplicateDispatchPrevented: number;
	verificationFailureRate: number;
	strategySuccessRates: Array<{ strategy: string; taskType: string; successRate: number; samples: number }>;
	avgRetriesBeforeCompletion: number;
	reviewRejectionByRole: Array<{ agentRole: string; rejections: number; total: number; rate: number }>;
	injectedTaskVolume: { total: number; autoApproved: number; pending: number; rejected: number };
	graphMutationStats: { total: number; byType: Record<string, number> };
	replanTriggerFrequency: { total: number; byTrigger: Record<string, number> };
	degradedProviderDuration: Array<{ provider: string; totalMs: number; incidents: number }>;
}

export async function getAgenticMetrics(projectId: string): Promise<AgenticMetrics> {
	const [
		claimLatency,
		duplicateCount,
		verificationRate,
		strategyRates,
		avgRetries,
		rejectionByRole,
		proposalStats,
		graphStats,
		replanStats,
	] = await Promise.all([
		getTaskClaimLatency(projectId),
		getDuplicateDispatchCount(projectId),
		getVerificationFailureRate(projectId),
		getStrategySuccessRates(projectId),
		getAvgRetriesBeforeCompletion(projectId),
		getReviewRejectionByRole(projectId),
		getInjectedTaskVolume(projectId),
		getGraphMutationStats(projectId),
		getReplanTriggerFrequency(projectId),
	]);

	return {
		taskClaimLatency: claimLatency,
		duplicateDispatchPrevented: duplicateCount,
		verificationFailureRate: verificationRate,
		strategySuccessRates: strategyRates,
		avgRetriesBeforeCompletion: avgRetries,
		reviewRejectionByRole: rejectionByRole,
		injectedTaskVolume: proposalStats,
		graphMutationStats: graphStats,
		replanTriggerFrequency: replanStats,
		degradedProviderDuration: [],
	};
}

async function getTaskClaimLatency(projectId: string): Promise<{ avgMs: number; p95Ms: number; samples: number }> {
	const row = await queryOne(
		`SELECT
			COALESCE(AVG(EXTRACT(EPOCH FROM (e2.timestamp - e1.timestamp)) * 1000), 0) AS avg_ms,
			COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e2.timestamp - e1.timestamp)) * 1000), 0) AS p95_ms,
			COUNT(*) AS samples
		 FROM events e1
		 JOIN events e2 ON e1.project_id = e2.project_id AND e1.task_id = e2.task_id
		 WHERE e1.project_id = $1
		   AND e1.type = 'task:assigned'
		   AND e2.type = 'task:started'`,
		[projectId],
	);
	return {
		avgMs: Math.round(Number(row?.avg_ms ?? 0)),
		p95Ms: Math.round(Number(row?.p95_ms ?? 0)),
		samples: Number(row?.samples ?? 0),
	};
}

async function getDuplicateDispatchCount(projectId: string): Promise<number> {
	const row = await queryOne(
		`SELECT COUNT(*) AS cnt FROM events
		 WHERE project_id = $1 AND type = 'execution:error'
		   AND payload->>'error' ILIKE '%already claimed%'`,
		[projectId],
	);
	return Number(row?.cnt ?? 0);
}

async function getVerificationFailureRate(projectId: string): Promise<number> {
	const row = await queryOne(
		`SELECT
			COUNT(*) FILTER (WHERE type = 'verification:failed') AS failed,
			COUNT(*) AS total
		 FROM events
		 WHERE project_id = $1 AND type IN ('verification:passed', 'verification:failed')`,
		[projectId],
	);
	const total = Number(row?.total ?? 0);
	if (total === 0) return 0;
	return Math.round((Number(row?.failed ?? 0) / total) * 10000) / 100;
}

async function getStrategySuccessRates(projectId: string): Promise<Array<{ strategy: string; taskType: string; successRate: number; samples: number }>> {
	const rows = await query(
		`SELECT strategy, task_type,
			COUNT(*) AS samples,
			COUNT(*) FILTER (WHERE outcome = 'success') AS successes
		 FROM agent_episodes
		 WHERE project_id = $1 AND strategy IS NOT NULL
		 GROUP BY strategy, task_type
		 HAVING COUNT(*) >= 2
		 ORDER BY COUNT(*) DESC
		 LIMIT 20`,
		[projectId],
	);
	return rows.map((r) => ({
		strategy: r.strategy as string,
		taskType: r.task_type as string,
		successRate: Math.round((Number(r.successes) / Number(r.samples)) * 10000) / 100,
		samples: Number(r.samples),
	}));
}

async function getAvgRetriesBeforeCompletion(projectId: string): Promise<number> {
	const row = await queryOne(
		`SELECT COALESCE(AVG(t.retry_count), 0) AS avg_retries
		 FROM tasks t
		 JOIN phases p ON t.phase_id = p.id
		 JOIN project_plans pp ON p.plan_id = pp.id
		 WHERE pp.project_id = $1 AND t.status = 'done'`,
		[projectId],
	);
	return Math.round(Number(row?.avg_retries ?? 0) * 100) / 100;
}

async function getReviewRejectionByRole(projectId: string): Promise<Array<{ agentRole: string; rejections: number; total: number; rate: number }>> {
	const rows = await query(
		`SELECT pa.role AS agent_role,
			COUNT(*) FILTER (WHERE e.type = 'task:review_rejected') AS rejections,
			COUNT(*) AS total
		 FROM events e
		 JOIN project_agents pa ON e.agent_id = pa.id
		 WHERE e.project_id = $1 AND e.type IN ('task:completed', 'task:review_rejected')
		 GROUP BY pa.role
		 ORDER BY rejections DESC`,
		[projectId],
	);
	return rows.map((r) => ({
		agentRole: r.agent_role as string,
		rejections: Number(r.rejections),
		total: Number(r.total),
		rate: Number(r.total) > 0 ? Math.round((Number(r.rejections) / Number(r.total)) * 10000) / 100 : 0,
	}));
}

async function getInjectedTaskVolume(projectId: string): Promise<{ total: number; autoApproved: number; pending: number; rejected: number }> {
	const row = await queryOne(
		`SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE status = 'approved') AS approved,
			COUNT(*) FILTER (WHERE status = 'pending') AS pending,
			COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
		 FROM task_proposals
		 WHERE project_id = $1`,
		[projectId],
	);
	return {
		total: Number(row?.total ?? 0),
		autoApproved: Number(row?.approved ?? 0),
		pending: Number(row?.pending ?? 0),
		rejected: Number(row?.rejected ?? 0),
	};
}

async function getGraphMutationStats(projectId: string): Promise<{ total: number; byType: Record<string, number> }> {
	const rows = await query(
		`SELECT mutation_type, COUNT(*) AS cnt
		 FROM graph_mutations
		 WHERE project_id = $1
		 GROUP BY mutation_type
		 ORDER BY cnt DESC`,
		[projectId],
	);
	const byType: Record<string, number> = {};
	let total = 0;
	for (const r of rows) {
		const cnt = Number(r.cnt);
		byType[r.mutation_type as string] = cnt;
		total += cnt;
	}
	return { total, byType };
}

async function getReplanTriggerFrequency(projectId: string): Promise<{ total: number; byTrigger: Record<string, number> }> {
	const rows = await query(
		`SELECT trigger, COUNT(*) AS cnt
		 FROM replan_events
		 WHERE project_id = $1
		 GROUP BY trigger
		 ORDER BY cnt DESC`,
		[projectId],
	);
	const byTrigger: Record<string, number> = {};
	let total = 0;
	for (const r of rows) {
		const cnt = Number(r.cnt);
		byTrigger[r.trigger as string] = cnt;
		total += cnt;
	}
	return { total, byTrigger };
}
