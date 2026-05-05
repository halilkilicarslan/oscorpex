// ---------------------------------------------------------------------------
// Oscorpex — Cross-Project Learning
// Extracts reusable patterns from successful executions without leaking tenant data.
// Patterns only — never raw source code exfiltration.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "./db.js";
import { detectPromptInjection, validatePatternContent } from "./learning-governance.js";
import { createLogger } from "./logger.js";
const log = createLogger("cross-project-learning");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LearningType = "strategy_success" | "execution_sequence" | "failure_signature" | "model_strategy_combo";

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
	const validation = validatePatternContent(params.pattern);
	if (!validation.valid && validation.score < 0.3) {
		log.warn(
			{ issues: validation.issues, score: validation.score },
			"[cross-project-learning] Pattern rejected by governance",
		);
		throw new Error(`Pattern rejected: ${validation.issues.join("; ")}`);
	}

	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO learning_patterns (id, tenant_id, learning_type, task_type, agent_role, pattern, sample_count, success_rate, is_global)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (tenant_id, learning_type, task_type, agent_role)
		 DO UPDATE SET pattern = $6, sample_count = $7, success_rate = $8, updated_at = now()
		 RETURNING *`,
		[
			id,
			params.tenantId ?? null,
			params.learningType,
			params.taskType,
			params.agentRole,
			JSON.stringify(params.pattern),
			params.sampleCount,
			params.successRate,
			params.isGlobal ?? false,
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

export async function getGlobalPatterns(learningType: LearningType, limit = 20): Promise<LearningPattern[]> {
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
			COALESCE(pa.role, 'unknown') AS agent_role,
			ae.strategy AS strategy_used,
			ae.task_type,
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE ae.outcome = 'success') as successes
		 FROM agent_episodes ae
		 JOIN projects p ON p.id = ae.project_id
		 LEFT JOIN project_agents pa ON pa.id = ae.agent_id
		 WHERE (p.tenant_id = $1 OR (p.tenant_id IS NULL AND $1 = 'default'))
		 GROUP BY COALESCE(pa.role, 'unknown'), ae.strategy, ae.task_type
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
			COALESCE(pa.role, 'unknown') AS agent_role,
			ae.task_type,
			ae.failure_reason,
			COUNT(*) as total
		 FROM agent_episodes ae
		 JOIN projects p ON p.id = ae.project_id
		 LEFT JOIN project_agents pa ON pa.id = ae.agent_id
		 WHERE (p.tenant_id = $1 OR (p.tenant_id IS NULL AND $1 = 'default')) AND ae.outcome = 'failure' AND ae.failure_reason IS NOT NULL
		 GROUP BY COALESCE(pa.role, 'unknown'), ae.task_type, ae.failure_reason
		 HAVING COUNT(*) >= 2`,
		[tenantId],
	);

	for (const row of failureRows) {
		const failureReason = row.failure_reason as string;
		const injections = detectPromptInjection(failureReason);
		if (injections.length > 0) {
			log.warn(
				{ injections, taskType: row.task_type },
				"[cross-project-learning] Skipping episode with injected failure_reason",
			);
			continue;
		}

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
 * v8.2: Governance gate — each candidate is content-validated before promotion.
 *       Patterns that fail (invalid content OR score < 0.5) are blocked and audited.
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
		// Fetch full pattern to run governance validation before promoting
		const candidate = await queryOne("SELECT * FROM learning_patterns WHERE id = $1", [row.id as string]);
		if (!candidate) continue;

		const candidatePattern = (candidate.pattern as Record<string, unknown>) ?? {};
		const validation = validatePatternContent(candidatePattern);
		if (!validation.valid || validation.score < 0.5) {
			log.warn(
				{ patternId: candidate.id, issues: validation.issues, score: validation.score },
				"[cross-project-learning] Pattern blocked from promotion — failed governance check",
			);
			const { eventBus } = await import("./event-bus.js");
			eventBus.emit({
				projectId: (candidate.tenant_id as string) ?? "global",
				type: "learning:promotion_blocked" as any, // New event type — not yet in EventType union
				payload: {
					patternId: candidate.id,
					reason: validation.issues.join("; "),
					score: validation.score,
				},
			});
			continue; // skip this pattern
		}

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
	const pattern = await queryOne("SELECT * FROM learning_patterns WHERE id = $1", [patternId]);
	if (!pattern) return null;

	// Governance gate: validate content before allowing manual promotion
	const patternData = (pattern.pattern as Record<string, unknown>) ?? {};
	const validation = validatePatternContent(patternData);
	if (!validation.valid) {
		log.warn(
			{ patternId, issues: validation.issues },
			"[cross-project-learning] Manual promotion blocked — pattern failed governance check",
		);
		const { eventBus } = await import("./event-bus.js");
		eventBus.emit({
			projectId: (pattern.tenant_id as string) ?? "global",
			type: "learning:promotion_blocked" as any, // New event type — not yet in EventType union
			payload: {
				patternId,
				reason: validation.issues.join("; "),
				score: validation.score,
			},
		});
		return null; // Return null to indicate promotion was blocked
	}

	// Anonymize: strip tenant_id, keep only aggregated metrics
	const anonymized = { ...patternData };
	anonymized.tenantSpecific = undefined;

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
