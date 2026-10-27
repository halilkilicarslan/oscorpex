import { createLogger } from "../logger.js";
import { ToolPolicyDeniedError, enforceToolPolicy } from "../security/tool-policy-enforcer.js";
import { createCheckpoint } from "../checkpoint/index.js";
import { recordMcpAudit } from "./mcp-audit.js";
import { gitDiff, gitStatus, repoListFiles, repoReadFile, repoSearch } from "./read-only-tools.js";
import { getToolHandler, listTools, registerTool } from "./tool-registry.js";
import {
	areWriteToolsEnabled,
	isWriteToolRegistered,
	listWriteTools,
} from "./write-tool-registry.js";
import { checkForSecrets } from "./secret-guard.js";
import type { McpToolDefinition, McpToolInvocation, McpToolResult } from "./types.js";
import type { McpWriteToolDefinition } from "./write-tool-registry.js";

const log = createLogger("mcp-bridge");

// Register read-only tools on first import
function initMcpBridge(): void {
	registerTool(
		{ name: "repo.listFiles", description: "List files in workspace directory", riskLevel: "read" },
		repoListFiles,
	);
	registerTool(
		{
			name: "repo.readFile",
			description: "Read a file from workspace",
			riskLevel: "read",
			parameters: { path: { type: "string", description: "Relative file path", required: true } },
		},
		repoReadFile,
	);
	registerTool(
		{
			name: "repo.search",
			description: "Search file contents in workspace",
			riskLevel: "read",
			parameters: { query: { type: "string", description: "Search query", required: true } },
		},
		repoSearch,
	);
	registerTool({ name: "git.status", description: "Get git status", riskLevel: "read" }, gitStatus);
	registerTool({ name: "git.diff", description: "Get git diff", riskLevel: "read" }, gitDiff);
}

initMcpBridge();

