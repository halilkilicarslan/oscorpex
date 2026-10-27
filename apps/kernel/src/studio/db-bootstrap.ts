// ---------------------------------------------------------------------------
// Oscorpex — Database bootstrap
// Applies scripts/init.sql as the migration user (superuser, or a role with
// CREATEROLE + BYPASSRLS). The script is applied only when its hash changed
// or the catalog drifted from the expected tenancy state. The runtime user is
// then made a member of oscorpex_app, the DML-only role that RLS applies to.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { createLogger } from "./logger.js";
import { TABLE_CLASSIFICATION } from "./tenancy/table-classification.js";

const log = createLogger("db-bootstrap");

/** Fixed advisory-lock key so concurrent boots/test workers apply the schema one at a time. */
export const SCHEMA_LOCK_KEY = "7203151907";

const HASH_KEY = "init_sql_sha256";
const RLS_MARKER = "rls-f1-r1";
const PRIVILEGED_ROLES = ["oscorpex_owner", "oscorpex_sysread", "oscorpex_migrator"] as const;
const SYS_FUNCTION_NAMES = [
	"sys_project_tenant",
	"sys_event_tenant",
	"sys_running_project_phases",
	"sys_running_projects",
	"sys_api_key_lookup",
	"sys_platform_stats",
] as const;
const SYSREAD_POLICY_TABLES = [
	"projects",
	"pipeline_runs",
	"project_plans",
	"phases",
	"tasks",
	"events",
	"token_usage",
] as const;

export type ApplyReason = "forced" | "changed" | "drift" | "unchanged";

export interface ApplySchemaResult {
	applied: boolean;
	reason: ApplyReason;
}

export interface ApplySchemaOptions {
	/** Connection string of the migration user. Default: OSCORPEX_MIGRATION_DATABASE_URL (DATABASE_URL outside production). */
	migrationUrl?: string;
	/** Connection string of the runtime user. Default: DATABASE_URL. */
	runtimeUrl?: string;
	/** Apply even when the hash is unchanged and there is no drift. */
	force?: boolean;
}

export interface RuntimeIdentity {
	/** current_user of a real runtime connection. */
	runtimeUser: string;
	/** current_user of the migration connection. */
	migratorUser: string;
	rolsuper: boolean;
	rolbypassrls: boolean;
	/** Privileged roles the runtime login is a member of (any inherit/set option, direct or indirect). */
	memberOf: readonly string[];
}

export interface RuntimeIsolationVerdict {
	fatal: string[];
	warnings: string[];
}

const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** The exact SQL that is hashed and executed. */
export function prepareSchemaSql(rawSql: string, opts: { hasVector: boolean }): string {
	if (opts.hasVector) return rawSql;
	return rawSql
		.replace(/^\s*CREATE\s+EXTENSION[^;]*vector[^;]*;/gim, "")
		.replace(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+rag_embeddings[\s\S]*?\);\s*/gi, "")
		.replace(/CREATE\s+INDEX[^;]*rag_embeddings[^;]*;/gi, "");
}

export function schemaHash(sql: string): string {
	return createHash("sha256").update(sql).digest("hex");
}

/**
 * Pure runtime-isolation verdict. Fatal: a non-superuser runtime login that is a member of a privileged
 * role or has BYPASSRLS (RLS would not constrain it). Warnings (fatal from F4): the runtime login is a
 * superuser, or is the migration user.
 */
export function checkRuntimeIsolation(info: RuntimeIdentity, _env?: unknown): RuntimeIsolationVerdict {
	const fatal: string[] = [];
	const warnings: string[] = [];
	if (!info.rolsuper) {
		const roles = info.memberOf.filter((r) => (PRIVILEGED_ROLES as readonly string[]).includes(r));
		if (roles.length > 0) fatal.push(`runtime login ${info.runtimeUser} is a member of ${roles.join(", ")}`);
		if (info.rolbypassrls) fatal.push(`runtime login ${info.runtimeUser} has BYPASSRLS`);
	}
	if (info.rolsuper) warnings.push(`runtime login ${info.runtimeUser} is a superuser`);
	if (info.runtimeUser === info.migratorUser) warnings.push("runtime login is the migrator (migration user)");
	return { fatal, warnings };
}

function resolveMigrationUrl(explicit: string | undefined): string {
	if (explicit) return explicit;
	const fromEnv = process.env.OSCORPEX_MIGRATION_DATABASE_URL;
	if (fromEnv) return fromEnv;
	if (isProduction()) {
		throw new Error("OSCORPEX_MIGRATION_DATABASE_URL is required in production (no DATABASE_URL fallback)");
	}
	const fallback = process.env.DATABASE_URL;
	if (!fallback) throw new Error("DATABASE_URL is not set");
	return fallback;
}

const f1Tables = (): string[] =>
	Object.entries(TABLE_CLASSIFICATION)
		.filter(([, e]) => e.rlsPhase === "F1")
		.map(([t]) => t);

