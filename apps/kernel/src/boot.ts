// ---------------------------------------------------------------------------
// Oscorpex — Kernel Boot
// Orchestrates the boot sequence via discrete phase modules.
// Each phase is imported from ./boot-phases/ and has a single responsibility.
// ---------------------------------------------------------------------------

import "dotenv/config";
import type { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createLogger } from "./studio/logger.js";

import { authConfigPhase } from "./boot-phases/auth-config-phase.js";
import { containerPoolPhase } from "./boot-phases/container-pool-phase.js";
import { dbPhase } from "./boot-phases/db-phase.js";
import { httpPhase } from "./boot-phases/http-phase.js";
import { pipelinePhase } from "./boot-phases/pipeline-phase.js";
import { providerRegistryPhase } from "./boot-phases/provider-registry-phase.js";
import { providerStatePhase } from "./boot-phases/provider-state-phase.js";
import { recoveryPhase } from "./boot-phases/recovery-phase.js";
import { replayPhase } from "./boot-phases/replay-phase.js";
import { webhookPhase } from "./boot-phases/webhook-phase.js";
import { websocketPhase } from "./boot-phases/websocket-phase.js";
import {
	registerEventBridges,
	registerNotificationBridge,
	registerPluginBridge,
	registerSeeders,
	registerWebhookBridge,
} from "./studio/composition/index.js";

const log = createLogger("boot");

export interface KernelBootOptions {
	port?: number;
}

/**
 * Boot the Oscorpex kernel.
 * Phases are executed in order; each phase is isolated and has a single responsibility.
 */
export async function bootKernel(options: KernelBootOptions = {}): Promise<{
	app: Hono;
	server: ReturnType<typeof serve>;
	port: number;
}> {
	const port = options.port ?? Number(process.env.PORT) ?? 3141;

	log.info(`[boot] Starting Oscorpex kernel on port ${port}...`);

	// Phase 1: DB schema migrations (fatal on failure)
	await dbPhase();

	// Phase 1.5: Auth config validation (fatal in production)
	authConfigPhase();

	// Phase 2: Provider state (warning on failure)
	await providerStatePhase();

	// Phase 3: WebSocket server
	websocketPhase();

	// Phase 4: Webhook sender
	webhookPhase();

	// Phase 5: Container pool warm-up (skip-allowed)
	containerPoolPhase();

	// Phase 6: Execution engine recovery (error logged, non-fatal)
	await recoveryPhase();

	// Phase 7: Pipeline engine hooks
	await pipelinePhase();

	// Phase 8: Provider registry wiring
	await providerRegistryPhase();

	// Phase 9: Replay auto-checkpoint wiring
	replayPhase();

	// Phase 9.5: Application composition (seeders, event bridges, webhooks, plugins, notifications)
	registerSeeders();
	registerEventBridges();
	registerWebhookBridge();
	registerPluginBridge();
	registerNotificationBridge();
	log.info("[boot] Application composition wired");

	// Phase 10: Build Hono app + HTTP server
	const { app, server } = httpPhase(port);

	log.info("[boot] Oscorpex kernel ready");

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
