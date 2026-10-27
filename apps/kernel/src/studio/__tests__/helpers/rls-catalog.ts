// ---------------------------------------------------------------------------
// Catalog-based RLS assertions. Uses a raw pg client (not ../pg.js) so it keeps
// working in test files that mock the kernel DB modules or node:fs.
// ---------------------------------------------------------------------------

import pg from "pg";
import { expect } from "vitest";

export interface PolicyRow {
	tablename: string;
	policyname: string;
	cmd: string;
	roles: string[];
	qual: string | null;
	with_check: string | null;
}

export const POLICY_SQL =
	"SELECT tablename, policyname, cmd, roles::text[] AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public'";

/**
 * Policy rules for RLS tables:
 *  (a) policies applying to PUBLIC or oscorpex_app: FOR ALL, USING and WITH CHECK both reference app_tenant()
 *      (or, for subquery-policy tables, the project subquery), with no "IS NULL OR" escape;
 *  (b) the only other allowed policy is `sysread_select`: FOR SELECT TO oscorpex_sysread USING (true), no WITH CHECK;
 *  (c) anything else is a problem.
 * Returns human-readable problems (empty = ok) and how many tenant policies each table has.
 */
export function policyProblems(
	rows: PolicyRow[],
	opts: { subqueryTables?: ReadonlySet<string> } = {},
): { problems: string[]; tenantPolicies: Map<string, number> } {
	const problems: string[] = [];
	const tenantPolicies = new Map<string, number>();
	for (const r of rows) {
		const id = `${r.tablename}.${r.policyname}`;
		const appliesToApp = r.roles.includes("public") || r.roles.includes("oscorpex_app");
		if (appliesToApp) {
			tenantPolicies.set(r.tablename, (tenantPolicies.get(r.tablename) ?? 0) + 1);
			if (r.cmd !== "ALL") problems.push(`${id}: cmd ${r.cmd}, expected ALL`);
			const viaSubquery = opts.subqueryTables?.has(r.tablename) ?? false;
			const ok = (e: string) => /app_tenant\(\)/.test(e) || (viaSubquery && /\bprojects\b/.test(e));
			for (const [label, expr] of [
				["USING", r.qual],
				["WITH CHECK", r.with_check],
			] as const) {
				if (expr === null) problems.push(`${id}: null ${label}`);
				else {
					if (!ok(expr)) problems.push(`${id}: ${label} does not reference app_tenant()`);
					if (/IS NULL OR/i.test(expr)) problems.push(`${id}: ${label} contains IS NULL OR`);
				}
			}
		} else if (
			r.policyname === "sysread_select" &&
			r.cmd === "SELECT" &&
			r.roles.length === 1 &&
			r.roles[0] === "oscorpex_sysread" &&
			r.qual === "true" &&
			r.with_check === null
		) {
			// allowed system read policy
		} else {
			problems.push(`${id}: unexpected policy (cmd ${r.cmd}, roles ${r.roles.join(",")})`);
		}
	}
	return { problems, tenantPolicies };
}

/** Assert RLS is enabled+forced on `table` and that it has a tenant policy (USING + WITH CHECK via app_tenant()). */
export async function expectTenantRlsInCatalog(table: string): Promise<void> {
	const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		const cls = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
			`SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relname = $1`,
			[table],
		);
		expect(cls.rows, `${table} must exist`).toHaveLength(1);
		expect(cls.rows[0].relrowsecurity, `${table} RLS enabled`).toBe(true);
		expect(cls.rows[0].relforcerowsecurity, `${table} RLS forced`).toBe(true);
		const pol = await client.query<PolicyRow>(`${POLICY_SQL} AND tablename = $1`, [table]);
		const { problems, tenantPolicies } = policyProblems(pol.rows);
		expect(problems, problems.join("; ")).toEqual([]);
		expect(tenantPolicies.get(table) ?? 0, `${table} has a tenant policy`).toBeGreaterThanOrEqual(1);
	} finally {
		await client.end();
	}
}
