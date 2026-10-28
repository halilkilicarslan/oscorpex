// ---------------------------------------------------------------------------
// F1a — database foundation: connection hardening, roles, ownership,
// privileges, bootstrap and runtime-DDL removal.
// Run with OSCORPEX_MIGRATION_DATABASE_URL pointing at a superuser when the
// runtime user lacks CREATEROLE.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../pg.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";
import { runApplySchema } from "./helpers/apply-schema.js";
import { getPool, roleExists, withAppRole, withMigrator } from "./helpers/tenancy.js";

const KERNEL_ROOT = process.cwd();
const REPO_ROOT = resolve(KERNEL_ROOT, "..", "..");
const KERNEL_SRC = join(KERNEL_ROOT, "src");
const KERNEL_STUDIO = join(KERNEL_SRC, "studio");
const CP_SRC = join(REPO_ROOT, "packages", "control-plane", "src");

function walkTs(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "__tests__" || name === "dist") continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walkTs(p, acc);
		else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) acc.push(p);
	}
	return acc;
}

const rel = (p: string) => p.replace(`${REPO_ROOT}/`, "");

// ---------------------------------------------------------------------------
// 1. No hardcoded DB credentials
// ---------------------------------------------------------------------------
describe("no hardcoded database credentials", () => {
	const saved = process.env.DATABASE_URL;
	afterEach(() => {
		if (saved === undefined) Reflect.deleteProperty(process.env, "DATABASE_URL");
		else process.env.DATABASE_URL = saved;
		vi.resetModules();
	});

	it("kernel pg.ts query() rejects mentioning DATABASE_URL when it is unset", async () => {
		Reflect.deleteProperty(process.env, "DATABASE_URL");
		vi.resetModules();
		const mod = await import("../pg.js");
		await expect(mod.query("SELECT 1")).rejects.toThrow(/DATABASE_URL/);
	});

	it("control-plane pg.ts query() rejects asking for initDb() when not initialised (no own pool)", async () => {
		vi.resetModules();
		const mod = await import("../../../../../packages/control-plane/src/pg.js");
		await expect(mod.query("SELECT 1")).rejects.toThrow(/initDb/);
	});

	it("pg-listener start() rejects mentioning DATABASE_URL when it is unset", async () => {
		Reflect.deleteProperty(process.env, "DATABASE_URL");
		vi.resetModules();
		const mod = await import("../pg-listener.js");
		try {
			await expect(mod.pgListener.start()).rejects.toThrow(/DATABASE_URL/);
		} finally {
			await mod.pgListener.stop?.();
		}
	});

	it("no source file contains a postgres://user:password@ literal", () => {
		const files = [...walkTs(KERNEL_STUDIO), ...walkTs(CP_SRC)].filter((f) => !f.endsWith("db-provisioner.ts"));
		const hits = files.filter((f) => /postgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@/.test(readFileSync(f, "utf8")));
		const bad = hits.filter((f) => /postgres(?:ql)?:\/\/user:password@/.test(readFileSync(f, "utf8")));
		expect(bad.map(rel), "files with user:password@ literal").toEqual([]);
		const withCreds = hits.map(rel);
		expect(withCreds, `files embedding connection-string credentials: ${withCreds.join(", ")}`).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 2. env-sanitizer
// ---------------------------------------------------------------------------
describe("env-sanitizer database patterns", () => {
	it("strips database-related variables and keeps safe ones", () => {
		const base = {
			PGPASSWORD: "x",
			PGHOST: "x",
			PGUSER: "x",
			REPLICA_DATABASE_URL: "x",
			FOO_DATABASE_URL: "x",
			ANALYTICS_DSN: "x",
			POSTGRES_PASSWORD: "x",
			PATH: "/usr/bin",
			HOME: "/home/u",
			NODE_ENV: "test",
		};
		const env = buildSafeChildEnv({ profile: "app_runner", base });
		for (const k of [
			"PGPASSWORD",
			"PGHOST",
			"PGUSER",
			"REPLICA_DATABASE_URL",
			"FOO_DATABASE_URL",
			"ANALYTICS_DSN",
			"POSTGRES_PASSWORD",
		]) {
			expect(env[k], k).toBeUndefined();
		}
		expect(env.PATH).toBe("/usr/bin");
		expect(env.HOME).toBe("/home/u");
		expect(env.NODE_ENV).toBe("test");
	});
});

// ---------------------------------------------------------------------------
// 3. docker-compose files
// ---------------------------------------------------------------------------
describe("docker compose hardening", () => {
	const files = ["docker-compose.yml", "docker-compose.dev.yml"].map((f) => ({
		name: f,
		text: readFileSync(join(REPO_ROOT, f), "utf8"),
	}));

	function serviceBlock(text: string, service: string): string | null {
		const lines = text.split("\n");
		const start = lines.findIndex((l) => new RegExp(`^ {2}${service}:\\s*$`).test(l));
		if (start === -1) return null;
		let end = lines.length;
		for (let i = start + 1; i < lines.length; i++) {
			if (/^ {2}\S/.test(lines[i]) || /^\S/.test(lines[i])) {
				end = i;
				break;
			}
		}
		return lines.slice(start, end).join("\n");
	}

	for (const { name, text } of files) {
		it(`${name}: no literal oscorpex_dev password`, () => {
			expect(text).not.toContain("oscorpex_dev");
		});

		it(`${name}: postgres port is published only on 127.0.0.1`, () => {
			const block = serviceBlock(text, "postgres");
			if (block === null) return;
			const ports = [...block.matchAll(/^\s*-\s*"?([^"\n]*\b5432\b[^"\n]*)"?\s*$/gm)].map((m) => m[1].trim());
			for (const p of ports) {
				// container-only ("5432") is not published; any host mapping must bind loopback.
				if (/^5432(\/\w+)?$/.test(p)) continue;
				expect(p, `port mapping ${p}`).toMatch(/^127\.0\.0\.1:/);
			}
		});
	}

	it("docker-compose.yml: kernel service defines OSCORPEX_MIGRATION_DATABASE_URL via ${...} interpolation", () => {
		const block = serviceBlock(files[0].text, "backend");
		expect(block, "backend service block").not.toBeNull();
		const line = (block ?? "").split("\n").find((l) => l.includes("OSCORPEX_MIGRATION_DATABASE_URL="));
		expect(line, "OSCORPEX_MIGRATION_DATABASE_URL line in backend service").toBeDefined();
		expect(line).toMatch(/\$\{[A-Z_]*PASSWORD/);
		expect(line).not.toContain("oscorpex_dev");
	});

	it("docker-compose.yml: requires POSTGRES_PASSWORD and interpolates it into DATABASE_URL", () => {
		const text = files[0].text;
		expect(text).toContain("${POSTGRES_PASSWORD:?");
		const dbUrl = text.split("\n").find((l) => l.includes("DATABASE_URL="));
		expect(dbUrl, "kernel DATABASE_URL line").toBeDefined();
		expect(dbUrl).toContain("${POSTGRES_PASSWORD");
	});
});

// ---------------------------------------------------------------------------
// 4-7. Roles, ownership, privileges, runtime login
// ---------------------------------------------------------------------------
interface RoleRow {
	rolname: string;
	rolcanlogin: boolean;
	rolsuper: boolean;
	rolbypassrls: boolean;
}

async function roleRow(name: string): Promise<RoleRow | undefined> {
	const { rows } = await getPool().query<RoleRow>(
		"SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
		[name],
	);
	return rows[0];
}

describe("roles", () => {
	it("oscorpex_owner exists and is NOLOGIN", async () => {
		const r = await roleRow("oscorpex_owner");
		expect(r, "oscorpex_owner missing").toBeDefined();
		expect(r?.rolcanlogin).toBe(false);
	});

	it("oscorpex_sysread exists and is NOLOGIN", async () => {
		const r = await roleRow("oscorpex_sysread");
		expect(r, "oscorpex_sysread missing").toBeDefined();
		expect(r?.rolcanlogin).toBe(false);
	});

	it("oscorpex_migrator exists", async () => {
		expect(await roleRow("oscorpex_migrator")).toBeDefined();
	});

	it("oscorpex_app is LOGIN, NOSUPERUSER, NOBYPASSRLS and not a member of oscorpex_owner", async () => {
		const r = await roleRow("oscorpex_app");
		expect(r, "oscorpex_app missing").toBeDefined();
		expect(r?.rolcanlogin).toBe(true);
		expect(r?.rolsuper).toBe(false);
		expect(r?.rolbypassrls).toBe(false);
		const { rows } = await getPool()
			.query<{ m: boolean }>("SELECT pg_has_role('oscorpex_app', 'oscorpex_owner', 'member') AS m")
			.catch(() => ({ rows: [{ m: true }] }));
		expect(rows[0].m).toBe(false);
	});
});

describe("ownership and privileges", () => {
	it("every public table and sequence is owned by oscorpex_owner", async () => {
		const { rows } = await getPool().query<{ relname: string; owner: string }>(
			`SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
			 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND pg_get_userbyid(c.relowner) <> 'oscorpex_owner'
			 ORDER BY c.relname`,
		);
		const bad = rows.map((r) => `${r.relname} (${r.owner})`);
		expect(bad, `objects not owned by oscorpex_owner: ${bad.join(", ")}`).toEqual([]);
	});

	it("oscorpex_app has DML on every public table and USAGE on every sequence", async () => {
		expect(await roleExists("oscorpex_app"), "oscorpex_app missing").toBe(true);
		const { rows } = await getPool().query<{ relname: string; kind: string; ok: boolean }>(
			`SELECT c.relname, c.relkind AS kind,
			   CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('oscorpex_app', c.oid, 'USAGE')
			        ELSE has_table_privilege('oscorpex_app', c.oid, 'SELECT')
			         AND has_table_privilege('oscorpex_app', c.oid, 'INSERT')
			         AND has_table_privilege('oscorpex_app', c.oid, 'UPDATE')
			         AND has_table_privilege('oscorpex_app', c.oid, 'DELETE') END AS ok
			 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND c.relname NOT IN ('users', 'schema_meta')`,
		);
		const bad = rows.filter((r) => !r.ok).map((r) => r.relname);
		expect(rows.length).toBeGreaterThan(50);
		expect(bad, `missing privileges on: ${bad.join(", ")}`).toEqual([]);
	});

	it("oscorpex_app on users: table-level SELECT/DELETE, column-level INSERT/UPDATE except is_platform_admin", async () => {
		const t = await getPool().query<{ sel: boolean; del: boolean }>(
			`SELECT has_table_privilege('oscorpex_app', 'public.users', 'SELECT') AS sel,
			        has_table_privilege('oscorpex_app', 'public.users', 'DELETE') AS del`,
		);
		expect(t.rows[0]).toEqual({ sel: true, del: true });
		const { rows } = await getPool().query<{ column_name: string; ins: boolean; upd: boolean }>(
			`SELECT column_name,
			        has_column_privilege('oscorpex_app', 'public.users', column_name, 'INSERT') AS ins,
			        has_column_privilege('oscorpex_app', 'public.users', column_name, 'UPDATE') AS upd
			 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`,
		);
		const admin = rows.find((r) => r.column_name === "is_platform_admin");
		expect(admin, "users.is_platform_admin missing").toBeDefined();
		expect(admin?.ins).toBe(false);
		expect(admin?.upd).toBe(false);
		const bad = rows
			.filter((r) => r.column_name !== "is_platform_admin" && !(r.ins && r.upd))
			.map((r) => r.column_name);
		expect(bad, `users columns not writable: ${bad.join(", ")}`).toEqual([]);
	});

	it("oscorpex_app has no CREATE on schema public", async () => {
		expect(await roleExists("oscorpex_app"), "oscorpex_app missing").toBe(true);
		const { rows } = await getPool().query<{ c: boolean }>(
			"SELECT has_schema_privilege('oscorpex_app', 'public', 'CREATE') AS c",
		);
		expect(rows[0].c).toBe(false);
	});

	it("default privileges grant DML on new owner tables to oscorpex_app", async () => {
		await withMigrator(async (client) => {
			try {
				await client.query("SET ROLE oscorpex_owner");
				await client.query("CREATE TABLE public.f1a_defpriv_probe (id int)");
				await client.query("RESET ROLE");
				const { rows } = await client.query<{ ok: boolean }>(
					`SELECT has_table_privilege('oscorpex_app', 'public.f1a_defpriv_probe', 'SELECT')
					   AND has_table_privilege('oscorpex_app', 'public.f1a_defpriv_probe', 'INSERT')
					   AND has_table_privilege('oscorpex_app', 'public.f1a_defpriv_probe', 'UPDATE')
					   AND has_table_privilege('oscorpex_app', 'public.f1a_defpriv_probe', 'DELETE') AS ok`,
				);
				expect(rows[0].ok).toBe(true);
			} finally {
				await client.query("RESET ROLE").catch(() => undefined);
				await client.query("DROP TABLE IF EXISTS public.f1a_defpriv_probe").catch(() => undefined);
			}
		});
	});
});

describe("runtime login", () => {
	it("the DATABASE_URL user is a member of oscorpex_app (unless superuser)", async () => {
		const user = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").username);
		const { rows } = await getPool().query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = $1", [
			user,
		]);
		expect(rows[0], `runtime user ${user} not found`).toBeDefined();
		if (rows[0].rolsuper) return;
		const m = await getPool().query<{ m: boolean }>("SELECT pg_has_role($1, 'oscorpex_app', 'member') AS m", [user]);
		expect(m.rows[0].m).toBe(true);
	});

	it("withAppRole(null, ...) works and runs as oscorpex_app", async () => {
		const who = await withAppRole(null, async (client) => {
			const { rows } = await client.query<{ u: string }>("SELECT current_user AS u");
			return rows[0].u;
		});
		expect(who).toBe("oscorpex_app");
	});
});

// ---------------------------------------------------------------------------
// 8. applySchema
// ---------------------------------------------------------------------------
describe("applySchema", () => {
	it("serializes concurrent calls and is idempotent", async () => {
		await expect(Promise.all([runApplySchema(), runApplySchema()])).resolves.toBeDefined();
		await expect(runApplySchema()).resolves.toMatchObject({ applied: false, reason: "unchanged" });
	}, 120_000);

	it("a second session waits on the advisory lock while the first holds it", async () => {
		const key = "7203151907"; // SCHEMA_LOCK_KEY in db-bootstrap.ts
		const holder = new pg.Client({
			connectionString: process.env.OSCORPEX_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
		});
		await holder.connect();
		let pending: Promise<unknown> | null = null;
		try {
			await holder.query("SELECT pg_advisory_lock($1::bigint)", [key]);
			// force: guarantees the call reaches the locked section regardless of the stored hash
			pending = runApplySchema({ force: true });
			let waiting = false;
			for (let i = 0; i < 100 && !waiting; i++) {
				const { rows } = await getPool().query<{ n: number }>(
					`SELECT count(*)::int AS n FROM pg_locks
					 WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
					   AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
					[key],
				);
				waiting = rows[0].n > 0;
				if (!waiting) await new Promise((r) => setTimeout(r, 100));
			}
			expect(waiting, "applySchema must be waiting on the advisory lock").toBe(true);
		} finally {
			await holder.query("SELECT pg_advisory_unlock($1::bigint)", [key]).catch(() => undefined);
			await holder.end().catch(() => undefined);
		}
		await expect(pending).resolves.toMatchObject({ applied: true });
	}, 120_000);
});

// ---------------------------------------------------------------------------
// 9. users.is_platform_admin
// ---------------------------------------------------------------------------
describe("users.is_platform_admin", () => {
	it("is boolean NOT NULL DEFAULT false", async () => {
		const { rows } = await getPool().query<{ data_type: string; is_nullable: string; column_default: string | null }>(
			`SELECT data_type, is_nullable, column_default FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_platform_admin'`,
		);
		expect(rows[0], "users.is_platform_admin missing").toBeDefined();
		expect(rows[0].data_type).toBe("boolean");
		expect(rows[0].is_nullable).toBe("NO");
		expect(rows[0].column_default).toBe("false");
	});
});

// ---------------------------------------------------------------------------
// 10. withTransaction releases with the error when ROLLBACK fails
// ---------------------------------------------------------------------------
describe("pg.withTransaction", () => {
	it("releases the client with an Error when ROLLBACK itself fails", async () => {
		const release = vi.fn();
		const fake = {
			query: vi.fn(async (sql: string) => {
				if (sql === "ROLLBACK") throw new Error("rollback failed");
				return { rows: [], rowCount: 0 };
			}),
			release,
		};
		const spy = vi.spyOn(pg.Pool.prototype, "connect").mockResolvedValue(fake as never);
		try {
			await expect(
				withTransaction(async () => {
					throw new Error("original failure");
				}),
			).rejects.toThrow("original failure");
			expect(release).toHaveBeenCalledTimes(1);
			expect(release.mock.calls[0][0]).toBeInstanceOf(Error);
		} finally {
			spy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// 11. No runtime DDL
// ---------------------------------------------------------------------------
describe("no runtime DDL", () => {
	it("non-test source has no CREATE TABLE/INDEX, ALTER TABLE or DROP TABLE outside db-bootstrap.ts", () => {
		const ddl = /\b(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b/;
		const hits: string[] = [];
		for (const f of [...walkTs(KERNEL_SRC), ...walkTs(CP_SRC)]) {
			if (f.endsWith(`${"/"}db-bootstrap.ts`)) continue;
			const lines = readFileSync(f, "utf8").split("\n");
			lines.forEach((line, i) => {
				const t = line.trim();
				if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
				if (ddl.test(line)) hits.push(`${rel(f)}:${i + 1}`);
			});
		}
		expect(hits, `runtime DDL found: ${hits.join(", ")}`).toEqual([]);
	});

	it("indexes formerly created at runtime exist in the DB catalog", async () => {
		const expected = [
			"idx_rag_docs_kb",
			"idx_jobs_queue_status",
			"idx_jobs_status",
			"idx_jobs_created",
			"idx_cli_probe_events_provider",
			"idx_cli_usage_snapshots_captured",
			"idx_cli_usage_snapshots_provider",
		];
		const { rows } = await getPool().query<{ indexname: string }>(
			"SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])",
			[expected],
		);
		const present = new Set(rows.map((r) => r.indexname));
		const missing = expected.filter((n) => !present.has(n));
		expect(missing, `missing indexes: ${missing.join(", ")}`).toEqual([]);
	});
});
