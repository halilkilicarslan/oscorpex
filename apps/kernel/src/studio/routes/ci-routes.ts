// ---------------------------------------------------------------------------
// Oscorpex — CI Routes (V6 M3)
// Endpoints for CI tracking: status, webhook receivers, manual track.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { ciTracker } from "../ci-tracker.js";
import { createCITracking, getCITrackings } from "../db.js";
import type { CIProvider } from "../db.js";
import { createLogger } from "../logger.js";
const log = createLogger("ci-routes");

const router = new Hono();

// ---------------------------------------------------------------------------
// GET /ci/status/:projectId — list all CI trackings for a project
// ---------------------------------------------------------------------------

router.get("/status/:projectId", async (c) => {
	try {
		const { projectId } = c.req.param();
		const trackings = await getCITrackings(projectId);
		return c.json(trackings);
	} catch (err) {
		log.error("[ci-routes] GET /ci/status/:projectId:" + " " + String(err));
		return c.json({ error: "Failed to fetch CI trackings" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /ci/track — manual PR tracking
// Body: { projectId, provider, prId, prUrl?, pipelineUrl? }
// ---------------------------------------------------------------------------

router.post("/track", async (c) => {
	try {
		const body = await c.req.json<{
			projectId?: string;
			provider?: string;
			prId?: string;
			prUrl?: string;
			pipelineUrl?: string;
		}>();

		if (!body.projectId || !body.provider || !body.prId) {
			return c.json({ error: "projectId, provider, and prId are required" }, 400);
		}

		const validProviders: CIProvider[] = ["github", "gitlab"];
		if (!validProviders.includes(body.provider as CIProvider)) {
			return c.json({ error: "provider must be 'github' or 'gitlab'" }, 400);
		}

		const result = await ciTracker.trackPR({
			projectId: body.projectId,
			provider: body.provider as CIProvider,
			prId: body.prId,
			prUrl: body.prUrl,
			pipelineUrl: body.pipelineUrl,
		});

		return c.json(result.tracking, 201);
	} catch (err) {
		log.error("[ci-routes] POST /ci/track:" + " " + String(err));
		return c.json({ error: "Failed to create CI tracking" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /ci/webhook/github — GitHub webhook receiver
// Headers expected: X-GitHub-Event, X-Hub-Signature-256
// Body: GitHub webhook JSON payload
// ---------------------------------------------------------------------------

router.post("/webhook/github", async (c) => {
	try {
		const payload = await c.req.json<Record<string, unknown>>();
		const projectId = c.req.query("projectId") ?? undefined;

		const updated = await ciTracker.processWebhook("github", payload, projectId);

		return c.json({ ok: true, updated: updated ?? null });
	} catch (err) {
		log.error("[ci-routes] POST /ci/webhook/github:" + " " + String(err));
		return c.json({ error: "Failed to process GitHub webhook" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /ci/webhook/gitlab — GitLab webhook receiver
// Headers expected: X-Gitlab-Token
// Body: GitLab pipeline/MR webhook JSON payload
// ---------------------------------------------------------------------------

router.post("/webhook/gitlab", async (c) => {
	try {
		const payload = await c.req.json<Record<string, unknown>>();
		const projectId = c.req.query("projectId") ?? undefined;

		const updated = await ciTracker.processWebhook("gitlab", payload, projectId);

		return c.json({ ok: true, updated: updated ?? null });
	} catch (err) {
		log.error("[ci-routes] POST /ci/webhook/gitlab:" + " " + String(err));
		return c.json({ error: "Failed to process GitLab webhook" }, 500);
	}
});

export { router as ciRoutes };
