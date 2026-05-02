// ---------------------------------------------------------------------------
// Oscorpex — Notification Routes (V6 M1)
// Endpoints for in-app notification management.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	countUnread,
	deleteNotification,
	listNotifications,
	markAllNotificationsAsRead,
	markNotificationAsRead,
} from "../db.js";
import { createLogger } from "../logger.js";
const log = createLogger("notification-routes");

const router = new Hono();

// ---------------------------------------------------------------------------
// GET /notifications — list notifications
// Query params: projectId, unreadOnly, limit, offset
// ---------------------------------------------------------------------------

router.get("/", async (c) => {
	try {
		const projectId = c.req.query("projectId");
		const unreadOnly = c.req.query("unreadOnly") === "true";
		const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
		const offset = Number(c.req.query("offset") ?? "0");
		const userId = (c.var as Record<string, unknown>)["userId"] as string | undefined;

		const notifications = await listNotifications({
			userId,
			projectId: projectId ?? undefined,
			unreadOnly,
			limit,
			offset,
		});
		return c.json(notifications);
	} catch (err) {
		log.error("[notification-routes] GET /notifications:" + " " + String(err));
		return c.json({ error: "Failed to fetch notifications" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /notifications/unread-count
// ---------------------------------------------------------------------------

router.get("/unread-count", async (c) => {
	try {
		const projectId = c.req.query("projectId") ?? undefined;
		const userId = (c.var as Record<string, unknown>)["userId"] as string | undefined;
		const count = await countUnread({ userId, projectId });
		return c.json({ count });
	} catch (err) {
		log.error("[notification-routes] GET /unread-count:" + " " + String(err));
		return c.json({ error: "Failed to fetch unread count" }, 500);
	}
});

// ---------------------------------------------------------------------------
// PATCH /notifications/:id/read
// ---------------------------------------------------------------------------

router.patch("/:id/read", async (c) => {
	try {
		await markNotificationAsRead(c.req.param("id"));
		return c.json({ ok: true });
	} catch (err) {
		log.error("[notification-routes] PATCH /:id/read:" + " " + String(err));
		return c.json({ error: "Failed to mark notification as read" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /notifications/mark-all-read
// ---------------------------------------------------------------------------

router.post("/mark-all-read", async (c) => {
	try {
		const projectId = c.req.query("projectId") ?? undefined;
		const userId = (c.var as Record<string, unknown>)["userId"] as string | undefined;
		await markAllNotificationsAsRead({ userId, projectId });
		return c.json({ ok: true });
	} catch (err) {
		log.error("[notification-routes] POST /mark-all-read:" + " " + String(err));
		return c.json({ error: "Failed to mark all as read" }, 500);
	}
});

// ---------------------------------------------------------------------------
// DELETE /notifications/:id
// ---------------------------------------------------------------------------

router.delete("/:id", async (c) => {
	try {
		await deleteNotification(c.req.param("id"));
		return c.json({ ok: true });
	} catch (err) {
		log.error("[notification-routes] DELETE /:id:" + " " + String(err));
		return c.json({ error: "Failed to delete notification" }, 500);
	}
});

export { router as notificationRoutes };
