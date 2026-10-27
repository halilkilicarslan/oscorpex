// P9-J: Rollback to Checkpoint
// Rolls back the git repo to a previously captured checkpoint's HEAD SHA.
import { execFileSync } from "node:child_process";
import { createLogger } from "../logger.js";
import { assertInsideWorkspace } from "../security/workspace-resolver.js";
import type { GitCheckpoint } from "./git-types.js";

const log = createLogger("git-rollback");

export interface GitRollbackResult {
	status: "applied" | "planned" | "failed" | "requires_approval";
	currentHead?: string;
	targetHead?: string;
	error?: string;
}

export function rollbackToCheckpoint(opts: {
	checkpoint: GitCheckpoint;
	repoPath: string;
	dryRun: boolean;
}): GitRollbackResult {
	const { checkpoint, repoPath, dryRun } = opts;

	// Workspace isolation check
	try {
		assertInsideWorkspace({ tenantId: checkpoint.tenantId, projectId: checkpoint.projectId }, repoPath);
	} catch (err) {
		return { status: "failed", error: err instanceof Error ? err.message : String(err) };
	}

	// Read current HEAD
	let currentHead: string;
	try {
		currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repoPath,
			encoding: "utf8",
			timeout: 10_000,
		}).trim();
	} catch (err) {
		return { status: "failed", error: `Failed to read HEAD: ${err instanceof Error ? err.message : String(err)}` };
	}

	// Dry run — report plan without mutation
	if (dryRun) {
		return {
			status: "planned",
			currentHead,
			targetHead: checkpoint.headSha,
		};
	}

	// No-op when already at target
	if (currentHead === checkpoint.headSha) {
		return { status: "applied", currentHead, targetHead: checkpoint.headSha };
	}

	// Apply soft reset to target SHA (preserves working tree)
	try {
		execFileSync("git", ["reset", "--soft", checkpoint.headSha], {
			cwd: repoPath,
			encoding: "utf8",
			timeout: 30_000,
		});

		log.info(
			{ from: currentHead, to: checkpoint.headSha, checkpointId: checkpoint.id },
			"[git-rollback] Rollback applied",
		);

		return { status: "applied", currentHead, targetHead: checkpoint.headSha };
	} catch (err) {
		log.error({ err, checkpointId: checkpoint.id }, "[git-rollback] Rollback failed");
		return { status: "failed", error: err instanceof Error ? err.message : String(err) };
	}
}
