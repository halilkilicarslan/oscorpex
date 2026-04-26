// ---------------------------------------------------------------------------
// Composition — Plugin Bridge
// M5: Manifest-driven plugin registry + legacy hook-based bridge.
// ---------------------------------------------------------------------------

import { eventBus } from "../event-bus.js";
import { notifyPlugins, pluginRegistry } from "../plugin-registry.js";
import type { EventType } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("composition:plugin-bridge");

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

export function registerPluginBridge(): void {
	for (const eventType of ALL_PLUGIN_EVENTS) {
		eventBus.on(eventType, (event) => {
			pluginRegistry.notifyPlugins(event).catch((err) => {
				log.warn({ err }, `Error notifying plugins for ${eventType}`);
			});

			if (eventType === "task:completed") {
				notifyPlugins("onTaskComplete", {
					projectId: event.projectId,
					taskId: event.taskId ?? "",
					agentId: event.agentId ?? "",
				}).catch((err) => log.warn({ err }, "plugin onTaskComplete failed"));
			} else if (eventType === "pipeline:completed") {
				const payload = event.payload as Record<string, unknown>;
				notifyPlugins("onPipelineComplete", {
					projectId: event.projectId,
					status: String(payload.status ?? "completed"),
				}).catch((err) => log.warn({ err }, "plugin onPipelineComplete failed"));
			} else if (eventType === "work_item:created") {
				const payload = event.payload as Record<string, unknown>;
				notifyPlugins("onWorkItemCreated", {
					projectId: event.projectId,
					itemId: String(payload.itemId ?? payload.id ?? ""),
					type: String(payload.type ?? "feature"),
				}).catch((err) => log.warn({ err }, "plugin onWorkItemCreated failed"));
			} else if (eventType === "phase:completed") {
				const payload = event.payload as Record<string, unknown>;
				notifyPlugins("onPhaseComplete", {
					projectId: event.projectId,
					phaseId: String(payload.phaseId ?? ""),
				}).catch((err) => log.warn({ err }, "plugin onPhaseComplete failed"));
			}
		});
	}
}
