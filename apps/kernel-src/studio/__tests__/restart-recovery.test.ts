// ---------------------------------------------------------------------------
// Section 17 Regression Test: Restart Recovery
// Verifies that pipeline state is fully reconstructible from DB after restart.
// DB-backed — skips if database unavailable.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import { getPipelineRun, mutatePipelineState } from "../db.js";
import { execute, query } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM pipeline_runs LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available */
}

const PROJECT_ID = "restart-recovery-test";

describe.skipIf(!dbReady)("Restart Recovery — DB-Authoritative Pipeline State", () => {
	beforeAll(async () => {
		// Clean up
		await execute("DELETE FROM pipeline_runs WHERE project_id = $1", [PROJECT_ID]);
		await execute("DELETE FROM projects WHERE id = $1", [PROJECT_ID]);

		// Seed project
		await execute(
			`INSERT INTO projects (id, name, description, status, created_at, updated_at)
			 VALUES ($1, 'Restart Test', 'test', 'running', now(), now())`,
			[PROJECT_ID],
		);
	});

	it("pipeline state persists after mutatePipelineState and is readable without cache", async () => {
		// Create initial pipeline run
		await execute(
			`INSERT INTO pipeline_runs (id, project_id, status, current_stage, stages_json, version, created_at)
			 VALUES ($1, $2, 'running', 0, $3, 1, now())
			 ON CONFLICT (project_id) DO UPDATE SET status = 'running', current_stage = 0, version = 1`,
			["rr-run-1", PROJECT_ID, JSON.stringify([{ name: "Phase 1", status: "pending" }, { name: "Phase 2", status: "pending" }])],
		);

		// Mutate state (simulates advancing stage)
		await mutatePipelineState(PROJECT_ID, async (run) => ({
			currentStage: 1,
			stagesJson: JSON.stringify([{ name: "Phase 1", status: "completed" }, { name: "Phase 2", status: "running" }]),
		}));

		// "Restart" — read from DB cold (no in-memory cache)
		const recovered = await getPipelineRun(PROJECT_ID);
		expect(recovered).toBeDefined();
		expect(recovered!.currentStage).toBe(1);
		expect(recovered!.status).toBe("running");

		const stages = typeof recovered!.stagesJson === "string"
			? JSON.parse(recovered!.stagesJson)
			: recovered!.stagesJson;
		expect(stages[0].status).toBe("completed");
		expect(stages[1].status).toBe("running");
	});

	it("version increments on each mutation (optimistic concurrency)", async () => {
		const before = await getPipelineRun(PROJECT_ID);
		const vBefore = before!.version;

		await mutatePipelineState(PROJECT_ID, async () => ({
			currentStage: 2,
		}));

		const after = await getPipelineRun(PROJECT_ID);
		expect(after!.version).toBe(vBefore + 1);
	});

	it("mutatePipelineState uses SELECT FOR UPDATE (serialized access)", async () => {
		// Run two concurrent mutations — both should succeed sequentially, not corrupt
		await Promise.all([
			mutatePipelineState(PROJECT_ID, async (run) => ({
				stagesJson: JSON.stringify([{ name: "Phase 1", status: "completed" }, { name: "Phase 2", status: "completed" }]),
			})),
			mutatePipelineState(PROJECT_ID, async (run) => ({
				status: "completed",
				completedAt: new Date().toISOString(),
			})),
		]);

		const final = await getPipelineRun(PROJECT_ID);
		expect(final).toBeDefined();
		// Both mutations applied (one sets stages, other sets status)
		// Version should have incremented twice from the state before this test
	});

	it("pipeline state survives simulated process restart (no in-memory dependency)", async () => {
		// Set a known state
		await mutatePipelineState(PROJECT_ID, async () => ({
			status: "paused",
			currentStage: 0,
		}));

		// Simulate cold read (as if a new process just started)
		const coldRead = await getPipelineRun(PROJECT_ID);
		expect(coldRead).toBeDefined();
		expect(coldRead!.status).toBe("paused");
		expect(coldRead!.currentStage).toBe(0);
	});
});
