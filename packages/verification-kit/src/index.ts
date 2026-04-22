// @oscorpex/verification-kit — Artifact existence verification, execution gates, and goal evaluation
// Pure verification logic extracted from kernel's output-verifier.ts and execution-gates.ts.
// No DB or event-bus dependencies — those remain in the kernel layer.

// Re-export canonical types from @oscorpex/core
export type {
	VerificationStrictness,
	VerificationType,
	VerificationDetail,
	VerificationResult,
	VerificationReport,
	GateResult,
} from "@oscorpex/core";

export type { TaskOutput } from "@oscorpex/core";

// Verification logic (pure functions, no side effects)
export {
	verifyFilesExist,
	verifyFilesModified,
	verifyOutputNonEmpty,
	runVerificationChecks,
	shouldBlockCompletion,
} from "./verify.js";

// Gate result types
export type { GateCheckResult, GoalCheckResult } from "./gates.js";