// ---------------------------------------------------------------------------
// F2 round 3, item 7 — low-severity items:
//  catalog (projects→tenants FK), legacy `local`-tenant DB keys, admin import path validation,
//  static guard + unit tests for the boundary helpers, /auth/me through the real studio router in strict mode.
// (The Sidebar test lives in apps/console; the "bind parameter" rename is in f2r-review1-infra.test.ts.)
// ---------------------------------------------------------------------------

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import pg from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The import route writes lint/sonar configs into the imported directory. Those writes are stubbed so that a
// regression (importing "/" or $HOME) can never litter the real filesystem while the test detects it.
const writes = vi.hoisted(() => ({ lint: [] as string[] }));
vi.mock("../lint-runner.js", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	initLintConfig: async (p: string) => {
		writes.lint.push(p);
	},
}));
vi.mock("../sonar-runner.js", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	isSonarEnabled: async () => false,
}));

import { studioRoutes } from "../index.js";
import {
	TenantScopeError,
	currentScope,
	enterRequestTenant,
	runAsSystem,
	runInTenant,
	runOutsideScope,
	runSysLookupAtBoundary,
	runWithoutScopeAtBoundary,
} from "../tenancy/tenant-scope.js";
import { call, cleanup, mkUser, registerCleanup, seedDbKey, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, TENANT_LOCAL, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

const ROOT = resolve(__dirname, "../../../../..");
let ownerA: SeededUser;
let ownerLocal: SeededUser;
let admin: SeededUser;
const dirs: string[] = [];

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerLocal = await mkUser({ tenantId: TENANT_LOCAL });
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
});

// ---------------------------------------------------------------------------
describe("catalog: projects → tenants foreign key", () => {
	it("is ON DELETE RESTRICT and validated (convalidated = true)", async () => {
		const r = await withMigrator((c) =>
			c.query(
				`SELECT con.confdeltype, con.convalidated
				 FROM pg_constraint con
				 WHERE con.conrelid = 'public.projects'::regclass
				   AND con.confrelid = 'public.tenants'::regclass
				   AND con.contype = 'f'
				   AND array_length(con.conkey, 1) = 1
				   AND con.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.projects'::regclass AND attname = 'tenant_id')`,
			),
		);
		expect(r.rowCount).toBe(1);
		expect(r.rows[0].confdeltype).toBe("r"); // r = RESTRICT
		expect(r.rows[0].convalidated).toBe(true);
	});

	it("deleting a tenant that still owns a project is refused", async () => {
		const tid = `f2r3-del-${Date.now()}`;
		const pid = `f2r3-del-proj-${Date.now()}`;
		await withMigrator(async (c) => {
			await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1)", [tid]);
			await c.query(
				"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'x', now(), now(), $2)",
				[pid, tid],
			);
		});
		try {
			// RESTRICT is asserted on the catalog above; the error code depends on the server version
			// (PostgreSQL 18+ raises 23001 restrict_violation, earlier versions 23503 foreign_key_violation).
			await expect(withMigrator((c) => c.query("DELETE FROM tenants WHERE id = $1", [tid]))).rejects.toMatchObject({
				code: expect.stringMatching(/^(23001|23503)$/),
			});
		} finally {
			await withMigrator(async (c) => {
				await c.query("DELETE FROM projects WHERE id = $1", [pid]);
				await c.query("DELETE FROM tenants WHERE id = $1", [tid]);
			});
		}
	});
});

