// ---------------------------------------------------------------------------
// P9: Git Commit Workflow — Core Type Definitions
// Covers checkpoints (P9-A), proposals (P9-B), secret scan (P9-D),
// commit message policy (P9-E), and test-pass tokens (P9-F).
// ---------------------------------------------------------------------------

export interface GitCheckpoint {
	id: string;
	tenantId: string;
	projectId: string;
	pipelineId?: string;
	headSha: string;
	branchName: string;
	stagedFiles: string[];
	createdAt: string;
	expiresAt: string;
	invalidatedAt?: string;
	invalidationReason?: string;
}

export interface CommitProposal {
	id: string;
	tenantId: string;
	projectId: string;
	checkpointId: string;
	message: string;
	stagedFiles: string[];
	diffSnapshot: string;
	diffSizeBytes: number;
	secretScanPassed: boolean;
	testGatePassed: boolean;
	status: "pending" | "approved" | "rejected" | "applied" | "failed" | "expired";
	proposedAt: string;
	decidedAt?: string;
	appliedAt?: string;
	resultSha?: string;
	decidedBy?: string;
	rejectionReason?: string;
}

export interface CommitMessageValidation {
	valid: boolean;
	errors: string[];
}

export interface SecretScanResult {
	passed: boolean;
	findings: Array<{ file: string; category: string; line: number }>;
}

export interface TestPassToken {
	projectId: string;
	tenantId: string;
	passed: boolean;
	issuedAt: string;
	expiresAt: string;
	suiteResult: { passed: number; failed: number; total: number };
}
