// ---------------------------------------------------------------------------
// Oscorpex — Replay Routes
// Provides inspect, list, and restore operations for replay snapshots.
// Makes the replay/restore strategy visible as API endpoints.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getCurrentCorrelationId } from "../correlation-context.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { replayStore } from "../replay-store.js";
import { restoreFromSnapshot } from "../replay-store.js";
const log = createLogger("replay-routes");

export const replayRoutes = new Hono();

// GET /replay/runs/:runId/snapshots — list snapshots for a run
replayRoutes.get("/runs/:runId/snapshots", async (c) => {
	try {
		const runId = c.req.param("runId");
		const limit = Number(c.req.query("limit") ?? "50");
		const snapshots = await replayStore.listSnapshots(runId, limit);
		return c.json({
			runId,
			count: snapshots.length,
			snapshots: snapshots.map((s) => ({
				id: s.id,
				checkpoint: s.checkpoint,
				createdAt: s.createdAt,
				taskCount: s.tasks?.length ?? 0,
				artifactCount: s.artifacts?.length ?? 0,
				policyDecisionCount: s.policyDecisions?.length ?? 0,
				verificationReportCount: s.verificationReports?.length ?? 0,
			})),
		});
	} catch (err) {
		log.error({ err }, "[replay-routes] list snapshots failed");
		return c.json({ error: String(err) }, 500);
	}
});

// GET /replay/snapshots/:snapshotId — inspect a single snapshot by ID
replayRoutes.get("/snapshots/:snapshotId", async (c) => {
	try {
		const snapshotId = c.req.param("snapshotId");
		const snapshot = await replayStore.getSnapshotById(snapshotId);
		if (!snapshot) {
			return c.json({ error: "Snapshot not found" }, 404);
		}

		return c.json(buildInspectResponse(snapshot));
	} catch (err) {
		log.error({ err }, "[replay-routes] inspect snapshot failed");
		return c.json({ error: String(err) }, 500);
	}
});

// POST /replay/runs/:runId/restore — restore from latest snapshot (dry-run by default)
// Authorization: only project owners or admins can perform real (dryRun=false) restores.
replayRoutes.post("/runs/:runId/restore", async (c) => {
	try {
		const runId = c.req.param("runId");
		const body = await c.req.json().catch(() => ({}));
		const dryRun = body.dryRun !== false; // default true for safety
		const checkpointId = body.checkpointId as string | undefined;

		const snapshot = await replayStore.getSnapshot(runId, checkpointId);
		if (!snapshot) {
			return c.json({ error: "No snapshot found for run" }, 404);
		}

		// Actor metadata from request context
		const actor = {
			ip: c.req.header("x-forwarded-for") ?? "unknown",
			// tenant auth context — populated by auth middleware when enabled
			userId: (c as any).get?.("userId") ?? "anonymous",
			role: (c as any).get?.("userRole") ?? "unknown",
		};

		// Authorization gate: real restore requires elevated role
		if (!dryRun && actor.role !== "admin" && actor.role !== "owner") {
			log.warn(
				{ runId, projectId: snapshot.projectId, actor, correlationId: getCurrentCorrelationId() },
				"[replay-routes] Restore denied — insufficient role",
			);
			return c.json({ error: "Restore denied: admin or owner role required" }, 403);
		}

		const result = await restoreFromSnapshot(snapshot, { dryRun });

		// Audit event
		eventBus.emitTransient({
			projectId: snapshot.projectId,
			type: "task:completed", // Using existing EventType for audit trail
			payload: {
				action: "replay_restore",
				runId,
				snapshotId: snapshot.id,
				dryRun,
				actor,
				correlationId: getCurrentCorrelationId(),
			},
		});

		log.info(
			{ runId, projectId: snapshot.projectId, dryRun, actor, correlationId: getCurrentCorrelationId() },
			"[replay-routes] Restore completed",
		);

		return c.json({
			success: true,
			dryRun,
			actor,
			restoredFrom: {
				id: snapshot.id,
				checkpoint: snapshot.checkpoint,
				createdAt: snapshot.createdAt,
			},
			result,
		});
	} catch (err) {
		log.error({ err, correlationId: getCurrentCorrelationId() }, "[replay-routes] restore failed");
		return c.json({ error: String(err) }, 500);
	}
});

// GET /replay/runs/:runId/inspect — inspect current replayable state
replayRoutes.get("/runs/:runId/inspect", async (c) => {
	try {
		const runId = c.req.param("runId");
		const snapshot = await replayStore.getSnapshot(runId);
		if (!snapshot) {
			return c.json({ error: "No snapshot found for run" }, 404);
		}

		return c.json(buildInspectResponse(snapshot));
	} catch (err) {
		log.error({ err }, "[replay-routes] inspect failed");
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Standardized inspect response builder
// ---------------------------------------------------------------------------

export function buildInspectResponse(snapshot: import("@oscorpex/core").ReplaySnapshot) {
	return {
		id: snapshot.id,
		runId: snapshot.runId,
		projectId: snapshot.projectId,
		checkpoint: snapshot.checkpoint,
		createdAt: snapshot.createdAt,
		run: snapshot.run,
		stages: snapshot.stages ?? [],
		tasks: snapshot.tasks ?? [],
		artifacts: snapshot.artifacts ?? [],
		policyDecisions: snapshot.policyDecisions ?? [],
		verificationReports: snapshot.verificationReports ?? [],
		metadata: snapshot.metadata ?? {},
	};
}
