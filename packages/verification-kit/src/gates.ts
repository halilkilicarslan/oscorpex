// @oscorpex/verification-kit — Gate result types for execution gates
// These types define the result of verification, test, and goal evaluation gates.

export interface GateCheckResult {
	/** Whether the gate passed overall */
	passed: boolean;
	/** Human-readable summary of what was checked and what failed */
	summary: string;
	/** Policy for this gate: "required" blocks completion, "optional" allows proceed */
	policy: "required" | "optional" | "skip";
	/** Test results if applicable */
	testsPassed?: number;
	testsFailed?: number;
	testsTotal?: number;
}

export interface GoalCheckResult {
	goalId: string;
	goalEnforcement: "enforce" | "advisory";
	criteriaResults: Array<{
		criterion: string;
		met: boolean;
		evidence?: string;
		confidence?: number;
	}>;
}