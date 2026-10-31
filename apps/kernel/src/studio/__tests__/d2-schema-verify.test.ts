// ---------------------------------------------------------------------------
// D2 — schema verify mode, missing init.sql handling, production bootstrap rules.
// All destructive work happens in a scratch database (see helpers/scratch-db.ts).
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applySchema } from "../db-bootstrap.js";
import { TABLE_CLASSIFICATION } from "../tenancy/table-classification.js";
import { type ScratchDb, createScratchDb, findLeftovers, withClient } from "./helpers/scratch-db.js";

interface BootstrapModule {
	applySchema: (o?: Record<string, unknown>) => Promise<{ applied: boolean; reason: string }>;
	applyDbBootstrap: () => Promise<void>;
	verifySchema?: (o?: { runtimeUrl?: string; schemaPath?: string }) => Promise<void>;
	SchemaNotReadyError?: new (...a: never[]) => Error;
}

const load = async (): Promise<BootstrapModule> => (await import("../db-bootstrap.js")) as unknown as BootstrapModule;

async function verify(opts?: { runtimeUrl?: string; schemaPath?: string }): Promise<void> {
	const mod = await load();
	expect(typeof mod.verifySchema, "db-bootstrap must export verifySchema").toBe("function");
	await (mod.verifySchema as NonNullable<typeof mod.verifySchema>)(opts);
}

async function expectNotReady(p: Promise<void>): Promise<void> {
	// attach the handler before any await so an early assertion failure cannot leave p unhandled
	const settled = p.then(
		() => undefined,
		(e: unknown) => e,
	);
	const mod = await load();
	expect(typeof mod.SchemaNotReadyError, "db-bootstrap must export SchemaNotReadyError").toBe("function");
	const err = await settled;
	expect(err, "expected SchemaNotReadyError").toBeInstanceOf(Error);
	expect(err).toBeInstanceOf(mod.SchemaNotReadyError as NonNullable<typeof mod.SchemaNotReadyError>);
	expect((err as Error).name).toBe("SchemaNotReadyError");
	expect((err as Error).message).toMatch(/migrate/i);
}

/** Records every statement issued through pg.Client.query while `fn` runs (calls through to the real query). */
async function captureStatements(fn: () => Promise<void>): Promise<{ statements: string[]; error: unknown }> {
	const statements: string[] = [];
	const original = pg.Client.prototype.query as (...a: unknown[]) => unknown;
	const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
		const first = args[0];
		statements.push(typeof first === "string" ? first : String((first as { text?: string } | undefined)?.text ?? ""));
		return original.apply(this, args);
	} as never);
	try {
		const error = await fn().then(
			() => undefined,
			(e: unknown) => e,
		);
		return { statements, error };
	} finally {
		spy.mockRestore();
	}
}

function expectReadOnlyTransaction(statements: string[]): void {
	expect(statements.length, "verifySchema must issue statements").toBeGreaterThan(2);
	expect(statements[0], "first statement starts a read-only transaction").toMatch(/^\s*BEGIN\b[\s\S]*READ\s+ONLY/i);
	expect(statements[statements.length - 1], "session ends with ROLLBACK").toMatch(/^\s*ROLLBACK\b/i);
	const writes = statements.filter((q) =>
		/^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE|COMMENT|REINDEX|VACUUM|COPY)\b/i.test(q),
	);
	expect(writes, "no DDL/DML/GRANT statements").toEqual([]);
}

const HASH_KEY = "init_sql_sha256";
const ENV_KEYS = ["NODE_ENV", "OSCORPEX_MIGRATION_DATABASE_URL", "DATABASE_URL"] as const;
const f1Table = Object.entries(TABLE_CLASSIFICATION).find(([, e]) => e.rlsPhase === "F1")?.[0] as string;

let scratch: ScratchDb;
let tmp: string;
let bypassRole = "";
let bypassUrl = "";
let appRole = "";
let appUrl = "";
const savedEnv: Record<string, string | undefined> = {};