// ---------------------------------------------------------------------------
describe("legacy keys: DB API key whose tenant is the reserved local tenant", () => {
	it("with AUTH_ENABLED a DB key bound to the local tenant → 401", async () => {
		const key = await seedDbKey(ownerLocal, [], TENANT_LOCAL);
		const res = await runOutsideScope(async () =>
			studioRoutes.request("/projects", { headers: { Authorization: `Bearer ${key}` } }),
		);
		expect(res.status).toBe(401);
	});

	it("a DB key of a real tenant keeps working (control)", async () => {
		const key = await seedDbKey(ownerA, []);
		const res = await runOutsideScope(async () =>
			studioRoutes.request("/projects", { headers: { Authorization: `Bearer ${key}` } }),
		);
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
describe("POST /projects/import as platform admin goes through realpath + validateRepoPath", () => {
	const imp = async (repoPath: string) => {
		const res = await call(admin, "POST", "/projects/import", { name: "f2r3-import", repoPath });
		const body = (await res.json()) as { id?: string; error?: string };
		if (body.id) cleanup.projects.push(body.id);
		return { status: res.status, body };
	};

	it('importing "/" is rejected', async () => {
		expect((await imp("/")).status).toBe(400);
	});

	it("importing $HOME is rejected", async () => {
		const home = process.env.HOME;
		expect(home).toBeTruthy();
		expect((await imp(home as string)).status).toBe(400);
	});

	it("a symlink that resolves to / is rejected (realpath first)", async () => {
		const base = realpathSync(mkdtempSync(join(tmpdir(), "f2r3-link-")));
		dirs.push(base);
		const link = join(base, "rootlink");
		symlinkSync("/", link);
		expect((await imp(link)).status).toBe(400);
	});

	it("a symlink that resolves to $HOME is rejected", async () => {
		const base = realpathSync(mkdtempSync(join(tmpdir(), "f2r3-link-")));
		dirs.push(base);
		const link = join(base, "homelink");
		symlinkSync(process.env.HOME as string, link);
		expect((await imp(link)).status).toBe(400);
	});

	it("a non-existent path is rejected", async () => {
		expect((await imp(join(tmpdir(), `f2r3-nope-${Date.now()}`))).status).toBe(400);
	});

	it("a valid directory OUTSIDE the tenant root still imports (admin privilege kept)", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "f2r3-valid-")));
		dirs.push(dir);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "package.json"), "{}");
		expect((await imp(dir)).status).toBe(201);
	});
});

