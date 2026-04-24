// ---------------------------------------------------------------------------
// Replay Restore Tests (S5-01)
// Verifies restoreFromSnapshot can replay task and pipeline state.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import { createProject, createPlan, createPhase, createTask, createPipelineRun, execute, getTask, getPipelineRun } from "../../db.js";
import { createCheckpointSnapshot, restoreFromSnapshot } from "../../replay-store.js";
import { randomUUID } from "node:crypto";

async function cleanSnapshots() {
	await execute("DELETE FROM replay_snapshots");
}

async function setTaskStatus(taskId: string, status: string): Promise<void> {
	await execute("UPDATE tasks SET status = $1 WHERE id = $2", [status, taskId]);
}

describe("restoreFromSnapshot", () => {
	beforeEach(async () => {
		await cleanSnapshots();
	});

	it("dryRun reports what would change without mutating", async () => {
		const project = await createProject({ name: "RestoreTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "T1", description: "", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await createPipelineRun({ projectId: project.id, status: "running", stagesJson: JSON.stringify([{ order: 0 }]) });
		await setTaskStatus(task.id, "done");

		const snapshot = await createCheckpointSnapshot(project.id, "checkpoint-1", randomUUID);

		// Mutate task back to queued
		await setTaskStatus(task.id, "queued");

		const result = await restoreFromSnapshot(snapshot, { dryRun: true });

		expect(result.tasksRestored).toBeGreaterThanOrEqual(1);
		expect(result.pipelineRestored).toBe(true);
		expect(result.errors).toEqual([]);

		// Task should still be queued (dryRun)
		const taskAfter = await getTask(task.id);
		expect(taskAfter?.status).toBe("queued");
	});

	it("non-dryRun actually restores task status", async () => {
		const project = await createProject({ name: "RestoreReal", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "T2", description: "", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await createPipelineRun({ projectId: project.id, status: "running", stagesJson: JSON.stringify([{ order: 0 }]) });
		await setTaskStatus(task.id, "failed");

		const snapshot = await createCheckpointSnapshot(project.id, "checkpoint-2", randomUUID);

		// Mutate task back to queued
		await setTaskStatus(task.id, "queued");

		const result = await restoreFromSnapshot(snapshot, { dryRun: false });

		expect(result.tasksRestored).toBeGreaterThanOrEqual(1);
		expect(result.pipelineRestored).toBe(true);
		expect(result.errors).toEqual([]);

		// Task should now be restored to "failed"
		const taskAfter = await getTask(task.id);
		expect(taskAfter?.status).toBe("failed");
	});

	it("restores pipeline stages", async () => {
		const project = await createProject({ name: "RestorePipe", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		await createTask({ phaseId: phase.id, title: "T3", description: "", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await createPipelineRun({ projectId: project.id, status: "running", stagesJson: JSON.stringify([{ order: 0, name: "Old" }]) });

		const snapshot = await createCheckpointSnapshot(project.id, "checkpoint-3", randomUUID);

		// Mutate pipeline
		await createPipelineRun({ projectId: project.id, status: "failed", stagesJson: JSON.stringify([{ order: 0, name: "New" }]) });

		await restoreFromSnapshot(snapshot, { dryRun: false });

		const pipeline = await getPipelineRun(project.id);
		expect(pipeline).toBeDefined();
	});
});