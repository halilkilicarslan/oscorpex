// ---------------------------------------------------------------------------
// Composition — Event Bridges
// Registers context session bridge and PG LISTEN/NOTIFY listener.
// ---------------------------------------------------------------------------

import { initContextSession } from "../context-session.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";

const log = createLogger("composition:event-bridges");

export function registerEventBridges(): void {
	// v4.0: Context session event bridge — crash recovery tracking
	initContextSession(eventBus);

	// M3: PG LISTEN/NOTIFY durable event bridge
	eventBus.initPgListener().catch((err) => log.warn({ err }, "initPgListener failed"));
}
