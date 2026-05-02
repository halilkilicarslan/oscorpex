// ---------------------------------------------------------------------------
// Oscorpex — Dependency Repository: Agent Dependencies + Capabilities
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, getPool, query } from "../pg.js";
import type {
	AgentCapability,
	AgentDependency,
	AgentDependencyMetadata,
	CapabilityPermission,
	CapabilityScopeType,
	DependencyType,
} from "../types.js";
import { rowToCapability, rowToDependency } from "./helpers.js";
const log = createLogger("dependency-repo");

// ---------------------------------------------------------------------------
// Agent Dependencies
// ---------------------------------------------------------------------------

export async function createAgentDependency(
	projectId: string,
	fromAgentId: string,
	toAgentId: string,
	type: DependencyType = "workflow",
	metadata?: AgentDependencyMetadata,
): Promise<AgentDependency> {
	const id = randomUUID();
	const createdAt = new Date().toISOString();
	await execute(
		"INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		[id, projectId, fromAgentId, toAgentId, type, JSON.stringify(metadata ?? {}), createdAt],
	);
	return { id, projectId, fromAgentId, toAgentId, type, metadata, createdAt };
}

export async function listAgentDependencies(projectId: string, type?: DependencyType): Promise<AgentDependency[]> {
	if (type) {
		const rows = await query<any>("SELECT * FROM agent_dependencies WHERE project_id = $1 AND type = $2", [
			projectId,
			type,
		]);
		return rows.map(rowToDependency);
	}
	const rows = await query<any>("SELECT * FROM agent_dependencies WHERE project_id = $1", [projectId]);
	return rows.map(rowToDependency);
}

export async function deleteAgentDependency(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM agent_dependencies WHERE id = $1", [id]);
	return (result.rowCount ?? 0) > 0;
}

export async function deleteAllDependencies(projectId: string): Promise<void> {
	await execute("DELETE FROM agent_dependencies WHERE project_id = $1", [projectId]);
}

export async function bulkCreateDependencies(
	projectId: string,
	deps: { fromAgentId: string; toAgentId: string; type: DependencyType; metadata?: AgentDependencyMetadata }[],
): Promise<AgentDependency[]> {
	const createdAt = new Date().toISOString();
	const results: AgentDependency[] = [];
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		for (const dep of deps) {
			const id = randomUUID();
			await client.query(
				"INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
				[id, projectId, dep.fromAgentId, dep.toAgentId, dep.type, JSON.stringify(dep.metadata ?? {}), createdAt],
			);
			results.push({
				id,
				projectId,
				fromAgentId: dep.fromAgentId,
				toAgentId: dep.toAgentId,
				type: dep.type,
				metadata: dep.metadata,
				createdAt,
			});
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
	return results;
}

// ---------------------------------------------------------------------------
// Agent Capabilities
// ---------------------------------------------------------------------------

export async function createAgentCapability(
	agentId: string,
	projectId: string,
	pattern: string,
	scopeType: CapabilityScopeType = "path",
	permission: CapabilityPermission = "readwrite",
): Promise<AgentCapability> {
	const id = randomUUID();
	await execute(
		"INSERT INTO agent_capabilities (id, agent_id, project_id, scope_type, pattern, permission) VALUES ($1, $2, $3, $4, $5, $6)",
		[id, agentId, projectId, scopeType, pattern, permission],
	);
	return { id, agentId, projectId, scopeType, pattern, permission };
}

export async function listAgentCapabilities(projectId: string, agentId?: string): Promise<AgentCapability[]> {
	if (agentId) {
		const rows = await query<any>("SELECT * FROM agent_capabilities WHERE project_id = $1 AND agent_id = $2", [
			projectId,
			agentId,
		]);
		return rows.map(rowToCapability);
	}
	const rows = await query<any>("SELECT * FROM agent_capabilities WHERE project_id = $1", [projectId]);
	return rows.map(rowToCapability);
}

export async function deleteAgentCapability(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM agent_capabilities WHERE id = $1", [id]);
	return (result.rowCount ?? 0) > 0;
}

export async function deleteAllCapabilities(projectId: string, agentId?: string): Promise<void> {
	if (agentId) {
		await execute("DELETE FROM agent_capabilities WHERE project_id = $1 AND agent_id = $2", [projectId, agentId]);
	} else {
		await execute("DELETE FROM agent_capabilities WHERE project_id = $1", [projectId]);
	}
}
