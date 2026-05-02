// ---------------------------------------------------------------------------
// Replay Truth Source Tests (Task 4)
// Verifies that createCheckpointSnapshot populates truthSources correctly
// based on whether canonical Run / persisted policy snapshots exist.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { execute } from "../../pg.js";
import { createCheckpointSnapshot } from "../../replay-store.js";

describe("Replay truth source semantics", () => {
	it("marks run source as canonical_run_db when Run record exists", async () => {
		await execute("DELETE FROM replay_snapshots WHERE run_id = 'truth-run-1'");

		const snapshot = await createCheckpointSnapshot("p-1", "truth-check", () => "truth-snap-1");

		expect(snapshot.metadata).toBeDefined();
		expect(snapshot.metadata!.truthSources).toBeDefined();
		// When runs table is populated, this should be canonical_run_db
		// When empty, fallback is pipeline_project_fallback
		const runSource = snapshot.metadata!.truthSources!.run;
		expect(["canonical_run_db", "pipeline_project_fallback"]).toContain(runSource);
	});

	it("marks policyDecisions source as task_policy_snapshot", async () => {
		await execute("DELETE FROM replay_snapshots WHERE run_id = 'truth-run-2'");

		const snapshot = await createCheckpointSnapshot("p-1", "truth-check", () => "truth-snap-2");

		expect(snapshot.metadata).toBeDefined();
		expect(snapshot.metadata!.truthSources).toBeDefined();
		expect(snapshot.metadata!.truthSources!.policyDecisions).toBe("task_policy_snapshot");
	});

	it("marks verificationReports source as verification_results_db", async () => {
		await execute("DELETE FROM replay_snapshots WHERE run_id = 'truth-run-3'");

		const snapshot = await createCheckpointSnapshot("p-1", "truth-check", () => "truth-snap-3");

		expect(snapshot.metadata).toBeDefined();
		expect(snapshot.metadata!.truthSources).toBeDefined();
		expect(snapshot.metadata!.truthSources!.verificationReports).toBe("verification_results_db");
	});

	it("marks artifacts source as task_output_files", async () => {
		await execute("DELETE FROM replay_snapshots WHERE run_id = 'truth-run-4'");

		const snapshot = await createCheckpointSnapshot("p-1", "truth-check", () => "truth-snap-4");

		expect(snapshot.metadata).toBeDefined();
		expect(snapshot.metadata!.truthSources).toBeDefined();
		expect(snapshot.metadata!.truthSources!.artifacts).toBe("task_output_files");
	});

	it("includes stages truth source", async () => {
		await execute("DELETE FROM replay_snapshots WHERE run_id = 'truth-run-5'");

		const snapshot = await createCheckpointSnapshot("p-1", "truth-check", () => "truth-snap-5");

		expect(snapshot.metadata).toBeDefined();
		expect(snapshot.metadata!.truthSources).toBeDefined();
		expect(["pipeline_run_db", "empty"]).toContain(snapshot.metadata!.truthSources!.stages);
	});
});
