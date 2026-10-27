// ---------------------------------------------------------------------------
// Vitest global setup — runs before every test file.
// Loads apps/kernel/.env.test.local (if present), then applies scripts/init.sql
// via applySchema() (idempotent). Fresh clones and CI runs need no manual
// migration steps.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll } from "vitest";
import { applySchema } from "../db-bootstrap.js";
import { closePool } from "../pg.js";

const envFile = join(process.cwd(), ".env.test.local");
if (existsSync(envFile)) dotenv.config({ path: envFile });

// Use a test database — override via DATABASE_URL env var.
// Default: oscorpex_test on localhost.
process.env.DATABASE_URL =
	process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex_test";

beforeAll(async () => {
	// SKIP_DB_SETUP=1 allows pure unit-test files (e.g. schema validation) to run without a DB.
	if (process.env.SKIP_DB_SETUP === "1") return;
	try {
		await applySchema();
	} catch (err) {
		console.error("[test setup] Failed to apply scripts/init.sql:", err);
		throw err;
	}
});

afterAll(async () => {
	await closePool();
});
