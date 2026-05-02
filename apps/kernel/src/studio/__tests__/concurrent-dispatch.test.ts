// ---------------------------------------------------------------------------
// Section 17 Regression Test: Concurrent Dispatch
// Verifies that SKIP LOCKED prevents duplicate task dispatch under concurrency.
// DB-backed — skips if database unavailable.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import { claimTask, createTask, getTask, releaseTaskClaim } from "../db.js";
import { execute, query } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM tasks LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available */
}

const PROJECT_ID = "concurrent-dispatch-test";
const PHASE_ID = "cd-phase-1";
const PLAN_ID = "cd-plan-1";

describe.skipIf(!dbReady)("Concurrent Dispatch — SKIP LOCKED", () => {
	beforeAll(async () => {
		// Clean up
		await execute("DELETE FROM tasks WHERE phase_id = $1", [PHASE_ID]);
		await execute("DELETE FROM phases WHERE id = $1", [PHASE_ID]);
		await execute("DELETE FROM project_plans WHERE id = $1", [PLAN_ID]);
		await execute("DELETE FROM projects WHERE id = $1", [PROJECT_ID]);

		// Seed project → plan → phase
		await execute(
			`INSERT INTO projects (id, name, description, status, created_at, updated_at)
			 VALUES ($1, 'Concurrent Test', 'test', 'planning', now(), now()) ON CONFLICT DO NOTHING`,
			[PROJECT_ID],
		);
		await execute(
			`INSERT INTO project_plans (id, project_id, version, status, created_at)
			 VALUES ($1, $2, 1, 'approved', now()) ON CONFLICT DO NOTHING`,
			[PLAN_ID, PROJECT_ID],
		);
		await execute(
			`INSERT INTO phases (id, plan_id, name, status, "order", depends_on)
			 VALUES ($1, $2, 'Phase 1', 'pending', 1, '[]') ON CONFLICT DO NOTHING`,
			[PHASE_ID, PLAN_ID],
		);
	});

	it("only one worker should claim a task when two compete simultaneously", async () => {
		// Create a queued task
		const task = await createTask({
			phaseId: PHASE_ID,
			title: "Concurrent target task",
			description: "Should only be claimed once",
			assignedAgent: "backend_dev",
			complexity: "S",
			dependsOn: [],
			branch: "main",
			projectId: PROJECT_ID,
		});

		// Two workers race to claim the same task
		const [claim1, claim2] = await Promise.all([claimTask(task.id, "worker-1"), claimTask(task.id, "worker-2")]);

		// Exactly one should succeed, the other gets null
		const claims = [claim1, claim2].filter(Boolean);
		expect(claims).toHaveLength(1);

		// The claimed task should be returned
		const claimedTask = claims[0]!;
		expect(claimedTask.id).toBe(task.id);

		// Clean up
		await releaseTaskClaim(task.id);
	});

	it("already claimed task cannot be claimed by another worker", async () => {
		const task = await createTask({
			phaseId: PHASE_ID,
			title: "Already claimed task",
			description: "Pre-claimed",
			assignedAgent: "backend_dev",
			complexity: "S",
			dependsOn: [],
			branch: "main",
			projectId: PROJECT_ID,
		});

		// First claim succeeds
		const first = await claimTask(task.id, "worker-A");
		expect(first).not.toBeNull();

		// Second claim fails
		const second = await claimTask(task.id, "worker-B");
		expect(second).toBeNull();

		await releaseTaskClaim(task.id);
	});

	it("released task can be claimed again", async () => {
		const task = await createTask({
			phaseId: PHASE_ID,
			title: "Release and reclaim",
			description: "test",
			assignedAgent: "backend_dev",
			complexity: "S",
			dependsOn: [],
			branch: "main",
			projectId: PROJECT_ID,
		});

		const first = await claimTask(task.id, "worker-X");
		expect(first).not.toBeNull();

		await releaseTaskClaim(task.id);

		const second = await claimTask(task.id, "worker-Y");
		expect(second).not.toBeNull();

		await releaseTaskClaim(task.id);
	});

	it("multiple tasks can be claimed independently by different workers", async () => {
		const t1 = await createTask({
			phaseId: PHASE_ID,
			title: "Task A",
			description: "a",
			assignedAgent: "backend_dev",
			complexity: "S",
			dependsOn: [],
			branch: "main",
			projectId: PROJECT_ID,
		});
		const t2 = await createTask({
			phaseId: PHASE_ID,
			title: "Task B",
			description: "b",
			assignedAgent: "frontend_dev",
			complexity: "S",
			dependsOn: [],
			branch: "main",
			projectId: PROJECT_ID,
		});

		const [c1, c2] = await Promise.all([claimTask(t1.id, "worker-1"), claimTask(t2.id, "worker-2")]);

		expect(c1).not.toBeNull();
		expect(c2).not.toBeNull();

		await releaseTaskClaim(t1.id);
		await releaseTaskClaim(t2.id);
	});
});
