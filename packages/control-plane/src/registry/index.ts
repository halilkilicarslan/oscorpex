// ---------------------------------------------------------------------------
// Agent Registry — Types, Repository, Service
// ---------------------------------------------------------------------------

export type { AgentInstanceRow as AgentInstance } from "./repo.js";
export type { ProviderRuntimeRow as ProviderRuntime } from "./repo.js";
export type { CapabilitySnapshotRow as CapabilitySnapshot } from "./repo.js";
export type { RegistryState } from "./service.js";
export {
	registerAgentInstance,
	recordAgentHeartbeat,
	setAgentStatus,
	listRegistryAgents,
	getRegistryAgent,
	registerProviderRuntime,
	listRegistryProviders,
	getRegistryProvider,
	recordCapabilitySnapshot,
	listProviderCapabilities,
	getRegistryState,
} from "./service.js";
