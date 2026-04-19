// ---------------------------------------------------------------------------
// Oscorpex — Auth Routes
// POST /auth/register — create tenant + user, return JWT
// POST /auth/login    — verify credentials, return JWT
// GET  /auth/me       — return current user info (requires JWT)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { execute, queryOne } from "../pg.js";
import type { AuthVariables } from "../auth/auth-middleware.js";
import { signJwt } from "../auth/jwt.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

const router = new Hono<{ Variables: AuthVariables }>();

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
router.post("/register", async (c) => {
	try {
		const body = await c.req.json<{
			email?: string;
			password?: string;
			displayName?: string;
			tenantName?: string;
		}>();
		const { email, password, displayName, tenantName } = body;

		if (!email || !password) {
			return c.json({ error: "Email and password required" }, 400);
		}

		// Email uniqueness check
		const existing = await queryOne("SELECT id FROM users WHERE email = $1", [email]);
		if (existing) {
			return c.json({ error: "Email already registered" }, 409);
		}

		// Create tenant
		const tenantId = randomUUID();
		const slugBase = email
			.split("@")[0]
			.replace(/[^a-z0-9-]/gi, "-")
			.toLowerCase();
		const tenantSlug = `${slugBase}-${tenantId.slice(0, 4)}`;
		const resolvedTenantName = tenantName ?? `${displayName ?? email}'s Workspace`;

		await execute("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [tenantId, resolvedTenantName, tenantSlug]);

		// Create user
		const userId = randomUUID();
		const passwordHash = hashPassword(password);
		const resolvedDisplayName = displayName ?? "";

		await execute(
			"INSERT INTO users (id, email, password_hash, display_name, tenant_id) VALUES ($1, $2, $3, $4, $5)",
			[userId, email, passwordHash, resolvedDisplayName, tenantId],
		);

		// Assign owner role
		await execute("INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)", [userId, tenantId, "owner"]);

		const token = signJwt({ sub: userId, email, tenantId, role: "owner" });
		return c.json(
			{
				token,
				user: { id: userId, email, displayName: resolvedDisplayName, tenantId, role: "owner" },
			},
			201,
		);
	} catch (err) {
		console.error("[auth] register error:", err);
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
router.post("/login", async (c) => {
	try {
		const body = await c.req.json<{ email?: string; password?: string }>();
		const { email, password } = body;

		if (!email || !password) {
			return c.json({ error: "Email and password required" }, 400);
		}

		const user = await queryOne<{
			id: string;
			email: string;
			password_hash: string;
			display_name: string;
			tenant_id: string;
		}>("SELECT id, email, password_hash, display_name, tenant_id FROM users WHERE email = $1", [email]);

		if (!user || !verifyPassword(password, user.password_hash)) {
			return c.json({ error: "Invalid credentials" }, 401);
		}

		const roleRow = await queryOne<{ role: string }>(
			"SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2",
			[user.id, user.tenant_id],
		);
		const role = roleRow?.role ?? "viewer";

		const token = signJwt({ sub: user.id, email: user.email, tenantId: user.tenant_id, role });
		return c.json({
			token,
			user: {
				id: user.id,
				email: user.email,
				displayName: user.display_name,
				tenantId: user.tenant_id,
				role,
			},
		});
	} catch (err) {
		console.error("[auth] login error:", err);
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /auth/me — current user info (requires JWT or DB API key auth)
// ---------------------------------------------------------------------------
router.get("/me", async (c) => {
	const userId = c.get("userId") as string | undefined;
	if (!userId) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	try {
		const user = await queryOne<{
			id: string;
			email: string;
			display_name: string;
			tenant_id: string;
		}>("SELECT id, email, display_name, tenant_id FROM users WHERE id = $1", [userId]);

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const roleRow = await queryOne<{ role: string }>(
			"SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2",
			[user.id, user.tenant_id],
		);

		return c.json({
			id: user.id,
			email: user.email,
			displayName: user.display_name,
			tenantId: user.tenant_id,
			role: roleRow?.role ?? "viewer",
		});
	} catch (err) {
		console.error("[auth] me error:", err);
		return c.json({ error: "Internal server error" }, 500);
	}
});

export default router;
