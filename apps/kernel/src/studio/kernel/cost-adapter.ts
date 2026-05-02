// @oscorpex/kernel — CostReporter adapter
// Implements the CostReporter contract from @oscorpex/core.
// Persists cost records to token_usage table and emits cost:recorded events.

import type { BudgetCheck, CostRecord, CostReporter, ProjectCostSummary } from "@oscorpex/core";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
const log = createLogger("cost-reporter");

class KernelCostReporter implements CostReporter {
	async recordCost(record: CostRecord): Promise<void> {
		const projectId = record.projectId ?? record.runId;

		// Persist to token_usage table via db repo (avoids direct pg access)
		const { recordTokenUsage } = await import("../db.js");
		await recordTokenUsage({
			projectId,
			taskId: record.taskId ?? "",
			agentId: "system", // agent_id — not available in CostRecord
			model: record.model ?? "",
			provider: record.provider,
			inputTokens: record.inputTokens,
			outputTokens: record.outputTokens,
			totalTokens: record.inputTokens + record.outputTokens,
			costUsd: record.estimatedCostUsd ?? record.billedCostUsd ?? 0,
			cacheCreationTokens: record.cacheWriteTokens ?? 0,
			cacheReadTokens: record.cacheReadTokens ?? 0,
		});

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
