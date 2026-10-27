// @oscorpex/policy-kit — Pre-execution tool-policy enforcement
// P1-7: All dangerous actions must pass through evaluateToolPolicy() BEFORE execution.
// Pure functions — no DB or event-bus dependencies.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolRiskLevel = "read" | "write" | "execute" | "network" | "container" | "credential";
export type ToolSource = "user" | "llm" | "provider" | "system";

export interface ToolInvocationRequest {
	actorId: string;
	tenantId: string;
	projectId?: string;
	source: ToolSource;
	tool: string;
	action: string;
	args?: unknown;
	riskLevel: ToolRiskLevel;
}

export interface ToolPolicyContext {
	environment: "development" | "test" | "staging" | "production";
	terminalExecEnabled: boolean;
	approvalEnabled: boolean;
}

export type ToolPolicyDecision =
	| { decision: "allow"; reason: string }
	| { decision: "deny"; reason: string; code: string }
	| { decision: "require_approval"; reason: string; approvalType: string };

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Shell metacharacters that indicate injection attempts */
const SHELL_METACHAR = /[;&|`$(){}[\]<>!\\]/;

/** Private IP / loopback patterns for SSRF checks */
const PRIVATE_IP =
	/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|localhost|::1)/i;

/** Actions treated as destructive (tool/action format) */
const DESTRUCTIVE_ACTIONS = new Set([
	"git/force_push",
	"git/delete_branch",
	"git/reset_hard",
	"file/delete_recursive",
	"db/drop_table",
	"db/truncate",
	"container/remove_all",
	"project/delete",
]);

// ---------------------------------------------------------------------------
// Core evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a tool invocation should proceed.
 *
 * This is the central pre-execution policy gate. Rules are evaluated in
 * priority order — first matching rule wins.
 *
 * Rule summary:
 *  1. LLM source cannot execute shell commands directly
 *  2. LLM source cannot access credentials
 *  3. Non-system shell execution denied in production
 *  4. User terminal requires OSCORPEX_ENABLE_TERMINAL_EXEC flag
 *  5. Network calls to private IPs are blocked (SSRF)
 *  6. File write paths must remain within workspace scope
 *  7. Shell metacharacters in command args are blocked (injection)
 *  8. Container actions are restricted to system source
 *  9. Destructive actions require approval when approvalEnabled
 * 10. Default: allow
 */
export function evaluateToolPolicy(
	request: ToolInvocationRequest,
	context: ToolPolicyContext,
): ToolPolicyDecision {
	const { source, tool, action, riskLevel, args } = request;
	const { environment } = context;

	// Rule 1: LLM source cannot execute shell commands directly
	if (source === "llm" && riskLevel === "execute") {
		return {
			decision: "deny",
			reason: "LLM source cannot execute shell commands directly",
			code: "LLM_SHELL_DENIED",
		};
	}

	// Rule 2: LLM source cannot access credentials
	if (source === "llm" && riskLevel === "credential") {
		return {
			decision: "deny",
			reason: "LLM source cannot access credentials",
			code: "LLM_CREDENTIAL_DENIED",
		};
	}

	// Rule 3: Production shell execution denied unless source is system
	if (environment === "production" && riskLevel === "execute" && source !== "system") {
		return {
			decision: "deny",
			reason: "Shell execution denied in production for non-system sources",
			code: "PROD_SHELL_DENIED",
		};
	}

	// Rule 4: User terminal command requires explicit dev flag
	if (source === "user" && tool === "terminal" && !context.terminalExecEnabled) {
		return {
			decision: "deny",
			reason: "Terminal execution requires OSCORPEX_ENABLE_TERMINAL_EXEC=true",
			code: "TERMINAL_DISABLED",
		};
	}

	// Rule 5: Network calls — check for SSRF to private IPs
	if (riskLevel === "network" && isRecord(args)) {
		const url = args["url"];
		if (typeof url === "string") {
			try {
				const hostname = new URL(url).hostname;
				if (PRIVATE_IP.test(hostname)) {
					return {
						decision: "deny",
						reason: "Network call to private IP blocked (SSRF)",
						code: "SSRF_BLOCKED",
					};
				}
			} catch {
				// Malformed URL — deny to be safe
				return {
					decision: "deny",
					reason: "Malformed URL in network request",
					code: "INVALID_URL",
				};
			}
		}
	}

	// Rule 6: File write paths must not escape workspace (defense-in-depth)
	if (riskLevel === "write" && isRecord(args)) {
		const path = args["path"];
		if (typeof path === "string" && (path.includes("..") || path.startsWith("/"))) {
			return {
				decision: "deny",
				reason: "File path outside workspace scope",
				code: "PATH_OUTSIDE_WORKSPACE",
			};
		}
	}

	// Rule 7: Shell metacharacters in execute args indicate injection attempt
	if (riskLevel === "execute" && isRecord(args)) {
		const cmd = args["command"];
		if (typeof cmd === "string" && SHELL_METACHAR.test(cmd)) {
			return {
				decision: "deny",
				reason: "Shell metacharacters detected in command",
				code: "SHELL_INJECTION",
			};
		}
	}

	// Rule 8: Container actions restricted to system source
	if (riskLevel === "container" && source !== "system") {
		return {
			decision: "deny",
			reason: "Container actions require system source",
			code: "CONTAINER_NON_SYSTEM",
		};
	}

	// Rule 9: Destructive operations require approval (when enabled)
	if (context.approvalEnabled && DESTRUCTIVE_ACTIONS.has(`${tool}/${action}`)) {
		return {
			decision: "require_approval",
			reason: `Destructive action: ${tool}/${action}`,
			approvalType: "destructive_operation",
		};
	}

	// Rule 10: Default — allow
	return { decision: "allow", reason: `Policy allows ${source}/${tool}/${action}` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
