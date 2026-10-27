import type { McpToolDefinition, McpToolHandler } from "./types.js";

const REGISTERED_TOOLS = new Map<string, { definition: McpToolDefinition; handler: McpToolHandler }>();

export function registerTool(definition: McpToolDefinition, handler: McpToolHandler): void {
	if (REGISTERED_TOOLS.has(definition.name)) {
		throw new Error(`MCP tool already registered: ${definition.name}`);
	}
	REGISTERED_TOOLS.set(definition.name, { definition, handler });
}

export function listTools(): McpToolDefinition[] {
	return Array.from(REGISTERED_TOOLS.values()).map((t) => t.definition);
}

export function getToolHandler(name: string): McpToolHandler | undefined {
	return REGISTERED_TOOLS.get(name)?.handler;
}

export function isToolRegistered(name: string): boolean {
	return REGISTERED_TOOLS.has(name);
}
