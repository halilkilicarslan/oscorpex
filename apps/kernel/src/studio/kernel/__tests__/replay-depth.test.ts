// ---------------------------------------------------------------------------
// Replay Snapshot Depth Tests (S2-01 ~ S2-04)
// Verifies createCheckpointSnapshot populates run, artifacts,
// verificationReports, and policyDecisions fields.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import { createProject, createPlan, createPhase, createTask, createPipelineRun, execute } from "../../db.js";
import { createCheckpointSnapshot } from "../../replay-store.js";
import { randomUUID } from "node:crypto";

async function cleanSnapshots() {
	await execute("DELETE FROM replay_snapshots");
}

async function setTaskOutput(taskId: string, output: Record<string, unknown>): Promise<void> {
	await execute("UPDATE tasks SET output = $1 WHERE id = $2", [JSON.stringify(output), taskId]);
}

describe("createCheckpointSnapshot — depth fields", () => {
	beforeEach(async () => {
		await cleanSnapshots();
	});

	it("populates run field with pipeline status and task counts", async () => {
		const project = await createProject({ name: "ReplayTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		await createPipelineRun({ projectId: project.id, status: "running", stagesJson: JSON.stringify([{ order: 0, agents: [] }]) });
		await createTask({ phaseId: phase.id, title: "T1", description: "", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await createTask({ phaseId: phase.id, title: "T2", description: "", assignedAgent: "a2", complexity: "S", dependsOn: [], branch: "main" });

		const snapshot = await createCheckpointSnapshot(project.id, "test-checkpoint", randomUUID);

		expect(snapshot.run).toBeDefined();
		expect(snapshot.run.status).toBeDefined();
		expect(snapshot.run.projectName).toBe(project.name);
		expect(snapshot.run.taskCount).toBe(2);
	});

	it("collects artifacts from task outputs", async () => {
		const project = await createProject({ name: "ArtifactTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "Auth task", description: "", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await setTaskOutput(task.id, {
			filesCreated: ["src/auth.ts"],
			filesModified: ["src/index.ts"],
			logs: [],
		});

		const snapshot = await createCheckpointSnapshot(project.id, "artifacts-test", randomUUID);

		expect(snapshot.artifacts.length).toBeGreaterThanOrEqual(1);
		expect(snapshot.artifacts[0]!.filesCreated).toContain("src/auth.ts");
	});

	it("fetches verification reports when available", async () => {
		const project = await createProject({ name: "VerifyTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "Verify task", description: "", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await setTaskOutput(task.id, { filesCreated: [], filesModified: [], logs: [] });
		await execute(
			`INSERT INTO verification_results (id, task_id, verification_type, status, details, created_at)
			 VALUES ($1, $2, $3, $4, $5, now())`,
			[randomUUID(), task.id, "files_exist", "passed", JSON.stringify([{ file: "src/auth.ts", expected: "exist", actual: "found" }])],
		);

		const snapshot = await createCheckpointSnapshot(project.id, "verify-test", randomUUID);

		expect(snapshot.verificationReports.length).toBeGreaterThanOrEqual(1);
		expect(snapshot.verificationReports[0]!.taskId).toBe(task.id);
	});

	it("populates stages from pipeline", async () => {
		const project = await createProject({ name: "StageTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		await createPipelineRun({ projectId: project.id, status: "running", stagesJson: JSON.stringify([{ order: 0, name: "Foundation", agents: ["agent-1"] }]) });

		const snapshot = await createCheckpointSnapshot(project.id, "stage-test", randomUUID);

		expect(snapshot.stages.length).toBe(1);
		expect((snapshot.stages[0] as any).name).toBe("Foundation");
	});

	it("gracefully handles missing tables (no crash)", async () => {
		const project = await createProject({ name: "EmptyTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });

		const snapshot = await createCheckpointSnapshot(project.id, "empty-test", randomUUID);

		expect(snapshot).toBeDefined();
		expect(snapshot.run).toBeDefined();
		expect(snapshot.stages).toEqual([]);
		expect(snapshot.artifacts).toEqual([]);
		expect(snapshot.verificationReports).toEqual([]);
	});
});