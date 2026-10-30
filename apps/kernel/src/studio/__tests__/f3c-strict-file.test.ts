// ---------------------------------------------------------------------------
// F3-c Part A.1 — file-level strict scope: useStrictScopeForFile() called at the top of a test file makes every hook
// (beforeAll/beforeEach/afterEach) and test run outside the implicit scope in strict mode.
// Contract: helpers/strict-scope.ts exports useStrictScopeForFile(): void (registers its own hooks, restores at file end).
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "../pg.js";
import {
	UnscopedQueryError,
	currentScope,
	isImplicitScope,
	runInTenant,
	tenantScopeMode,
} from "../tenancy/tenant-scope.js";
import * as strictScope from "./helpers/strict-scope.js";
import { TENANT_A, seedTestTenants } from "./helpers/tenancy.js";

const useStrict = (strictScope as Record<string, unknown>).useStrictScopeForFile as (() => void) | undefined;
// Registered at file top level, before any hook of this file.
if (typeof useStrict === "function") useStrict();

interface Probe {
	implicit: boolean;
	scope: unknown;
	mode: string;
	queryError: unknown;
}

async function probe(): Promise<Probe> {
	let queryError: unknown;
	try {
		await query("SELECT 1 AS probe");
	} catch (err) {
		queryError = err;
	}
	return { implicit: isImplicitScope(), scope: currentScope(), mode: tenantScopeMode(), queryError };
}

let inBeforeAll: Probe;
let inBeforeEach: Probe | undefined;
let inAfterEach: Probe | undefined;
let afterEachRuns = 0;

beforeAll(async () => {
	inBeforeAll = await probe();
});

beforeEach(async () => {
	inBeforeEach = await probe();
});

afterEach(async () => {
	inAfterEach = await probe();
	afterEachRuns++;
});

describe("F3-c A.1 — useStrictScopeForFile", () => {
	it("is exported by helpers/strict-scope.ts", () => {
		expect(typeof useStrict, "strict-scope.ts must export useStrictScopeForFile()").toBe("function");
	});

	it("beforeAll ran outside the implicit scope, in strict mode, and an unscoped query threw UnscopedQueryError", () => {
		expect(inBeforeAll.implicit).toBe(false);
		expect(inBeforeAll.scope).toBeUndefined();
		expect(inBeforeAll.mode).toBe("strict");
		expect(inBeforeAll.queryError).toBeInstanceOf(UnscopedQueryError);
	});

	it("beforeEach runs strict and unscoped (a query in the hook throws UnscopedQueryError)", () => {
		expect(inBeforeEach?.implicit).toBe(false);
		expect(inBeforeEach?.scope).toBeUndefined();
		expect(inBeforeEach?.mode).toBe("strict");
		expect(inBeforeEach?.queryError).toBeInstanceOf(UnscopedQueryError);
	});

	it("afterEach of the previous test ran strict and unscoped (query throws UnscopedQueryError)", () => {
		expect(afterEachRuns).toBeGreaterThan(0);
		expect(inAfterEach?.implicit).toBe(false);
		expect(inAfterEach?.scope).toBeUndefined();
		expect(inAfterEach?.mode).toBe("strict");
		expect(inAfterEach?.queryError).toBeInstanceOf(UnscopedQueryError);
	});

	it("a plain it() body runs strict and unscoped, so a bare query throws", async () => {
		expect(tenantScopeMode()).toBe("strict");
		expect(isImplicitScope()).toBe(false);
		expect(currentScope()).toBeUndefined();
		await expect(query("SELECT 1")).rejects.toBeInstanceOf(UnscopedQueryError);
	});

	it("explicit runInTenant still works inside the strict file, including seeding via helpers", async () => {
		// seedTestTenants uses the migrator connection, not the scoped pool.
		await seedTestTenants();
		const rows = await runInTenant(TENANT_A, () => query<{ one: number }>("SELECT 1 AS one"));
		expect(rows[0].one).toBe(1);
	});

	it("scope stays absent across awaits and timers", async () => {
		await new Promise((r) => setTimeout(r, 5));
		expect(currentScope()).toBeUndefined();
		expect(isImplicitScope()).toBe(false);
	});
});