// ---------------------------------------------------------------------------
describe("static guard: scope-escape boundary helpers have a closed importer set", () => {
	function walk(dir: string, out: string[] = []): string[] {
		for (const name of readdirSync(dir)) {
			if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p, out);
			else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
		}
		return out;
	}
	const files = [join(ROOT, "apps/kernel/src"), join(ROOT, "packages/control-plane/src")].flatMap((d) => walk(d));
	const rel = (f: string) => relative(ROOT, f).replaceAll("\\", "/");
	const importers = (name: string) =>
		files
			.filter((f) => !rel(f).endsWith("studio/tenancy/tenant-scope.ts"))
			.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, "utf8")))
			.map(rel);
	const allowed =
		/(apps\/kernel\/src\/studio\/(auth|routes|middleware|control-plane)\/|apps\/kernel\/src\/observability\/)/;

	for (const helper of ["enterRequestTenant", "runSysLookupAtBoundary", "runWithoutScopeAtBoundary"]) {
		it(`${helper} is imported only from request-boundary code`, () => {
			expect(importers(helper).filter((f) => !allowed.test(f))).toEqual([]);
		});
	}

	it("each of the three helpers is actually used at some boundary (the guard is not vacuous)", () => {
		for (const helper of ["enterRequestTenant", "runSysLookupAtBoundary", "runWithoutScopeAtBoundary"]) {
			expect(importers(helper).length, helper).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
describe("boundary helpers (unit)", () => {
	describe("enterRequestTenant", () => {
		it("fresh boundary (no scope): runs in the given tenant", async () => {
			const s = await runOutsideScope(() => enterRequestTenant(TENANT_A, async () => currentScope()));
			expect(s).toEqual({ kind: "tenant", tenantId: TENANT_A });
		});

		it("implicit default test scope is dropped, not inherited", async () => {
			expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
			const s = await enterRequestTenant(TENANT_A, async () => currentScope());
			expect(s).toEqual({ kind: "tenant", tenantId: TENANT_A });
		});

		it("explicit scope of the same tenant is honoured (no-op)", async () => {
			const s = await runOutsideScope(() =>
				runInTenant(TENANT_A, () => enterRequestTenant(TENANT_A, async () => currentScope())),
			);
			expect(s).toEqual({ kind: "tenant", tenantId: TENANT_A });
		});

		it("explicit scope of ANOTHER tenant is never replaced → TenantScopeError", async () => {
			await expect(
				runOutsideScope(() => runInTenant(TENANT_A, () => enterRequestTenant(TENANT_B, async () => 1))),
			).rejects.toBeInstanceOf(TenantScopeError);
		});

		it("rejects an invalid tenant id", async () => {
			await expect(runOutsideScope(() => enterRequestTenant("", async () => 1))).rejects.toBeInstanceOf(
				TenantScopeError,
			);
		});
	});

	describe("runSysLookupAtBoundary", () => {
		it("fresh boundary: runs in explicit system scope with the given reason", async () => {
			const s = await runOutsideScope(() => runSysLookupAtBoundary("f2r3:lookup", async () => currentScope()));
			expect(s).toEqual({ kind: "system", reason: "f2r3:lookup" });
		});

		it("implicit default test scope: system scope as well", async () => {
			const s = await runSysLookupAtBoundary("f2r3:lookup", async () => currentScope());
			expect(s).toEqual({ kind: "system", reason: "f2r3:lookup" });
		});

		it("inside an explicit tenant scope: runs in place — no escalation, scope unchanged", async () => {
			const s = await runOutsideScope(() =>
				runInTenant(TENANT_A, () => runSysLookupAtBoundary("f2r3:lookup", async () => currentScope())),
			);
			expect(s).toEqual({ kind: "tenant", tenantId: TENANT_A });
		});

		it("inside an explicit system scope: runs in place", async () => {
			const s = await runOutsideScope(() =>
				runAsSystem("outer", () => runSysLookupAtBoundary("inner", async () => currentScope())),
			);
			expect(s).toEqual({ kind: "system", reason: "outer" });
		});
	});

	describe("runWithoutScopeAtBoundary", () => {
		it("drops the implicit default test scope", async () => {
			expect(await runWithoutScopeAtBoundary(async () => currentScope())).toBeUndefined();
		});

		it("no scope stays no scope", async () => {
			expect(await runOutsideScope(() => runWithoutScopeAtBoundary(async () => currentScope()))).toBeUndefined();
		});

		it("an explicit tenant scope is left alone", async () => {
			const s = await runOutsideScope(() =>
				runInTenant(TENANT_A, () => runWithoutScopeAtBoundary(async () => currentScope())),
			);
			expect(s).toEqual({ kind: "tenant", tenantId: TENANT_A });
		});
	});
});

// ---------------------------------------------------------------------------
describe("GET /auth/me through the REAL studio router (behind accessGuard), strict scope mode", () => {
	let spy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
	});
	afterEach(() => spy?.mockRestore());

	it("returns 200 with the caller's identity (no UnscopedQueryError / 500)", async () => {
		const res = await runOutsideScope(async () =>
			studioRoutes.request("/auth/me", { headers: { Authorization: `Bearer ${ownerA.token}` } }),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id?: string; isPlatformAdmin?: boolean };
		expect(body.id).toBe(ownerA.id);
		expect(body.isPlatformAdmin).toBe(false);
	});

	it("the profile queries run in the caller's TENANT scope, not system scope", async () => {
		spy = vi.spyOn(pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown }, "query") as never;
		const res = await runOutsideScope(async () =>
			studioRoutes.request("/auth/me", { headers: { Authorization: `Bearer ${ownerA.token}` } }),
		);
		expect(res.status).toBe(200);
		const texts = spy.mock.calls.map((c: unknown[]) => {
			const a = c[0] as unknown;
			return typeof a === "string" ? a : String((a as { text?: string })?.text ?? "");
		});
		const tenantHex = Buffer.from(TENANT_A, "utf8").toString("hex");
		// pg.ts opens tenant transactions with BEGIN + set_config(<hex of tenant id>)
		const userQueryIdx = texts.findIndex((t: string) => /FROM users\b/i.test(t) && !/sys_/i.test(t));
		expect(userQueryIdx).toBeGreaterThan(0);
		expect(texts.slice(0, userQueryIdx).some((t: string) => /BEGIN/i.test(t) && t.includes(tenantHex))).toBe(true);
	});

	it("an admin's /auth/me also works under strict mode", async () => {
		const res = await runOutsideScope(async () =>
			studioRoutes.request("/auth/me", { headers: { Authorization: `Bearer ${admin.token}` } }),
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { isPlatformAdmin?: boolean }).isPlatformAdmin).toBe(true);
	});
});
