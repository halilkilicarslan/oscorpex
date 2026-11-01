// ---------------------------------------------------------------------------
// P9-B: Commit Proposal Service
// Builds a CommitProposal from a valid GitCheckpoint. Validates the commit
// message, captures the diff snapshot, and runs the secret scan inline.
// The proposal status is set to "failed" immediately if secrets are found.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";
import { validateCommitMessage } from "./commit-message-policy.js";
import { NO_SUBMODULES, gitSafeEnv } from "./git-safe-config.js";
import type { CommitProposal, GitCheckpoint } from "./git-types.js";
import { scanStagedForSecrets } from "./secret-scan.js";

const log = createLogger("commit-proposal");

/** Maximum bytes kept in the diff_snapshot column — 500 KB */
const MAX_DIFF_BYTES = 500_000;

/**
 * Create a commit proposal from an existing checkpoint.
 *
 * @throws {Error} if the commit message fails policy validation
 * @throws {Error} if git diff command fails
 */
export function createCommitProposal(opts: {
	checkpoint: GitCheckpoint;
	message: string;
	repoPath: string;
}): CommitProposal {
	// --- Commit message policy (P9-E) ---
	const msgValidation = validateCommitMessage(opts.message);
	if (!msgValidation.valid) {
		throw new Error(`Invalid commit message: ${msgValidation.errors.join(", ")}`);
	}

	// --- Diff snapshot ---
	const diffFull = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", NO_SUBMODULES, "--cached"], {
		cwd: opts.repoPath,
		encoding: "utf8",
		timeout: 30_000,
		env: gitSafeEnv(buildSafeChildEnv({ profile: "build_tool" }), opts.repoPath),
	});

	// --- Secret scan (P9-D) ---
	const secretScan = scanStagedForSecrets(opts.repoPath, opts.checkpoint.stagedFiles);

	const proposal: CommitProposal = {
		id: randomUUID(),
		tenantId: opts.checkpoint.tenantId,
		projectId: opts.checkpoint.projectId,
		checkpointId: opts.checkpoint.id,
		message: opts.message,
		stagedFiles: opts.checkpoint.stagedFiles,
		diffSnapshot: diffFull.slice(0, MAX_DIFF_BYTES),
		diffSizeBytes: Buffer.byteLength(diffFull),
		secretScanPassed: secretScan.passed,
		testGatePassed: false, // Caller must set via test-pass token (P9-F)
		status: secretScan.passed ? "pending" : "failed",
		proposedAt: new Date().toISOString(),
	};

	log.info(
		{
			proposalId: proposal.id,
			projectId: proposal.projectId,
			secretScanPassed: proposal.secretScanPassed,
			diffSizeBytes: proposal.diffSizeBytes,
			status: proposal.status,
		},
		"[commit-proposal] Created",
	);

	return proposal;
}
