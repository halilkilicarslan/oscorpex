import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { eventBus } from "../event-bus.js";

const log = createLogger("mcp-audit");

export interface McpAuditEvent {
	id: string;
	tenantId: string;
	projectId: string;
	actorId: string;
	toolName: string;
	source: "user" | "llm" | "provider" | "system";
	decision: "allow" | "deny";
	status: "success" | "failed" | "denied";
	durationMs: number;
	errorCode?: string;
	createdAt: string;
}

export function recordMcpAudit(event: Omit<McpAuditEvent, "id" | "createdAt">): McpAuditEvent {
	const audit: McpAuditEvent = {
		...event,
		id: randomUUID(),
		createdAt: new Date().toISOString(),
	};

	// Structured log
	log.info(
		{
			auditId: audit.id,
			tool: audit.toolName,
			source: audit.source,
			decision: audit.decision,
			status: audit.status,
			durationMs: audit.durationMs,
		},
		"[mcp-audit] invocation recorded",
	);

	// Emit event for downstream consumers
	eventBus.emitTransient({
		projectId: audit.projectId,
		type: "agent:output",
		agentId: audit.actorId,
		payload: {
			output: `[mcp-audit] ${audit.toolName}: ${audit.status} (${audit.durationMs}ms)`,
			audit,
		},
	});

	return audit;
}
