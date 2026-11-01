// ---------------------------------------------------------------------------
// Oscorpex — Execution Workspace Contract
// Unified interface for local and file-copy isolated workspaces.
// resolveWorkspace() picks the right strategy based on sandbox policy.
// ---------------------------------------------------------------------------

import { type IsolatedWorkspace, prepareIsolatedWorkspace } from "./isolated-workspace.js";
import { createLogger } from "./logger.js";
import type { SandboxPolicy } from "./sandbox-manager.js";
const log = createLogger("execution-workspace");

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type WorkspaceType = "local" | "isolated";

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
 *  - isolationLevel "container" or "vm" → refused (there is no container/VM runtime; never falls back to the host)
 *  - isolationLevel "workspace" → file-copy isolated
 *  - isolationLevel "none" or no policy → local (source repo direct)
 *  - anything else → refused
 */
export async function resolveWorkspace(
	sourceRepoPath: string | undefined,
	taskId: string,
	policy?: SandboxPolicy,
): Promise<ExecutionWorkspace> {
	const level: unknown = policy?.isolationLevel ?? "none";

	// Fail closed: a policy that demands a container/VM boundary must never run unisolated on the host.
	if (level === "container" || level === "vm") {
		log.warn({ taskId, level }, "[execution-workspace] isolationLevel not available, refusing to run");
		throw new Error(`isolationLevel "${level}" is not available: container/VM isolation is not supported`);
	}
	// ...and neither may an unknown value be read as "no isolation"
	if (level !== "none" && level !== "workspace") {
		throw new Error(`Unknown isolationLevel ${JSON.stringify(level)}`);
	}

	if (!sourceRepoPath) {
		return localWorkspace("");
	}

	if (level === "workspace") {
		const ws = await prepareIsolatedWorkspace(sourceRepoPath, taskId, policy);
		return fromIsolated(ws, ws.isolated ? "isolated" : "local");
	}

	// "none"
	return localWorkspace(sourceRepoPath);
}
