// ---------------------------------------------------------------------------
// Boot Phase — HTTP Server
// Builds the Hono app, mounts routes, and starts the HTTP server.
// ---------------------------------------------------------------------------

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { observabilityRoutes } from "../observability-routes.js";
import { authRoutes, studioRoutes } from "../studio/index.js";
import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:http");

export interface HttpPhaseResult {
	app: Hono;
	server: ReturnType<typeof serve>;
}

export function httpPhase(port: number): HttpPhaseResult {
	const app = new Hono();
	app.route("/api/studio", studioRoutes);
	app.route("/api/observability", observabilityRoutes);
	app.route("/api/auth", authRoutes);

	// Health check
	app.get("/health", (c) => c.json({ status: "ok", mode: "kernel" }));

	// Bind to localhost in dev mode to prevent LAN exposure without auth
	const hostname = process.env.NODE_ENV === "production" ? "0.0.0.0" : (process.env.HOST ?? "127.0.0.1");
	const server = serve({ fetch: app.fetch, port, hostname });

	log.info(`HTTP server ready — http://${hostname}:${port}`);
	log.info(`Studio API: http://${hostname}:${port}/api/studio`);

	return { app, server };
}
