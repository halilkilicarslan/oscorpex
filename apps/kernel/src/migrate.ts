// ---------------------------------------------------------------------------
// Oscorpex — migrate step (entry: src/bin/migrate.ts → `node dist/migrate.js`)
// Applies scripts/init.sql through the migration connection. Requires
// OSCORPEX_MIGRATION_DATABASE_URL in every environment (no DATABASE_URL fallback).
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applySchema } from "./studio/db-bootstrap.js";
import { createLogger } from "./studio/logger.js";
import { redactConnectionStrings } from "./studio/redact-secrets.js";

const log = createLogger("migrate");

/** Valid from src/migrate.ts and from any file directly under dist/. */
const defaultSchemaPath = (): string => fileURLToPath(new URL("../scripts/init.sql", import.meta.url));

export async function runMigrate(
	env: NodeJS.ProcessEnv = process.env,
	opts: { schemaPath?: string } = {},
): Promise<number> {
	const migrationUrl = env.OSCORPEX_MIGRATION_DATABASE_URL?.trim();
	if (!migrationUrl) {
		log.error("OSCORPEX_MIGRATION_DATABASE_URL is required to run the migrate step");
		return 1;
	}
	const schemaPath = opts.schemaPath ?? defaultSchemaPath();
	if (!existsSync(schemaPath)) {
		log.error(`Schema script ${schemaPath} (init.sql) is missing`);
		return 1;
	}
	const runtimeUrl = env.DATABASE_URL?.trim();
	if (!runtimeUrl) {
		if (process.env.NODE_ENV === "production") {
			log.error("DATABASE_URL is required in production to verify runtime isolation");
			return 1;
		}
		log.warn("DATABASE_URL is not set; runtime isolation is not verified");
	}
	try {
		const result = await applySchema({ migrationUrl, runtimeUrl: runtimeUrl || undefined, schemaPath });
		log.info({ applied: result.applied, reason: result.reason }, "migrate finished");
		return 0;
	} catch (err) {
		log.error(`migrate failed: ${redactConnectionStrings(err instanceof Error ? err.message : String(err))}`);
		return 1;
	}
}