/** Differences between the catalog and the expected tenancy state (empty = no drift). */
async function catalogProblems(client: pg.Client): Promise<string[]> {
	const problems: string[] = [];
	const tables = f1Tables();

	const marker = await client.query<{ m: string | null }>(
		"SELECT obj_description(to_regprocedure('public.app_tenant()'), 'pg_proc') AS m",
	);
	if (marker.rows[0]?.m !== RLS_MARKER) problems.push("rls marker missing");

	const roles = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
		"SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'oscorpex\\_%'",
	);
	const byName = new Map(roles.rows.map((r) => [r.rolname, r]));
	for (const r of ["oscorpex_owner", "oscorpex_sysread", "oscorpex_migrator", "oscorpex_app"]) {
		if (!byName.has(r)) problems.push(`role ${r} missing`);
	}
	const app = byName.get("oscorpex_app");
	if (app && (app.rolsuper || app.rolbypassrls)) problems.push("oscorpex_app is superuser or BYPASSRLS");

	const cls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
		`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
		[tables],
	);
	const flags = new Map(cls.rows.map((r) => [r.relname, r]));
	for (const t of tables) {
		const f = flags.get(t);
		if (!f?.relrowsecurity || !f.relforcerowsecurity) problems.push(`${t}: RLS not enabled+forced`);
	}

	const pol = await client.query<{
		tablename: string;
		policyname: string;
		permissive: string;
		cmd: string;
		roles: string[];
		qual: string | null;
		with_check: string | null;
	}>(
		`SELECT tablename, policyname, permissive, cmd, roles::text[] AS roles, qual, with_check
		 FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
		[tables],
	);
	const tenant = new Map<string, (typeof pol.rows)[number]>();
	const sysread = new Set<string>();
	for (const r of pol.rows) {
		if (r.policyname === "tenant_isolation") tenant.set(r.tablename, r);
		else if (r.policyname === "sysread_select") {
			sysread.add(r.tablename);
			if (r.cmd !== "SELECT" || r.roles.join() !== "oscorpex_sysread" || r.qual !== "true" || r.with_check !== null) {
				problems.push(`${r.tablename}: sysread_select definition drifted`);
			}
		} else problems.push(`${r.tablename}: unexpected policy ${r.policyname}`);
	}
	for (const t of tables) {
		const r = tenant.get(t);
		if (!r) {
			problems.push(`${t}: tenant_isolation policy missing`);
			continue;
		}
		const okExpr = (e: string | null) => e !== null && /app_tenant\(\)/.test(e) && !/IS NULL OR/i.test(e);
		if (
			r.permissive !== "PERMISSIVE" ||
			r.cmd !== "ALL" ||
			r.roles.join() !== "public" ||
			!okExpr(r.qual) ||
			!okExpr(r.with_check)
		) {
			problems.push(`${t}: tenant_isolation definition drifted`);
		}
	}
	for (const t of SYSREAD_POLICY_TABLES) if (!sysread.has(t)) problems.push(`${t}: sysread_select missing`);

	const fns = await client.query<{ proname: string; owner: string; prosecdef: boolean }>(
		`SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef FROM pg_proc p
		 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])`,
		[[...SYS_FUNCTION_NAMES]],
	);
	const fnMap = new Map(fns.rows.map((r) => [r.proname, r]));
	for (const n of SYS_FUNCTION_NAMES) {
		const f = fnMap.get(n);
		if (!f) problems.push(`function ${n} missing`);
		else if (f.owner !== "oscorpex_sysread" || !f.prosecdef) problems.push(`function ${n} drifted`);
	}
	return problems;
}

async function decideReason(client: pg.Client, hash: string, force: boolean): Promise<ApplyReason> {
	if (force) return "forced";
	const meta = await client.query<{ present: boolean }>(
		"SELECT to_regclass('public.schema_meta') IS NOT NULL AS present",
	);
	let stored: string | undefined;
	if (meta.rows[0]?.present) {
		const r = await client.query<{ value: string }>("SELECT value FROM public.schema_meta WHERE key = $1", [HASH_KEY]);
		stored = r.rows[0]?.value;
	}
	if (stored !== hash) return "changed";
	return (await catalogProblems(client)).length === 0 ? "unchanged" : "drift";
}

/**
 * Connect as the runtime login, make it a member of oscorpex_app (via the migration client) and verify
 * it is actually constrained by RLS. Production throws on fatal findings; warnings are always logged.
 */
