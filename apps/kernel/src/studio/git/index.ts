// P9: Git Commit Workflow — Barrel Export
// Covers: checkpoint (P9-A), proposal (P9-B), secret scan (P9-D),
//         commit message policy (P9-E), test-pass token (P9-F),
//         commit executor (P9-H), rollback (P9-K).

// --- Checkpoint (P9-A) ---
export { createGitCheckpoint, isCheckpointValid } from "./git-checkpoint-service.js";

// --- Proposal (P9-B) ---
export { createCommitProposal } from "./commit-proposal-service.js";

// --- Secret Scan (P9-D) ---
export { scanStagedForSecrets } from "./secret-scan.js";

// --- Commit Message Policy (P9-E) ---
export { validateCommitMessage } from "./commit-message-policy.js";

// --- Test-Pass Token (P9-F) ---
export { issueTestPassToken, verifyTestPassToken } from "./test-pass-token.js";

// --- Commit Executor (P9-H) ---
export { applyCommit } from "./commit-executor.js";
export type { CommitApplyResult } from "./commit-executor.js";

// --- Rollback (P9-K) ---
export { rollbackToCheckpoint } from "./git-rollback.js";
export type { GitRollbackResult } from "./git-rollback.js";

// --- Shared Types ---
export type {
	GitCheckpoint,
	CommitProposal,
	CommitMessageValidation,
	SecretScanResult,
	TestPassToken,
} from "./git-types.js";
