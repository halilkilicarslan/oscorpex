// ---------------------------------------------------------------------------
// Boot Phase — HTTP Server
// Builds the Hono app, mounts routes, and starts the HTTP server.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { serve } from "@hono/node-server";
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

	const server = serve({ fetch: app.fetch, port });

	log.info(`HTTP server ready — http://0.0.0.0:${port}`);
	log.info(`Studio API: http://0.0.0.0:${port}/api/studio`);

	return { app, server };
}
