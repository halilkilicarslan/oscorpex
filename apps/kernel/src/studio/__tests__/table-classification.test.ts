// ---------------------------------------------------------------------------
// F0 — table classification registry must stay in sync with the schema.
// Table set T = init.sql CREATE TABLE names + runtime-created tables found in
// non-test sources. Columns and RLS state come from the DB catalog (setup.ts
// has already applied init.sql to the test DB).
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPool } from "./helpers/tenancy.js";

import {
	RLS_ENFORCED_PHASES,
	TABLE_CLASSIFICATION,
	type TableClass,
	type TableClassification,
	tablesByClass,
} from "../tenancy/table-classification.js";

type Entry = TableClassification;
const classification: Record<string, Entry> = TABLE_CLASSIFICATION;
const ALL_CLASSES: TableClass[] = ["tenant-owned", "pre-tenant", "global", "system", "legacy"];
// Name must be followed by "(" so prose in comments ("CREATE TABLE definitions above") is ignored.
const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
const stripSqlComments = (sql: string): string => sql.replace(/--.*$/gm, "");

// Explicit, user-approved non-tenant set. Making a table non-tenant requires editing this list.
const EXPECTED_GLOBAL = [
	"agent_strategies",
	"ai_providers",
	"capability_snapshots",
	"provider_runtime_registry",
	"registered_plugins",
	"team_templates",
];
const EXPECTED_SYSTEM = [
	"cli_probe_events",
	"cli_probe_settings",
	"cli_usage_snapshots",
	"operator_actions",
	"operator_flags",
	"provider_state",
	"schema_meta",
];
const EXPECTED_LEGACY = [
	"jobs",
	"marketplace_items",
	"voltagent_memory_conversations",
	"voltagent_memory_messages",
	"voltagent_memory_steps",
	"voltagent_memory_workflow_states",
];
const EXPECTED_NON_TENANT = [...EXPECTED_GLOBAL, ...EXPECTED_SYSTEM, ...EXPECTED_LEGACY].sort();

function namesIn(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(CREATE_TABLE_RE)) {
		if (m[1].toLowerCase() !== "if") out.push(m[1].toLowerCase());
	}
	return out;
}

function walkTs(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "__tests__" || name === "dist") continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walkTs(p, acc);
		else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) acc.push(p);
	}
	return acc;
}

const initSql = stripSqlComments(readFileSync(join(process.cwd(), "scripts", "init.sql"), "utf8"));
const initSqlNames = namesIn(initSql);
const initSqlLineCount = initSql.split("\n").filter((l) => /create\s+table/i.test(l)).length;

const runtimeNames = new Set<string>();
for (const root of [
	resolve(process.cwd(), "src"),
	resolve(process.cwd(), "..", "..", "packages", "control-plane", "src"),
]) {
	for (const file of walkTs(root)) {
		for (const n of namesIn(readFileSync(file, "utf8"))) runtimeNames.add(n);
	}
}

const T = new Set<string>([...initSqlNames, ...runtimeNames]);

interface DbState {
	columns: Map<string, Set<string>>;
	rls: Set<string>;
	forceRls: Set<string>;
	publicTables: Set<string>;
}

