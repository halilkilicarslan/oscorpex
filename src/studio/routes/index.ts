// ---------------------------------------------------------------------------
// Oscorpex — Modular Route Index
// Tüm sub-router'ları birleştirir ve studioRoutes olarak export eder.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import { initContextSession } from "../context-session.js";
import { processEventForNotification } from "../notification-service.js";
import { seedPresetAgents, seedTeamTemplates } from "../db.js";
import { eventBus } from "../event-bus.js";
import { budgetGuard } from "../middleware/policy-middleware.js";
import { notifyPlugins, pluginRegistry } from "../plugin-registry.js";
import type { EventType } from "../types.js";
import { sendWebhookNotification } from "../webhook-sender.js";

import { agentRoutes } from "./agent-routes.js";
import { notificationRoutes } from "./notification-routes.js";
import { analyticsRoutes } from "./analytics-routes.js";
import authRoutes from "./auth-routes.js";
import { ceremonyRoutes } from "./ceremony-routes.js";
import { cliUsageRoutes } from "./cli-usage-routes.js";
import { gitFileRoutes } from "./git-file-routes.js";
import { integrationRoutes } from "./integration-routes.js";
import { lifecycleRoutes } from "./lifecycle-routes.js";
import { memoryRoutes } from "./memory-routes.js";
import { pipelineRoutes } from "./pipeline-routes.js";
import pluginRoutes from "./plugin-routes.js";
import { projectRoutes } from "./project-routes.js";
import { providerRoutes } from "./provider-routes.js";
import { runtimeRoutes } from "./runtime-routes.js";
import { sprintRoutes } from "./sprint-routes.js";
import { taskRoutes } from "./task-routes.js";
import { teamRoutes } from "./team-routes.js";
import { workItemRoutes } from "./work-item-routes.js";

// M6.2: auth middleware — opt-in via OSCORPEX_AUTH_ENABLED=true
// Disabled by default so existing tests and integrations keep working.
import { authMiddleware } from "../auth/auth-middleware.js";

// Preset agentları ve takım şablonlarını başlat
seedPresetAgents();
seedTeamTemplates();

// v4.0: Context session event bridge — crash recovery tracking
initContextSession(eventBus);

// M3: PG LISTEN/NOTIFY durable event bridge — diğer process'lerden gelen event'leri dinle
eventBus
	.initPgListener()
	.catch((err) => console.warn("[routes] initPgListener failed:", err instanceof Error ? err.message : err));

// ---------------------------------------------------------------------------
// Webhook Event Entegrasyonu — global event listener
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Webhook Event Listeners — type-specific webhook notifications
// ---------------------------------------------------------------------------

eventBus.on("task:completed", (event) => {
	const payload = event.payload as Record<string, unknown>;
	sendWebhookNotification(event.projectId, "task_completed", {
		taskId: event.taskId ?? "",
		taskTitle: payload.title ?? payload.taskTitle ?? "",
		agentId: event.agentId ?? "",
		...payload,
	}).catch((err) => console.warn("[webhook] task_completed gonderilemedi:", err));
});

eventBus.on("task:failed", (event) => {
	const payload = event.payload as Record<string, unknown>;
	sendWebhookNotification(event.projectId, "execution_error", {
		taskId: event.taskId ?? "",
		taskTitle: payload.title ?? payload.taskTitle ?? "",
		error: payload.error ?? "Bilinmeyen hata",
		agentId: event.agentId ?? "",
		...payload,
	}).catch((err) => console.warn("[webhook] task_failed gonderilemedi:", err));
});

eventBus.on("pipeline:completed", (event) => {
	sendWebhookNotification(event.projectId, "pipeline_completed", {
		...(event.payload as Record<string, unknown>),
	}).catch((err) => console.warn("[webhook] pipeline_completed gonderilemedi:", err));
});

eventBus.on("budget:warning", (event) => {
	const payload = event.payload as Record<string, unknown>;
	sendWebhookNotification(event.projectId, "budget_warning", {
		currentCost: payload.currentCostUsd ?? payload.currentCost ?? 0,
		limitCost: payload.maxCostUsd ?? payload.limitCost ?? 0,
		...payload,
	}).catch((err) => console.warn("[webhook] budget_warning gonderilemedi:", err));
});

// ---------------------------------------------------------------------------
// M5: Plugin Bridge — general event bridge for ALL event types
// pluginRegistry handles hook-based filtering internally per plugin manifest.
// Legacy notifyPlugins (hook-based) is also preserved for backward compat.
// ---------------------------------------------------------------------------

const ALL_PLUGIN_EVENTS: EventType[] = [
	"task:assigned",
	"task:started",
	"task:completed",
	"task:failed",
	"task:timeout",
	"task:retry",
	"task:approval_required",
	"task:approved",
	"task:rejected",
	"task:timeout_warning",
	"task:review_rejected",
	"agent:started",
	"agent:stopped",
	"agent:output",
	"agent:error",
	"phase:started",
	"phase:completed",
	"plan:created",
	"plan:approved",
	"execution:started",
	"execution:error",
	"escalation:user",
	"git:commit",
	"git:pr-created",
	"pipeline:completed",
	"budget:warning",
	"budget:exceeded",
	"prompt:size",
	"work_item:created",
	"work_item:planned",
	"sprint:started",
	"sprint:completed",
	"ceremony:standup",
	"ceremony:retrospective",
	"policy:violation",
	"lifecycle:transition",
	"message:created",
];

