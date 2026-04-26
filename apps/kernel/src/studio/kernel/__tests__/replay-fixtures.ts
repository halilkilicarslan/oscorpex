// ---------------------------------------------------------------------------
// Replay Fixture Builder
// Reusable factories for deterministic replay test data.
// ---------------------------------------------------------------------------

import type { ReplaySnapshot } from "@oscorpex/core";

export interface FakeRun {
	id: string;
	projectId: string;
	goal: string;
	mode: "execute" | "plan" | "review";
	status: "running" | "completed" | "failed";
}

export interface FakeStage {
	order: number;
	agents: string[];
	tasks: string[];
	status: "pending" | "running" | "completed";
}

export interface FakeTask {
	id: string;
	phaseId: string;
	title: string;
	assignedAgent: string;
	status: "queued" | "running" | "completed" | "failed";
	complexity: "S" | "M" | "L" | "XL";
	dependsOn: string[];
	branch: string;
	retryCount: number;
	revisionCount: number;
	requiresApproval: boolean;
}

export interface FakeArtifact {
	taskId: string;
	filesCreated: string[];
	filesModified: string[];
}

export interface FakePolicyDecision {
	runId: string;
	action: "allow" | "deny" | "warn";
	reasons: string[];
	policyVersion: string;
	createdAt: string;
}

export interface FakeVerificationReport {
	runId: string;
	taskId: string;
	passed: boolean;
	checks: string[];
	createdAt: string;
}

export function fakeRun(overrides?: Partial<FakeRun>): FakeRun {
	return {
		id: "r1",
		projectId: "p1",
		goal: "Test goal",
		mode: "execute",
		status: "running",
		...overrides,
	};
}

export function fakeStage(overrides?: Partial<FakeStage>): FakeStage {
	return {
		order: 0,
		agents: [],
		tasks: [],
		status: "pending",
		...overrides,
	};
}

export function fakeTask(overrides?: Partial<FakeTask>): FakeTask {
	return {
		id: "t1",
		phaseId: "ph1",
		title: "Test Task",
		assignedAgent: "",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	};
}

export function fakeArtifact(overrides?: Partial<FakeArtifact>): FakeArtifact {
	return {
		taskId: "t1",
		filesCreated: [],
		filesModified: [],
		...overrides,
	};
}

export function fakePolicyDecision(overrides?: Partial<FakePolicyDecision>): FakePolicyDecision {
	return {
		runId: "r1",
		action: "allow",
		reasons: [],
		policyVersion: "1.0",
		createdAt: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

export function fakeVerificationReport(overrides?: Partial<FakeVerificationReport>): FakeVerificationReport {
	return {
		runId: "r1",
		taskId: "t1",
		passed: true,
		checks: [],
		createdAt: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

/**
 * Build a complete ReplaySnapshot from partial overrides.
 * All fields have sensible defaults.
 */
export function buildReplaySnapshot(overrides?: Partial<ReplaySnapshot>): ReplaySnapshot {
	return {
		id: "snap-1",
		runId: "r1",
		projectId: "p1",
		checkpoint: "cp1",
		createdAt: "2024-01-01T00:00:00Z",
		run: fakeRun(overrides?.run as any),
		stages: [fakeStage()],
		tasks: [fakeTask()],
		artifacts: [fakeArtifact()],
		policyDecisions: [fakePolicyDecision()],
		verificationReports: [fakeVerificationReport()],
		metadata: { truthSources: { run: "db" } },
		...overrides,
	} as ReplaySnapshot;
}
