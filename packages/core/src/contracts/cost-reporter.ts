// @oscorpex/core — CostReporter contract
// Interface for recording and querying cost/budget data.

import type { CostRecord, BudgetCheck, ProjectCostSummary } from "../domain/cost.js";

export interface CostReporter {
	recordCost(record: CostRecord): Promise<void>;
	getProjectSpend(projectId: string): Promise<ProjectCostSummary>;
	checkBudget(projectId: string): Promise<BudgetCheck>;
}