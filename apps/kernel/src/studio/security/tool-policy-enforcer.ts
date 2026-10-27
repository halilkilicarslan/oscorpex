// P2-1: Centralized pre-execution tool-policy enforcement wrapper
import {
	type ToolInvocationRequest,
	type ToolPolicyContext,
	type ToolPolicyDecision,
	evaluateToolPolicy,
} from "@oscorpex/policy-kit";
import { createLogger } from "../logger.js";
import { isTerminalExecEnabled } from "../routes/terminal-routes.js";

const log = createLogger("tool-policy-enforcer");

export class ToolPolicyDeniedError extends Error {
	public readonly code: string;
	public readonly decision: ToolPolicyDecision;
	constructor(decision: Extract<ToolPolicyDecision, { decision: "deny" }>) {
		super(`Tool policy denied: ${decision.reason} [${decision.code}]`);
		this.name = "ToolPolicyDeniedError";
		this.code = decision.code;
		this.decision = decision;
	}
}

export class ToolPolicyApprovalRequiredError extends Error {
	public readonly approvalType: string;
	public readonly decision: ToolPolicyDecision;
	constructor(decision: Extract<ToolPolicyDecision, { decision: "require_approval" }>) {
		super(`Tool policy requires approval: ${decision.reason}`);
		this.name = "ToolPolicyApprovalRequiredError";
		this.approvalType = decision.approvalType;
		this.decision = decision;
	}
}

function buildContext(): ToolPolicyContext {
	const env = process.env.NODE_ENV ?? "development";
	return {
		environment: env === "production" ? "production" : env === "test" ? "test" : "development",
		terminalExecEnabled: isTerminalExecEnabled(),
		approvalEnabled: process.env.OSCORPEX_APPROVAL_ENABLED === "true",
	};
}

export interface EnforceToolPolicyOptions {
	request: ToolInvocationRequest;
	context?: ToolPolicyContext;
	audit?: boolean;
}

/**
 * Evaluate tool policy and enforce the decision.
 * Throws ToolPolicyDeniedError for denied actions.
 * Throws ToolPolicyApprovalRequiredError for actions needing approval.
 * Returns the decision for allowed actions.
 */
export function enforceToolPolicy(options: EnforceToolPolicyOptions): ToolPolicyDecision {
	const ctx = options.context ?? buildContext();
	const decision = evaluateToolPolicy(options.request, ctx);

	if (options.audit !== false) {
		log.info(
			{
				decision: decision.decision,
				tool: options.request.tool,
				action: options.request.action,
				source: options.request.source,
				riskLevel: options.request.riskLevel,
				reason:
					decision.decision !== "allow"
						? (
								decision as
									| Extract<ToolPolicyDecision, { decision: "deny" }>
									| Extract<ToolPolicyDecision, { decision: "require_approval" }>
							).reason
						: undefined,
			},
			"[tool-policy] enforcement decision",
		);
	}

	if (decision.decision === "deny") {
		throw new ToolPolicyDeniedError(decision as Extract<ToolPolicyDecision, { decision: "deny" }>);
	}

	if (decision.decision === "require_approval") {
		throw new ToolPolicyApprovalRequiredError(
			decision as Extract<ToolPolicyDecision, { decision: "require_approval" }>,
		);
	}

	return decision;
}
