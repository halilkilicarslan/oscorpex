// ---------------------------------------------------------------------------
// Composition — Webhook Bridge
// Registers type-specific webhook notification listeners on the event bus.
// ---------------------------------------------------------------------------

import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { sendWebhookNotification } from "../webhook-sender.js";

const log = createLogger("composition:webhook-bridge");

export function registerWebhookBridge(): void {
	eventBus.on("task:completed", (event) => {
		const payload = event.payload as Record<string, unknown>;
		sendWebhookNotification(event.projectId, "task_completed", {
			taskId: event.taskId ?? "",
			taskTitle: payload.title ?? payload.taskTitle ?? "",
			agentId: event.agentId ?? "",
			...payload,
		}).catch((err) => log.warn({ err }, "webhook task:completed failed"));
	});

	eventBus.on("task:failed", (event) => {
		const payload = event.payload as Record<string, unknown>;
		sendWebhookNotification(event.projectId, "execution_error", {
			taskId: event.taskId ?? "",
			taskTitle: payload.title ?? payload.taskTitle ?? "",
			error: payload.error ?? "Bilinmeyen hata",
			agentId: event.agentId ?? "",
			...payload,
		}).catch((err) => log.warn({ err }, "webhook task:failed failed"));
	});

	eventBus.on("pipeline:completed", (event) => {
		sendWebhookNotification(event.projectId, "pipeline_completed", {
			...(event.payload as Record<string, unknown>),
		}).catch((err) => log.warn({ err }, "webhook pipeline:completed failed"));
	});

	eventBus.on("budget:warning", (event) => {
		const payload = event.payload as Record<string, unknown>;
		sendWebhookNotification(event.projectId, "budget_warning", {
			currentCost: payload.currentCostUsd ?? payload.currentCost ?? 0,
			limitCost: payload.maxCostUsd ?? payload.limitCost ?? 0,
			...payload,
		}).catch((err) => log.warn({ err }, "webhook budget:warning failed"));
	});
}