async function enforceRuntimeIsolation(migrator: pg.Client, runtimeUrl: string | undefined): Promise<void> {
	if (!runtimeUrl) return;
	const runtime = new pg.Client({ connectionString: runtimeUrl });
	runtime.on("error", (err) => log.warn({ err }, "[db-bootstrap] runtime client error"));
	try {
		await runtime.connect();
	} catch (err) {
		if (isProduction()) throw err;
		log.warn({ err }, "[db-bootstrap] runtime login could not connect; isolation not verified");
		return;
	}
	try {
		const who = await runtime.query<{ u: string; rolsuper: boolean; rolbypassrls: boolean }>(
			"SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user",
		);
		const me = await migrator.query<{ u: string }>("SELECT current_user AS u");
		const runtimeUser = who.rows[0].u;
		const migratorUser = me.rows[0].u;
		const { rolsuper, rolbypassrls } = who.rows[0];

		if (!rolsuper && runtimeUser !== migratorUser) {
			const { rows } = await migrator.query<{ stmt: string }>(
				"SELECT format('GRANT oscorpex_app TO %I', $1::text) AS stmt",
				[runtimeUser],
			);
			await migrator.query(rows[0].stmt);
		}
		const memberOf: string[] = [];
		for (const role of PRIVILEGED_ROLES) {
			const r = await migrator.query<{ m: boolean }>("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [runtimeUser, role]);
			if (r.rows[0]?.m) memberOf.push(role);
		}
		const verdict = checkRuntimeIsolation({ runtimeUser, migratorUser, rolsuper, rolbypassrls, memberOf }, process.env);
		for (const w of verdict.warnings) log.error(`[db-bootstrap] ${w}: RLS not enforced until F4`);
		if (verdict.fatal.length > 0) {
			const msg = `Runtime isolation violated: ${verdict.fatal.join("; ")}`;
			if (isProduction()) throw new Error(msg);
			log.error(msg);
		}
	} finally {
		await runtime.end().catch(() => undefined);
	}
}

/**
 * Apply scripts/init.sql when its hash changed, the catalog drifted, or `force` is set.
 * Throws on failure (the boot caller decides whether to continue).
 */
export async function applySchema(opts: ApplySchemaOptions = {}): Promise<ApplySchemaResult> {
	const migrationUrl = resolveMigrationUrl(opts.migrationUrl);
	const runtimeUrl = opts.runtimeUrl ?? process.env.DATABASE_URL;

	let raw: string;
	try {
		raw = await readFile(join(process.cwd(), "scripts", "init.sql"), "utf8");
	} catch {
		// No init script available — schema managed elsewhere (e.g. Docker entrypoint).
		return { applied: false, reason: "unchanged" };
	}

	const client = new pg.Client({ connectionString: migrationUrl });
	client.on("error", (err) => log.warn({ err }, "[db-bootstrap] migration client error"));
	await client.connect();
	let locked = false;
	try {
		await client.query("SELECT pg_advisory_lock($1::bigint)", [SCHEMA_LOCK_KEY]);
		locked = true;
		await client.query("SET lock_timeout = '5s'");

		// pgvector is optional in local dev; skip vector-dependent DDL when it is not installed. A legacy
		// rag_embeddings table whose "vector" column is not of type vector cannot take the ivfflat index either.
		const avail = await client.query<{ available: boolean }>(
			"SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available",
		);
		const legacy = await client.query(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'rag_embeddings' AND column_name = 'vector' AND udt_name <> 'vector'`,
		);
		const script = prepareSchemaSql(raw, {
			hasVector: avail.rows[0]?.available === true && (legacy.rowCount ?? 0) === 0,
		});
		const hash = schemaHash(script);

		const reason = await decideReason(client, hash, opts.force === true);
		if (reason !== "unchanged") {
			// pg's simple-query protocol (no params) supports multi-statement SQL.
			await client.query(script);
			await client.query(
				`INSERT INTO public.schema_meta (key, value) VALUES ($1, $2)
				 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
				[HASH_KEY, hash],
			);
			log.info({ reason }, "[db-bootstrap] scripts/init.sql applied");
			const after = await catalogProblems(client);
			if (after.length > 0) {
				const msg = `Schema drift after apply: ${after.join("; ")}`;
				if (isProduction()) throw new Error(msg);
				log.error(msg);
			}
		}
		await enforceRuntimeIsolation(client, runtimeUrl);
		return { applied: reason !== "unchanged", reason };
	} finally {
		try {
			if (locked) await client.query("SELECT pg_advisory_unlock($1::bigint)", [SCHEMA_LOCK_KEY]);
		} catch (err) {
			log.warn({ err }, "[db-bootstrap] advisory unlock failed");
		}
		await client.end().catch((err) => log.warn({ err }, "[db-bootstrap] client end failed"));
	}
}

/** Boot entry point: warns and continues on failure, except in production where it rethrows. */
export async function applyDbBootstrap(): Promise<void> {
	try {
		await applySchema();
	} catch (err) {
		if (isProduction()) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		log.warn(`[db-bootstrap] init.sql apply failed: ${msg}`);
		log.warn("[db-bootstrap] Continuing — ensure schema is up-to-date manually.");
	}
}