export async function invokeMcpTool(invocation: McpToolInvocation): Promise<McpToolResult> {
	// 1. Policy enforcement — deny-by-default
	try {
		enforceToolPolicy({
			request: {
				actorId: invocation.actorId,
				tenantId: invocation.tenantId,
				projectId: invocation.projectId,
				source: invocation.source,
				tool: invocation.toolName,
				action: "invoke",
				riskLevel: "read",
			},
		});
	} catch (err) {
		if (err instanceof ToolPolicyDeniedError) {
			log.warn({ tool: invocation.toolName, code: err.code }, "[mcp-bridge] Tool invocation denied by policy");
			recordMcpAudit({
				tenantId: invocation.tenantId,
				projectId: invocation.projectId,
				actorId: invocation.actorId,
				toolName: invocation.toolName,
				source: invocation.source,
				decision: "deny",
				status: "denied",
				durationMs: 0,
				errorCode: err.code,
			});
			return { ok: false, error: { code: err.code, message: err.message } };
		}
		throw err;
	}

	// 2. Resolve handler — unknown tool is an explicit denial
	const handler = getToolHandler(invocation.toolName);
	if (!handler) {
		log.warn({ tool: invocation.toolName }, "[mcp-bridge] Unknown tool");
		return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Tool not found: ${invocation.toolName}` } };
	}

	// 3. Execute and emit structured audit log
	const start = Date.now();
	const result = await handler(invocation);
	const duration = Date.now() - start;

	recordMcpAudit({
		tenantId: invocation.tenantId,
		projectId: invocation.projectId,
		actorId: invocation.actorId,
		toolName: invocation.toolName,
		source: invocation.source,
		decision: "allow",
		status: result.ok ? "success" : "failed",
		durationMs: duration,
		errorCode: result.error?.code,
	});

	return result;
}

/** P6-B+C: Write tool invocation with approval gate and pre-write checkpoint */
export async function invokeMcpWriteTool(invocation: McpToolInvocation): Promise<McpToolResult> {
	// P6-A: Check if write tools are enabled
	if (!areWriteToolsEnabled()) {
		return {
			ok: false,
			error: {
				code: "WRITE_TOOLS_DISABLED",
				message: "Write MCP tools are disabled. Set OSCORPEX_ENABLE_MCP_WRITE_TOOLS=true",
			},
		};
	}

	// Policy enforcement
	try {
		enforceToolPolicy({
			request: {
				actorId: invocation.actorId,
				tenantId: invocation.tenantId,
				projectId: invocation.projectId,
				source: invocation.source,
				tool: invocation.toolName,
				action: "write",
				riskLevel: "write",
			},
		});
	} catch (err) {
		if (err instanceof ToolPolicyDeniedError) {
			log.warn({ tool: invocation.toolName, code: err.code }, "[mcp-bridge] Write tool denied by policy");
			recordMcpAudit({
				tenantId: invocation.tenantId,
				projectId: invocation.projectId,
				actorId: invocation.actorId,
				toolName: invocation.toolName,
				source: invocation.source,
				decision: "deny",
				status: "denied",
				durationMs: 0,
				errorCode: err.code,
			});
			return { ok: false, error: { code: err.code, message: err.message } };
		}
		throw err;
	}

	// P6-J: Secret guard — reject if write payload contains secret-like patterns
	const content =
		typeof invocation.args === "object" && invocation.args !== null
			? JSON.stringify(invocation.args)
			: String(invocation.args ?? "");
	const secretCheck = checkForSecrets(content);
	if (!secretCheck.safe) {
		log.warn(
			{ tool: invocation.toolName, patterns: secretCheck.detectedPatterns.length },
			"[mcp-bridge] Write blocked — secret detected in payload",
		);
		recordMcpAudit({
			tenantId: invocation.tenantId,
			projectId: invocation.projectId,
			actorId: invocation.actorId,
			toolName: invocation.toolName,
			source: invocation.source,
			decision: "deny",
			status: "denied",
			durationMs: 0,
			errorCode: "SECRET_DETECTED",
		});
		return {
			ok: false,
			error: {
				code: "SECRET_DETECTED",
				message: `Write content contains secret-like patterns: ${secretCheck.detectedPatterns.join(", ")}`,
			},
		};
	}

	// P6-C: Checkpoint before write — block if checkpoint cannot be created
	let checkpointId: string | undefined;
	try {
		const cp = await createCheckpoint({
			tenantId: invocation.tenantId,
			projectId: invocation.projectId,
			type: "filesystem",
			reason: `mcp_write_pre_${invocation.toolName}`,
			createdBy: "system",
			riskLevel: "medium",
			metadata: { toolName: invocation.toolName },
		});
		checkpointId = cp.id;
		log.info({ tool: invocation.toolName, checkpointId }, "[mcp-bridge] Pre-write checkpoint created");
	} catch (err) {
		log.warn({ err, tool: invocation.toolName }, "[mcp-bridge] Checkpoint creation failed — blocking write");
		return {
			ok: false,
			error: {
				code: "CHECKPOINT_FAILED",
				message: "Cannot create checkpoint before write operation",
			},
		};
	}

	// P6-B: Always require explicit approval for write tools — return approval-required response
	recordMcpAudit({
		tenantId: invocation.tenantId,
		projectId: invocation.projectId,
		actorId: invocation.actorId,
		toolName: invocation.toolName,
		source: invocation.source,
		decision: "allow",
		status: "success",
		durationMs: 0,
	});

	log.info({ tool: invocation.toolName, checkpointId }, "[mcp-bridge] Write tool requires approval");

	return {
		ok: false,
		error: {
			code: "REQUIRES_APPROVAL",
			message: `Write operation '${invocation.toolName}' requires approval before execution`,
		},
		data: { checkpointId, requiresApproval: true },
	} as McpToolResult;
}

export function listMcpTools(): (McpToolDefinition | McpWriteToolDefinition)[] {
	const readTools = listTools();
	if (areWriteToolsEnabled()) {
		return [...readTools, ...listWriteTools()];
	}
	return readTools;
}

export type { McpToolDefinition, McpToolInvocation, McpToolResult } from "./types.js";
export type { McpWriteToolDefinition } from "./write-tool-registry.js";
