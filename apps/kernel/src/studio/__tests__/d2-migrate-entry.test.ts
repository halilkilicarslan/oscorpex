// ---------------------------------------------------------------------------
// D2 — `migrate` entry point (src/migrate.ts): applies the schema through the
// migration connection and returns an exit code.
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ScratchDb, createScratchDb, withClient } from "./helpers/scratch-db.js";

const captured: string[] = [];
const record = (...args: unknown[]) => {
	captured.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
};
function safeJson(v: unknown): string {
	try {
		return JSON.stringify(v, Object.getOwnPropertyNames(Object(v)));
	} catch {
		return String(v);
	}
}

vi.mock("../logger.js", () => {
	const make = (): Record<string, unknown> => {
		const l: Record<string, unknown> = {};
		for (const level of ["trace", "debug", "info", "warn", "error", "fatal"])
			l[level] = (...a: unknown[]) => record(...a);
		l.child = () => make();
		return l;
	};
	return { createLogger: () => make(), withContext: (l: unknown) => l, logger: make() };
});

type RunMigrate = (env?: NodeJS.ProcessEnv, opts?: { schemaPath?: string }) => Promise<number>;

async function loadRunMigrate(): Promise<RunMigrate> {
	const mod = (await import("../../migrate.js")) as unknown as { runMigrate?: RunMigrate };
	expect(typeof mod.runMigrate, "src/migrate.ts must export runMigrate").toBe("function");
	return mod.runMigrate as RunMigrate;
}

const HASH_KEY = "init_sql_sha256";
const UNUSED_PORT_URL = "postgresql://nobody:unusedpw@127.0.0.1:1/nodb";

let scratch: ScratchDb;
let tmp: string;
let savedNodeEnv: string | undefined;

/** applySchema reads process.env.NODE_ENV, so the real variable must follow the env argument. */
const setNodeEnv = (v: string) => {
	process.env.NODE_ENV = v;
};

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), "oscorpex-d2-migrate-"));
	scratch = await createScratchDb();
}, 60_000);

afterAll(async () => {
	rmSync(tmp, { recursive: true, force: true });
	await scratch?.drop();
});

beforeEach(() => {
	savedNodeEnv = process.env.NODE_ENV;
	captured.length = 0;
	for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(record);
	vi.spyOn(process.stdout, "write").mockImplementation(((s: unknown) => {
		record(String(s));
		return true;
	}) as never);
	vi.spyOn(process.stderr, "write").mockImplementation(((s: unknown) => {
		record(String(s));
		return true;
	}) as never);
});

