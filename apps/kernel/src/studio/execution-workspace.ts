// ---------------------------------------------------------------------------
// Oscorpex — Execution Workspace Contract
// Unified interface for local, file-copy isolated, and container workspaces.
// resolveWorkspace() picks the right strategy based on sandbox policy.
// ---------------------------------------------------------------------------

import { type IsolatedWorkspace, prepareIsolatedWorkspace } from "./isolated-workspace.js";
import { createLogger } from "./logger.js";
import type { SandboxPolicy } from "./sandbox-manager.js";
const log = createLogger("execution-workspace");

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

	// Container/VM mode: use container-pool when available, fall back to
	// file-copy isolation when Docker is not present or pool is not ready.
	if (level === "container" || level === "vm") {
		try {
			const { containerPool } = await import("./container-pool.js");
			if (containerPool.isReady()) {
				const container = await containerPool.acquireContainer(taskId);
				if (container) {
					await containerPool.bindWorkspace(container.id, sourceRepoPath);
					log.info({ taskId, containerId: container.id }, "[execution-workspace] Container workspace bound");

					return {
						type: "container" as const,
						repoPath: "/workspace",
						isolated: true,

						async writeBack(files: string[]): Promise<string[]> {
							const { writeFile, mkdir } = await import("node:fs/promises");
							const { join, dirname } = await import("node:path");
							const written: string[] = [];

							for (const file of files) {
								// Strip any path component that isn't alphanumeric, dot, dash, slash, or underscore
								const safePath = file.replace(/[^a-zA-Z0-9._\-/]/g, "");
								if (!safePath) continue;

								try {
									// Read the file from the container using cat with array Cmd (no shell injection)
									const content = await containerPool.execInContainer(container.id, ["cat", `/workspace/${safePath}`]);
									const targetPath = join(sourceRepoPath, safePath);
									await mkdir(dirname(targetPath), { recursive: true });
									await writeFile(targetPath, content);
									written.push(safePath);
								} catch (err) {
									log.warn({ err, file: safePath }, "[execution-workspace] Write-back failed for file");
								}
							}

							return written;
						},

						async cleanup(): Promise<void> {
							try {
								containerPool.releaseContainer(container.id);
								log.info({ containerId: container.id }, "[execution-workspace] Container released back to pool");
							} catch (err) {
								log.warn({ err }, "[execution-workspace] Container cleanup failed");
							}
						},
					};
				}
			}
		} catch (err) {
			log.warn({ err }, "[execution-workspace] Container workspace setup failed, falling back to file-copy");
		}

		// Fallback: file-copy isolation (no real container boundary)
		const ws = await prepareIsolatedWorkspace(sourceRepoPath, taskId, policy);
		return fromIsolated(ws, ws.isolated ? "isolated" : "local");
	}

	if (level === "workspace") {
		const ws = await prepareIsolatedWorkspace(sourceRepoPath, taskId, policy);
		return fromIsolated(ws, ws.isolated ? "isolated" : "local");
	}

	// "none" or unknown
	return localWorkspace(sourceRepoPath);
}
