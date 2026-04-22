// @oscorpex/core — PolicyEngine contract
// Interface for evaluating policy decisions against runs and tasks.

import type { PolicyDecision, PolicyEvaluationInput } from "../domain/policy.js";

export interface PolicyEngine {
	evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision>;
}