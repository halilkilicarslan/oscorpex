// ---------------------------------------------------------------------------
// Oscorpex — WebSocket ticket route
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { AuthVariables } from "../auth/auth-middleware.js";
import { hashApiKey } from "../auth/auth-middleware.js";
import { callerTenantId, callerUserId, isPlatformAdminRequest } from "../auth/request-identity.js";
import { rateLimiter } from "../middleware/rate-limiter.js";
import { getWsConfig } from "../performance-config.js";
import { issueWsTicket } from "../ws-ticket.js";

const wsTicketRoutes = new Hono<{ Variables: AuthVariables }>();

// Runs after the access guard (the route requires projects:read), so the limiter keys on the authenticated user.
wsTicketRoutes.post(
	"/ws/ticket",
	rateLimiter({ name: "ws-ticket", windowMs: 60_000, max: getWsConfig().ticketIssuePerMinute }),
	(c) => {
		const userId = callerUserId(c);
		const tenantId = callerTenantId(c);
		if (!userId || !tenantId) return c.json({ error: "Unauthorized" }, 401);

		const authType = c.get("authType");
		const tokenExp = c.get("tokenExp");
		const apiKeyId = c.get("apiKeyId");

		return c.json(
			issueWsTicket({
				userId,
				tenantId,
				role: c.get("userRole") ?? "",
				isPlatformAdmin: isPlatformAdminRequest(c),
				authType,
				tokenExpiresAt: tokenExp !== undefined ? tokenExp * 1000 : undefined,
				...(authType === "api-key-db" && apiKeyId
					? { apiKeyId, apiKeyHash: hashApiKey(c.req.header("Authorization")?.slice(7) ?? "") }
					: {}),
			}),
		);
	},
);

export { wsTicketRoutes };
