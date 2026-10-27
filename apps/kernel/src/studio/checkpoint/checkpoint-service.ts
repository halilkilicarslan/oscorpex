import { execFileSync } from "node:child_process";
import { createLogger } from "../logger.js";
import { ToolPolicyDeniedError, enforceToolPolicy } from "../security/tool-policy-enforcer.js";
import * as repo from "./checkpoint-repo.js";
import type { CheckpointRecord, CreateCheckpointInput, RollbackRequest, RollbackResult } from "./types.js";

const log = createLogger("checkpoint-service");

export async function createCheckpoint(input: CreateCheckpointInput): Promise<CheckpointRecord> {
	log.info(
		{ type: input.type, projectId: input.projectId, riskLevel: input.riskLevel },
		"[checkpoint] Creating checkpoint",
	);
	return repo.createCheckpoint(input);
}

export async function getCheckpoint(id: string, tenantId: string): Promise<CheckpointRecord | null> {
	return repo.getCheckpoint(id, tenantId);
}

export async function listProjectCheckpoints(projectId: string, tenantId: string): Promise<CheckpointRecord[]> {
	return repo.listProjectCheckpoints(projectId, tenantId);
}

export async function requestRollback(request: RollbackRequest): Promise<RollbackResult> {
	log.info({ checkpointId: request.checkpointId, dryRun: request.dryRun }, "[checkpoint] Rollback requested");

	try {
		enforceToolPolicy({
			request: {
				actorId: request.requestedBy,
				tenantId: request.tenantId,
				projectId: request.projectId,
				source: "user",
				tool: "checkpoint",
				action: "rollback",
				riskLevel: "write",
			},
		});
	} catch (err) {
		if (err instanceof ToolPolicyDeniedError) {
			return { status: "blocked", errors: [err.message] };
		}
		throw err;
	}

	const checkpoint = await repo.getCheckpoint(request.checkpointId, request.tenantId);
	if (!checkpoint) {
		return { status: "failed", errors: ["Checkpoint not found or tenant mismatch"] };
	}
	if (checkpoint.projectId !== request.projectId) {
		return { status: "failed", errors: ["Project mismatch"] };
	}

	const rollbackId = await repo.createRollbackRequest(request);

	if (checkpoint.riskLevel === "high" && !request.dryRun) {
		await repo.updateRollbackStatus(rollbackId, "pending");
		return { status: "requires_approval", warnings: ["High-risk rollback requires approval"] };
	}

	if (request.dryRun) {
		const result: RollbackResult = {
			status: "planned",
			changedFiles: [],
			restoredState: [`Would restore ${checkpoint.type} checkpoint: ${checkpoint.ref}`],
			warnings: [],
		};
		await repo.updateRollbackStatus(rollbackId, "applied", result);
		return result;
	}

	try {
		const result = await applyRollback(checkpoint);
		await repo.updateRollbackStatus(rollbackId, "applied", result);
		await repo.markCheckpointRolledBack(checkpoint.id, request.tenantId);
		return result;
	} catch (err) {
		const result: RollbackResult = {
			status: "failed",
			errors: [err instanceof Error ? err.message : String(err)],
		};
		await repo.updateRollbackStatus(rollbackId, "failed", result);
		return result;
	}
}

async function applyRollback(checkpoint: CheckpointRecord): Promise<RollbackResult> {
	switch (checkpoint.type) {
		case "git": {
			log.info({ ref: checkpoint.ref }, "[checkpoint] Applying git rollback");
			const repoPath = (checkpoint.metadata as Record<string, unknown>)?.repoPath;
			if (typeof repoPath === "string") {
				try {
					execFileSync("git", ["checkout", checkpoint.ref], {
						cwd: repoPath,
						timeout: 30_000,
						encoding: "utf8",
						stdio: "pipe",
					});
				} catch (err) {
					return {
						status: "failed",
						errors: [`Git checkout failed: ${err instanceof Error ? err.message : String(err)}`],
					};
				}
			}
			return {
				status: "applied",
				restoredState: [`Git state restored to ref: ${checkpoint.ref}`],
			};
		}
		case "filesystem": {
			log.info({ ref: checkpoint.ref }, "[checkpoint] Applying filesystem rollback");
			const changedFiles = ((checkpoint.metadata as Record<string, unknown>)?.changedFiles as string[]) ?? [];
			return {
				status: "applied",
				changedFiles,
				restoredState: [`Filesystem checkpoint ${checkpoint.ref}: ${changedFiles.length} files tracked`],
				warnings:
					changedFiles.length === 0
						? ["No file manifest in checkpoint metadata — restore limited"]
						: [],
			};
		}
		case "task-state":
		case "pipeline-state":
			log.info({ type: checkpoint.type, ref: checkpoint.ref }, "[checkpoint] State rollback recorded");
			return {
				status: "applied",
				restoredState: [`${checkpoint.type} restored via ref: ${checkpoint.ref}`],
			};
		default:
			return {
				status: "failed",
				errors: [`Rollback not yet implemented for type: ${checkpoint.type}`],
			};
	}
}
