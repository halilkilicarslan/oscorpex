// @oscorpex/event-schema — Budget event payloads

export interface BudgetWarningPayload {
	percentageUsed?: number;
	currentSpendUsd?: number;
	budgetMaxUsd?: number;
}

export interface BudgetExceededPayload {
	currentSpendUsd?: number;
	budgetMaxUsd?: number;
	overspendUsd?: number;
}

export interface BudgetHaltedPayload {
	currentSpendUsd?: number;
	budgetMaxUsd?: number;
	overrunPercent?: number;
}