const setProduction = () => {
	process.env.NODE_ENV = "production";
};
const useScratch = ({ migration }: { migration: boolean }) => {
	process.env.DATABASE_URL = scratch.url;
	if (migration) process.env.OSCORPEX_MIGRATION_DATABASE_URL = scratch.url;
	else Reflect.deleteProperty(process.env, "OSCORPEX_MIGRATION_DATABASE_URL");
};
const restoreSchema = () => applySchema({ migrationUrl: scratch.url, runtimeUrl: scratch.url, force: true });
const storedHash = (): Promise<string | undefined> =>
	withClient(scratch.url, async (c) => {
		const r = await c.query<{ value: string }>("SELECT value FROM public.schema_meta WHERE key = $1", [HASH_KEY]);
		return r.rows[0]?.value;
	});

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), "oscorpex-d2-verify-"));
	scratch = await createScratchDb();
	await restoreSchema();

	// Non-superuser BYPASSRLS login: may read schema_meta, so only the isolation check can fail.
	const suffix = randomBytes(6).toString("hex");
	const password = randomBytes(12).toString("hex");
	bypassRole = `oscorpex_d2_bypass_${suffix}`;
	await withClient(scratch.url, async (c) => {
		await c.query(`CREATE ROLE ${bypassRole} LOGIN PASSWORD '${password}' NOSUPERUSER BYPASSRLS`);
		await c.query(`GRANT CONNECT ON DATABASE ${new URL(scratch.url).pathname.slice(1)} TO ${bypassRole}`);
		await c.query(`GRANT USAGE ON SCHEMA public TO ${bypassRole}`);
		await c.query(`GRANT SELECT ON public.schema_meta TO ${bypassRole}`);
	});
	const u = new URL(scratch.url);
	u.username = bypassRole;
	u.password = password;
	bypassUrl = u.toString();

	// Plain oscorpex_app member: cannot read schema_meta (revoked from oscorpex_app).
	const appPassword = randomBytes(12).toString("hex");
	appRole = `oscorpex_d2_app_${suffix}`;
	await withClient(scratch.url, async (c) => {
		await c.query(`CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOBYPASSRLS`);
		await c.query(`GRANT oscorpex_app TO ${appRole}`);
		await c.query(`GRANT CONNECT ON DATABASE ${scratch.name} TO ${appRole}`);
	});
	const a = new URL(scratch.url);
	a.username = appRole;
	a.password = appPassword;
	appUrl = a.toString();
}, 120_000);

afterAll(async () => {
	rmSync(tmp, { recursive: true, force: true });
	const roles = [bypassRole, appRole].filter(Boolean);
	if (scratch) {
		await withClient(scratch.url, async (c) => {
			for (const role of roles) {
				await c.query(`DROP OWNED BY ${role}`);
				await c.query(`DROP ROLE IF EXISTS ${role}`);
			}
		});
		await scratch.drop();
		expect(await findLeftovers({ roles, database: scratch.name }), "scratch resources leaked").toEqual([]);
	}
});

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = savedEnv[k];
	}
});