for (const eventType of ALL_PLUGIN_EVENTS) {
	eventBus.on(eventType, (event) => {
		// New manifest-driven registry (M5)
		pluginRegistry.notifyPlugins(event).catch((err) => {
			console.warn(
				`[plugin-bridge] Error notifying plugins for ${eventType}:`,
				err instanceof Error ? err.message : err,
			);
		});

		// Legacy hook-based bridge (backward compat — v3.9 style)
		if (eventType === "task:completed") {
			notifyPlugins("onTaskComplete", {
				projectId: event.projectId,
				taskId: event.taskId ?? "",
				agentId: event.agentId ?? "",
			}).catch((err) => console.warn("[plugin-registry] onTaskComplete failed:", err));
		} else if (eventType === "pipeline:completed") {
			const payload = event.payload as Record<string, unknown>;
			notifyPlugins("onPipelineComplete", {
				projectId: event.projectId,
				status: String(payload.status ?? "completed"),
			}).catch((err) => console.warn("[plugin-registry] onPipelineComplete failed:", err));
		} else if (eventType === "work_item:created") {
			const payload = event.payload as Record<string, unknown>;
			notifyPlugins("onWorkItemCreated", {
				projectId: event.projectId,
				itemId: String(payload.itemId ?? payload.id ?? ""),
				type: String(payload.type ?? "feature"),
			}).catch((err) => console.warn("[plugin-registry] onWorkItemCreated failed:", err));
		} else if (eventType === "phase:completed") {
			const payload = event.payload as Record<string, unknown>;
			notifyPlugins("onPhaseComplete", {
				projectId: event.projectId,
				phaseId: String(payload.phaseId ?? ""),
			}).catch((err) => console.warn("[plugin-registry] onPhaseComplete failed:", err));
		}
	});
}

// ---------------------------------------------------------------------------
// V6 M1: Notification Bridge — important events → in-app notifications
// ---------------------------------------------------------------------------

const NOTIFICATION_EVENTS: EventType[] = ["task:completed", "task:failed", "pipeline:completed"];

for (const eventType of NOTIFICATION_EVENTS) {
	eventBus.on(eventType, (event) => {
		processEventForNotification(event).catch((err) => {
			console.warn(`[notification-bridge] Error for ${eventType}:`, err instanceof Error ? err.message : err);
		});
	});
}

// ---------------------------------------------------------------------------
// Ana Studio Router
// ---------------------------------------------------------------------------

const studio = new Hono();

// ---------------------------------------------------------------------------
// CORS — Allow configured origins (default: localhost dev ports)
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.OSCORPEX_CORS_ORIGINS ?? "http://localhost:5173,http://localhost:4242")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean);

studio.use(
	"*",
	cors({
		origin: allowedOrigins,
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		maxAge: 86400,
	}),
);

// ---------------------------------------------------------------------------
// Auth middleware — Bearer token (opt-in via OSCORPEX_API_KEY env var)
// Skips SSE streams to avoid breaking EventSource connections.
// ---------------------------------------------------------------------------
const apiKey = process.env.OSCORPEX_API_KEY;
if (apiKey) {
	studio.use("*", async (c, next) => {
		// Skip SSE/EventSource (Accept: text/event-stream) — browser EventSource can't set headers
		if (c.req.header("accept")?.includes("text/event-stream")) return next();

		const authHeader = c.req.header("authorization");
		if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return next();
	});
}

// ---------------------------------------------------------------------------
// M6.2: Tenant-aware auth middleware — only active when OSCORPEX_AUTH_ENABLED=true
// Sets tenantId / userId / userRole / authType on context for downstream use.
// /api/auth/* is always auth-free (register/login endpoints).
// SSE endpoints are skipped because browser EventSource cannot send headers;
// they use the ?token= query param fallback instead.
// ---------------------------------------------------------------------------
if (process.env.OSCORPEX_AUTH_ENABLED === "true") {
	studio.use("*", async (c, next) => {
		// Skip SSE — handled with query-param token in the route itself
		if (c.req.header("accept")?.includes("text/event-stream")) return next();
		return authMiddleware(c, next);
	});
}

// Budget guard — execution route'larına uygula
studio.use("/projects/:id/execute*", budgetGuard());
studio.use("/projects/:id/pipeline/start*", budgetGuard());
studio.use("/projects/:id/agents/:agentId/exec*", budgetGuard());

// Sub-router'ları mount et
studio.route("/auth", authRoutes);
studio.route("/", projectRoutes);
studio.route("/", taskRoutes);
studio.route("/", agentRoutes);
studio.route("/", teamRoutes);
studio.route("/", gitFileRoutes);
studio.route("/", pipelineRoutes);
studio.route("/", analyticsRoutes);
studio.route("/", runtimeRoutes);
studio.route("/", integrationRoutes);
studio.route("/", providerRoutes);
studio.route("/", cliUsageRoutes);
studio.route("/", workItemRoutes);
studio.route("/", lifecycleRoutes);
studio.route("/", ceremonyRoutes);
studio.route("/", sprintRoutes);
studio.route("/", memoryRoutes);
studio.route("/plugins", pluginRoutes);
studio.route("/notifications", notificationRoutes);

export { studio as studioRoutes };
