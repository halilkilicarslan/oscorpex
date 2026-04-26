// ---------------------------------------------------------------------------
// Oscorpex — Memory Bridge
// Previously wrote PM chat messages and agent execution outputs to VoltAgent
// memory tables. VoltAgent integration has been removed; this module is now
// a no-op placeholder to preserve imports in task-engine and project-routes.
// ---------------------------------------------------------------------------

/**
 * No-op: previously ensured a memory conversation existed for a project.
 */
export async function ensureConversation(_projectId: string, _projectName: string): Promise<string> {
	return "";
}

/**
 * No-op: previously recorded a chat message in the memory tables.
 */
export async function recordChatToMemory(
	_projectId: string,
	_projectName: string,
	_role: "user" | "assistant",
	_content: string,
): Promise<void> {
	// VoltAgent integration removed — memory bridge disabled
}

/**
 * No-op: previously recorded an agent execution step in the memory tables.
 */
export async function recordAgentStep(
	_projectId: string,
	_projectName: string,
	_agentId: string,
	_agentName: string,
	_taskTitle: string,
	_output: string | null,
): Promise<void> {
	// VoltAgent integration removed — memory bridge disabled
}
