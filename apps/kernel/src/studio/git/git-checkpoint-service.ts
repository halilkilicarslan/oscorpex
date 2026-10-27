// ---------------------------------------------------------------------------
// P9-A: Git Checkpoint Service
// Creates and validates immutable snapshots of the repo's HEAD state
// before any commit operation. TTL: 60 minutes.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createLogger } from "../logger.js";
import { assertInsideWorkspace } from "../security/workspace-resolver.js";
import type { GitCheckpoint } from "./git-types.js";

const log = createLogger("git-checkpoint");

/** Checkpoint lifetime — 60 minutes */
const CHECKPOINT_TTL_MS = 60 * 60 * 1_000;

/**
 * Create a git checkpoint by capturing the current HEAD SHA, branch name,
 * and staged file list for the given repo path.
 *
 * @throws {WorkspaceViolationError} if repoPath escapes the tenant workspace
 * @throws {Error} if any git command fails
 */
export function createGitCheckpoint(opts: {
	tenantId: string;
	projectId: string;
	repoPath: string;
	pipelineId?: string;
}): GitCheckpoint {
	// Validate workspace isolation before touching the repo
	assertInsideWorkspace({ tenantId: opts.tenantId, projectId: opts.projectId }, opts.repoPath);

	// Capture HEAD SHA
	const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: opts.repoPath,
		encoding: "utf8",
		timeout: 10_000,
	}).trim();

	// Capture current branch
	const branchName = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd: opts.repoPath,
		encoding: "utf8",
		timeout: 10_000,
	}).trim();

	// Capture staged file list (may be empty)
	const stagedOutput = execFileSync("git", ["diff", "--cached", "--name-only"], {
		cwd: opts.repoPath,
		encoding: "utf8",
		timeout: 10_000,
	}).trim();
	const stagedFiles = stagedOutput ? stagedOutput.split("\n") : [];

	const now = new Date();
	const checkpoint: GitCheckpoint = {
		id: randomUUID(),
		tenantId: opts.tenantId,
		projectId: opts.projectId,
		pipelineId: opts.pipelineId,
		headSha,
		branchName,
		stagedFiles,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + CHECKPOINT_TTL_MS).toISOString(),
	};

	log.info(
		{ checkpointId: checkpoint.id, projectId: opts.projectId, headSha, stagedCount: stagedFiles.length },
		"[git-checkpoint] Created",
	);

	return checkpoint;
}

/**
 * Validate that a checkpoint is still usable:
 * - Not manually invalidated
 * - Not expired
 * - HEAD SHA still matches (no external commits have landed)
 */
export function isCheckpointValid(checkpoint: GitCheckpoint, currentHeadSha: string): boolean {
	if (checkpoint.invalidatedAt) return false;
	if (new Date(checkpoint.expiresAt) < new Date()) return false;
	if (checkpoint.headSha !== currentHeadSha) return false;
	return true;
}
