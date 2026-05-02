// @oscorpex/kernel — CostReporter adapter
// Implements the CostReporter contract from @oscorpex/core.
// Persists cost records to token_usage table and emits cost:recorded events.

import { randomUUID } from "node:crypto";
import type { BudgetCheck, CostRecord, CostReporter, ProjectCostSummary } from "@oscorpex/core";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { execute } from "../pg.js";
const log = createLogger("cost-reporter");

class KernelCostReporter implements CostReporter {
	async recordCost(record: CostRecord): Promise<void> {
		const projectId = record.projectId ?? record.runId;

		// Persist to token_usage table (S3-03)
		await execute(
			`INSERT INTO token_usage (id, project_id, task_id, agent_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, cache_creation_tokens, cache_read_tokens, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			[
				randomUUID(),
				projectId,
				record.taskId,
				"system", // agent_id — not available in CostRecord
				record.model ?? "",
				record.provider,
				record.inputTokens,
				record.outputTokens,
				record.inputTokens + record.outputTokens,
				record.estimatedCostUsd ?? record.billedCostUsd ?? 0,
				record.cacheWriteTokens ?? 0,
				record.cacheReadTokens ?? 0,
				record.createdAt ?? new Date().toISOString(),
			],
		);

		// Emit cost:recorded event (S3-02 semantic fix)
		eventBus.emit({
			projectId,
			type: "cost:recorded",
			payload: {
				recordId: record.id,
				projectId,
				runId: record.runId,
				taskId: record.taskId,
				provider: record.provider,
				model: record.model,
				inputTokens: record.inputTokens,
				outputTokens: record.outputTokens,
				cacheReadTokens: record.cacheReadTokens,
				cacheWriteTokens: record.cacheWriteTokens,
				costUsd: record.estimatedCostUsd ?? record.billedCostUsd ?? 0,
			},
		});
	}

	async getProjectSpend(_projectId: string): Promise<ProjectCostSummary> {
		const { getProjectCostSummary } = await import("../db.js");
		return getProjectCostSummary(_projectId) as Promise<ProjectCostSummary>;
	}

	async checkBudget(projectId: string): Promise<BudgetCheck> {
		const { getProjectSettingsMap } = await import("../db.js");
		const settingsMap = await getProjectSettingsMap(projectId);
		const budgetSettings = settingsMap["budget"];

		if (!budgetSettings || budgetSettings["enabled"] !== "true") {
			return { totalSpentUsd: 0, budgetMaxUsd: null, exceeded: false };
		}

		const maxCost = Number.parseFloat(budgetSettings["maxCostUsd"] ?? "0");
		const summary = await this.getProjectSpend(projectId);
		const currentSpend = summary.totalCostUsd ?? 0;

		return {
			totalSpentUsd: currentSpend,
			budgetMaxUsd: maxCost > 0 ? maxCost : null,
			exceeded: maxCost > 0 && currentSpend >= maxCost,
		};
	}
}

export const costReporter = new KernelCostReporter();
