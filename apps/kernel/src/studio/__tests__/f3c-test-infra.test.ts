// ---------------------------------------------------------------------------
// F3-c Part A.2/A.3 — strictTestBody: detached implicit-scope leftovers are warnings (classified through the
// inventory records), and a late-finishing body cannot clobber the strict mode of a later itStrict test.
// Contracts:
//  - A detached leftover (origin "detached") is reported through console.warn or process.emitWarning with a message
//    matching /detached/i; the test does not fail. strictTestBody enables the inventory itself.
//  - Queries whose record has origin "test" (current test) still fail the body.
//  - strictTestBody restores via a generation token: only the newest strict body may restore the mode.
// ---------------------------------------------------------------------------

import { AsyncResource } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../db.js";
import { enableImplicitScopeInventory, query, resetImplicitScopeCallers } from "../pg.js";
import * as strictScope from "./helpers/strict-scope.js";

const MODE_ENV = "OSCORPEX_TENANT_SCOPE_MODE";
const sandbox = mkdtempSync(join(tmpdir(), "f3c-infra-"));
const modeBefore = process.env[MODE_ENV];

afterEach(() => {
	enableImplicitScopeInventory(false);
	resetImplicitScopeCallers();
	if (modeBefore === undefined) delete process.env[MODE_ENV];
	else process.env[MODE_ENV] = modeBefore;
});

afterAll(() => {
	rmSync(sandbox, { recursive: true, force: true });
});

type Ctx = { skip: () => void; onTestFinished?: (cb: () => void) => void };
type Body = (fn: (ctx: unknown) => unknown) => (ctx: Ctx) => Promise<unknown>;
const strictTestBody = (): Body => {
	const fn = (strictScope as Record<string, unknown>).strictTestBody;
	expect(typeof fn, "strict-scope.ts must export strictTestBody(fn)").toBe("function");
	return fn as Body;
};

/** Script compiled outside __tests__: its frames are "production-like" (detached) callers. */
function script<T>(name: string, code: string): T {
	return new vm.Script(code, { filename: join(sandbox, name) }).runInThisContext() as T;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Collect warnings emitted through console.warn or process.emitWarning while fn runs. */
async function collectWarnings<T>(
	fn: () => Promise<T>,
): Promise<{ result: PromiseSettledResult<T>; warnings: string[] }> {
	const warnings: string[] = [];
	const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
		warnings.push(args.map(String).join(" "));
	});
	const onWarning = (w: Error) => warnings.push(`${w.name}: ${w.message}`);
	process.on("warning", onWarning);
	try {
		const [result] = await Promise.allSettled([fn()]);
		await sleep(5); // process 'warning' events are emitted on nextTick
		return { result, warnings };
	} finally {
		process.off("warning", onWarning);
		spy.mockRestore();
	}
}

describe("F3-c A.2 — detached leftovers are warnings, current-test queries still fail", () => {
	it("a detached implicit-scope query from an earlier test does not fail the strict body; it is reported as a warning", async () => {
		// Leftover of "a previous test": scheduled in the implicit scope from a non-test frame, fires during the body.
		const schedule = script<(f: () => Promise<unknown>, ms: number) => void>(
			"detached-leftover.js",
			"(function (f, ms) { setTimeout(function () { f(); }, ms); })",
		);
		let leftoverDone: Promise<unknown> = Promise.resolve();
		schedule(() => {
			leftoverDone = query("SELECT 1 AS leftover");
			return leftoverDone;
		}, 20);

		const run = strictTestBody()(async () => {
			await sleep(150);
		});
		const { result, warnings } = await collectWarnings(() => run({ skip: () => {} }));
		await leftoverDone;

		expect(
			result.status,
			`body must not fail on a detached leftover: ${String((result as { reason?: unknown }).reason)}`,
		).toBe("fulfilled");
		expect(warnings.some((w) => /detached/i.test(w))).toBe(true);
	});

	it("a query that originates from the current test (implicit scope captured in the test) still fails the body", async () => {
		const implicit = new AsyncResource("f3c-implicit"); // created in the implicit scope of this test
		const run = strictTestBody()(async () => {
			await implicit.runInAsyncScope(() => getProject("f3c-none"));
		});
		const { result } = await collectWarnings(() => run({ skip: () => {} }));
		expect(result.status).toBe("rejected");
		expect(String((result as PromiseRejectedResult).reason)).toMatch(/implicit/i);
	});

	it("mixed: a detached leftover plus a current-test implicit query still fails (only the latter counts)", async () => {
		const schedule = script<(f: () => Promise<unknown>, ms: number) => void>(
			"detached-leftover-2.js",
			"(function (f, ms) { setTimeout(function () { f(); }, ms); })",
		);
		schedule(() => query("SELECT 1 AS leftover2"), 10);
		const implicit = new AsyncResource("f3c-implicit-2");
		const run = strictTestBody()(async () => {
			await sleep(60);
			await implicit.runInAsyncScope(() => getProject("f3c-none"));
		});
		const { result } = await collectWarnings(() => run({ skip: () => {} }));
		expect(result.status).toBe("rejected");
	});
});

