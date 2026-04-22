// @oscorpex/core — Replay snapshot domain type

export interface ReplaySnapshot {
	id: string;
	runId: string;
	checkpoint: string;
	createdAt: string;
	run: import("./run.js").Run;
	stages: import("./stage.js").Stage[];
	tasks: import("./task.js").Task[];
	artifacts: import("./artifact.js").ArtifactManifest[];
	policyDecisions: import("./policy.js").PolicyDecision[];
	verificationReports: import("./verification.js").VerificationReport[];
}