// ---------------------------------------------------------------------------
// Oscorpex — Modular Route Index
// Tüm sub-router'ları birleştirir ve studioRoutes olarak export eder.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	seedPresetAgents,
	seedTeamTemplates,
} from "../db.js";
import { eventBus } from "../event-bus.js";
import { sendWebhookNotification } from "../webhook-sender.js";
import { budgetGuard } from "../middleware/policy-middleware.js";

import { projectRoutes } from "./project-routes.js";
import { taskRoutes } from "./task-routes.js";
import { agentRoutes } from "./agent-routes.js";
import { teamRoutes } from "./team-routes.js";
import { gitFileRoutes } from "./git-file-routes.js";
import { pipelineRoutes } from "./pipeline-routes.js";
import { analyticsRoutes } from "./analytics-routes.js";
import { runtimeRoutes } from "./runtime-routes.js";
import { integrationRoutes } from "./integration-routes.js";
import { providerRoutes } from "./provider-routes.js";

// Preset agentları ve takım şablonlarını başlat
seedPresetAgents();
seedTeamTemplates();

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
// Ana Studio Router
// ---------------------------------------------------------------------------

const studio = new Hono();

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

export { studio as studioRoutes };
