// ---------------------------------------------------------------------------
// F2d — `it` variant whose body runs OUTSIDE the default test tenant scope.
// Kernel tests run inside runInTenant(TENANT_LOCAL) by default (setup.ts); tests that assert
// unscoped behavior, or that enter other tenants / system scope themselves, use this `it`.
// ---------------------------------------------------------------------------

import { it as vitestIt } from "vitest";
import { runInTenant, runOutsideScope } from "../../tenancy/tenant-scope.js";

// biome-ignore lint/suspicious/noExplicitAny: thin wrapper over vitest's overloaded `it`
type AnyFn = (...args: any[]) => any;

const wrap =
	(fn: AnyFn): AnyFn =>
	(...args) =>
		runOutsideScope(() => fn(...args));

function base(name: string, fn: AnyFn, timeout?: number) {
	return vitestIt(name, wrap(fn), timeout);
}

interface OutsideScopeIt {
	(name: string, fn: AnyFn, timeout?: number): void;
	each: (cases: readonly unknown[]) => (name: string, fn: AnyFn) => void;
	skip: typeof vitestIt.skip;
	todo: typeof vitestIt.todo;
}

export const it: OutsideScopeIt = Object.assign(base, {
	each: (cases: readonly unknown[]) => (name: string, fn: AnyFn) =>
		vitestIt.each(cases as never[])(name, wrap(fn) as never),
	skip: vitestIt.skip,
	todo: vitestIt.todo,
});

/**
 * `it` whose body runs outside the default scope and then inside runInTenant(tenantId).
 * For suites that exercise real tenant-scoped HTTP guards (JWT tenants other than the local one).
 */
export function itInTenant(
	tenantId: string,
): Pick<OutsideScopeIt, "skip" | "todo"> & ((name: string, fn: AnyFn, timeout?: number) => void) {
	const wrapIn =
		(fn: AnyFn): AnyFn =>
		(...args) =>
			runOutsideScope(() => runInTenant(tenantId, () => fn(...args)));
	const fn = (name: string, f: AnyFn, timeout?: number): void => {
		vitestIt(name, wrapIn(f), timeout);
	};
	return Object.assign(fn, { skip: vitestIt.skip, todo: vitestIt.todo });
}
