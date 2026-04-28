// ---------------------------------------------------------------------------
// Control Plane — Operator Action Routes (thin host)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	executeOperatorAction,
	listOperatorActions,
	isQueuePaused,
	getOperatorFlag,
} from "@oscorpex/control-plane";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-operator-actions");

export const cpOperatorActionRoutes = new Hono();

const actionBodySchema = (actionType: string) => ({
	actionType,
	targetId: "string?",
	targetType: "string?",
	actor: "string",
	reason: "string",
	metadata: "object?",
});

function requireBody(c: any): { actionType: string; targetId?: string; targetType?: string; actor: string; reason: string; metadata?: Record<string, unknown> } {
	return c.req.json() as any;
}

function requireActorReason(body: any): { actor: string; reason: string } {
	if (!body.actor || !body.reason) {
		throw new Error("actor and reason are required");
	}
	return { actor: body.actor, reason: body.reason };
}

// Unified action endpoint
cpOperatorActionRoutes.post("/actions", async (c) => {
	try {
		const body = await requireBody(c);
		const { actor, reason } = requireActorReason(body);
		const result = await executeOperatorAction({
			actionType: body.actionType as any,
			targetId: body.targetId,
			targetType: body.targetType,
			actor,
			reason,
			metadata: body.metadata,
		});
		return c.json(result, result.status === "success" ? 200 : 400);
	} catch (err) {
		log.error("[operator-action] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

// Specific endpoints for convenience
cpOperatorActionRoutes.post("/actions/provider-disable", async (c) => {
	try {
		const { targetId, actor, reason } = await c.req.json() as any;
		if (!targetId || !actor || !reason) throw new Error("targetId, actor, and reason are required");
		const result = await executeOperatorAction({ actionType: "provider_disable", targetId, targetType: "provider", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[provider-disable] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

cpOperatorActionRoutes.post("/actions/provider-enable", async (c) => {
	try {
		const { targetId, actor, reason } = await c.req.json() as any;
		if (!targetId || !actor || !reason) throw new Error("targetId, actor, and reason are required");
		const result = await executeOperatorAction({ actionType: "provider_enable", targetId, targetType: "provider", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[provider-enable] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

cpOperatorActionRoutes.post("/actions/retry-task", async (c) => {
	try {
		const { targetId, actor, reason } = await c.req.json() as any;
		if (!targetId || !actor || !reason) throw new Error("targetId, actor, and reason are required");
		const result = await executeOperatorAction({ actionType: "retry_task", targetId, targetType: "task", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[retry-task] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

cpOperatorActionRoutes.post("/actions/cancel-task", async (c) => {
	try {
		const { targetId, actor, reason } = await c.req.json() as any;
		if (!targetId || !actor || !reason) throw new Error("targetId, actor, and reason are required");
		const result = await executeOperatorAction({ actionType: "cancel_task", targetId, targetType: "task", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[cancel-task] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

cpOperatorActionRoutes.post("/actions/pause-queue", async (c) => {
	try {
		const { actor, reason } = await c.req.json() as any;
		if (!actor || !reason) throw new Error("actor and reason are required");
		const result = await executeOperatorAction({ actionType: "pause_queue", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[pause-queue] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

cpOperatorActionRoutes.post("/actions/resume-queue", async (c) => {
	try {
		const { actor, reason } = await c.req.json() as any;
		if (!actor || !reason) throw new Error("actor and reason are required");
		const result = await executeOperatorAction({ actionType: "resume_queue", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[resume-queue] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

cpOperatorActionRoutes.post("/actions/reset-cooldown", async (c) => {
	try {
		const { targetId, actor, reason } = await c.req.json() as any;
		if (!targetId || !actor || !reason) throw new Error("targetId, actor, and reason are required");
		const result = await executeOperatorAction({ actionType: "reset_cooldown", targetId, targetType: "provider", actor, reason });
		return c.json(result);
	} catch (err) {
		log.error("[reset-cooldown] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

// List actions
cpOperatorActionRoutes.get("/actions", async (c) => {
	try {
		const limit = Number(c.req.query("limit") ?? "100");
		const actions = await listOperatorActions(limit);
		return c.json({ actions });
	} catch (err) {
		log.error("[operator-actions] list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// Flags
cpOperatorActionRoutes.get("/flags/:key", async (c) => {
	try {
		const flag = await getOperatorFlag(c.req.param("key"));
		if (!flag) return c.json({ error: "Flag not found" }, 404);
		return c.json({ flag });
	} catch (err) {
		log.error("[operator-flags] get failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpOperatorActionRoutes.get("/flags/queue-paused", async (c) => {
	try {
		const paused = await isQueuePaused();
		return c.json({ paused });
	} catch (err) {
		log.error("[operator-flags] queue check failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
