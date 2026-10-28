// ---------------------------------------------------------------------------
// F0 — tenancy test helpers (seedTestTenants, withTenantTx, withAppRole).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	TENANT_A,
	TENANT_B,
	TENANT_LOCAL,
	assertRlsSubjectRole,
	expectPgError,
	getPool,
	roleExists,
	seedTestTenants,
	withAppRole,
	withTenantTx,
} from "./helpers/tenancy.js";

const SENTINEL_SLUG_PREFIX = "tenancy-helper-test-";

async function settingOutsideTx(): Promise<string | null> {
	const { rows } = await getPool().query<{ v: string | null }>(
		"SELECT current_setting('app.current_tenant_id', true) AS v",
	);
	return rows[0].v;
}

describe("tenancy helpers", () => {
	const cleanupSentinels = () =>
		getPool().query("DELETE FROM tenants WHERE slug LIKE $1", [`${SENTINEL_SLUG_PREFIX}%`]);

	beforeAll(async () => {
		await cleanupSentinels();
		await seedTestTenants();
	});

	afterAll(async () => {
		await cleanupSentinels();
	});

	it("seedTestTenants is idempotent and seeds the expected slugs", async () => {
		await seedTestTenants();
		await seedTestTenants();
		const { rows } = await getPool().query<{ id: string; slug: string }>(
			"SELECT id, slug FROM tenants WHERE id = ANY($1::text[]) ORDER BY id",
			[[TENANT_LOCAL, TENANT_A, TENANT_B]],
		);
		expect(rows).toHaveLength(3);
		const bySlug = Object.fromEntries(rows.map((r) => [r.id, r.slug]));
		expect(bySlug[TENANT_LOCAL]).toBe("local");
		expect(bySlug[TENANT_A]).toBe("test-tenant-a");
		expect(bySlug[TENANT_B]).toBe("test-tenant-b");
	});

	it("sets app.current_tenant_id inside the tx and does not leak to pooled connections", async () => {
		const inside = await withTenantTx(TENANT_A, async (client) => {
			const { rows } = await client.query<{ v: string | null }>(
				"SELECT current_setting('app.current_tenant_id', true) AS v",
			);
			return rows[0].v;
		});
		expect(inside).toBe(TENANT_A);

		for (let i = 0; i < 6; i++) {
			const v = await settingOutsideTx();
			expect(v === null || v === "").toBe(true);
		}
	});

	it("rolls back by default and persists with { commit: true }", async () => {
		const slugRollback = `${SENTINEL_SLUG_PREFIX}rollback`;
		const slugCommit = `${SENTINEL_SLUG_PREFIX}commit`;
		const insert = (slug: string) => (client: import("pg").PoolClient) =>
			client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [`tenancy-helper-${slug}`, slug, slug]);

		await withTenantTx(TENANT_A, insert(slugRollback));
		const r1 = await getPool().query("SELECT 1 FROM tenants WHERE slug = $1", [slugRollback]);
		expect(r1.rowCount).toBe(0);

		await withTenantTx(TENANT_A, insert(slugCommit), { commit: true });
		const r2 = await getPool().query("SELECT 1 FROM tenants WHERE slug = $1", [slugCommit]);
		expect(r2.rowCount).toBe(1);
		await getPool().query("DELETE FROM tenants WHERE slug = $1", [slugCommit]);
	});

	it("withTenantTx(null) leaves the tenant setting unset", async () => {
		const v = await withTenantTx(null, async (client) => {
			const { rows } = await client.query<{ v: string | null }>(
				"SELECT current_setting('app.current_tenant_id', true) AS v",
			);
			return rows[0].v;
		});
		expect(v === null || v === "").toBe(true);
	});

	it("rejects an invalid role name with 'Invalid role name' before touching the DB", async () => {
		const connectSpy = vi.spyOn(getPool(), "connect");
		let called = false;
		try {
			await expect(
				withTenantTx(
					TENANT_A,
					async () => {
						called = true;
					},
					{ role: "x; DROP TABLE tenants" },
				),
			).rejects.toThrow(/Invalid role name/);
			expect(called).toBe(false);
			expect(connectSpy).not.toHaveBeenCalled();
		} finally {
			connectSpy.mockRestore();
		}
		const { rows } = await getPool().query("SELECT 1 FROM tenants LIMIT 1");
		expect(rows.length).toBeGreaterThan(0);
	});

	it("does not leak the tenant setting to pooled connections after { commit: true }", async () => {
		const inside = await withTenantTx(
			TENANT_A,
			async (client) => {
				const { rows } = await client.query<{ v: string | null }>(
					"SELECT current_setting('app.current_tenant_id', true) AS v",
				);
				return rows[0].v;
			},
			{ commit: true },
		);
		expect(inside).toBe(TENANT_A);
		for (let i = 0; i < 6; i++) {
			const v = await settingOutsideTx();
			expect(v === null || v === "").toBe(true);
		}
	});

	it("resets session-level state (search_path) before releasing the client", async () => {
		const { rows: before } = await getPool().query<{ search_path: string }>("SHOW search_path");
		const defaultPath = before[0].search_path;
		expect(defaultPath).not.toBe("pg_catalog");

		try {
			await withTenantTx(
				TENANT_A,
				async (client) => {
					await client.query("SET search_path TO pg_catalog");
				},
				{ commit: true },
			);
			for (let i = 0; i < 6; i++) {
				const { rows } = await getPool().query<{ search_path: string }>("SHOW search_path");
				expect(rows[0].search_path).toBe(defaultPath);
			}
		} finally {
			// Do not pollute later tests if the helper failed to reset the session.
			for (let i = 0; i < 6; i++) await getPool().query("RESET search_path");
		}
	});

	it("supports a valid role ({ role: current_user }) and restores the original role", async () => {
		const { rows: orig } = await getPool().query<{ u: string }>("SELECT current_user AS u");
		const original = orig[0].u;
		const inside = await withTenantTx(
			TENANT_A,
			async (client) => {
				const { rows } = await client.query<{ u: string; r: string }>(
					"SELECT current_user AS u, current_setting('role') AS r",
				);
				return rows[0];
			},
			{ role: original },
		);
		expect(inside.u).toBe(original);
		expect(inside.r).toBe(original);
		for (let i = 0; i < 5; i++) {
			const { rows } = await getPool().query<{ u: string; r: string }>(
				"SELECT current_user AS u, current_setting('role') AS r",
			);
			expect(rows[0].u).toBe(original);
			expect(rows[0].r).toBe("none");
		}
	});

	it("rejects { commit: true } when fn swallowed a SQL error (aborted transaction)", async () => {
		const slug = `${SENTINEL_SLUG_PREFIX}aborted`;
		const err = await withTenantTx(
			TENANT_A,
			async (client) => {
				await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2)", [
					`tenancy-helper-${slug}`,
					slug,
				]);
				try {
					await client.query("SELECT 1/0");
				} catch {
					// swallowed on purpose: the transaction is now aborted
				}
			},
			{ commit: true },
		).then(
			() => null,
			(e: unknown) => e as Error,
		);
		expect(err).toBeInstanceOf(Error);
		expect(err?.message).toMatch(/abort|not committed/i);
		const r = await getPool().query("SELECT 1 FROM tenants WHERE slug = $1", [slug]);
		expect(r.rowCount).toBe(0);
	});

	describe("expectPgError", () => {
		it("resolves on the expected SQLSTATE and keeps the transaction usable", async () => {
			await withTenantTx(TENANT_A, async (client) => {
				await expectPgError(client, "SELECT 1/0", [], "22012");
				const { rows } = await client.query<{ one: number }>("SELECT 1 AS one");
				expect(rows[0].one).toBe(1);
			});
		});

		it("rejects when the statement succeeds, and the transaction stays usable", async () => {
			await withTenantTx(TENANT_A, async (client) => {
				await expect(expectPgError(client, "SELECT $1::int", [1], "22012")).rejects.toThrow(/22012.*succeeded/);
				const { rows } = await client.query<{ one: number }>("SELECT 1 AS one");
				expect(rows[0].one).toBe(1);
			});
		});

		it("rejects on a different SQLSTATE, and the transaction stays usable", async () => {
			await withTenantTx(TENANT_A, async (client) => {
				await expect(expectPgError(client, "SELECT 1/0", [], "23505")).rejects.toThrow(/23505.*22012/);
				const { rows } = await client.query<{ one: number }>("SELECT 1 AS one");
				expect(rows[0].one).toBe(1);
			});
		});
	});

	describe("assertRlsSubjectRole", () => {
		const good = { rolsuper: false, rolbypassrls: false, memberOfOwner: false, canSetRole: true };
		it.each([
			["superuser", { ...good, rolsuper: true }, /superuser/i],
			["bypassrls", { ...good, rolbypassrls: true }, /bypass/i],
			["member of oscorpex_owner", { ...good, memberOfOwner: true }, /oscorpex_owner/],
			["not settable by current_user", { ...good, canSetRole: false }, /SET ROLE|settable|set role/i],
		])("throws for %s", (_name, attrs, message) => {
			expect(() => assertRlsSubjectRole(attrs)).toThrow(message);
		});

		it("passes for a plain settable role", () => {
			expect(() => assertRlsSubjectRole(good)).not.toThrow();
		});
	});

	it("withAppRole rejects with a helpful message while oscorpex_app does not exist (pre-F1)", async (ctx) => {
		if (await roleExists("oscorpex_app")) ctx.skip();
		let called = false;
		const err = await withAppRole(TENANT_A, async () => {
			called = true;
		}).then(
			() => null,
			(e: unknown) => e as Error,
		);
		expect(called).toBe(false);
		expect(err).toBeInstanceOf(Error);
		expect(err?.message).toContain("oscorpex_app");
		expect(err?.message).toContain("F1");
	});

	it("propagates errors from fn and releases the client (no pool leak)", async () => {
		const pool = getPool();
		for (let i = 0; i < 20; i++) {
			await expect(
				withTenantTx(TENANT_B, async () => {
					throw new Error(`boom-${i}`);
				}),
			).rejects.toThrow(`boom-${i}`);
		}
		expect(pool.waitingCount).toBe(0);
		expect(pool.totalCount - pool.idleCount).toBe(0);
		// Pool is still usable and nothing leaked into the session state.
		expect((await settingOutsideTx()) ?? "").toBe("");
	});
});
