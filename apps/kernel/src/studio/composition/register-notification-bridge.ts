// ---------------------------------------------------------------------------
// Composition — Notification Bridge
// V6 M1: Important events → in-app notifications.
// ---------------------------------------------------------------------------

import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { processEventForNotification } from "../notification-service.js";
import { rethrowScopeError } from "../tenancy/tenant-scope.js";
import type { EventType } from "../types.js";

const log = createLogger("composition:notification-bridge");

const NOTIFICATION_EVENTS: EventType[] = ["task:completed", "task:failed", "pipeline:completed"];

export function registerNotificationBridge(): void {
	for (const eventType of NOTIFICATION_EVENTS) {
		eventBus.on(eventType, async (event) => {
			try {
				await processEventForNotification(event);
			} catch (err) {
				rethrowScopeError(err);
				log.warn({ err }, `Notification bridge error for ${eventType}`);
			}
		});
	}
}
