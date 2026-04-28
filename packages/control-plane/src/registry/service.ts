// ---------------------------------------------------------------------------
// Control Plane — Agent Registry Service
// ---------------------------------------------------------------------------

import {
	insertAgentInstance,
	updateAgentInstanceLastSeen,
	updateAgentInstanceStatus,
	listAgentInstances,
	getAgentInstance,
	upsertProviderRuntime,
	listProviderRuntimes,
	getProviderRuntime,
	upsertCapabilitySnapshot,
	listCapabilitySnapshots,
	 type AgentInstanceRow,
	 type ProviderRuntimeRow,
} from "./registry-repo.js";

export interface RegistryState {
	agents: Array<{
		id: string;
		name: string;
		role: string;
		status: string;
		projectId: string | null;
		registeredAt: string;
		lastSeenAt: string | null;
	}>;
	providers: Array<{
		id: string;
		name: string;
		type: string;
		status: string;
		lastHealthCheckAt: string | null;
		cooldownUntil: string | null;
		capabilities: string[];
	}>;
}

export async function registerAgentInstance(data: {
	id?: string;
	name: string;
	role: string;
	status?: string;
	projectId?: string | null;
}): Promise<AgentInstanceRow> {
	return insertAgentInstance(data);
}

export async function recordAgentHeartbeat(agentId: string): Promise<void> {
	await updateAgentInstanceLastSeen(agentId);
}

export async function setAgentStatus(agentId: string, status: string): Promise<void> {
	await updateAgentInstanceStatus(agentId, status);
}

export async function listRegistryAgents(projectId?: string): Promise<AgentInstanceRow[]> {
	return listAgentInstances(projectId);
}

export async function getRegistryAgent(id: string): Promise<AgentInstanceRow | undefined> {
	return getAgentInstance(id);
}

export async function registerProviderRuntime(data: {
	id: string;
	name: string;
	type: string;
	status?: string;
	lastHealthCheckAt?: string | null;
	cooldownUntil?: string | null;
	capabilities?: string[];
}): Promise<ProviderRuntimeRow> {
	return upsertProviderRuntime(data);
}

export async function listRegistryProviders(): Promise<ProviderRuntimeRow[]> {
	return listProviderRuntimes();
}

export async function getRegistryProvider(id: string): Promise<ProviderRuntimeRow | undefined> {
	return getProviderRuntime(id);
}

export async function recordCapabilitySnapshot(data: {
	providerId: string;
	capabilities: string[];
}): Promise<void> {
	await upsertCapabilitySnapshot(data);
}

export async function listProviderCapabilities(providerId?: string): Promise<string[]> {
	const rows = await listCapabilitySnapshots(providerId);
	const caps = new Set<string>();
	for (const row of rows) {
		try {
			const arr = JSON.parse(row.capabilities) as string[];
			for (const c of arr) caps.add(c);
		} catch { /* skip malformed */ }
	}
	return Array.from(caps);
}

export async function getRegistryState(): Promise<RegistryState> {
	const [agents, providers] = await Promise.all([listAgentInstances(), listProviderRuntimes()]);
	return {
		agents,
		providers: providers.map((p) => ({
			...p,
			capabilities: (() => {
				try {
					return JSON.parse(p.capabilities) as string[];
				} catch {
					return [];
				}
			})(),
		})),
	};
}
