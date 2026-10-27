import { createLogger } from "../logger.js";
import type { McpToolHandler } from "./types.js";

const log = createLogger("write-tool-registry");

export interface McpWriteToolDefinition {
	name: string;
	description: string;
	riskLevel: "write";
	requiresApproval: true;
	requiresCheckpoint: true;
	supportsRollbackDryRun: true;
	inputSchema?: unknown;
}

const WRITE_TOOLS = new Map<string, { definition: McpWriteToolDefinition; handler: McpToolHandler }>();

export function registerWriteTool(definition: McpWriteToolDefinition, handler: McpToolHandler): void {
	if (WRITE_TOOLS.has(definition.name)) {
		throw new Error(`MCP write tool already registered: ${definition.name}`);
	}
	log.info({ tool: definition.name }, "[write-tool-registry] Registered write tool");
	WRITE_TOOLS.set(definition.name, { definition, handler });
}

export function listWriteTools(): McpWriteToolDefinition[] {
	return Array.from(WRITE_TOOLS.values()).map((t) => t.definition);
}

export function getWriteToolHandler(name: string): McpToolHandler | undefined {
	return WRITE_TOOLS.get(name)?.handler;
}

export function isWriteToolRegistered(name: string): boolean {
	return WRITE_TOOLS.has(name);
}

/** P6-A: Write tools are disabled by default. Requires explicit flags. */
export function areWriteToolsEnabled(): boolean {
	if (process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS !== "true") return false;
	if (process.env.NODE_ENV === "production" && process.env.OSCORPEX_ALLOW_MCP_WRITE_IN_PROD !== "true") return false;
	return true;
}

/** Test helper — clears the registry between test runs. Do not use in production code. */
export function __clearWriteToolRegistry(): void {
	WRITE_TOOLS.clear();
}
