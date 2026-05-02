// ---------------------------------------------------------------------------
// Oscorpex — Auth Routes
// POST /auth/register — create tenant + user, return JWT
// POST /auth/login    — verify credentials, return JWT
// GET  /auth/me       — return current user info (requires JWT)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthVariables } from "../auth/auth-middleware.js";
import { authMiddleware } from "../auth/auth-middleware.js";
import { signJwt } from "../auth/jwt.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { requirePermission } from "../auth/rbac.js";
import { logTenantActivity } from "../auth/tenant-context.js";
import {
	createApiKey,
	createTenantWithOwner,
	getUser,
	getUserByEmail,
	getUserRole,
	listApiKeys,
	listTenantUsers,
	revokeApiKey,
	upsertUserRole,
} from "../db.js";
import { createLogger } from "../logger.js";
const log = createLogger("auth-routes");

const router = new Hono<{ Variables: AuthVariables }>();

// Protected auth endpoints require resolved auth context (JWT/API key).
router.use("/me", authMiddleware);
router.use("/users", authMiddleware);
router.use("/users/*", authMiddleware);
router.use("/api-keys", authMiddleware);
router.use("/api-keys/*", authMiddleware);

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
		const existing = await getUserByEmail(email);
		if (existing) {
			return c.json({ error: "Email already registered" }, 409);
		}

		// Create tenant + user + owner role atomically via repo
		const tenantId = randomUUID();
		const slugBase = email
			.split("@")[0]
			.replace(/[^a-z0-9-]/gi, "-")
			.toLowerCase();
		const tenantSlug = `${slugBase}-${tenantId.slice(0, 4)}`;
		const resolvedTenantName = tenantName ?? `${displayName ?? email}'s Workspace`;
		const userId = randomUUID();
		const passwordHash = hashPassword(password);
		const resolvedDisplayName = displayName ?? "";

		await createTenantWithOwner({
			tenantId,
			tenantName: resolvedTenantName,
			tenantSlug,
			userId,
			email,
			passwordHash,
			displayName: resolvedDisplayName,
		});

		const token = signJwt({ sub: userId, email, tenantId, role: "owner" });

		// M6.4: Audit log — non-blocking
		logTenantActivity(tenantId, userId, "register", { email, tenantName: resolvedTenantName });

		return c.json(
			{
				token,
				user: { id: userId, email, displayName: resolvedDisplayName, tenantId, role: "owner" },
			},
			201,
		);
	} catch (err) {
		log.error("[auth] register error:" + " " + String(err));
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

		const user = await getUserByEmail(email);

		if (!user || !verifyPassword(password, user.passwordHash)) {
			return c.json({ error: "Invalid credentials" }, 401);
		}

		const role = (await getUserRole(user.id, user.tenantId ?? "")) ?? "viewer";

		const token = signJwt({ sub: user.id, email: user.email, tenantId: user.tenantId ?? "", role });
		return c.json({
			token,
			user: {
				id: user.id,
				email: user.email,
				displayName: user.displayName,
				tenantId: user.tenantId,
				role,
			},
		});
	} catch (err) {
		log.error("[auth] login error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /auth/me — current user info (requires JWT or DB API key auth)
// When auth is disabled, returns { authDisabled: true } so the frontend
// knows the platform is running in open mode.
// ---------------------------------------------------------------------------
router.get("/me", async (c) => {
	const authEnabled = process.env.OSCORPEX_AUTH_ENABLED === "true";
	if (!authEnabled) {
		return c.json({ authDisabled: true });
	}

	const userId = c.get("userId") as string | undefined;
	if (!userId) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	try {
		const user = await getUser(userId);

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const role = (await getUserRole(user.id, user.tenantId ?? "")) ?? "viewer";

		return c.json({
			id: user.id,
			email: user.email,
			displayName: user.displayName,
			tenantId: user.tenantId,
			role,
		});
	} catch (err) {
		log.error("[auth] me error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /auth/users — list all users in the tenant (admin+ only)
// ---------------------------------------------------------------------------
router.get("/users", requirePermission("users:read"), async (c) => {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Hono context variables
		const tid = (c as any).get("tenantId") as string | undefined;
		if (!tid) return c.json({ error: "Tenant context required" }, 400);

		const users = await listTenantUsers(tid);
		return c.json(users);
	} catch (err) {
		log.error("[auth] users list error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// PATCH /auth/users/:id/role — change a user's role (owner only)
// ---------------------------------------------------------------------------
router.patch("/users/:id/role", async (c) => {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Hono context variables
		const ctx = c as any;
		const tid = ctx.get("tenantId") as string | undefined;
		const callerRole = ctx.get("userRole") as string | undefined;

		if (!tid) return c.json({ error: "Tenant context required" }, 400);
		if (callerRole !== "owner") return c.json({ error: "Only owners can change roles" }, 403);

		const userId = c.req.param("id");
		const body = await c.req.json<{ role?: string }>();
		const { role } = body;

		const validRoles = ["owner", "admin", "developer", "viewer", "billing"];
		if (!role || !validRoles.includes(role)) {
			return c.json({ error: "Invalid role" }, 400);
		}

		await upsertUserRole(userId, tid, role);

		// M6.4: Audit log — non-blocking
		const callerId = ctx.get("userId") as string | undefined;
		if (callerId) {
			logTenantActivity(tid, callerId, "role_change", { targetUserId: userId, newRole: role });
		}

		return c.json({ ok: true, userId, role });
	} catch (err) {
		log.error("[auth] patch role error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /auth/api-keys — create a new API key
// ---------------------------------------------------------------------------
router.post("/api-keys", async (c) => {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Hono context variables
		const ctx = c as any;
		const tid = ctx.get("tenantId") as string | undefined;
		const uid = ctx.get("userId") as string | undefined;

		if (!tid || !uid) return c.json({ error: "Auth required" }, 401);

		const body = await c.req.json<{ name?: string; scopes?: string[] }>();
		const result = await createApiKey({
			tenantId: tid,
			userId: uid,
			name: body.name ?? "Default",
			scopes: body.scopes ?? [],
		});

		// M6.4: Audit log — non-blocking
		logTenantActivity(tid, uid, "api_key_create", { keyName: body.name ?? "Default", scopes: body.scopes ?? [] });

		return c.json(result, 201);
	} catch (err) {
		log.error("[auth] create api-key error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /auth/api-keys — list API keys for the tenant
// ---------------------------------------------------------------------------
router.get("/api-keys", async (c) => {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Hono context variables
		const tid = (c as any).get("tenantId") as string | undefined;
		if (!tid) return c.json({ error: "Tenant context required" }, 400);

		const keys = await listApiKeys(tid);
		return c.json(keys);
	} catch (err) {
		log.error("[auth] list api-keys error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// DELETE /auth/api-keys/:id — revoke an API key
// ---------------------------------------------------------------------------
router.delete("/api-keys/:id", async (c) => {
	try {
		const keyId = c.req.param("id");
		// biome-ignore lint/suspicious/noExplicitAny: Hono context variables
		const ctx = c as any;
		const tid = ctx.get("tenantId") as string | undefined;
		const uid = ctx.get("userId") as string | undefined;

		if (tid) {
			const tenantKeys = await listApiKeys(tid);
			if (!tenantKeys.some((k) => k.id === keyId)) {
				return c.json({ error: "API key not found" }, 404);
			}
		}

		await revokeApiKey(keyId);

		// M6.4: Audit log — non-blocking
		if (tid && uid) {
			logTenantActivity(tid, uid, "api_key_delete", { keyId });
		}

		return c.json({ ok: true });
	} catch (err) {
		log.error("[auth] revoke api-key error:" + " " + String(err));
		return c.json({ error: "Internal server error" }, 500);
	}
});

export default router;
