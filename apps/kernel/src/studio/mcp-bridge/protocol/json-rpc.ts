import { createLogger } from "../../logger.js";
import { invokeMcpTool, invokeMcpWriteTool, listMcpTools } from "../mcp-bridge.js";
import { isWriteToolRegistered } from "../write-tool-registry.js";
import type { McpToolInvocation } from "../types.js";

const log = createLogger("mcp-json-rpc");

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export interface McpRequestContext {
	tenantId: string;
	projectId: string;
	actorId: string;
	source: "user" | "llm" | "provider" | "system";
}

/**
 * Handle a JSON-RPC MCP request.
 * Supports: tools/list, tools/call
 */
export async function handleJsonRpcRequest(
	raw: unknown,
	context: McpRequestContext,
): Promise<JsonRpcResponse> {
	// Validate JSON-RPC structure
	if (!raw || typeof raw !== "object") {
		return { jsonrpc: "2.0", id: 0, error: { code: -32600, message: "Invalid request" } };
	}
	const req = raw as Partial<JsonRpcRequest>;
	if (req.jsonrpc !== "2.0" || !req.method || !req.id) {
		return { jsonrpc: "2.0", id: req.id ?? 0, error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" } };
	}

	// Validate context
	if (!context.tenantId || !context.projectId) {
		return { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: "tenantId and projectId are required" } };
	}

	try {
		switch (req.method) {
			case "tools/list":
				return { jsonrpc: "2.0", id: req.id, result: { tools: listMcpTools() } };

			case "tools/call": {
				const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
				if (!params?.name) {
					return { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: "params.name is required" } };
				}
				const invocation: McpToolInvocation = {
					tenantId: context.tenantId,
					projectId: context.projectId,
					actorId: context.actorId,
					toolName: params.name,
					args: params.arguments ?? {},
					source: context.source,
				};

				// Route write tools through the approval+checkpoint gate (P6-B/C)
				const isWrite = isWriteToolRegistered(params.name);
				const result = isWrite
					? await invokeMcpWriteTool(invocation)
					: await invokeMcpTool(invocation);

				if (result.ok) {
					return {
						jsonrpc: "2.0",
						id: req.id,
						result: { content: [{ type: "text", text: JSON.stringify(result.data) }] },
					};
				}

				// REQUIRES_APPROVAL is a structured response, not a generic error
				if (result.error?.code === "REQUIRES_APPROVAL") {
					return {
						jsonrpc: "2.0",
						id: req.id,
						result: {
							content: [{ type: "text", text: JSON.stringify(result.data) }],
							requiresApproval: true,
						},
					};
				}

				return {
					jsonrpc: "2.0",
					id: req.id,
					error: {
						code: -32000,
						message: result.error?.message ?? "Tool execution failed",
						data: { code: result.error?.code, ...(result.data ? { details: result.data } : {}) },
					},
				};
			}

			default:
				return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
		}
	} catch (err) {
		log.error({ err, method: req.method }, "[mcp-json-rpc] Unhandled error");
		return { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: "Internal error" } };
	}
}
