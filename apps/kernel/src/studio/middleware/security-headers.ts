// ---------------------------------------------------------------------------
// Oscorpex — Security Headers Middleware
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
	await next();
	c.header("X-Content-Type-Options", "nosniff");
	c.header("X-Frame-Options", "DENY");
	c.header("Referrer-Policy", "strict-origin-when-cross-origin");
	c.header("X-XSS-Protection", "0");
	c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	if (process.env.NODE_ENV === "production") {
		c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
};
