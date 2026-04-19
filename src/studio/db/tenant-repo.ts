// ---------------------------------------------------------------------------
// Oscorpex — Tenant & User Repo (M6: Multi-Tenant Identity)
// ---------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export interface Tenant {
	id: string;
	name: string;
	slug: string;
	plan: string;
	createdAt: string;
	updatedAt: string;
}

function rowToTenant(row: Record<string, unknown>): Tenant {
	return {
		id: row.id as string,
		name: row.name as string,
		slug: row.slug as string,
		plan: (row.plan as string) ?? "free",
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

export async function getTenant(id: string): Promise<Tenant | undefined> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM tenants WHERE id = $1", [id]);
	return row ? rowToTenant(row) : undefined;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | undefined> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM tenants WHERE slug = $1", [slug]);
	return row ? rowToTenant(row) : undefined;
}

export async function createTenant(data: { name: string; slug: string; plan?: string }): Promise<Tenant> {
	const id = randomUUID();
	await execute("INSERT INTO tenants (id, name, slug, plan) VALUES ($1, $2, $3, $4)", [
		id,
		data.name,
		data.slug,
		data.plan ?? "free",
	]);
	return {
		id,
		name: data.name,
		slug: data.slug,
		plan: data.plan ?? "free",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface User {
	id: string;
	email: string;
	passwordHash: string;
	displayName: string;
	tenantId: string | null;
	createdAt: string;
	updatedAt: string;
}

function rowToUser(row: Record<string, unknown>): User {
	return {
		id: row.id as string,
		email: row.email as string,
		passwordHash: row.password_hash as string,
		displayName: (row.display_name as string) ?? "",
		tenantId: (row.tenant_id as string) ?? null,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

export async function getUser(id: string): Promise<User | undefined> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM users WHERE id = $1", [id]);
	return row ? rowToUser(row) : undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM users WHERE email = $1", [email]);
	return row ? rowToUser(row) : undefined;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type UserRole = "owner" | "admin" | "developer" | "viewer" | "billing";

export async function getUserRole(userId: string, tenantId: string): Promise<UserRole | undefined> {
	const row = await queryOne<{ role: string }>("SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2", [
		userId,
		tenantId,
	]);
	return (row?.role as UserRole) ?? undefined;
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export interface ApiKeyRecord {
	id: string;
	tenantId: string;
	userId: string;
	name: string;
	scopes: string[];
	expiresAt: string | null;
	lastUsedAt: string | null;
	createdAt: string;
}

/**
 * Create a new API key. The plain key is returned once (never stored).
 * Format: osx_<32 random bytes hex>
 */
export async function createApiKey(data: {
	tenantId: string;
	userId: string;
	name: string;
	scopes?: string[];
	expiresAt?: string;
}): Promise<{ record: ApiKeyRecord; plainKey: string }> {
	const id = randomUUID();
	const plainKey = `osx_${randomBytes(32).toString("hex")}`;
	const keyHash = createHash("sha256").update(plainKey).digest("hex");
	const scopes = data.scopes ?? [];

	await execute(
		`INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, scopes, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, data.tenantId, data.userId, keyHash, data.name, scopes, data.expiresAt ?? null],
	);

	const record: ApiKeyRecord = {
		id,
		tenantId: data.tenantId,
		userId: data.userId,
		name: data.name,
		scopes,
		expiresAt: data.expiresAt ?? null,
		lastUsedAt: null,
		createdAt: new Date().toISOString(),
	};

	return { record, plainKey };
}

export async function listApiKeys(tenantId: string): Promise<ApiKeyRecord[]> {
	const rows = await query<Record<string, unknown>>(
		"SELECT id, tenant_id, user_id, name, scopes, expires_at, last_used_at, created_at FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
		[tenantId],
	);
	return rows.map((r) => ({
		id: r.id as string,
		tenantId: r.tenant_id as string,
		userId: r.user_id as string,
		name: r.name as string,
		scopes: (r.scopes as string[]) ?? [],
		expiresAt: (r.expires_at as string) ?? null,
		lastUsedAt: (r.last_used_at as string) ?? null,
		createdAt: r.created_at as string,
	}));
}

export async function revokeApiKey(id: string): Promise<void> {
	await execute("DELETE FROM api_keys WHERE id = $1", [id]);
}
