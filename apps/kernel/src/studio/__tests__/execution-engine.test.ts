// ---------------------------------------------------------------------------
// Execution Engine tests
//  - recoverStuckTasks: resets running/assigned → queued, revives failed phases
//  - getExecutionStatus: returns task progress for a project
//
// Notes: recoverStuckTasks calls startProjectExecution which would attempt CLI
// dispatch; that call is fire-and-forget with an error swallower, so tests
// can verify DB state changes without requiring an AI runtime.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import {
	createPhase,
	createPlan,
	createProject,
	createTask,
	getTask,
	listPhases,
	updatePhaseStatus,
	updatePlanStatus,
	updateProject,
	updateTask,
} from "../db.js";
import { executionEngine } from "../execution-engine.js";
import { execute } from "../pg.js";

describe("Execution Engine", () => {
	beforeAll(async () => {
		await execute("DELETE FROM chat_messages");
		await execute("DELETE FROM events");
		await execute("DELETE FROM tasks");
		await execute("DELETE FROM phases");
		await execute("DELETE FROM project_plans");
		await execute("DELETE FROM project_agents");
		await execute("DELETE FROM projects WHERE name LIKE 'EE Test%'");
	});

	async function setupRunningProject(opts?: {
		phaseStatus?: "running" | "failed" | "completed";
		taskStatuses?: Array<"running" | "assigned" | "queued" | "revision">;
	}) {
		const project = await createProject({
			name: `EE Test ${Date.now()}-${Math.random()}`,
			description: "",
			techStack: [],
			repoPath: "",
		});
		await updateProject(project.id, { status: "running" });

		const plan = await createPlan(project.id);
		await updatePlanStatus(plan.id, "approved");

		const phase = await createPhase({
			planId: plan.id,
			name: "Foundation",
			order: 1,
			dependsOn: [],
		});
		await updatePhaseStatus(phase.id, opts?.phaseStatus ?? "running");

		// First task has no deps; later tasks depend on prior ones so auto-dispatch
		// after recovery only picks up already-reset tasks (and can't actually
		// execute without a CLI — dispatch is fire-and-forget with error swallowing).
		const tasks = [];
		const statuses = opts?.taskStatuses ?? ["running"];
		for (const [i, status] of statuses.entries()) {
			// Make every task depend on a phantom id so no task is ever "ready"
			// during recovery dispatch — we only care that states are reset.
			const task = await createTask({
				phaseId: phase.id,
				title: `Task ${i}`,
				description: "",
				assignedAgent: "coder",
				complexity: "S",
				dependsOn: ["phantom-dep-that-never-resolves"],
				branch: `feat/t${i}`,
			});
			await updateTask(task.id, { status });
			tasks.push(task);
		}

		return { project, plan, phase, tasks };
	}

	// ---- recoverStuckTasks --------------------------------------------------

	describe("recoverStuckTasks", () => {
		it("resets running tasks in running phases back to queued", async () => {
			const { tasks } = await setupRunningProject({
				phaseStatus: "running",
				taskStatuses: ["running", "assigned"],
			});

			await executionEngine.recoverStuckTasks();

			for (const t of tasks) {
				const fresh = await getTask(t.id);
				expect(fresh?.status).toBe("queued");
				expect(fresh?.startedAt).toBeUndefined();
			}
		});

		it("revives failed phases with stuck tasks back to running", async () => {
			const { phase, plan } = await setupRunningProject({
				phaseStatus: "failed",
				taskStatuses: ["running"],
			});

			await executionEngine.recoverStuckTasks();

			const phases = await listPhases(plan.id);
			const refreshed = phases.find((p) => p.id === phase.id);
			expect(refreshed?.status).toBe("running");
		});

		it("leaves completed phases and their tasks untouched", async () => {
			const { phase, plan, tasks } = await setupRunningProject({
				phaseStatus: "completed",
				taskStatuses: ["queued"],
			});
			// Intentionally mark phase completed + task queued (simulating a review
			// task orphaned in a completed phase). recoverStuckTasks should not
			// downgrade phase status, though it may dispatch the orphan.
			await executionEngine.recoverStuckTasks();

			const phases = await listPhases(plan.id);
			const freshPhase = phases.find((p) => p.id === phase.id);
			expect(freshPhase?.status).toBe("completed");
			const freshTask = await getTask(tasks[0].id);
			// queued task remains queued (dispatch is async fire-and-forget)
			expect(["queued", "assigned", "running"]).toContain(freshTask?.status);
		});

		it("ignores projects not in 'running' status", async () => {
			const { project, tasks } = await setupRunningProject({
				phaseStatus: "running",
				taskStatuses: ["running"],
			});
			// Put the project into paused — recoverStuckTasks should skip it.
			await updateProject(project.id, { status: "paused" });

			await executionEngine.recoverStuckTasks();

			const fresh = await getTask(tasks[0].id);
			expect(fresh?.status).toBe("running"); // unchanged
		});
	});

	// ---- getExecutionStatus -------------------------------------------------

	describe("getExecutionStatus", () => {
		it("returns project progress snapshot", async () => {
			const { project } = await setupRunningProject({
				phaseStatus: "running",
				taskStatuses: ["queued"],
			});

			const status = await executionEngine.getExecutionStatus(project.id);

			expect(status.projectId).toBe(project.id);
			expect(status.runtimes).toEqual([]);
			expect(status.progress).toBeDefined();
		});
	});
});
