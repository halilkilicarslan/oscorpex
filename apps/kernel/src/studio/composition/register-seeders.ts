// ---------------------------------------------------------------------------
// Composition — Seeders
// Initializes preset agents and team templates on startup.
// Runs in system scope: presets are global records with a NULL tenant.
// ---------------------------------------------------------------------------

import { seedPresetAgents, seedTeamTemplates } from "../db.js";
import { createLogger } from "../logger.js";
import { runAsSystemInBackground } from "../tenancy/tenant-scope.js";

const log = createLogger("composition:seeders");

export async function registerSeeders(): Promise<void> {
	await runAsSystemInBackground("seeders", async () => {
		const results = await Promise.allSettled([seedPresetAgents(), seedTeamTemplates()]);
		const names = ["seedPresetAgents", "seedTeamTemplates"];
		results.forEach((r, i) => {
			if (r.status === "rejected") log.error({ err: r.reason }, `${names[i]} failed`);
		});
		const failed = results.find((r) => r.status === "rejected");
		if (failed) throw failed.reason;
	});
}
