import { Hono } from "hono";
import { createLogger } from "../logger.js";
import { handleGatewayRequest } from "../gateway/index.js";
import { rateLimiter } from "../middleware/rate-limiter.js";

const log = createLogger("gateway-routes");
export const gatewayRoutes = new Hono();

// P11-E: Gateway-specific rate limiting — 60 req/min, overridable via OSCORPEX_GATEWAY_RATE_LIMIT
const gatewayRateLimit = Number(process.env.OSCORPEX_GATEWAY_RATE_LIMIT) || 60;
gatewayRoutes.use("*", rateLimiter({ windowMs: 60_000, max: gatewayRateLimit }));

// POST /gateway/invoke — invoke a read-only MCP tool via gateway
gatewayRoutes.post("/gateway/invoke", async (c) => {
	const ctx = c as typeof c & { get(key: string): string | undefined };
	const tenantId = ctx.get("tenantId") ?? c.req.header("x-tenant-id") ?? "";
	const projectId = c.req.header("x-project-id") ?? "";
	const actorId = ctx.get("userId") ?? c.req.header("x-actor-id") ?? "anonymous";

	let body: { toolName?: string; args?: Record<string, unknown> };
	try {
		body = await c.req.json<{ toolName?: string; args?: Record<string, unknown> }>();
	} catch {
		return c.json({ ok: false, error: { code: "INVALID_BODY", message: "Invalid JSON body" } }, 400);
	}

	if (!body.toolName) {
		return c.json({ ok: false, error: { code: "MISSING_TOOL", message: "toolName is required" } }, 400);
	}

	log.info({ tool: body.toolName, actorId, tenantId, projectId }, "[gateway] invoke request");

	const response = await handleGatewayRequest({
		tenantId,
		projectId,
		actorId,
		source: "gateway",
		toolName: body.toolName,
		args: body.args ?? {},
	});

	const status = response.ok ? 200 : response.error?.code === "GATEWAY_DISABLED" ? 503 : 400;
	return c.json(response, status);
});

// GET /gateway/tools — list available read-only gateway tools
gatewayRoutes.get("/gateway/tools", async (c) => {
	const { getGatewayConfig, isGatewayEnabled } = await import("../gateway/gateway-config.js");
	if (!isGatewayEnabled()) {
		return c.json({ ok: false, error: { code: "GATEWAY_DISABLED", message: "Gateway disabled" } }, 503);
	}
	const config = getGatewayConfig();
	return c.json({ ok: true, tools: Array.from(config.allowedTools), readOnly: config.readOnly });
});

// GET /gateway/health — lightweight health check (no auth required to check if gateway is up)
gatewayRoutes.get("/gateway/health", async (c) => {
	const { isGatewayEnabled } = await import("../gateway/gateway-config.js");
	return c.json({ ok: true, enabled: isGatewayEnabled(), readOnly: true });
});
