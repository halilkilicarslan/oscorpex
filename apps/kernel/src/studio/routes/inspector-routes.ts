// ---------------------------------------------------------------------------
// Oscorpex — Inspector Routes
// GET /projects/:projectId/tasks/:taskId/inspector
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { createLogger } from "../logger.js";
import { getTaskSessionInspector } from "../inspector/index.js";

const log = createLogger("inspector-routes");
const router = new Hono();

router.get("/projects/:projectId/tasks/:taskId/inspector", async (c) => {
	const projectId = c.req.param("projectId");
	const taskId = c.req.param("taskId");

	try {
		const inspector = await getTaskSessionInspector(projectId, taskId);
		if (!inspector) {
			return c.json({ error: "Task not found" }, 404);
		}
		return c.json({ data: inspector });
	} catch (err) {
		log.error({ err, projectId, taskId }, "inspector request failed");
		return c.json({ error: "Internal server error" }, 500);
	}
});

export { router as inspectorRoutes };
