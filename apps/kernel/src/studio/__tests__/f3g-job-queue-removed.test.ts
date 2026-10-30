// ---------------------------------------------------------------------------
// F3-g — the unused job queue is deleted.
//   1. /jobs, /jobs/stats, /jobs/cleanup are unreachable for an admin (default-deny 403 or 404)
//   2. /scheduler/jobs is still routed
//   3. the jobs table is gone after schema apply, and re-applying stays idempotent
//   4. table-classification no longer lists jobs
//   5. no non-test source imports job-queue / job-routes
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TABLE_CLASSIFICATION } from "../tenancy/table-classification.js";
import { runApplySchema } from "./helpers/apply-schema.js";
import { call, mkUser, registerCleanup, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import { TENANT_A, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

const KERNEL_SRC = resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "__tests__" || name === "node_modules") continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(full);
	}
	return out;
}

async function jobsRegclass(): Promise<string | null> {
	return withMigrator(async (c) => {
		const r = await c.query("SELECT to_regclass('public.jobs')::text AS t");
		return (r.rows[0]?.t as string | null) ?? null;
	});
}

describe("F3-g job queue removed", () => {
	it.each([
		// The removed router served GET /jobs, GET /jobs/stats, POST /jobs/:id/retry and DELETE /jobs/cleanup.
		["GET", "/jobs"],
		["GET", "/jobs/stats"],
		["POST", "/jobs/f3g-job/retry"],
		["DELETE", "/jobs/cleanup"],
	])("%s %s is unreachable for an authenticated admin", async (method, path) => {
		const admin = await mkUser({ tenantId: TENANT_A, role: "admin", admin: true });
		const res = await call(admin, method, path);
		// The access guard denies routes without a permission entry before routing (default deny → 403);
		// a 404 from the router is equally fine. What matters is that nothing answers.
		expect([403, 404]).toContain(res.status);
		if (res.status === 403) expect(((await res.json()) as { error?: string }).error).toMatch(/unknown route/i);
	});

	it("GET /scheduler/jobs is still routed", async () => {
		const admin = await mkUser({ tenantId: TENANT_A, role: "admin", admin: true });
		const res = await call(admin, "GET", "/scheduler/jobs");
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(403);
	});

	it("schema apply drops a pre-existing jobs table and re-apply is idempotent", async () => {
		// Simulate a database created before F3-g; a fresh CI database would never have the table.
		await withMigrator((c) => c.query("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY)"));
		expect(await jobsRegclass()).not.toBeNull();
		await expect(runApplySchema({ force: true })).resolves.toBeDefined();
		expect(await jobsRegclass()).toBeNull();
		await expect(runApplySchema({ force: true })).resolves.toBeDefined();
		expect(await jobsRegclass()).toBeNull();
	});

	it("table-classification no longer lists jobs", () => {
		expect(Object.keys(TABLE_CLASSIFICATION)).not.toContain("jobs");
	});

	it("no non-test source imports job-queue, job-routes or job-repo", () => {
		const IMPORT_RE =
			/from\s+["'][^"']*\b(job-queue|job-routes|job-repo)(?:\.js)?["']|import\(\s*["'][^"']*\b(job-queue|job-routes|job-repo)/;
		const offenders = walk(KERNEL_SRC)
			.filter((f) => IMPORT_RE.test(readFileSync(f, "utf8")))
			.map((f) => f.slice(KERNEL_SRC.length + 1));
		expect(offenders).toEqual([]);
	});
});
