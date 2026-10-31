// ---------------------------------------------------------------------------
// Boot Phase — HTTP Server
// Builds the Hono app, mounts routes, and starts the HTTP server.
// ---------------------------------------------------------------------------

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { observabilityRoutes } from "../observability-routes.js";
import { authRoutes, studioRoutes } from "../studio/index.js";
import { createLogger } from "../studio/logger.js";
import { originGuard } from "../studio/middleware/origin-guard.js";
import { rateLimiter } from "../studio/middleware/rate-limiter.js";

const log = createLogger("boot:http");

export interface HttpPhaseResult {
	app: Hono;
	server: ReturnType<typeof serve>;
}

/** All HTTP mounts and /health; does not listen. */
export function buildHttpApp(): Hono {
	const app = new Hono();
	// Root mounts sit outside studioRoutes, so the CSRF guard and auth throttling are applied here as well
	app.use("/api/*", originGuard());
	const authLimiter = rateLimiter({ windowMs: 60_000, max: 10 });
	app.post("/api/auth/login", authLimiter);
	app.post("/api/auth/register", authLimiter);
	app.route("/api/studio", studioRoutes);
	app.route("/api/observability", observabilityRoutes);
	app.route("/api/auth", authRoutes);

	// Health check
	app.get("/health", (c) => c.json({ status: "ok", mode: "kernel" }));
	return app;
}

export function httpPhase(port: number): HttpPhaseResult {
	const app = buildHttpApp();

	// Bind to localhost in dev mode to prevent LAN exposure without auth
	const hostname = process.env.NODE_ENV === "production" ? "0.0.0.0" : (process.env.HOST ?? "127.0.0.1");
	const server = serve({ fetch: app.fetch, port, hostname });

	log.info(`HTTP server ready — http://${hostname}:${port}`);
	log.info(`Studio API: http://${hostname}:${port}/api/studio`);

	return { app, server };
}