describe("D2 verify mode", () => {
	it("a. passes on a freshly migrated database (verifySchema and production applyDbBootstrap without migration URL)", async () => {
		setProduction();
		useScratch({ migration: false });
		await expect(verify({ runtimeUrl: scratch.url })).resolves.toBeUndefined();
		await expect(verify()).resolves.toBeUndefined();
		await expect((await load()).applyDbBootstrap()).resolves.toBeUndefined();
	});

	it("b. performs no writes (schema_meta, catalog object counts, role memberships)", async () => {
		const snapshot = () =>
			withClient(scratch.url, async (c) => {
				const meta = await c.query("SELECT key, value, updated_at FROM public.schema_meta ORDER BY key");
				const counts = await c.query(
					`SELECT (SELECT count(*) FROM pg_class)::int AS classes, (SELECT count(*) FROM pg_policy)::int AS policies,
					        (SELECT count(*) FROM pg_proc)::int AS procs, (SELECT count(*) FROM pg_auth_members)::int AS members`,
				);
				return { meta: meta.rows, counts: counts.rows[0] };
			});
		const before = await snapshot();
		setProduction();
		useScratch({ migration: false });
		await verify({ runtimeUrl: scratch.url });
		await verify();
		expect(await snapshot()).toEqual(before);
	});

	it("c. throws SchemaNotReadyError (migrate) when schema_meta is missing", async () => {
		await withClient(scratch.url, (c) => c.query("DROP TABLE public.schema_meta"));
		try {
			setProduction();
			useScratch({ migration: false });
			await expectNotReady(verify());
		} finally {
			await restoreSchema();
		}
	});

	it("c2. throws SchemaNotReadyError when the hash row is missing", async () => {
		await withClient(scratch.url, (c) => c.query("DELETE FROM public.schema_meta WHERE key = $1", [HASH_KEY]));
		try {
			setProduction();
			useScratch({ migration: false });
			await expectNotReady(verify());
		} finally {
			await restoreSchema();
		}
	});

	it("d. throws SchemaNotReadyError when the stored hash differs", async () => {
		await withClient(scratch.url, (c) =>
			c.query("UPDATE public.schema_meta SET value = 'deadbeef' WHERE key = $1", [HASH_KEY]),
		);
		try {
			setProduction();
			useScratch({ migration: false });
			await expectNotReady(verify());
			await expectNotReady((await load()).applyDbBootstrap());
		} finally {
			await restoreSchema();
		}
	});

	it("d2. honours schemaPath: an init.sql that hashes differently is not ready", async () => {
		const modified = join(tmp, "modified-init.sql");
		writeFileSync(modified, `${readFileSync(join(process.cwd(), "scripts", "init.sql"), "utf8")}\n-- d2 drift\n`);
		setProduction();
		useScratch({ migration: false });
		await expectNotReady(verify({ schemaPath: modified }));
	});

	it("e. throws SchemaNotReadyError on catalog drift (tenant_isolation policy dropped)", async () => {
		expect(f1Table, "an F1 table must exist in TABLE_CLASSIFICATION").toBeTruthy();
		await withClient(scratch.url, (c) => c.query(`DROP POLICY tenant_isolation ON public.${f1Table}`));
		try {
			setProduction();
			useScratch({ migration: false });
			// hash still matches, so only the catalog check can detect this
			expect(await storedHash()).toBeTruthy();
			await expectNotReady(verify());
		} finally {
			await restoreSchema();
		}
	});
});

describe("D2 verify read-only session and privileges", () => {
	it("b2. verifySchema reads inside BEGIN READ ONLY ... ROLLBACK and issues no DDL/DML/GRANT", async () => {
		setProduction();
		useScratch({ migration: false });
		const { statements, error } = await captureStatements(() => verify({ runtimeUrl: scratch.url }));
		expect(error).toBeUndefined();
		expectReadOnlyTransaction(statements);
	});

	it("b3. the read-only transaction is also rolled back on the error paths (schema_meta missing, hash differs)", async () => {
		setProduction();
		useScratch({ migration: false });

		await withClient(scratch.url, (c) =>
			c.query("UPDATE public.schema_meta SET value = 'deadbeef' WHERE key = $1", [HASH_KEY]),
		);
		try {
			const hashCase = await captureStatements(() => verify());
			expect(hashCase.error, "hash mismatch must reject").toBeInstanceOf(Error);
			expectReadOnlyTransaction(hashCase.statements);
		} finally {
			await restoreSchema();
		}

		await withClient(scratch.url, (c) => c.query("DROP TABLE public.schema_meta"));
		try {
			const missingCase = await captureStatements(() => verify());
			expect(missingCase.error, "missing schema_meta must reject").toBeInstanceOf(Error);
			expectReadOnlyTransaction(missingCase.statements);
		} finally {
			await restoreSchema();
		}
	});

	it("k. a plain oscorpex_app member cannot read schema_meta: SchemaNotReadyError, not a raw pg error", async () => {
		setProduction();
		useScratch({ migration: false });
		const mod = await load();
		const err = await verify({ runtimeUrl: appUrl }).then(
			() => undefined,
			(e: unknown) => e,
		);
		expect(err, "expected an error").toBeInstanceOf(Error);
		// verifySchema must be exported for this to be meaningful
		expect(typeof mod.SchemaNotReadyError, "db-bootstrap must export SchemaNotReadyError").toBe("function");
		expect(err).toBeInstanceOf(mod.SchemaNotReadyError as NonNullable<typeof mod.SchemaNotReadyError>);
		expect((err as Error).message).toMatch(/schema_meta/);
		expect((err as Error).message).toMatch(/privilege/i);
	});
});

