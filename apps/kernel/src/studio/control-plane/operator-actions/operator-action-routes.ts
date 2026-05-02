// ---------------------------------------------------------------------------
// Control Plane — Operator Action Routes (thin host)
// ---------------------------------------------------------------------------

import type { OperatorActionType } from "@oscorpex/control-plane";
import { executeOperatorAction, getOperatorFlag, isQueuePaused, listOperatorActions } from "@oscorpex/control-plane";
import type { Context } from "hono";
import { Hono } from "hono";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-operator-actions");

export const cpOperatorActionRoutes = new Hono();

function requireActorReason(body: Record<string, unknown>): { actor: string; reason: string } {
	if (!body.actor || typeof body.actor !== "string") {
		throw new Error("actor is required and must be a string");
	}
	if (!body.reason || typeof body.reason !== "string") {
		throw new Error("reason is required and must be a string");
	}
	return { actor: body.actor, reason: body.reason };
}

function createActionHandler(actionType: OperatorActionType): (c: Context) => Promise<Response> {
	return async (c) => {
		try {
			const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
			const { targetId, metadata } = body;
			if (targetId !== undefined && typeof targetId !== "string") {
				return c.json({ error: "targetId must be a string" }, 400);
			}
			const { actor, reason } = requireActorReason(body);
			const result = await executeOperatorAction({
				actionType,
				targetId: targetId as string | undefined,
				actor,
				reason,
				metadata: metadata as Record<string, unknown> | undefined,
			});
			return c.json(result);
		} catch (err) {
			log.error(`[${actionType}] failed: ${String(err)}`);
			return c.json({ error: String(err) }, 400);
		}
	};
}

// Unified action endpoint
cpOperatorActionRoutes.post("/actions", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const { actionType, targetId, targetType, metadata } = body;
		if (!actionType || typeof actionType !== "string") {
			return c.json({ error: "actionType is required and must be a string" }, 400);
		}
		if (targetId !== undefined && typeof targetId !== "string") {
			return c.json({ error: "targetId must be a string" }, 400);
		}
		const { actor, reason } = requireActorReason(body);
		const result = await executeOperatorAction({
			actionType: actionType as OperatorActionType,
			targetId: targetId as string | undefined,
			targetType: targetType as string | undefined,
			actor,
			reason,
			metadata: metadata as Record<string, unknown> | undefined,
		});
		return c.json(result, result.status === "success" ? 200 : 400);
	} catch (err) {
		log.error("[operator-action] failed: " + String(err));
		return c.json({ error: String(err) }, 400);
	}
});

// Specific endpoints for convenience
cpOperatorActionRoutes.post("/actions/provider-disable", createActionHandler("provider_disable"));
cpOperatorActionRoutes.post("/actions/provider-enable", createActionHandler("provider_enable"));
cpOperatorActionRoutes.post("/actions/retry-task", createActionHandler("retry_task"));
cpOperatorActionRoutes.post("/actions/cancel-task", createActionHandler("cancel_task"));
cpOperatorActionRoutes.post("/actions/pause-queue", createActionHandler("pause_queue"));
cpOperatorActionRoutes.post("/actions/resume-queue", createActionHandler("resume_queue"));
cpOperatorActionRoutes.post("/actions/reset-cooldown", createActionHandler("reset_cooldown"));

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
