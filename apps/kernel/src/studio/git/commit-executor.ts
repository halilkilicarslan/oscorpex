// P9-H: Commit Apply Executor
// Applies an approved CommitProposal to the git repo after all gates are verified.
import { execFileSync } from "node:child_process";
import { createLogger } from "../logger.js";
import { enforceToolPolicy } from "../security/tool-policy-enforcer.js";
import { assertInsideWorkspace } from "../security/workspace-resolver.js";
import type { CommitProposal, GitCheckpoint } from "./git-types.js";

const log = createLogger("commit-executor");

export interface CommitApplyResult {
	status: "applied" | "failed" | "blocked";
	resultSha?: string;
	error?: string;
}

export function applyCommit(opts: {
	proposal: CommitProposal;
	checkpoint: GitCheckpoint;
	repoPath: string;
	actorId: string;
}): CommitApplyResult {
	const { proposal, checkpoint, repoPath, actorId } = opts;

	// Precondition: proposal must be approved
	if (proposal.status !== "approved") {
		return { status: "blocked", error: `Proposal status is '${proposal.status}', expected 'approved'` };
	}

	// Precondition: secret scan must have passed
	if (!proposal.secretScanPassed) {
		return { status: "blocked", error: "Secret scan not passed" };
	}

	// Precondition: test gate must have passed
	if (!proposal.testGatePassed) {
		return { status: "blocked", error: "Test gate not passed" };
	}

	// Verify HEAD has not moved since checkpoint was taken
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

	if (currentHead !== checkpoint.headSha) {
		return {
			status: "blocked",
			error: `HEAD has moved: expected ${checkpoint.headSha}, got ${currentHead}`,
		};
	}

	// Workspace isolation check
	try {
		assertInsideWorkspace({ tenantId: proposal.tenantId, projectId: proposal.projectId }, repoPath);
	} catch (err) {
		return { status: "blocked", error: `Workspace violation: ${err instanceof Error ? err.message : String(err)}` };
	}

	// Tool policy enforcement
	try {
		enforceToolPolicy({
			request: {
				actorId,
				tenantId: proposal.tenantId,
				projectId: proposal.projectId,
				source: "system",
				tool: "git",
				action: "commit",
				riskLevel: "write",
			},
		});
	} catch (err) {
		return { status: "blocked", error: `Policy denied: ${err instanceof Error ? err.message : String(err)}` };
	}

	// Execute commit
	try {
		execFileSync("git", ["commit", "-m", proposal.message], {
			cwd: repoPath,
			encoding: "utf8",
			timeout: 30_000,
		});

		const resultSha = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repoPath,
			encoding: "utf8",
			timeout: 10_000,
		}).trim();

		log.info({ proposalId: proposal.id, resultSha }, "[commit-executor] Commit applied successfully");
		return { status: "applied", resultSha };
	} catch (err) {
		log.error({ err, proposalId: proposal.id }, "[commit-executor] Commit failed");
		return { status: "failed", error: err instanceof Error ? err.message : String(err) };
	}
}