afterEach(() => {
	vi.restoreAllMocks();
	if (savedNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
	else process.env.NODE_ENV = savedNodeEnv;
});

describe("D2 runMigrate", () => {
	for (const nodeEnv of ["production", "development"]) {
		it(`a. without OSCORPEX_MIGRATION_DATABASE_URL returns 1 and never connects (NODE_ENV=${nodeEnv}, DATABASE_URL set)`, async () => {
			setNodeEnv(nodeEnv);
			const run = await loadRunMigrate();
			const pg = (await import("pg")).default;
			const connect = vi.spyOn(pg.Client.prototype, "connect");
			const code = await run({ NODE_ENV: nodeEnv, DATABASE_URL: UNUSED_PORT_URL } as NodeJS.ProcessEnv);
			expect(code).toBe(1);
			expect(connect).not.toHaveBeenCalled();
			expect(captured.join("\n")).toContain("OSCORPEX_MIGRATION_DATABASE_URL");
		}, 10_000);
	}

	it("a2. treats an empty OSCORPEX_MIGRATION_DATABASE_URL as missing", async () => {
		const run = await loadRunMigrate();
		const code = await run({
			NODE_ENV: "development",
			OSCORPEX_MIGRATION_DATABASE_URL: "",
			DATABASE_URL: UNUSED_PORT_URL,
		});
		expect(code).toBe(1);
	}, 10_000);

	it("b. applies the schema to the migration database and returns 0", async () => {
		const run = await loadRunMigrate();
		const code = await run({
			NODE_ENV: "development",
			OSCORPEX_MIGRATION_DATABASE_URL: scratch.url,
			DATABASE_URL: scratch.url,
		});
		expect(code).toBe(0);
		const rows = await withClient(scratch.url, (c) =>
			c.query<{ value: string }>("SELECT value FROM public.schema_meta WHERE key = $1", [HASH_KEY]),
		);
		expect(rows.rows[0]?.value).toMatch(/^[0-9a-f]{64}$/);

		// idempotent
		const again = await run({
			NODE_ENV: "development",
			OSCORPEX_MIGRATION_DATABASE_URL: scratch.url,
			DATABASE_URL: scratch.url,
		});
		expect(again).toBe(0);
	}, 120_000);

	it("c. returns 1 on a bad migration URL without printing its password", async () => {
		setNodeEnv("production");
		const run = await loadRunMigrate();
		const code = await run({
			NODE_ENV: "production",
			OSCORPEX_MIGRATION_DATABASE_URL: "postgresql://migrator:SuperSecretPw123@127.0.0.1:1/nodb",
			DATABASE_URL: UNUSED_PORT_URL,
		});
		expect(code).toBe(1);
		expect(captured.length, "an error must be reported").toBeGreaterThan(0);
		expect(captured.join("\n")).not.toContain("SuperSecretPw123");
	}, 20_000);

	it("a3. production without DATABASE_URL returns 1 naming DATABASE_URL and never connects", async () => {
		setNodeEnv("production");
		const run = await loadRunMigrate();
		const pg = (await import("pg")).default;
		const connect = vi.spyOn(pg.Client.prototype, "connect");
		for (const blank of [undefined, "", "   "]) {
			captured.length = 0;
			const code = await run({
				NODE_ENV: "production",
				OSCORPEX_MIGRATION_DATABASE_URL: scratch.url,
				...(blank === undefined ? {} : { DATABASE_URL: blank }),
			});
			expect(code, `DATABASE_URL=${JSON.stringify(blank)}`).toBe(1);
			expect(captured.join("\n")).toContain("DATABASE_URL");
		}
		expect(connect).not.toHaveBeenCalled();
	}, 10_000);

	it("a4. development without DATABASE_URL warns and continues (returns 0)", async () => {
		setNodeEnv("development");
		const run = await loadRunMigrate();
		const code = await run({ NODE_ENV: "development", OSCORPEX_MIGRATION_DATABASE_URL: scratch.url });
		expect(code).toBe(0);
		expect(captured.join("\n")).toContain("DATABASE_URL");
	}, 120_000);

	it("d. resolves init.sql relative to the module, not process.cwd()", async () => {
		setNodeEnv("production");
		await withClient(scratch.url, (c) => c.query("DROP TABLE IF EXISTS public.schema_meta"));
		vi.spyOn(process, "cwd").mockReturnValue(tmp);
		const run = await loadRunMigrate();
		const code = await run({
			NODE_ENV: "production",
			OSCORPEX_MIGRATION_DATABASE_URL: scratch.url,
			DATABASE_URL: scratch.url,
		});
		expect(code).toBe(0);
		const rows = await withClient(scratch.url, (c) =>
			c.query<{ value: string }>("SELECT value FROM public.schema_meta WHERE key = $1", [HASH_KEY]),
		);
		expect(rows.rows[0]?.value).toMatch(/^[0-9a-f]{64}$/);
	}, 120_000);

	for (const nodeEnv of ["production", "development"]) {
		it(`e. a missing opts.schemaPath returns 1 naming init.sql (NODE_ENV=${nodeEnv})`, async () => {
			setNodeEnv(nodeEnv);
			const run = await loadRunMigrate();
			const code = await run(
				{ NODE_ENV: nodeEnv, OSCORPEX_MIGRATION_DATABASE_URL: scratch.url, DATABASE_URL: scratch.url },
				{ schemaPath: join(tmp, "nope", "init.sql") },
			);
			expect(code).toBe(1);
			expect(captured.join("\n")).toContain("init.sql");
		}, 30_000);
	}
});
