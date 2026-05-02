// ---------------------------------------------------------------------------
// Oscorpex — Database bootstrap
// Applies scripts/init.sql idempotently on startup so fresh environments
// and incremental schema additions (CREATE TABLE IF NOT EXISTS, ADD COLUMN
// IF NOT EXISTS, ...) land without manual migration steps. Mirrors the
// pattern used by the test suite in src/studio/__tests__/setup.ts.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { getPool } from "./pg.js";
const log = createLogger("db-bootstrap");

export async function applyDbBootstrap(): Promise<void> {
	const initSqlPath = join(process.cwd(), "scripts", "init.sql");
	let sql: string;
	try {
		sql = await readFile(initSqlPath, "utf8");
	} catch {
		// No init script available — schema managed elsewhere (e.g. Docker
		// entrypoint). Safe to skip.
		return;
	}

	const pool = getPool();

	// pgvector is optional in local dev; strip vector-dependent DDL if the
	// extension isn't installed so bootstrap still succeeds.
	const { rows } = await pool.query<{ exists: boolean }>(
		"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists",
	);
	const hasVector = rows[0]?.exists === true;

	// CREATE EXTENSION needs superuser, which the app role usually lacks; the
	// extension is enabled by the Docker entrypoint or operator beforehand.
	let sanitized = sql.replace(/^\s*CREATE\s+EXTENSION[^;]*;/gim, "");
	if (!hasVector) {
		sanitized = sanitized
			.replace(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+rag_embeddings[\s\S]*?\);\s*/gi, "")
			.replace(/CREATE\s+INDEX[^;]*rag_embeddings[^;]*;/gi, "");
	}

	try {
		await pool.query(sanitized);
		log.info("[db-bootstrap] scripts/init.sql applied (idempotent)");
	} catch (err) {
		// Ownership mismatches (dev DBs created by a different role) surface
		// here. The app can still run — log loudly so the operator can fix
		// ownership when convenient.
		const msg = err instanceof Error ? err.message : String(err);
		log.warn(`[db-bootstrap] init.sql apply failed: ${msg}`);
		log.warn("[db-bootstrap] Continuing — ensure schema is up-to-date manually.");
	}
}