describe("F3-c A.3 — generation token", () => {
	it("a body finishing late after a timeout does not restore/clobber the strict mode of a later strict test", async () => {
		const finishedA: Array<() => void> = [];
		const finishedB: Array<() => void> = [];
		let releaseA: () => void = () => {};
		let releaseB: () => void = () => {};
		const gateA = new Promise<void>((r) => {
			releaseA = r;
		});
		const gateB = new Promise<void>((r) => {
			releaseB = r;
		});
		const modeDuringB: Array<string | undefined> = [];

		// Test A starts; its "timeout" fires: vitest runs the onTestFinished callbacks while the body is still pending.
		const runA = strictTestBody()(async () => {
			await gateA;
		})({ skip: () => {}, onTestFinished: (cb) => finishedA.push(cb) });
		await sleep(5);
		expect(process.env[MODE_ENV]).toBe("strict");
		for (const cb of finishedA) cb();
		expect(process.env[MODE_ENV]).toBe(modeBefore);

		// Test B (the next itStrict) starts and is strict.
		const runB = strictTestBody()(async () => {
			modeDuringB.push(process.env[MODE_ENV]);
			await gateB;
			modeDuringB.push(process.env[MODE_ENV]);
		})({ skip: () => {}, onTestFinished: (cb) => finishedB.push(cb) });
		await sleep(5);
		expect(process.env[MODE_ENV]).toBe("strict");

		// A's body finally finishes (late). It must not touch the mode that now belongs to B.
		releaseA();
		await runA.catch(() => {});
		await sleep(5);
		expect(process.env[MODE_ENV], "late finish of A clobbered B's strict mode").toBe("strict");

		releaseB();
		await runB;
		for (const cb of finishedB) cb();
		expect(modeDuringB).toEqual(["strict", "strict"]);
		expect(process.env[MODE_ENV]).toBe(modeBefore);
	});

	it("the late body of A also does not restore a stale 'previous' value over B after B finished (no leak either way)", async () => {
		let releaseA: () => void = () => {};
		const gateA = new Promise<void>((r) => {
			releaseA = r;
		});
		const finishedA: Array<() => void> = [];
		const runA = strictTestBody()(async () => {
			await gateA;
		})({ skip: () => {}, onTestFinished: (cb) => finishedA.push(cb) });
		await sleep(5);
		for (const cb of finishedA) cb();

		process.env[MODE_ENV] = "warn"; // an unrelated mode the next owner established
		releaseA();
		await runA.catch(() => {});
		expect(process.env[MODE_ENV], "stale restore from a finished generation").toBe("warn");
	});
});

describe("F3-c R1-7 — infra classification cannot be gamed by timing", () => {
	it("the current test's own implicit query after `await sleep()` still fails the strict body", async () => {
		const implicit = new AsyncResource("f3c-implicit-sleep");
		const run = strictTestBody()(async () => {
			await sleep(30);
			await implicit.runInAsyncScope(() => getProject("f3c-none"));
		});
		const { result } = await collectWarnings(() => run({ skip: () => {} }));
		expect(result.status).toBe("rejected");
		expect(String((result as PromiseRejectedResult).reason)).toMatch(/implicit/i);
	});

	it("the current test's own implicit query fired from its own timer callback still fails", async () => {
		const implicit = new AsyncResource("f3c-implicit-timer");
		const run = strictTestBody()(async () => {
			await new Promise<void>((resolve, reject) => {
				setTimeout(() => {
					implicit.runInAsyncScope(() => getProject("f3c-none")).then(() => resolve(), reject);
				}, 10);
			});
		});
		const { result } = await collectWarnings(() => run({ skip: () => {} }));
		expect(result.status).toBe("rejected");
	});

	it("a repo/entry key first seen as detached and later produced by the current test still fails", async () => {
		// Same call site (inside the script) for both runs; only the first one is timer-rooted.
		const callThrough = script<(f: () => Promise<unknown>, viaTimer: boolean) => unknown>(
			"shared-entry.js",
			"(function (f, viaTimer) { function call() { return f(); } if (viaTimer) { setTimeout(function () { call(); }, 5); return undefined; } return call(); })",
		);
		enableImplicitScopeInventory(true);
		let first: Promise<unknown> = Promise.resolve();
		callThrough(() => {
			first = getProject("f3c-none");
			return first;
		}, true);
		await sleep(60);
		await first;

		const implicit = new AsyncResource("f3c-implicit-shared");
		const run = strictTestBody()(async () => {
			await implicit.runInAsyncScope(() => callThrough(() => getProject("f3c-none"), false) as Promise<unknown>);
		});
		const { result } = await collectWarnings(() => run({ skip: () => {} }));
		expect(result.status).toBe("rejected");
		expect(String((result as PromiseRejectedResult).reason)).toMatch(/implicit/i);
	});
});
