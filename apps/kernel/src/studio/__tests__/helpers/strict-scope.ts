// ---------------------------------------------------------------------------
// F3-a — opt out of the implicit test tenant scope and run in strict mode.
// ---------------------------------------------------------------------------

import { type TestContext, it as vitestIt } from "vitest";
import { getImplicitScopeQueryCount } from "../../pg.js";
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

/** The function itStrict registers: strict mode is restored via onTestFinished (covers timeouts) and any query that
 * resolved through the implicit scope during the body fails the test. */
export function strictTestBody<C extends TestContext>(fn: (ctx: C) => unknown): (ctx: C) => Promise<void> {
	return async (ctx) => {
		const previous = process.env[MODE_ENV];
		const restore = () => {
			if (previous === undefined) delete process.env[MODE_ENV];
			else process.env[MODE_ENV] = previous;
		};
		ctx.onTestFinished?.(restore);
		const before = getImplicitScopeQueryCount();
		process.env[MODE_ENV] = "strict";
		try {
			await runOutsideScope(() => fn(ctx));
		} finally {
			restore();
		}
		const leaked = getImplicitScopeQueryCount() - before;
		if (leaked > 0)
			throw new Error(`itStrict body ran ${leaked} quer${leaked === 1 ? "y" : "ies"} in the implicit test scope`);
	};
}

export function itStrict(name: string, fn: (ctx: TestContext) => unknown, timeout?: number): void {
	vitestIt(name, strictTestBody(fn), timeout);
}
