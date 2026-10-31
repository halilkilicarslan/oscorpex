import { createLogger } from "../logger.js";
import { enforceToolPolicy } from "../security/tool-policy-enforcer.js";
import { recordMcpAudit } from "./mcp-audit.js";
import { checkForSecrets } from "./secret-guard.js";
import type { McpToolInvocation, McpToolResult } from "./types.js";
import { areWriteToolsEnabled, getWriteToolHandler } from "./write-tool-registry.js";

const log = createLogger("approval-apply");

export interface ApprovalApplyRequest {
	approvalId: string;
	checkpointId: string;
	tenantId: string;
	projectId: string;
	actorId: string;
	toolName: string;
	args: Record<string, unknown>;
	source: "user" | "system";
}

export interface ApprovalApplyResult {
	status: "applied" | "failed" | "denied";
	toolResult?: McpToolResult;
	error?: string;
}

/**
 * Execute a write tool after approval has been verified.
 * Re-validates policy, checkpoint, and secret guard before execution (defense in depth).
 */
export async function applyApprovedWrite(request: ApprovalApplyRequest): Promise<ApprovalApplyResult> {
	if (!areWriteToolsEnabled()) {
		log.warn({ tool: request.toolName }, "[approval-apply] Write tools disabled — denying apply");
		return { status: "denied", error: "Write tools disabled" };
	}

	// Re-verify policy (defense in depth)
	try {
		enforceToolPolicy({
			request: {
				actorId: request.actorId,
				tenantId: request.tenantId,
				projectId: request.projectId,
				source: request.source,
				tool: request.toolName,
				action: "write_apply",
				riskLevel: "write",
			},
		});
	} catch (err) {
		log.warn({ err, tool: request.toolName }, "[approval-apply] Policy re-check denied apply");
		return { status: "denied", error: err instanceof Error ? err.message : String(err) };
	}

	// Re-verify secret guard
	const secretCheck = checkForSecrets(JSON.stringify(request.args));
	if (!secretCheck.safe) {
		log.warn(
			{ tool: request.toolName, patterns: secretCheck.detectedPatterns.length },
			"[approval-apply] Secret detected in approved write args — blocking",
		);
		return { status: "denied", error: `Secret detected: ${secretCheck.detectedPatterns.join(", ")}` };
	}

	// Get handler
	const handler = getWriteToolHandler(request.toolName);
	if (!handler) {
		log.warn({ tool: request.toolName }, "[approval-apply] Write tool handler not found");
		return { status: "failed", error: `Tool not found: ${request.toolName}` };
	}

	// Execute
	const start = Date.now();
	try {
		const invocation: McpToolInvocation = {
			tenantId: request.tenantId,
			projectId: request.projectId,
			actorId: request.actorId,
			toolName: request.toolName,
			args: request.args,
			source: request.source,
		};
		const result = await handler(invocation);
		const duration = Date.now() - start;

		recordMcpAudit({
			tenantId: request.tenantId,
			projectId: request.projectId,
			actorId: request.actorId,
			toolName: request.toolName,
			source: request.source,
			decision: "allow",
			status: result.ok ? "success" : "failed",
			durationMs: duration,
		});

		log.info(
			{ tool: request.toolName, approvalId: request.approvalId, ok: result.ok, duration },
			"[approval-apply] Write tool executed after approval",
		);
		return { status: result.ok ? "applied" : "failed", toolResult: result };
	} catch (err) {
		const duration = Date.now() - start;
		log.error(
			{ err, tool: request.toolName, approvalId: request.approvalId },
			"[approval-apply] Write tool execution failed",
		);
		recordMcpAudit({
			tenantId: request.tenantId,
			projectId: request.projectId,
			actorId: request.actorId,
			toolName: request.toolName,
			source: request.source,
			decision: "allow",
			status: "failed",
			durationMs: duration,
			errorCode: "EXECUTION_ERROR",
		});
		return { status: "failed", error: err instanceof Error ? err.message : String(err) };
	}
}
