// ---------------------------------------------------------------------------
// F2 review round 1 — nested withTransaction emits a warning.
// Separate file: mocks the logger module to capture pg.ts warnings.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../logger.js", () => {
	const log: Record<string, unknown> = {
		warn,
		info: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
	};
	log.child = () => log;
	return { createLogger: () => log, logger: log };
});

import { query, withTransaction } from "../pg.js";
import { runInTenant, runOutsideScope } from "../tenancy/tenant-scope.js";
import { TENANT_A } from "./helpers/tenancy.js";

const warned = () =>
	warn.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

describe("nested withTransaction", () => {
	it("emits a warning (the inner call opens a separate connection/transaction)", async () => {
		warn.mockClear();
		await runOutsideScope(() =>
			runInTenant(TENANT_A, () =>
				withTransaction(async () => {
					await withTransaction(async (inner) => inner.query("SELECT 1"));
				}),
			),
		);
		expect(warned().some((m) => /nested/i.test(m) && /transaction/i.test(m))).toBe(true);
	});

	it("a non-nested withTransaction does not warn about nesting", async () => {
		warn.mockClear();
		await runOutsideScope(() => runInTenant(TENANT_A, () => withTransaction(async (c) => c.query("SELECT 1"))));
		await runOutsideScope(() => runInTenant(TENANT_A, () => query("SELECT 1")));
		expect(warned().some((m) => /nested/i.test(m))).toBe(false);
	});

	it("sequential (non-overlapping) transactions do not warn", async () => {
		warn.mockClear();
		await runOutsideScope(() =>
			runInTenant(TENANT_A, async () => {
				await withTransaction(async (c) => c.query("SELECT 1"));
				await withTransaction(async (c) => c.query("SELECT 2"));
			}),
		);
		expect(warned().some((m) => /nested/i.test(m))).toBe(false);
	});
});
