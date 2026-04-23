// @oscorpex/kernel — CostReporter adapter
// Implements the CostReporter contract from @oscorpex/core.

import type { CostReporter, CostRecord, ProjectCostSummary, BudgetCheck } from "@oscorpex/core";
import { eventBus } from "../event-bus.js";

class KernelCostReporter implements CostReporter {
	async recordCost(record: CostRecord): Promise<void> {
		eventBus.emit({
			projectId: record.runId,
			type: "budget:warning",
			payload: {
				taskId: record.taskId,
				provider: record.provider,
				model: record.model,
				inputTokens: record.inputTokens,
				outputTokens: record.outputTokens,
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