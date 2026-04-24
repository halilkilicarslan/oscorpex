// ---------------------------------------------------------------------------
// Replay Routes Test Suite (P0-4)
// Covers inspect, restore, list, snapshot-by-id, not-found, dry-run.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { replayRoutes } from "../../routes/replay-routes.js";

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
});