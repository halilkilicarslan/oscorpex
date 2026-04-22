// @oscorpex/core — Policy error types

import { OscorpexError } from "./domain-errors.js";
import type { RiskLevel, TaskStatus } from "../domain/task.js";

export class PolicyViolationError extends OscorpexError {
	constructor(
		public readonly taskId: string,
		public readonly violations: string[],
		public readonly blocked: boolean,
	) {
		super("POLICY_VIOLATION", `Policy violation for task ${taskId}: ${violations.join(", ")}`);
		this.name = "PolicyViolationError";
	}
}

export class SandboxViolationError extends OscorpexError {
	constructor(
		public readonly violation: import("../domain/policy.js").SandboxViolation,
		public readonly sessionId?: string,
	) {
		super("SANDBOX_VIOLATION", `Sandbox violation: ${violation.type} — ${violation.detail}`);
		this.name = "SandboxViolationError";
	}
}

export class ApprovalRequiredError extends OscorpexError {
	constructor(
		public readonly taskId: string,
		public readonly riskLevel: RiskLevel,
		public readonly reason: string,
	) {
		super("APPROVAL_REQUIRED", `Task ${taskId} requires approval (risk: ${riskLevel}): ${reason}`);
		this.name = "ApprovalRequiredError";
	}
}