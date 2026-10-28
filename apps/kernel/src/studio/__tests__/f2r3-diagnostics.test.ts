// ---------------------------------------------------------------------------
// F2 round 3, item 6 — the unscoped-query warning's caller hint skips pg.ts frames in BUILT output too
// (e.g. dist/pg-DZ4nHWIx.js, a hashed chunk) and shows the real caller.
// Assumed contract: pg.ts exports `callerHint(stack?: string): string` (defaults to the current stack).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import * as pgModule from "../pg.js";

type CallerHint = (stack?: string) => string;
const callerHint = (pgModule as unknown as { callerHint?: CallerHint }).callerHint as CallerHint;

const BUILT_STACK = [
	"Error",
	"    at callerHint (file:///app/dist/pg-DZ4nHWIx.js:95:20)",
	"    at resolveTenantGuc (file:///app/dist/pg-DZ4nHWIx.js:120:5)",
	"    at query (file:///app/dist/pg-DZ4nHWIx.js:200:3)",
	"    at listWidgets (file:///app/dist/widget-repo-Qw3rTy.js:55:10)",
	"    at handler (file:///app/dist/routes-XyZ123.js:10:1)",
	"    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
].join("\n");

const SRC_STACK = [
	"Error",
	"    at callerHint (/repo/apps/kernel/src/studio/pg.ts:90:20)",
	"    at query (/repo/apps/kernel/src/studio/pg.ts:200:3)",
	"    at listWidgets (/repo/apps/kernel/src/studio/db/widget-repo.ts:12:9)",
	"    at node:internal/process/task_queues:95:5",
].join("\n");

describe("callerHint", () => {
	it("is exported as a function", () => {
		expect(typeof callerHint).toBe("function");
	});

	it("built layout: skips frames of the hashed pg chunk (dist/pg-<hash>.js) and shows the real caller", () => {
		const hint = callerHint(BUILT_STACK);
		expect(hint).toContain("listWidgets");
		expect(hint).toContain("widget-repo-Qw3rTy.js");
		expect(hint).not.toContain("pg-DZ4nHWIx");
		expect(hint).not.toContain("resolveTenantGuc");
	});

	it("built layout: node:internal frames are skipped and at most 3 frames are reported", () => {
		const hint = callerHint(BUILT_STACK);
		expect(hint).not.toContain("node:internal");
		expect(hint.split(" <- ").length).toBeLessThanOrEqual(3);
	});

	it("source layout: pg.ts frames are still skipped", () => {
		const hint = callerHint(SRC_STACK);
		expect(hint).toContain("widget-repo.ts");
		expect(hint).not.toMatch(/studio\/pg\.ts/);
	});

	it("an unrelated file whose name merely contains 'pg' is not skipped", () => {
		const stack = [
			"Error",
			"    at query (/repo/dist/pg-DZ4nHWIx.js:1:1)",
			"    at run (/repo/src/studio/pgn-helper.ts:3:3)",
		].join("\n");
		expect(callerHint(stack)).toContain("pgn-helper.ts");
	});

	it("without an argument it describes the current call stack (this test file)", () => {
		expect(callerHint()).toContain("f2r3-diagnostics");
	});
});
