// ---------------------------------------------------------------------------
// F3-a — opt out of the implicit test tenant scope and run in strict mode.
// ---------------------------------------------------------------------------

import { type TestContext, aroundAll, aroundEach, it as vitestIt } from "vitest";
import { enableImplicitScopeInventory, getImplicitScopeCallers, getImplicitScopeQueryCount } from "../../pg.js";
import { runOutsideScope } from "../../tenancy/tenant-scope.js";

const MODE_ENV = "OSCORPEX_TENANT_SCOPE_MODE";

/** Run fn outside any tenant scope with OSCORPEX_TENANT_SCOPE_MODE=strict; the previous mode is always restored. */
export async function withStrictScope<T>(fn: () => T | Promise<T>): Promise<T> {
	const previous = process.env[MODE_ENV];
	process.env[MODE_ENV] = "strict";
	try {
		return await runOutsideScope(fn);
	} finally {
		if (previous === undefined) delete process.env[MODE_ENV];
		else process.env[MODE_ENV] = previous;
	}
}

interface InventoryKey {
	key: string;
	origin: "test" | "detached";
	count: number;
}

function inventorySnapshot(): Map<string, InventoryKey> {
	const map = new Map<string, InventoryKey>();
	for (const c of getImplicitScopeCallers()) {
		map.set(`${c.origin}|${c.repoFrame}|${c.entryFrame}`, {
			key: `${c.repoFrame}|${c.entryFrame}`,
			origin: c.origin,
			count: c.count,
		});
	}
	return map;
}

/** Newest strict body owns the mode; `base` is the mode from before the first still-active strict body. */
const strictState = { generation: 0, active: false, base: undefined as string | undefined };

/** The function itStrict registers: strict mode is restored via onTestFinished (covers timeouts), only by the newest
 * body and only once. Queries that resolved through the implicit scope during the body fail the test, except
 * detached leftovers of earlier tests (inventory origin "detached"), which only warn. */
export function strictTestBody<C extends TestContext>(fn: (ctx: C) => unknown): (ctx: C) => Promise<void> {
	return async (ctx) => {
		if (!strictState.active) strictState.base = process.env[MODE_ENV];
		strictState.active = true;
		const generation = ++strictState.generation;
		let restored = false;
		const restore = () => {
			if (restored || generation !== strictState.generation) return;
			restored = true;
			strictState.active = false;
			if (strictState.base === undefined) delete process.env[MODE_ENV];
			else process.env[MODE_ENV] = strictState.base;
			enableImplicitScopeInventory(Boolean(process.env.OSCORPEX_IMPLICIT_SCOPE_REPORT));
		};
		ctx.onTestFinished?.(restore);
		const before = inventorySnapshot();
		const countBefore = getImplicitScopeQueryCount();
		enableImplicitScopeInventory(true);
		process.env[MODE_ENV] = "strict";
		try {
			await runOutsideScope(() => fn(ctx));
		} finally {
			restore();
		}

		let recorded = 0;
		let testLeaks = 0;
		const detached: string[] = [];
		for (const [key, now] of inventorySnapshot()) {
			const delta = now.count - (before.get(key)?.count ?? 0);
			if (delta <= 0) continue;
			recorded += delta;
			if (now.origin === "test") testLeaks += delta;
			else detached.push(key);
		}
		// Queries the inventory could not attribute (capped or frameless) count against the test.
		testLeaks += Math.max(0, getImplicitScopeQueryCount() - countBefore - recorded);
		if (detached.length > 0) {
			console.warn(
				`itStrict: detached implicit-scope queries from earlier work ran during the test: ${detached.join("; ")}`,
			);
		}
		if (testLeaks > 0)
			throw new Error(`itStrict body ran ${testLeaks} quer${testLeaks === 1 ? "y" : "ies"} in the implicit test scope`);
	};
}

/** From this call on, every hook and test of the file runs outside the implicit scope in strict mode; the previous
 * mode is restored at file end. Call at the top level of the file, before registering hooks. */
export function useStrictScopeForFile(): void {
	aroundAll(async (runSuite) => {
		const previous = process.env[MODE_ENV];
		process.env[MODE_ENV] = "strict";
		try {
			await runOutsideScope(runSuite);
		} finally {
			if (previous === undefined) delete process.env[MODE_ENV];
			else process.env[MODE_ENV] = previous;
		}
	});
	aroundEach(async (runTest) => {
		await runOutsideScope(runTest);
	});
}

export function itStrict(name: string, fn: (ctx: TestContext) => unknown, timeout?: number): void {
	vitestIt(name, strictTestBody(fn), timeout);
}
