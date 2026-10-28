// ---------------------------------------------------------------------------
// F2 review — identity fixtures. Every JWT / DB-API-key request now verifies that the user still exists
// and has a role in the token's tenant (the role comes from the DB, not the token), so tests that send
// JWTs through the real auth middleware need real users + user_roles rows.
// ---------------------------------------------------------------------------

import { signJwt } from "../../auth/jwt.js";
import { withMigrator } from "./tenancy.js";

export interface SeededUser {
	id: string;
	email: string;
	tenantId: string;
	role: string;
	token: string;
}

/** Idempotently create tenant, user and user_roles row; returns a signed JWT for them. */
export async function seedUser(o: {
	tenantId: string;
	role?: string;
	admin?: boolean;
	id?: string;
}): Promise<SeededUser> {
	const role = o.role ?? "owner";
	const id = o.id ?? `f2r-user-${role}-${o.tenantId}`;
	const email = `${id}@f2r.test`;
	await withMigrator(async (c) => {
		await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [o.tenantId]);
		await c.query(
			`INSERT INTO users (id, email, password_hash, tenant_id, is_platform_admin) VALUES ($1, $2, 'x', $3, $4)
			 ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, is_platform_admin = EXCLUDED.is_platform_admin`,
			[id, email, o.tenantId, o.admin === true],
		);
		await c.query(
			`INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
			[id, o.tenantId, role],
		);
	});
	return { id, email, tenantId: o.tenantId, role, token: signJwt({ sub: id, email, tenantId: o.tenantId, role }) };
}

export async function removeUsers(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	await withMigrator(async (c) => {
		await c.query("DELETE FROM api_keys WHERE user_id = ANY($1)", [ids]);
		await c.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
		await c.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
	});
}
