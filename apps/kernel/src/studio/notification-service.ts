// ---------------------------------------------------------------------------
// Oscorpex — Notification Service (V6 M1)
// Listens to StudioEvent bus and creates in-app notifications.
// ---------------------------------------------------------------------------

import { type Notification, createNotification, getProjectTenantId } from "./db.js";
import { createLogger } from "./logger.js";
import { projectBelongsToTenant } from "./tenancy/project-tenant-cache.js";
import { currentScope, isImplicitScope, runInTenant } from "./tenancy/tenant-scope.js";
import type { EventType, StudioEvent } from "./types.js";
const log = createLogger("notification-service");

// ---------------------------------------------------------------------------
// Event → Notification mapping
// ---------------------------------------------------------------------------

type NotifData = { type: string; title: string; body: string };
type EventMapper = (event: StudioEvent) => NotifData | null;

const EVENT_NOTIFICATION_MAP: Partial<Record<EventType, EventMapper>> = {
	"task:completed": (e) => {
		const title = String(e.payload.title ?? e.payload.taskTitle ?? "Unknown");
		return {
			type: "task_completed",
			title: `Task completed: ${title}`,
			body: `Agent finished task "${title}" successfully.`,
		};
	},
	"task:failed": (e) => {
		const title = String(e.payload.title ?? e.payload.taskTitle ?? "Unknown");
		const error = String(e.payload.error ?? "Unknown error");
		return {
			type: "task_failed",
			title: `Task failed: ${title}`,
			body: `Task "${title}" failed: ${error}`,
		};
	},
	"pipeline:completed": (_e) => ({
		type: "pipeline_completed",
		title: "Pipeline completed",
		body: "All phases completed for project.",
	}),
	["review:requested" as EventType]: (e: StudioEvent) => {
		const title = String(e.payload.title ?? e.payload.taskTitle ?? "Unknown");
		return {
			type: "review_requested",
			title: `Review requested: ${title}`,
			body: `Task "${title}" is waiting for your review.`,
		};
	},
};

// ---------------------------------------------------------------------------
// processEventForNotification
// ---------------------------------------------------------------------------

export async function processEventForNotification(event: StudioEvent): Promise<Notification | null> {
	const mapper = EVENT_NOTIFICATION_MAP[event.type];
	if (!mapper) return null;

	const notifData = mapper(event);
	if (!notifData) return null;

	// Bus-dispatched events run in their verified tenant scope; everything else is resolved from the project itself.
	const scope = currentScope();
	const tenantId =
		scope?.kind === "tenant" && !isImplicitScope()
			? (await projectBelongsToTenant(event.projectId, scope.tenantId))
				? scope.tenantId
				: null
			: await getProjectTenantId(event.projectId);
	if (!tenantId) {
		log.warn({ projectId: event.projectId, eventType: event.type }, "notification skipped: project has no tenant");
		return null;
	}

	return runInTenant(tenantId, () =>
		createNotification({
			tenantId,
			userId: null, // broadcast: all project members
			projectId: event.projectId,
			type: notifData.type,
			title: notifData.title,
			body: notifData.body,
			data: {
				eventId: event.id,
				eventType: event.type,
				taskId: event.taskId,
				agentId: event.agentId,
				...event.payload,
			},
		}),
	);
}
