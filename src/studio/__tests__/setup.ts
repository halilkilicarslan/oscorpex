// ---------------------------------------------------------------------------
// Vitest global setup — runs once before any test files.
// Ensures the test DB exists and has the latest schema by executing
// scripts/init.sql (which is idempotent via IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS). Fresh clones and CI runs no longer need manual migration steps.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { closePool, getPool } from "../pg.js";

// Use a test database — override via DATABASE_URL env var.
// Default: oscorpex_test on localhost.
process.env.DATABASE_URL =
	process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex_test";

beforeAll(async () => {
	const initSqlPath = join(process.cwd(), "scripts", "init.sql");
	let sql: string;
	try {
		sql = await readFile(initSqlPath, "utf8");
	} catch {
		// No init script — assume schema is managed elsewhere.
		return;
	}

	// CREATE EXTENSION requires superuser. Detect whether pgvector is
	// available; if not, strip the extension statement plus all RAG embedding
	// objects (table/index) that depend on the `vector` type. Studio tests
	// don't exercise pgvector — RAG has its own coverage when the extension
	// is present.
	const pool = getPool();
	const { rows } = await pool.query<{ exists: boolean }>(
		"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists",
	);
	const hasVector = rows[0]?.exists === true;

	let sanitized = sql.replace(/^\s*CREATE\s+EXTENSION[^;]*;/gim, "");
	if (!hasVector) {
		// Drop CREATE TABLE rag_embeddings (...); and any index referencing it.
		sanitized = sanitized
			.replace(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+rag_embeddings[\s\S]*?\);\s*/gi, "")
			.replace(/CREATE\s+INDEX[^;]*rag_embeddings[^;]*;/gi, "");
	}

	try {
		// pg's simple-query protocol (no params) supports multi-statement SQL.
		await pool.query(sanitized);
	} catch (err) {
		// Surface the failure so tests don't mysteriously skip.
		// eslint-disable-next-line no-console
		console.error("[test setup] Failed to apply scripts/init.sql:", err);
		throw err;
	}
});

afterAll(async () => {
	await closePool();
});
