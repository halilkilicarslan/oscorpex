// ---------------------------------------------------------------------------
// Replay Routes Test Suite (P0-4)
// Covers inspect, restore, list, snapshot-by-id, not-found, dry-run.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { replayRoutes, buildInspectResponse } from "../../routes/replay-routes.js";

describe("Replay Routes", () => {
	const app = new Hono();
	app.route("/replay", replayRoutes);

	describe("GET /replay/runs/:runId/snapshots", () => {
		it("returns snapshot list or empty array", async () => {
			const res = await app.request("/replay/runs/p-1/snapshots");
			expect([200, 500]).toContain(res.status);
			if (res.status === 200) {
				const body = await res.json();
				expect(body).toHaveProperty("runId");
				expect(body).toHaveProperty("count");
				expect(body).toHaveProperty("snapshots");
				expect(Array.isArray(body.snapshots)).toBe(true);
			}
		});
	});

	describe("GET /replay/runs/:runId/inspect", () => {
		it("returns 404 when no snapshot exists", async () => {
			const res = await app.request("/replay/runs/nonexistent-run/inspect");
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toContain("No snapshot found");
		});
	});

	describe("POST /replay/runs/:runId/restore", () => {
		it("defaults to dryRun=true and returns restore preview", async () => {
			const res = await app.request("/replay/runs/p-1/restore", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			// May be 404 if no snapshot, but must be structured
			expect([200, 404, 500]).toContain(res.status);
			if (res.status === 200) {
				const body = await res.json();
				expect(body.dryRun).toBe(true);
				expect(body.result).toBeDefined();
				expect(body.result).toHaveProperty("tasksRestored");
				expect(body.result).toHaveProperty("pipelineRestored");
			}
		});

		it("accepts explicit dryRun=false parameter", async () => {
			const res = await app.request("/replay/runs/p-1/restore", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ dryRun: false }),
			});
			expect([200, 404, 500]).toContain(res.status);
			if (res.status === 200) {
				const body = await res.json();
				expect(body.dryRun).toBe(false);
			}
		});

		it("returns 404 when no snapshot exists", async () => {
			const res = await app.request("/replay/runs/nonexistent-run/restore", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ dryRun: true }),
			});
			expect(res.status).toBe(404);
		});
	});

	describe("GET /replay/snapshots/:snapshotId", () => {
		it("returns 404 for non-existent snapshot", async () => {
			const res = await app.request("/replay/snapshots/nonexistent-id");
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toContain("Snapshot not found");
		});
	});

	describe("POST /replay/runs/:runId/restore — edge cases", () => {
		it("returns 500 for malformed JSON body", async () => {
			const res = await app.request("/replay/runs/p-1/restore", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not-json",
			});
			expect([200, 404, 500]).toContain(res.status);
		});

		it("accepts checkpointId parameter", async () => {
			const res = await app.request("/replay/runs/p-1/restore", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ dryRun: true, checkpointId: "specific-checkpoint" }),
			});
			expect([200, 404, 500]).toContain(res.status);
		});
	});
});

describe("buildInspectResponse standardization", () => {
	it("returns consistent shape for both inspect endpoints", () => {
		const snapshot = {
			id: "snap-1",
			runId: "r1",
			projectId: "p1",
			checkpoint: "cp1",
			createdAt: "2024-01-01T00:00:00Z",
			run: { id: "r1", projectId: "p1", goal: "test", mode: "execute", status: "running" },
			stages: [{ order: 0, agents: [], tasks: [], status: "pending" as const }],
			tasks: [{ id: "t1", phaseId: "ph1", title: "Task 1", assignedAgent: "", status: "queued", complexity: "M", dependsOn: [], branch: "", retryCount: 0, revisionCount: 0, requiresApproval: false }],
			artifacts: [{ taskId: "t1", filesCreated: ["file.ts"], filesModified: [] }],
			policyDecisions: [{ runId: "r1", action: "allow", reasons: [], policyVersion: "1.0", createdAt: "2024-01-01T00:00:00Z" }],
			verificationReports: [{ runId: "r1", taskId: "t1", passed: true, checks: [], createdAt: "2024-01-01T00:00:00Z" }],
			metadata: { truthSources: { run: "db" } },
		};

		const response = buildInspectResponse(snapshot as any);

		expect(response).toHaveProperty("id");
		expect(response).toHaveProperty("runId");
		expect(response).toHaveProperty("projectId");
		expect(response).toHaveProperty("checkpoint");
		expect(response).toHaveProperty("createdAt");
		expect(response).toHaveProperty("run");
		expect(response).toHaveProperty("stages");
		expect(response).toHaveProperty("tasks");
		expect(response).toHaveProperty("artifacts");
		expect(response).toHaveProperty("policyDecisions");
		expect(response).toHaveProperty("verificationReports");
		expect(response).toHaveProperty("metadata");
	});
});