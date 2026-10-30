// ---------------------------------------------------------------------------
// Vitest global setup — runs before every test file.
// Loads apps/kernel/.env.test.local (if present), then applies scripts/init.sql
// via applySchema() (idempotent). Fresh clones and CI runs need no manual
// migration steps.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, expect } from "vitest";
import { applySchema } from "../db-bootstrap.js";
import { enterTenantScopeForTests } from "../tenancy/tenant-scope.js";
import { closeTestPool } from "./helpers/tenancy.js";

const envFile = join(process.cwd(), ".env.test.local");
if (existsSync(envFile)) dotenv.config({ path: envFile });

// Use a test database — override via DATABASE_URL env var.
// Default: oscorpex_test on localhost.
process.env.DATABASE_URL =
	process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex_test";

// Every kernel test runs inside the local tenant scope by default (tests that need no scope / other tenants
// use runOutsideScope or helpers/outside-scope.ts `it`). enterWith at module top level propagates to the
// runner's async context for hooks and test bodies of this file.
enterTenantScopeForTests("00000000-0000-0000-0000-000000000001");

const implicitScopeReport = process.env.OSCORPEX_IMPLICIT_SCOPE_REPORT;

beforeAll(async () => {
	if (implicitScopeReport) {
		try {
			(await import("../pg.js")).enableImplicitScopeInventory(true);
		} catch {
			// vi.mock("../pg.js") without the inventory API
		}
	}
	// SKIP_DB_SETUP=1 allows pure unit-test files (e.g. schema validation) to run without a DB.
	if (process.env.SKIP_DB_SETUP === "1") return;
	try {
		await applySchema();
		await initControlPlaneDb();
	} catch (err) {
		console.error("[test setup] Failed to apply scripts/init.sql:", err);
		throw err;
	}
});

/**
 * Mirrors boot-phases/db-phase.ts: the control-plane package delegates to the kernel's tenant-scoped helpers.
 * The helpers are resolved lazily so that pg.ts is not loaded before a test file had the chance to vi.mock its logger.
 */
async function initControlPlaneDb(): Promise<void> {
	const { initDb } = await import("@oscorpex/control-plane");
	const kernelPg = () => import("../pg.js");
	initDb({
		query: async (sql, params) => (await kernelPg()).query(sql, params),
		queryOne: async (sql, params) => (await kernelPg()).queryOne(sql, params),
		execute: async (sql, params) => (await kernelPg()).execute(sql, params),
		withTransaction: async (fn) => (await kernelPg()).withTransaction(fn),
	});
}

afterAll(async () => {
	try {
		if (implicitScopeReport) {
			const pgMod = await import("../pg.js");
			let hasInventory = true;
			try {
				hasInventory = typeof pgMod.getImplicitScopeCallers === "function";
			} catch {
				hasInventory = false; // vi.mock("../pg.js") without the inventory API
			}
			if (hasInventory) {
				const { flushImplicitScopeReport } = await import("./helpers/implicit-scope-report.js");
				flushImplicitScopeReport(implicitScopeReport, expect.getState().testPath ?? "unknown");
				pgMod.resetImplicitScopeCallers();
			}
		}
	} finally {
		// Lazy import: a static import here would load pg.ts (and its logger) before test files can vi.mock the logger.
		try {
			const { closePool } = await import("../pg.js");
			await closePool();
		} catch {
			// Test files that vi.mock("../pg.js") without closePool have no real pool to close.
		}
		await closeTestPool();
	}
});
