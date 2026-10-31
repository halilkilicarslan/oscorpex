import { Hono } from "hono";
import { assertProjectInTenant } from "../auth/project-access.js";
import { createSession, getHermesAllowedTools, handleHermesInvocation, isHermesEnabled } from "../hermes/index.js";
import { createLogger } from "../logger.js";
import { rateLimiter } from "../middleware/rate-limiter.js";

const log = createLogger("hermes-routes");
export const hermesRoutes = new Hono();

// Rate-limit all hermes endpoints: 30 req/min per actor
hermesRoutes.use("*", rateLimiter({ windowMs: 60_000, max: 30 }));

// ---------------------------------------------------------------------------
// POST /hermes/session — create a new Hermes session for a project
// ---------------------------------------------------------------------------
hermesRoutes.post("/hermes/session", async (c) => {
	if (!isHermesEnabled()) return c.json({ error: "Hermes disabled" }, 503);

	const tenantId = (c.get as (k: string) => string | undefined)("tenantId") ?? "";
	const projectId = c.req.header("x-project-id") ?? "";
	if (!tenantId || !projectId) {
		return c.json({ error: "tenantId and projectId required" }, 400);
	}
	const denied = await assertProjectInTenant(c, projectId);
	if (denied) return denied;

	const body = await c.req.json().catch(() => ({}));
	const maxToolCalls = typeof body?.maxToolCalls === "number" ? (body.maxToolCalls as number) : undefined;

	const session = createSession({ apiKeyId: "api-key", tenantId, projectId, maxToolCalls });
	log.info({ sessionId: session.id, tenantId, projectId }, "[hermes-routes] Session created");

	return c.json({
		sessionId: session.id,
		maxToolCalls: session.maxToolCalls,
		expiresAt: session.expiresAt,
	});
});

// ---------------------------------------------------------------------------
// POST /hermes/invoke — invoke a read-only MCP tool within a session
// ---------------------------------------------------------------------------
hermesRoutes.post("/hermes/invoke", async (c) => {
	if (!isHermesEnabled()) {
		return c.json({ ok: false, error: { code: "HERMES_DISABLED", message: "Hermes disabled" } }, 503);
	}

	const body = await c.req.json().catch(() => null);
	if (!body?.sessionId || !body?.toolName) {
		return c.json({ ok: false, error: { code: "INVALID_REQUEST", message: "sessionId and toolName required" } }, 400);
	}

	const tenantId = (c.get as (k: string) => string | undefined)("tenantId") ?? "";
	const projectId = c.req.header("x-project-id") ?? (body.projectId as string | undefined) ?? "";
	const actorId = (c.get as (k: string) => string | undefined)("userId") ?? "hermes-client";
	if (!projectId) {
		return c.json({ ok: false, error: { code: "INVALID_REQUEST", message: "projectId required" } }, 400);
	}
	const denied = await assertProjectInTenant(c, projectId);
	if (denied) return denied;

	const result = await handleHermesInvocation({
		sessionId: body.sessionId as string,
		tenantId,
		projectId,
		actorId,
		toolName: body.toolName as string,
		args: (body.args as Record<string, unknown>) ?? {},
		source: "hermes",
	});

	return c.json(result, result.ok ? 200 : 400);
});

// ---------------------------------------------------------------------------
// GET /hermes/tools — list tools available via Hermes (read-only subset)
// ---------------------------------------------------------------------------
hermesRoutes.get("/hermes/tools", (c) => {
	if (!isHermesEnabled()) return c.json({ error: "Hermes disabled" }, 503);
	return c.json({ tools: Array.from(getHermesAllowedTools()), readOnly: true });
});

// ---------------------------------------------------------------------------
// POST /hermes/soak — P13-B: read-only soak mode (non-production only)
// ---------------------------------------------------------------------------
hermesRoutes.post("/hermes/soak", async (c) => {
	if (process.env.NODE_ENV === "production") {
		return c.json({ error: "Soak not available in production" }, 403);
	}
	const { runHermesSoak } = await import("../hermes/index.js");
	const tenantId = (c.get as (k: string) => string | undefined)("tenantId") ?? "";
	const projectId = c.req.header("x-project-id");
	if (!projectId) return c.json({ error: "x-project-id header is required" }, 400);
	const denied = await assertProjectInTenant(c, projectId);
	if (denied) return denied;
	const result = await runHermesSoak(tenantId, projectId);
	return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /hermes/keys — P13-G: generate a new Hermes API key (raw key returned once)
// ---------------------------------------------------------------------------
hermesRoutes.post("/hermes/keys", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.name) {
		return c.json({ error: "name required" }, 400);
	}
	const tenantId = (c.get as (k: string) => string | undefined)("tenantId") ?? "";
	const { generateHermesApiKey } = await import("../hermes/hermes-key-management.js");
	const result = generateHermesApiKey({ tenantId, name: body.name as string });
	// rawKey is shown exactly once — the caller must store it immediately
	return c.json({ id: result.id, key: result.rawKey, name: result.name });
});
