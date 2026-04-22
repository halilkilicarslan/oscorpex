// ---------------------------------------------------------------------------
// Oscorpex — Cross-Project Learning
// Extracts reusable patterns from successful executions without leaking tenant data.
// Patterns only — never raw source code exfiltration.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne, execute } from "./db.js";
import { createLogger } from "./logger.js";
const log = createLogger("cross-project-learning");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LearningType =
	| "strategy_success"
	| "execution_sequence"
	| "failure_signature"
	| "model_strategy_combo";

export interface LearningPattern {
	id: string;
	tenantId?: string;
	learningType: LearningType;
	taskType: string;
	agentRole: string;
	pattern: Record<string, unknown>;
	sampleCount: number;
	successRate: number;
	isGlobal: boolean;
	createdAt: string;
	updatedAt: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToPattern(row: Record<string, unknown>): LearningPattern {
	return {
		id: row.id as string,
		tenantId: (row.tenant_id as string) ?? undefined,
		learningType: row.learning_type as LearningType,
		taskType: row.task_type as string,
		agentRole: row.agent_role as string,
		pattern: (row.pattern as Record<string, unknown>) ?? {},
		sampleCount: (row.sample_count as number) ?? 0,
		successRate: (row.success_rate as number) ?? 0,
		isGlobal: (row.is_global as boolean) ?? false,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function upsertLearningPattern(params: {
	tenantId?: string;
	learningType: LearningType;
	taskType: string;
	agentRole: string;
	pattern: Record<string, unknown>;
	sampleCount: number;
	successRate: number;
	isGlobal?: boolean;
}): Promise<LearningPattern> {
	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO learning_patterns (id, tenant_id, learning_type, task_type, agent_role, pattern, sample_count, success_rate, is_global)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (tenant_id, learning_type, task_type, agent_role)
		 DO UPDATE SET pattern = $6, sample_count = $7, success_rate = $8, updated_at = now()
		 RETURNING *`,
		[
			id, params.tenantId ?? null, params.learningType, params.taskType, params.agentRole,
			JSON.stringify(params.pattern), params.sampleCount, params.successRate, params.isGlobal ?? false,
		],
	);
	return rowToPattern(row!);
}

export async function getLearningPatterns(
	taskType: string,
	agentRole: string,
	tenantId?: string,
): Promise<LearningPattern[]> {
	// Tenant-local first, then global fallback
	const rows = await query(
		`SELECT * FROM learning_patterns
		 WHERE task_type = $1 AND agent_role = $2
		   AND (tenant_id = $3 OR (is_global = true AND tenant_id IS NULL))
		 ORDER BY success_rate DESC, sample_count DESC
		 LIMIT 10`,
		[taskType, agentRole, tenantId ?? null],
	);
	return rows.map(rowToPattern);
}

export async function getGlobalPatterns(
	learningType: LearningType,
	limit = 20,
): Promise<LearningPattern[]> {
	const rows = await query(
		`SELECT * FROM learning_patterns
		 WHERE is_global = true AND learning_type = $1
		 ORDER BY success_rate DESC, sample_count DESC
		 LIMIT $2`,
		[learningType, limit],
	);
	return rows.map(rowToPattern);
}

// ---------------------------------------------------------------------------
// Pattern extraction — aggregate from episodes
// ---------------------------------------------------------------------------

/**
 * Extract learning patterns from completed episodes across a tenant.
 * Anonymizes data: stores only strategy names, task types, success rates.
 * Never stores raw code or tenant-specific content.
 */
export async function extractPatternsFromEpisodes(tenantId: string): Promise<number> {
	// Strategy success patterns — which strategies work best for which task types
	const strategyRows = await query(
		`SELECT
			ae.agent_role,
			ae.strategy_used,
			ae.task_type,
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE ae.outcome = 'success') as successes
		 FROM agent_episodes ae
		 JOIN projects p ON p.id = ae.project_id
		 WHERE p.tenant_id = $1
		 GROUP BY ae.agent_role, ae.strategy_used, ae.task_type
		 HAVING COUNT(*) >= 3`,
		[tenantId],
	);

	let patternsCreated = 0;

	for (const row of strategyRows) {
		const total = row.total as number;
		const successes = row.successes as number;
		await upsertLearningPattern({
			tenantId,
			learningType: "strategy_success",
			taskType: row.task_type as string,
			agentRole: row.agent_role as string,
			pattern: {
				strategy: row.strategy_used,
				sampleSize: total,
			},
			sampleCount: total,
			successRate: total > 0 ? successes / total : 0,
		});
		patternsCreated++;
	}

	// Failure signature patterns — common failure reasons by task type
	const failureRows = await query(
		`SELECT
			ae.agent_role,
			ae.task_type,
			ae.failure_reason,
			COUNT(*) as total
		 FROM agent_episodes ae
		 JOIN projects p ON p.id = ae.project_id
		 WHERE p.tenant_id = $1 AND ae.outcome = 'failure' AND ae.failure_reason IS NOT NULL
		 GROUP BY ae.agent_role, ae.task_type, ae.failure_reason
		 HAVING COUNT(*) >= 2`,
		[tenantId],
	);

	for (const row of failureRows) {
		await upsertLearningPattern({
			tenantId,
			learningType: "failure_signature",
			taskType: row.task_type as string,
			agentRole: row.agent_role as string,
			pattern: {
				failureReason: row.failure_reason,
				frequency: row.total as number,
			},
			sampleCount: row.total as number,
			successRate: 0,
		});
		patternsCreated++;
	}

	return patternsCreated;
}

// ---------------------------------------------------------------------------
// Promote tenant pattern to global (anonymized)
// ---------------------------------------------------------------------------

/**
 * v8.0: Auto-promote patterns that meet quality threshold.
 * Patterns with ≥10 samples and ≥70% success are automatically promoted to global.
 */
export async function autoPromotePatterns(tenantId: string): Promise<number> {
	const candidates = await query(
		`SELECT id FROM learning_patterns
		 WHERE tenant_id = $1 AND is_global = false
		   AND sample_count >= 10 AND success_rate >= 0.7`,
		[tenantId],
	);

	let promoted = 0;
	for (const row of candidates) {
		const result = await promoteToGlobal(row.id as string);
		if (result) promoted++;
	}

	if (promoted > 0) {
		const { eventBus } = await import("./event-bus.js");
		eventBus.emitTransient({
			projectId: "__global__",
			type: "task:completed" as any, // Use closest event type for learning:pattern_promoted
			payload: { learningPatternsPromoted: promoted, tenantId },
		});
	}

	return promoted;
}

export async function promoteToGlobal(patternId: string): Promise<LearningPattern | null> {
	const pattern = await queryOne(`SELECT * FROM learning_patterns WHERE id = $1`, [patternId]);
	if (!pattern) return null;

	// Anonymize: strip tenant_id, keep only aggregated metrics
	const anonymized = (pattern.pattern as Record<string, unknown>) ?? {};
	delete anonymized.tenantSpecific;

	const globalPattern = await upsertLearningPattern({
		tenantId: undefined,
		learningType: pattern.learning_type as LearningType,
		taskType: pattern.task_type as string,
		agentRole: pattern.agent_role as string,
		pattern: anonymized,
		sampleCount: pattern.sample_count as number,
		successRate: pattern.success_rate as number,
		isGlobal: true,
	});

	return globalPattern;
}
