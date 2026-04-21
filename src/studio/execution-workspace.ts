// ---------------------------------------------------------------------------
// Oscorpex — Execution Workspace Contract
// Unified interface for local, file-copy isolated, and container workspaces.
// resolveWorkspace() picks the right strategy based on sandbox policy.
// ---------------------------------------------------------------------------

import type { SandboxPolicy } from "./sandbox-manager.js";
import { prepareIsolatedWorkspace, type IsolatedWorkspace } from "./isolated-workspace.js";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type WorkspaceType = "local" | "isolated" | "container";

export interface ExecutionWorkspace {
	readonly type: WorkspaceType;
	readonly repoPath: string;
	readonly isolated: boolean;
	writeBack(files: string[]): Promise<string[]>;
	cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** Wrap the existing IsolatedWorkspace into the unified contract */
function fromIsolated(ws: IsolatedWorkspace, wsType: WorkspaceType): ExecutionWorkspace {
	return {
		type: wsType,
		repoPath: ws.repoPath,
		isolated: ws.isolated,
		writeBack: (files) => ws.writeBack(files),
		cleanup: () => ws.cleanup(),
	};
}

function localWorkspace(repoPath: string): ExecutionWorkspace {
	return {
		type: "local",
		repoPath,
		isolated: false,
		writeBack: async () => [],
		cleanup: async () => {},
	};
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Pick the right workspace strategy based on sandbox policy.
 *
 * Decision matrix:
 *  - isolationLevel "container" + Docker available → container (future)
 *  - isolationLevel "workspace" or "container" (no Docker) → file-copy isolated
 *  - isolationLevel "none" or no policy → local (source repo direct)
 */
export async function resolveWorkspace(
	sourceRepoPath: string | undefined,
	taskId: string,
	policy?: SandboxPolicy,
	_containerAvailable?: boolean,
): Promise<ExecutionWorkspace> {
	if (!sourceRepoPath) {
		return localWorkspace("");
	}

	const level = policy?.isolationLevel ?? "none";

	// Container mode: for now, fall back to file-copy isolation.
	// When container-pool is wired into execution path, this branch
	// will acquire a container and use docker cp for workspace setup.
	if (level === "container" || level === "vm") {
		const ws = await prepareIsolatedWorkspace(sourceRepoPath, taskId, policy);
		return fromIsolated(ws, ws.isolated ? "container" : "local");
	}

	if (level === "workspace") {
		const ws = await prepareIsolatedWorkspace(sourceRepoPath, taskId, policy);
		return fromIsolated(ws, ws.isolated ? "isolated" : "local");
	}

	// "none" or unknown
	return localWorkspace(sourceRepoPath);
}
