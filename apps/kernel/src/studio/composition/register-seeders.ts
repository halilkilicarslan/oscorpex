// ---------------------------------------------------------------------------
// Composition — Seeders
// Initializes preset agents and team templates on startup.
// Non-blocking: errors are swallowed to avoid crashing the server on stale DB.
// ---------------------------------------------------------------------------

import { seedPresetAgents, seedTeamTemplates } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("composition:seeders");

export function registerSeeders(): void {
	seedPresetAgents().catch((err) => {
		log.warn({ err }, "seedPresetAgents failed");
	});
	seedTeamTemplates().catch((err) => {
		log.warn({ err }, "seedTeamTemplates failed");
	});
}
