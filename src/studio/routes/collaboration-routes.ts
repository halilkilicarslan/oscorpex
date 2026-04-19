// ---------------------------------------------------------------------------
// Oscorpex — Collaboration Routes (V6 M6 F11)
// Presence tracking endpoints for multi-user workspace collaboration.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { collaboration } from "../collaboration.js";

const router = new Hono();

// ---------------------------------------------------------------------------
// POST /collaboration/join
// Body: { projectId: string, userId: string, displayName: string, avatar?: string, activeTab?: string }
// ---------------------------------------------------------------------------

router.post("/join", async (c) => {
	try {
		const body = await c.req.json<{
			projectId: string;
			userId: string;
			displayName: string;
			avatar?: string;
			activeTab?: string;
		}>();

		if (!body.projectId || !body.userId || !body.displayName) {
			return c.json({ error: "projectId, userId, and displayName are required" }, 400);
		}

		const presence = collaboration.join(body.projectId, {
			userId: body.userId,
			displayName: body.displayName,
			avatar: body.avatar,
			activeTab: body.activeTab,
		});

		return c.json({ ok: true, presence });
	} catch (err) {
		console.error("[collaboration-routes] POST /join:", err);
		return c.json({ error: "Failed to join collaboration session" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /collaboration/leave
// Body: { projectId: string, userId: string }
// ---------------------------------------------------------------------------

router.post("/leave", async (c) => {
	try {
		const body = await c.req.json<{ projectId: string; userId: string }>();

		if (!body.projectId || !body.userId) {
			return c.json({ error: "projectId and userId are required" }, 400);
		}

		const removed = collaboration.leave(body.projectId, body.userId);
		return c.json({ ok: true, removed });
	} catch (err) {
		console.error("[collaboration-routes] POST /leave:", err);
		return c.json({ error: "Failed to leave collaboration session" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /collaboration/heartbeat
// Body: { projectId: string, userId: string }
// ---------------------------------------------------------------------------

router.post("/heartbeat", async (c) => {
	try {
		const body = await c.req.json<{ projectId: string; userId: string }>();

		if (!body.projectId || !body.userId) {
			return c.json({ error: "projectId and userId are required" }, 400);
		}

		const found = collaboration.heartbeat(body.projectId, body.userId);

		// If not found, user needs to re-join
		if (!found) {
			return c.json({ ok: false, rejoin: true });
		}

		return c.json({ ok: true });
	} catch (err) {
		console.error("[collaboration-routes] POST /heartbeat:", err);
		return c.json({ error: "Failed to process heartbeat" }, 500);
	}
});

// ---------------------------------------------------------------------------
// PATCH /collaboration/presence
// Body: { projectId: string, userId: string, activeTab?: string, displayName?: string, avatar?: string }
// ---------------------------------------------------------------------------

router.patch("/presence", async (c) => {
	try {
		const body = await c.req.json<{
			projectId: string;
			userId: string;
			activeTab?: string;
			displayName?: string;
			avatar?: string;
		}>();

		if (!body.projectId || !body.userId) {
			return c.json({ error: "projectId and userId are required" }, 400);
		}

		const presence = collaboration.updatePresence(body.projectId, body.userId, {
			activeTab: body.activeTab,
			displayName: body.displayName,
			avatar: body.avatar,
		});

		if (!presence) {
			return c.json({ error: "User not found in project — please re-join" }, 404);
		}

		return c.json({ ok: true, presence });
	} catch (err) {
		console.error("[collaboration-routes] PATCH /presence:", err);
		return c.json({ error: "Failed to update presence" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /collaboration/presence/:projectId
// Returns all active users in the given project.
// ---------------------------------------------------------------------------

router.get("/presence/:projectId", async (c) => {
	try {
		const { projectId } = c.req.param();

		if (!projectId) {
			return c.json({ error: "projectId is required" }, 400);
		}

		const presenceList = collaboration.getPresence(projectId);
		return c.json(presenceList);
	} catch (err) {
		console.error("[collaboration-routes] GET /presence/:projectId:", err);
		return c.json({ error: "Failed to fetch presence" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /collaboration/stats
// Returns global collaboration stats.
// ---------------------------------------------------------------------------

router.get("/stats", async (c) => {
	try {
		const stats = collaboration.getCollaborationStats();
		return c.json(stats);
	} catch (err) {
		console.error("[collaboration-routes] GET /stats:", err);
		return c.json({ error: "Failed to fetch collaboration stats" }, 500);
	}
});

export { router as collaborationRoutes };