describe("D2 verify runtime isolation", () => {
	it("j. a BYPASSRLS runtime login is fatal in production and only a warning outside it", async () => {
		// earlier tests drop/recreate schema_meta, which loses its grants: re-grant so j is order-independent
		await withClient(scratch.url, async (c) => {
			await c.query(`GRANT CONNECT ON DATABASE ${new URL(scratch.url).pathname.slice(1)} TO ${bypassRole}`);
			await c.query(`GRANT USAGE ON SCHEMA public TO ${bypassRole}`);
			await c.query(`GRANT SELECT ON public.schema_meta TO ${bypassRole}`);
		});
		useScratch({ migration: false });
		setProduction();
		await expect(verify({ runtimeUrl: bypassUrl })).rejects.toThrow(/BYPASSRLS/);

		process.env.NODE_ENV = "development";
		await expect(verify({ runtimeUrl: bypassUrl })).resolves.toBeUndefined();
	});
});

describe("D2 missing init.sql", () => {
	const missing = () => join(tmp, "does-not-exist", "init.sql");

	it("f. production: verifySchema and applySchema throw naming init.sql", async () => {
		setProduction();
		useScratch({ migration: true });
		await expect(verify({ schemaPath: missing() })).rejects.toThrow(/init\.sql/);
		await expect(
			applySchema({ migrationUrl: scratch.url, runtimeUrl: scratch.url, schemaPath: missing() } as never),
		).rejects.toThrow(/init\.sql/);
		await expect(
			applySchema({ migrationUrl: scratch.url, runtimeUrl: scratch.url, schemaPath: missing() } as never),
		).rejects.toThrow(/missing/i);
	});

	it("f3. verifySchema with a missing schema file throws outside production too", async () => {
		process.env.NODE_ENV = "development";
		useScratch({ migration: false });
		await expect(verify({ schemaPath: missing() })).rejects.toThrow(/init\.sql/);
	});

	it("f2. outside production applySchema keeps returning applied:false/unchanged", async () => {
		process.env.NODE_ENV = "test";
		useScratch({ migration: true });
		await expect(
			applySchema({ migrationUrl: scratch.url, runtimeUrl: scratch.url, schemaPath: missing() } as never),
		).resolves.toEqual({ applied: false, reason: "unchanged" });
	});
});

describe("D2 applyDbBootstrap mode selection", () => {
	it("g. production WITH migration URL takes the apply path (stored hash is restored)", async () => {
		const good = await storedHash();
		await withClient(scratch.url, (c) =>
			c.query("UPDATE public.schema_meta SET value = 'deadbeef' WHERE key = $1", [HASH_KEY]),
		);
		try {
			setProduction();
			useScratch({ migration: true });
			await expect((await load()).applyDbBootstrap()).resolves.toBeUndefined();
			expect(await storedHash()).toBe(good);
		} finally {
			await restoreSchema();
		}
	});

	it("h. outside production without migration URL still applies via the DATABASE_URL fallback", async () => {
		const good = await storedHash();
		await withClient(scratch.url, (c) =>
			c.query("UPDATE public.schema_meta SET value = 'deadbeef' WHERE key = $1", [HASH_KEY]),
		);
		try {
			process.env.NODE_ENV = "development";
			useScratch({ migration: false });
			await expect((await load()).applyDbBootstrap()).resolves.toBeUndefined();
			expect(await storedHash()).toBe(good);
		} finally {
			await restoreSchema();
		}
	});

	it("i. apply failure is fatal in production and only warned outside production", async () => {
		const unreachable = "postgresql://nobody:pw@127.0.0.1:1/nodb";
		process.env.DATABASE_URL = scratch.url;
		process.env.OSCORPEX_MIGRATION_DATABASE_URL = unreachable;

		setProduction();
		await expect((await load()).applyDbBootstrap()).rejects.toThrow();

		process.env.NODE_ENV = "development";
		await expect((await load()).applyDbBootstrap()).resolves.toBeUndefined();
	});
});
