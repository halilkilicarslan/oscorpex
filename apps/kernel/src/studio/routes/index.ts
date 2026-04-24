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
import { costRoutes } from "./cost-routes.js";
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
import { templateRoutes } from "./template-routes.js";
import { ciRoutes } from "./ci-routes.js";
import { jobRoutes } from "./job-routes.js";
import { telemetryRoutes } from "./telemetry-routes.js";
import { clusterRoutes } from "./cluster-routes.js";
import { collaborationRoutes } from "./collaboration-routes.js";
import { marketplaceRoutes } from "./marketplace-routes.js";
// v7.0 Phase 2+3: Agentic platform routes
import { agenticRoutes } from "./agentic-routes.js";
import { graphRoutes } from "./graph-routes.js";
import { sandboxRoutes } from "./sandbox-routes.js";
import { replayRoutes } from "./replay-routes.js";
// import { tracingMiddleware } from "../middleware/tracing-middleware.js";
// NOTE: Uncomment the line above and apply below to enable global HTTP tracing:
//   studio.use("*", tracingMiddleware());
// Requires OSCORPEX_TRACE_ENABLED=true to actually export/log spans.

// M6.2: auth middleware — opt-in via OSCORPEX_AUTH_ENABLED=true
// Disabled by default so existing tests and integrations keep working.
import { authMiddleware } from "../auth/auth-middleware.js";
import { createLogger } from "../logger.js";
const log = createLogger("index");

// Preset agentları ve takım şablonlarını başlat
seedPresetAgents();
seedTeamTemplates();

// v4.0: Context session event bridge — crash recovery tracking
initContextSession(eventBus);

// M3: PG LISTEN/NOTIFY durable event bridge — diğer process'lerden gelen event'leri dinle
eventBus
	.initPgListener()
	.catch((err) => log.warn("[routes] initPgListener failed:", err instanceof Error ? err.message : err));

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
	}).catch((err) => log.warn("[webhook] task_completed gonderilemedi:" + " " + String(err)));
});

eventBus.on("task:failed", (event) => {
	const payload = event.payload as Record<string, unknown>;
	sendWebhookNotification(event.projectId, "execution_error", {
		taskId: event.taskId ?? "",
		taskTitle: payload.title ?? payload.taskTitle ?? "",
		error: payload.error ?? "Bilinmeyen hata",
		agentId: event.agentId ?? "",
		...payload,
	}).catch((err) => log.warn("[webhook] task_failed gonderilemedi:" + " " + String(err)));
});

eventBus.on("pipeline:completed", (event) => {
	sendWebhookNotification(event.projectId, "pipeline_completed", {
		...(event.payload as Record<string, unknown>),
	}).catch((err) => log.warn("[webhook] pipeline_completed gonderilemedi:" + " " + String(err)));
});

eventBus.on("budget:warning", (event) => {
	const payload = event.payload as Record<string, unknown>;
	sendWebhookNotification(event.projectId, "budget_warning", {
		currentCost: payload.currentCostUsd ?? payload.currentCost ?? 0,
		limitCost: payload.maxCostUsd ?? payload.limitCost ?? 0,
		...payload,
	}).catch((err) => log.warn("[webhook] budget_warning gonderilemedi:" + " " + String(err)));
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
	// v7.0: agentic platform events
	"agent:session_started",
	"agent:strategy_selected",
	"agent:requested_help",
	"agent:memory_written",
	"task:proposal_created",
	"task:proposal_approved",
	"graph:mutation_proposed",
	"graph:mutation_applied",
	"plan:replanned",
	"verification:passed",
	"verification:failed",
	"budget:halted",
	"provider:degraded",
];

for (const eventType of ALL_PLUGIN_EVENTS) {
	eventBus.on(eventType, (event) => {
		// New manifest-driven registry (M5)
		pluginRegistry.notifyPlugins(event).catch((err) => {
			log.warn(
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
			}).catch((err) => log.warn("[plugin-registry] onTaskComplete failed:" + " " + String(err)));
		} else if (eventType === "pipeline:completed") {
			const payload = event.payload as Record<string, unknown>;
			notifyPlugins("onPipelineComplete", {
				projectId: event.projectId,
				status: String(payload.status ?? "completed"),
			}).catch((err) => log.warn("[plugin-registry] onPipelineComplete failed:" + " " + String(err)));
		} else if (eventType === "work_item:created") {
			const payload = event.payload as Record<string, unknown>;
			notifyPlugins("onWorkItemCreated", {
				projectId: event.projectId,
				itemId: String(payload.itemId ?? payload.id ?? ""),
				type: String(payload.type ?? "feature"),
			}).catch((err) => log.warn("[plugin-registry] onWorkItemCreated failed:" + " " + String(err)));
		} else if (eventType === "phase:completed") {
			const payload = event.payload as Record<string, unknown>;
			notifyPlugins("onPhaseComplete", {
				projectId: event.projectId,
				phaseId: String(payload.phaseId ?? ""),
			}).catch((err) => log.warn("[plugin-registry] onPhaseComplete failed:" + " " + String(err)));
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
			log.warn(`[notification-bridge] Error for ${eventType}:`, err instanceof Error ? err.message : err);
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
// YAGNI-deferred: cli-usage, ceremony, marketplace, cluster, collaboration
// These modules are not part of the core execution pipeline and add maintenance
// cost without current runtime value. Re-enable when needed.
// studio.route("/", cliUsageRoutes);
// studio.route("/", ceremonyRoutes);
// studio.route("/cluster", clusterRoutes);
// studio.route("/collaboration", collaborationRoutes);
// studio.route("/marketplace", marketplaceRoutes);

studio.route("/", workItemRoutes);
studio.route("/", lifecycleRoutes);
studio.route("/", sprintRoutes);
studio.route("/", memoryRoutes);
studio.route("/plugins", pluginRoutes);
studio.route("/notifications", notificationRoutes);
studio.route("/cost", costRoutes);
studio.route("/templates", templateRoutes);
studio.route("/ci", ciRoutes);
studio.route("/jobs", jobRoutes);

// Telemetry debug endpoints — only mounted when tracing is enabled
if (process.env.OSCORPEX_TRACE_ENABLED === "true") {
	studio.route("/telemetry", telemetryRoutes);
}
// v7.0 Phase 2+3: Agentic platform
studio.route("/", agenticRoutes);
studio.route("/", graphRoutes);
studio.route("/", sandboxRoutes);
studio.route("/replay", replayRoutes);

export { studio as studioRoutes };
