import { createLogger } from "../logger.js";
import { recordMcpAudit } from "../mcp-bridge/mcp-audit.js";
import { invokeMcpTool } from "../mcp-bridge/mcp-bridge.js";
import { ToolPolicyDeniedError, enforceToolPolicy } from "../security/tool-policy-enforcer.js";
import { getGatewayConfig, isGatewayEnabled } from "./gateway-config.js";
import type { GatewayRequest, GatewayResponse } from "./gateway-types.js";

const log = createLogger("gateway");

// P11-G: Response redaction patterns — prevent secrets from leaking to external callers
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

function redactResponse(data: unknown): unknown {
	if (typeof data === "string") {
		let redacted = data;
		for (const pattern of REDACT_PATTERNS) {
			// Reset lastIndex for global regex to handle repeated calls correctly
			pattern.lastIndex = 0;
			redacted = redacted.replace(pattern, "[REDACTED]");
		}
		return redacted;
	}
	if (typeof data === "object" && data !== null) {
		if (Array.isArray(data)) return data.map(redactResponse);
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
			result[k] = redactResponse(v);
		}
		return result;
	}
	return data;
}

export async function handleGatewayRequest(request: GatewayRequest): Promise<GatewayResponse> {
	// P11-A: Gateway enabled check — disabled by default for safety
	if (!isGatewayEnabled()) {
		return {
			ok: false,
			error: { code: "GATEWAY_DISABLED", message: "Gateway is disabled. Set OSCORPEX_ENABLE_GATEWAY=true" },
		};
	}

	const config = getGatewayConfig();

	// P11-C: Tenant/project scope — both are mandatory for isolation
	if (!request.tenantId || !request.projectId) {
		return { ok: false, error: { code: "MISSING_SCOPE", message: "tenantId and projectId are required" } };
	}

	// P12-L: Validate args size — prevent oversized payloads
	const argsSize = JSON.stringify(request.args).length;
	if (argsSize > 50_000) {
		return { ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request args exceed 50KB limit" } };
	}

	// P11-A: Read-only enforcement — only allow-listed tools may be invoked via gateway
	if (!config.allowedTools.has(request.toolName)) {
		log.warn({ tool: request.toolName, actorId: request.actorId }, "[gateway] Tool not in read-only allowlist");
		recordMcpAudit({
			tenantId: request.tenantId,
			projectId: request.projectId,
			actorId: request.actorId,
			toolName: request.toolName,
			source: "user",
			decision: "deny",
			status: "denied",
			durationMs: 0,
			errorCode: "TOOL_NOT_ALLOWED",
		});
		return {
			ok: false,
			error: { code: "TOOL_NOT_ALLOWED", message: `Tool '${request.toolName}' is not available via gateway` },
		};
	}

	// P11-D: Policy enforcement — evaluate tool-policy before invocation
	try {
		enforceToolPolicy({
			request: {
				actorId: request.actorId,
				tenantId: request.tenantId,
				projectId: request.projectId,
				source: "user",
				tool: request.toolName,
				action: "invoke",
				riskLevel: "read",
			},
		});
	} catch (err) {
		if (err instanceof ToolPolicyDeniedError) {
			recordMcpAudit({
				tenantId: request.tenantId,
				projectId: request.projectId,
				actorId: request.actorId,
				toolName: request.toolName,
				source: "user",
				decision: "deny",
				status: "denied",
				durationMs: 0,
				errorCode: err.code,
			});
			return { ok: false, error: { code: err.code, message: err.message } };
		}
		throw err;
	}

	// Invoke the MCP tool within tenant/project scope
	const start = Date.now();
	const result = await invokeMcpTool({
		tenantId: request.tenantId,
		projectId: request.projectId,
		actorId: request.actorId,
		toolName: request.toolName,
		args: request.args,
		source: "user",
	});
	const duration = Date.now() - start;

	// P11-G: Redact response before returning to external caller
	const redactedData = result.ok ? redactResponse(result.data) : result.data;

	// P11-F: Audit every invocation — both success and failure paths
	const audit = recordMcpAudit({
		tenantId: request.tenantId,
		projectId: request.projectId,
		actorId: request.actorId,
		toolName: request.toolName,
		source: "user",
		decision: "allow",
		status: result.ok ? "success" : "failed",
		durationMs: duration,
		errorCode: result.error?.code,
	});

	return {
		ok: result.ok,
		data: redactedData,
		error: result.error,
		auditId: audit.id,
	};
}
