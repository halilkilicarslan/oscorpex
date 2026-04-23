// ---------------------------------------------------------------------------
// Oscorpex — Kernel Boot (VoltAgent-free)
// Starts the core Oscorpex platform without VoltAgent.
// The studio HTTP server, WebSocket, DB bootstrap, and execution recovery
// all run independently of any VoltAgent integration.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { observabilityRoutes } from "./observability-routes.js";
import { containerPool } from "./studio/container-pool.js";
import { applyDbBootstrap } from "./studio/db-bootstrap.js";
import { authRoutes, studioRoutes } from "./studio/index.js";
import { providerState } from "./studio/provider-state.js";
import { webhookSender } from "./studio/webhook-sender.js";
import { startWSServer } from "./studio/ws-server.js";
import { createLogger } from "./studio/logger.js";

const log = createLogger("boot");

export interface KernelBootOptions {
	port?: number;
}

/**
 * Boot the Oscorpex kernel without VoltAgent.
 * Initializes DB, event bus, provider state, WebSocket, and HTTP server.
 * Returns the Hono app and the Node server for programmatic control.
 */
export async function bootKernel(options: KernelBootOptions = {}): Promise<{
	app: Hono;
	server: ReturnType<typeof serve>;
	port: number;
}> {
	const port = options.port ?? Number(process.env.PORT) ?? 3141;

	log.info(`[boot] Starting Oscorpex kernel on port ${port}...`);

	// 1. DB schema migrations (idempotent — safe on every startup)
	await applyDbBootstrap();
	log.info("[boot] DB schema bootstrap complete");

	// 2. Provider state
	await providerState.loadFromDb().catch((err) => {
		log.warn("[boot] Provider state load skipped: " + (err instanceof Error ? err.message : String(err)));
	});

	// 3. WebSocket server (port 3142)
	startWSServer();
	log.info("[boot] WebSocket server started");

	// 4. Webhook sender
	webhookSender.init();
	log.info("[boot] Webhook sender initialized");

	// 5. Container pool warm-up (non-blocking — fails silently if Docker not available)
	containerPool.initialize().catch((err) => {
		log.warn("[boot] Container pool init skipped: " + (err instanceof Error ? err.message : String(err)));
	});

	// 6. Execution engine recovery (stuck tasks)
	const { executionEngine } = await import("./studio/execution-engine.js");
	await executionEngine.recoverStuckTasks().catch((err) => {
		log.error("[boot] Startup recovery failed: " + String(err));
	});

	// 7. Pipeline engine hook registration
	const { pipelineEngine } = await import("./studio/pipeline-engine.js");
	pipelineEngine.registerTaskHook();

	// 8. Build Hono app with studio routes
	const app = new Hono();
	app.route("/api/studio", studioRoutes);
	app.route("/api/observability", observabilityRoutes);
	app.route("/api/auth", authRoutes);

	// Health check
	app.get("/health", (c) => c.json({ status: "ok", mode: "kernel" }));

	// 9. Start HTTP server
	const server = serve({ fetch: app.fetch, port });

	log.info(`[boot] Oscorpex kernel ready — http://0.0.0.0:${port}`);
	log.info(`[boot] Studio API: http://0.0.0.0:${port}/api/studio`);

	return { app, server, port };
}

/**
 * Convenience: boot and block until SIGINT/SIGTERM.
 */
export async function bootAndServe(options?: KernelBootOptions): Promise<void> {
	const { server, port } = await bootKernel(options);

	const shutdown = () => {
		log.info("[boot] Shutting down...");
		server.close();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	log.info(`[boot] Press Ctrl+C to stop`);
}