// ---------------------------------------------------------------------------
// F3-b — route coverage: every registered studio route that carries a project reference must be
//   (a) under the generic guard prefix `/projects/:id[/...]` (accessGuard checks sys_project_tenant), or
//   (b) in PROJECT_PARAM_ALLOWLIST (reasoned) whose handler file calls assertProjectInTenant.
// Handlers that take the project from a query string, header or JSON body (invisible in the route path) are
// found with a source scan: such a file must call assertProjectInTenant or be in SOURCE_SCAN_EXEMPT.
// A new unguarded project route makes this test fail; the message lists the offending routes.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { studioRoutes } from "../index.js";

const STUDIO = resolve(__dirname, "..");
const HELPER = "assertProjectInTenant";

/** Registered routes whose project id is not covered by the generic /projects/:id guard. */
const PROJECT_PARAM_ALLOWLIST: Array<{ method: string; path: string; file: string; reason: string }> = [
	...["insights", "recommendation", "efficiency"].map((seg) => ({
		method: "GET",
		path: `/cost/${seg}/:projectId`,
		file: "routes/cost-routes.ts",
		reason: "project id is a path param outside /projects/:id — handler calls assertProjectInTenant",
	})),
	{
		method: "GET",
		path: "/ci/status/:projectId",
		file: "routes/ci-routes.ts",
		reason: "project id is a path param outside /projects/:id — handler calls assertProjectInTenant",
	},
	...["usage", "cost"].map((seg) => ({
		method: "GET",
		path: `/${seg}/projects/:id`,
		file: "control-plane/usage-cost/usage-cost-routes.ts",
		reason:
			"mid-path /projects/:id (not the first segment, so the path guard skips it) — handler calls assertProjectInTenant",
	})),
	{
		method: "GET",
		path: "/policy/projects/:id",
		file: "control-plane/policy/policy-routes.ts",
		reason:
			"mid-path /projects/:id (not the first segment, so the path guard skips it) — handler calls assertProjectInTenant",
	},
];

/** Files that read a project reference from query/header/body but are not mounted or are guarded otherwise. */
const SOURCE_SCAN_EXEMPT: Record<string, string> = {
	"routes/collaboration-routes.ts": "not mounted (YAGNI-deferred in routes/index.ts)",
	"routes/ceremony-routes.ts": "not mounted (YAGNI-deferred in routes/index.ts)",
	"routes/cluster-routes.ts": "not mounted (YAGNI-deferred in routes/index.ts)",
	"routes/marketplace-routes.ts": "not mounted (YAGNI-deferred in routes/index.ts)",
	"routes/test-routes.ts": "not mounted in routes/index.ts",
	"control-plane/approvals/approval-routes.ts":
		"body.projectId already verified with isProjectInTenant(projectId, tenantId)",
};

const PROJECT_REF_IN_SOURCE = [
	/x-project-id/i,
	/c\.req\.query\(\s*["']projectId["']\s*\)/,
	/\bbody\??\.projectId\b/,
	/\{[^}\n]*\bprojectId\b[^}\n]*\}\s*=\s*(?:await\s+)?c\.req\.(?:json|query)/,
];

// `:projectId`-style params, or ANY param directly after a `projects` segment anywhere in the path
// (e.g. /policy/projects/:id, /usage/projects/:id, /cost/projects/:id)
const PROJECT_PARAM_NAME = /:(projectId|project_id|projectID)\b|\/projects\/:[A-Za-z_]+/;
const GUARDED_PREFIX = /^\/projects\/:[A-Za-z]+(\/|$)/;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "__tests__") continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(full);
	}
	return out;
}

function routeKey(r: { method: string; path: string }): string {
	return `${r.method} ${r.path}`;
}

describe("F3-b — route coverage (project-scoped routes are guarded)", () => {
	const registered = [
		...new Map(
			(studioRoutes.routes as Array<{ method: string; path: string }>)
				.filter((r) => r.method !== "ALL" || r.path !== "/*")
				.map((r) => [routeKey(r), r]),
		).values(),
	];

	it("enumerates a plausible number of routes (sanity)", () => {
		expect(registered.length).toBeGreaterThan(200);
		expect(registered.some((r) => GUARDED_PREFIX.test(r.path))).toBe(true);
	});

	it("every route with a project path param is under /projects/:id or allow-listed + asserts tenancy", () => {
		const unguarded = registered.filter((r) => {
			if (GUARDED_PREFIX.test(r.path)) return false;
			return PROJECT_PARAM_NAME.test(r.path);
		});
		const failures: string[] = [];
		for (const r of unguarded) {
			const entry = PROJECT_PARAM_ALLOWLIST.find((a) => a.method === r.method && a.path === r.path);
			if (!entry) {
				failures.push(`${routeKey(r)} — not under /projects/:id and not allow-listed`);
				continue;
			}
			const src = readFileSync(join(STUDIO, entry.file), "utf8");
			if (!src.includes(HELPER)) failures.push(`${routeKey(r)} — ${entry.file} never calls ${HELPER}`);
		}
		expect(failures, `Unguarded project routes:\n${failures.join("\n")}`).toEqual([]);
	});

	it("allow-list entries are real registered routes with a stated reason (no stale exemptions)", () => {
		const keys = new Set(registered.map(routeKey));
		const stale = PROJECT_PARAM_ALLOWLIST.filter((a) => !keys.has(`${a.method} ${a.path}`) || !a.reason.trim());
		expect(stale.map((a) => `${a.method} ${a.path}`)).toEqual([]);
	});

	it("generic guard prefix: no route registers a literal 2nd segment that is really a project id", () => {
		// literal second segments under /projects/ are the guard's exclusions (collection routes)
		const literals = new Set(
			registered
				.map((r) => /^\/projects\/([^/:*][^/]*)/.exec(r.path)?.[1])
				.filter((s): s is string => typeof s === "string"),
		);
		expect([...literals].sort()).toEqual(["from-template", "import"]);
	});

	it("handlers reading a project id from query/header/body call assertProjectInTenant", () => {
		const files = [...walk(join(STUDIO, "routes")), ...walk(join(STUDIO, "control-plane"))];
		const failures: string[] = [];
		for (const file of files) {
			const rel = file.slice(STUDIO.length + 1);
			if (SOURCE_SCAN_EXEMPT[rel]) continue;
			const src = readFileSync(file, "utf8");
			const refs = PROJECT_REF_IN_SOURCE.filter((re) => re.test(src));
			if (refs.length > 0 && !src.includes(HELPER)) {
				failures.push(`${rel} — reads projectId outside the path (${refs.length} pattern(s)) without ${HELPER}`);
			}
		}
		expect(failures, `Files with unguarded project references:\n${failures.join("\n")}`).toEqual([]);
	});
});
