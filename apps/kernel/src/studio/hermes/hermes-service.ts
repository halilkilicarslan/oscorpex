import { createLogger } from "../logger.js";
import { recordMcpAudit } from "../mcp-bridge/mcp-audit.js";
import { invokeMcpTool } from "../mcp-bridge/mcp-bridge.js";
import { ToolPolicyDeniedError, enforceToolPolicy } from "../security/tool-policy-enforcer.js";
import { getHermesAllowedTools, isHermesEnabled } from "./hermes-config.js";
import { consumeToolCall, getSession } from "./hermes-session.js";
import type { HermesInvocation, HermesResult } from "./hermes-types.js";
import { checkPromptInjection } from "./prompt-injection-guard.js";

const log = createLogger("hermes");

// P12-I: Outbound secret redaction — mirrors gateway-service.ts patterns
const REDACT_PATTERNS: RegExp[] = [
	/(?:password|secret|token|key|credential)\s*[=:]\s*["']?[^\s"']+/gi,
	/sk-[a-zA-Z0-9]{20,}/g,
	/ghp_[a-zA-Z0-9]{36,}/g,
	/AKIA[A-Z0-9]{16}/g,
	/-----BEGIN\s+\w+\s+PRIVATE\s+KEY-----/g,
	/github_pat_[a-zA-Z0-9_]{20,}/g,
	/glpat-[a-zA-Z0-9_-]{20,}/g,
	/sk_live_[a-zA-Z0-9]{24,}/g,
	/sk_test_[a-zA-Z0-9]{24,}/g,
	/AIza[A-Za-z0-9_-]{35}/g,
	/SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,
];

function redactForAudit(data: unknown): unknown {
	if (typeof data === "string") {
		let redacted = data;
		for (const pattern of REDACT_PATTERNS) {
			pattern.lastIndex = 0;
			redacted = redacted.replace(pattern, "[REDACTED]");
		}
		return redacted;
	}
	if (typeof data === "object" && data !== null) {
		if (Array.isArray(data)) return data.map(redactForAudit);
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
			result[k] = redactForAudit(v);
		}
		return result;
	}
	return data;
}

export async function handleHermesInvocation(invocation: HermesInvocation): Promise<HermesResult> {
	// Feature flag — disabled by default for safety
	if (!isHermesEnabled()) {
		return { ok: false, error: { code: "HERMES_DISABLED", message: "Hermes is disabled" } };
	}

	// Session existence check
	const session = getSession(invocation.sessionId);
	if (!session) {
		return { ok: false, error: { code: "INVALID_SESSION", message: "Session not found" } };
	}

	// Tenant isolation — session must belong to the requesting tenant
	if (session.tenantId !== invocation.tenantId) {
		log.warn(
			{ sessionId: invocation.sessionId, sessionTenant: session.tenantId, requestTenant: invocation.tenantId },
			"[hermes] Tenant mismatch on session",
		);
		return { ok: false, error: { code: "TENANT_MISMATCH", message: "Session tenant mismatch" } };
	}

	// Read-only allowlist enforcement
	const allowed = getHermesAllowedTools();
	if (!allowed.has(invocation.toolName)) {
		log.warn({ tool: invocation.toolName }, "[hermes] Tool not in read-only allowlist");
		recordMcpAudit({
			tenantId: invocation.tenantId,
			projectId: invocation.projectId,
			actorId: invocation.actorId,
			toolName: invocation.toolName,
			source: "user",
			decision: "deny",
			status: "denied",
			durationMs: 0,
			errorCode: "TOOL_NOT_ALLOWED",
		});
		return {
			ok: false,
			error: { code: "TOOL_NOT_ALLOWED", message: `Tool '${invocation.toolName}' not available via Hermes` },
		};
	}

	// P12-D: Prompt injection detection on serialised args
	const argsStr = JSON.stringify(invocation.args);
	const injectionCheck = checkPromptInjection(argsStr);
	if (!injectionCheck.safe) {
		log.warn(
			{ tool: invocation.toolName, patterns: injectionCheck.detectedPatterns.length },
			"[hermes] Prompt injection blocked",
		);
		recordMcpAudit({
			tenantId: invocation.tenantId,
			projectId: invocation.projectId,
			actorId: invocation.actorId,
			toolName: invocation.toolName,
			source: "user",
			decision: "deny",
			status: "denied",
			durationMs: 0,
			errorCode: "PROMPT_INJECTION",
		});
		return { ok: false, error: { code: "PROMPT_INJECTION", message: "Input contains prompt injection patterns" } };
	}

	// P12-E: Session budget enforcement
	const budget = consumeToolCall(invocation.sessionId);
	if (!budget.allowed) {
		return {
			ok: false,
			error: { code: "SESSION_EXHAUSTED", message: "Session tool call budget exhausted" },
			remainingCalls: 0,
		};
	}

	// Policy enforcement via tool-policy-enforcer
	try {
		enforceToolPolicy({
			request: {
				actorId: invocation.actorId,
				tenantId: invocation.tenantId,
				projectId: invocation.projectId,
				source: "user",
				tool: invocation.toolName,
				action: "invoke",
				riskLevel: "read",
			},
		});
	} catch (err) {
		if (err instanceof ToolPolicyDeniedError) {
			return { ok: false, error: { code: err.code, message: err.message } };
		}
		throw err;
	}

	// Invoke the underlying MCP tool
	const start = Date.now();
	const result = await invokeMcpTool({
		tenantId: invocation.tenantId,
		projectId: invocation.projectId,
		actorId: invocation.actorId,
		toolName: invocation.toolName,
		args: invocation.args,
		source: "user",
	});
	const duration = Date.now() - start;

	// Audit the invocation result
	const audit = recordMcpAudit({
		tenantId: invocation.tenantId,
		projectId: invocation.projectId,
		actorId: invocation.actorId,
		toolName: invocation.toolName,
		source: "user",
		decision: "allow",
		status: result.ok ? "success" : "failed",
		durationMs: duration,
		errorCode: result.error?.code,
	});

	// P12-I: Redact secrets from outbound Hermes responses
	const redactedData = result.ok ? redactForAudit(result.data) : result.data;

	return {
		ok: result.ok,
		data: redactedData,
		error: result.error,
		sessionId: invocation.sessionId,
		remainingCalls: budget.remaining,
		auditId: audit.id,
	};
}
