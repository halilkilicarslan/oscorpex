// @oscorpex/policy-kit — Governance, approval, and sandbox enforcement
// Pure policy evaluation logic extracted from kernel's policy-engine.ts and sandbox-manager.ts.
// No DB or event-bus dependencies — those remain in the kernel layer.

// Re-export canonical types from @oscorpex/core
export type {
	PolicyAction,
	RiskLevel,
	ApprovalStatus,
	PolicyDecision,
	PolicyRule,
	SandboxEnforcementMode,
	SandboxViolation,
	SandboxPolicy,
	SandboxSession,
	PolicyEvaluationInput,
} from "@oscorpex/core";

// Policy evaluation (pure functions)
export {
	evaluateBuiltinRule,
	evaluateCustomCondition,
	parsePolicies,
	evaluatePolicyRules,
	BUILTIN_RULE_MAX_COST,
	BUILTIN_RULE_LARGE_APPROVAL,
	BUILTIN_RULE_MULTI_REVIEWER,
} from "./policy-evaluation.js";
export type { PolicyEvaluationResult } from "./policy-evaluation.js";

// Sandbox enforcement (pure functions)
export {
	checkToolAllowed,
	checkPathAllowed,
	checkOutputSize,
	buildDefaultSandboxPolicy,
	isSecurityTask,
	shouldEnforce,
} from "./sandbox-enforcement.js";
export type { CheckResult, SandboxEnforcementPolicy } from "./sandbox-enforcement.js";