async function loadCatalog(): Promise<DbState> {
	const pool = getPool();
	const cols = await pool.query<{ table_name: string; column_name: string }>(
		`SELECT c.relname AS table_name, a.attname AS column_name
		 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`,
	);
	const columns = new Map<string, Set<string>>();
	for (const r of cols.rows) {
		if (!T.has(r.table_name)) continue;
		if (!columns.has(r.table_name)) columns.set(r.table_name, new Set());
		columns.get(r.table_name)?.add(r.column_name);
	}
	const rlsRes = await pool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
		`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
		 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
	);
	const rls = new Set(rlsRes.rows.filter((r) => r.relrowsecurity && T.has(r.relname)).map((r) => r.relname));
	const forceRls = new Set(rlsRes.rows.filter((r) => r.relforcerowsecurity && T.has(r.relname)).map((r) => r.relname));
	const pt = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
	return { columns, rls, forceRls, publicTables: new Set(pt.rows.map((r) => r.tablename)) };
}

function expectedTenantKey(cols: Set<string>): Entry["tenantKey"] {
	if (cols.has("tenant_id")) return "tenant_id";
	if (cols.has("project_id")) return "project_id";
	if (cols.has("task_id")) return "task_id";
	return "none";
}

describe("source of truth", () => {
	it("init.sql CREATE TABLE count matches grep -c style line count with no duplicates", () => {
		expect(new Set(initSqlNames).size).toBe(initSqlNames.length);
		expect(initSqlNames.length).toBe(initSqlLineCount);
	});
});

describe("table classification", () => {
	it("has an entry for every table in T and none outside T", () => {
		const missing = [...T].filter((t) => !(t in classification)).sort();
		const extra = Object.keys(classification)
			.filter((t) => !T.has(t))
			.sort();
		expect(missing, `tables missing from classification: ${missing.join(", ")}`).toEqual([]);
		expect(extra, `classification entries outside T: ${extra.join(", ")}`).toEqual([]);
	});

	it("every table in T exists in the DB catalog (except pgvector-dependent tables without the extension)", async () => {
		const pool = getPool();
		const present = new Set(
			(
				await pool.query<{ table_name: string }>(
					"SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')",
				)
			).rows.map((r) => r.table_name),
		);
		const hasVector = ((await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).rowCount ?? 0) > 0;
		const optional = hasVector ? new Set<string>() : new Set(["rag_embeddings"]);
		const missing = [...T].filter((t) => !present.has(t) && !optional.has(t)).sort();
		expect(missing, `tables in T missing from DB: ${missing.join(", ")}`).toEqual([]);
	});

	it("derives tenantKey from catalog columns (tenant_id > project_id > task_id > none)", async () => {
		const { columns } = await loadCatalog();
		const bad: string[] = [];
		for (const [t, cols] of columns) {
			const e = classification[t];
			if (e && e.tenantKey !== expectedTenantKey(cols)) {
				bad.push(`${t}: expected ${expectedTenantKey(cols)}, got ${e.tenantKey}`);
			}
		}
		expect(bad.sort(), bad.join("; ")).toEqual([]);
	});

	it("classifies every table with tenant_id/project_id/task_id as tenant-owned or pre-tenant", async () => {
		const { columns } = await loadCatalog();
		const bad = [...columns.entries()]
			.filter(([, c]) => c.has("tenant_id") || c.has("project_id") || c.has("task_id"))
			.filter(([t]) => classification[t] && !["tenant-owned", "pre-tenant"].includes(classification[t].class))
			.map(([t]) => t)
			.sort();
		expect(bad, `tenant-keyed tables with wrong class: ${bad.join(", ")}`).toEqual([]);
	});

	it("RLS state in the DB equals rlsPhase in RLS_ENFORCED_PHASES (both directions)", async () => {
		const { rls } = await loadCatalog();
		const enforced = new Set(
			Object.entries(classification)
				.filter(([, e]) => e.rlsPhase !== null && (RLS_ENFORCED_PHASES as readonly string[]).includes(e.rlsPhase))
				.map(([t]) => t),
		);
		const rlsNotClassified = [...rls].filter((t) => !enforced.has(t)).sort();
		const classifiedNotRls = [...enforced].filter((t) => T.has(t) && !rls.has(t)).sort();
		expect(rlsNotClassified, `RLS enabled in DB but phase not enforced: ${rlsNotClassified.join(", ")}`).toEqual([]);
		expect(classifiedNotRls, `phase enforced but no RLS in DB: ${classifiedNotRls.join(", ")}`).toEqual([]);
	});

	it("FORCE RLS in the DB equals rlsPhase in RLS_ENFORCED_PHASES (both directions)", async () => {
		const { forceRls } = await loadCatalog();
		const enforced = new Set(
			Object.entries(classification)
				.filter(([, e]) => e.rlsPhase !== null && (RLS_ENFORCED_PHASES as readonly string[]).includes(e.rlsPhase))
				.map(([t]) => t),
		);
		const forcedNotClassified = [...forceRls].filter((t) => !enforced.has(t)).sort();
		const classifiedNotForced = [...enforced].filter((t) => T.has(t) && !forceRls.has(t)).sort();
		expect(forcedNotClassified, `FORCE RLS but phase not enforced: ${forcedNotClassified.join(", ")}`).toEqual([]);
		expect(classifiedNotForced, `phase enforced but no FORCE RLS: ${classifiedNotForced.join(", ")}`).toEqual([]);
	});

	it("every public table in the DB is in T (allow-list: transient f1a_ probe tables)", async () => {
		const { publicTables } = await loadCatalog();
		const stray = [...publicTables].filter((t) => !T.has(t) && !t.startsWith("f1a_")).sort();
		expect(stray, `public tables not in T: ${stray.join(", ")}`).toEqual([]);
	});

	it("RLS_ENFORCED_PHASES is currently exactly F1", () => {
		expect([...RLS_ENFORCED_PHASES]).toEqual(["F1"]);
	});

	it("rlsPhase is non-null only for tenant-owned and pre-tenant", () => {
		const bad = Object.entries(classification)
			.filter(([, e]) => {
				const needs = e.class === "tenant-owned" || e.class === "pre-tenant";
				return needs ? e.rlsPhase === null : e.rlsPhase !== null;
			})
			.map(([t, e]) => `${t} (${e.class}, ${e.rlsPhase})`)
			.sort();
		expect(bad, bad.join("; ")).toEqual([]);
	});

	it("writer follows class rules and sharedRows only appears on tenant-owned", () => {
		const bad: string[] = [];
		for (const [t, e] of Object.entries(classification)) {
			const w = e.writer;
			let ok: boolean;
			if (e.class === "tenant-owned" || e.class === "pre-tenant") ok = w === "tenant";
			else if (e.class === "legacy") ok = w === "system-only";
			else ok = w === "platform-admin" || w === "system-only";
			if (!ok) bad.push(`${t}: class ${e.class} writer ${String(w)}`);
			if (e.sharedRows !== undefined && (e.sharedRows !== true || e.class !== "tenant-owned")) {
				bad.push(`${t}: sharedRows not allowed on ${e.class}`);
			}
		}
		expect(bad.sort(), bad.join("; ")).toEqual([]);
	});

	it("non-tenant set (global + system + legacy) equals the hard-coded approved list", () => {
		const actual = Object.entries(classification)
			.filter(([, e]) => e.class === "global" || e.class === "system" || e.class === "legacy")
			.map(([t]) => t)
			.sort();
		expect(actual).toEqual(EXPECTED_NON_TENANT);
		expect(tablesByClass("global")).toEqual(EXPECTED_GLOBAL);
		expect(tablesByClass("system")).toEqual(EXPECTED_SYSTEM);
		expect(tablesByClass("legacy")).toEqual(EXPECTED_LEGACY);
	});

	it("approved writers for platform and system tables", () => {
		for (const t of [
			"ai_providers",
			"registered_plugins",
			"provider_runtime_registry",
			"operator_flags",
			"operator_actions",
		]) {
			expect(classification[t]?.writer, t).toBe("platform-admin");
		}
		for (const t of [
			"cli_probe_events",
			"cli_probe_settings",
			"cli_usage_snapshots",
			"provider_state",
			"schema_meta",
		]) {
			expect(classification[t]?.writer, t).toBe("system-only");
		}
	});

	it("agent_configs, project_templates, skills are tenant-owned F5-6 with shared rows", () => {
		for (const t of ["agent_configs", "project_templates", "skills"]) {
			const e = classification[t];
			expect(e?.class, t).toBe("tenant-owned");
			expect(e?.rlsPhase, t).toBe("F5-6");
			expect(e?.sharedRows, t).toBe(true);
		}
	});

	it("tablesByClass returns sorted names and the union equals all keys", () => {
		const union: string[] = [];
		for (const cls of ALL_CLASSES) {
			const names = tablesByClass(cls);
			expect(names).toEqual([...names].sort());
			for (const n of names) expect(classification[n].class).toBe(cls);
			union.push(...names);
		}
		expect(new Set(union).size).toBe(union.length);
		expect([...union].sort()).toEqual(Object.keys(classification).sort());
	});
});
