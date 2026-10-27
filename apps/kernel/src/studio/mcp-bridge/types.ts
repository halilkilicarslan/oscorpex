export interface McpToolDefinition {
	name: string;
	description: string;
	riskLevel: "read";
	parameters?: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface McpToolInvocation {
	tenantId: string;
	projectId: string;
	actorId: string;
	toolName: string;
	args: Record<string, unknown>;
	source: "user" | "llm" | "provider" | "system";
}

export interface McpToolResult {
	ok: boolean;
	data?: unknown;
	error?: {
		code: string;
		message: string;
	};
}

export type McpToolHandler = (invocation: McpToolInvocation) => Promise<McpToolResult>;
