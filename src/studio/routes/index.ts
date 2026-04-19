// ---------------------------------------------------------------------------
// Oscorpex — Modular Route Index
// Tüm sub-router'ları birleştirir ve studioRoutes olarak export eder.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import { seedPresetAgents, seedTeamTemplates } from "../db.js";
import { initContextSession } from "../context-session.js";
import { eventBus } from "../event-bus.js";
import { budgetGuard } from "../middleware/policy-middleware.js";
import { notifyPlugins } from "../plugin-registry.js";
import { sendWebhookNotification } from "../webhook-sender.js";

import { agentRoutes } from "./agent-routes.js";
import { analyticsRoutes } from "./analytics-routes.js";
import { ceremonyRoutes } from "./ceremony-routes.js";
import { cliUsageRoutes } from "./cli-usage-routes.js";
import { gitFileRoutes } from "./git-file-routes.js";
import { integrationRoutes } from "./integration-routes.js";
import { lifecycleRoutes } from "./lifecycle-routes.js";
import { memoryRoutes } from "./memory-routes.js";
import { pipelineRoutes } from "./pipeline-routes.js";
import { projectRoutes } from "./project-routes.js";
import { providerRoutes } from "./provider-routes.js";
import { runtimeRoutes } from "./runtime-routes.js";
import { sprintRoutes } from "./sprint-routes.js";
import { taskRoutes } from "./task-routes.js";
import { teamRoutes } from "./team-routes.js";
import { workItemRoutes } from "./work-item-routes.js";

// Preset agentları ve takım şablonlarını başlat
seedPresetAgents();
seedTeamTemplates();

// v4.0: Context session event bridge — crash recovery tracking
initContextSession(eventBus);

// M3: PG LISTEN/NOTIFY durable event bridge — diğer process'lerden gelen event'leri dinle
eventBus.initPgListener().catch((err) =>
	console.warn("[routes] initPgListener failed:", err instanceof Error ? err.message : err),
);

// ---------------------------------------------------------------------------
// Webhook Event Entegrasyonu — global event listener
// ---------------------------------------------------------------------------
eventBus.on("task:completed", (event) => {
	const payload = event.payload as Record<string, unknown>;
	sendWebhookNotification(event.projectId, "task_completed", {
		taskId: event.taskId ?? "",
		taskTitle: payload.title ?? payload.taskTitle ?? "",
		agentId: event.agentId ?? "",
		...payload,
	}).catch((err) => console.warn("[webhook] task_completed gonderilemedi:", err));

	// v3.9: Notify plugins (non-blocking)
	notifyPlugins("onTaskComplete", {
		projectId: event.projectId,
		taskId: event.taskId ?? "",
		agentId: event.agentId ?? "",
	}).catch((err) => console.warn("[plugin-registry] onTaskComplete failed:", err));
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

	// v3.9: Notify plugins (non-blocking)
	const payload = event.payload as Record<string, unknown>;
	notifyPlugins("onPipelineComplete", {
		projectId: event.projectId,
		status: String(payload.status ?? "completed"),
	}).catch((err) => console.warn("[plugin-registry] onPipelineComplete failed:", err));
});

eventBus.on("work_item:created", (event) => {
	const payload = event.payload as Record<string, unknown>;
	notifyPlugins("onWorkItemCreated", {
		projectId: event.projectId,
		itemId: String(payload.itemId ?? payload.id ?? ""),
		type: String(payload.type ?? "feature"),
	}).catch((err) => console.warn("[plugin-registry] onWorkItemCreated failed:", err));
});

eventBus.on("phase:completed", (event) => {
	const payload = event.payload as Record<string, unknown>;
	notifyPlugins("onPhaseComplete", {
		projectId: event.projectId,
		phaseId: String(payload.phaseId ?? ""),
	}).catch((err) => console.warn("[plugin-registry] onPhaseComplete failed:", err));
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

// Budget guard — execution route'larına uygula
studio.use("/projects/:id/execute*", budgetGuard());
studio.use("/projects/:id/pipeline/start*", budgetGuard());
studio.use("/projects/:id/agents/:agentId/exec*", budgetGuard());

// Sub-router'ları mount et
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

export { studio as studioRoutes };
