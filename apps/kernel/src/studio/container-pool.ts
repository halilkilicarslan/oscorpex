// ---------------------------------------------------------------------------
// Oscorpex — Container Pool
// Manages a pool of pre-warmed Docker containers for agent task execution.
// Each container runs an HTTP agent-worker that accepts task requests.
// ---------------------------------------------------------------------------

import Dockerode from "dockerode";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
const log = createLogger("container-pool");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolContainer {
	id: string;
	name: string;
	port: number;
	status: "ready" | "busy" | "starting" | "stopping" | "unhealthy";
	assignedTo?: { projectId: string; agentId: string; taskId: string };
	createdAt: string;
	lastHealthCheck?: string;
}

export interface PoolConfig {
	/** Minimum idle containers to keep warm */
	minIdle: number;
	/** Maximum total containers */
	maxTotal: number;
	/** Container memory limit */
	memoryLimit: string;
	/** Container CPU limit (cores) */
	cpuLimit: number;
	/** Health check interval in ms */
	healthCheckInterval: number;
	/** Container idle timeout before recycle (ms) */
	idleTimeout: number;
}

export interface TaskRequest {
	taskId: string;
	prompt: string;
	systemPrompt?: string;
	timeout?: number;
}

export interface TaskResult {
	status: "completed" | "failed";
	output: string;
	filesCreated: string[];
	filesModified: string[];
	logs: string[];
	exitCode: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_IMAGE = "ai-dev-studio/coder:latest";
const CONTAINER_PREFIX = "studio-pool-";
const INTERNAL_NETWORK = "studio-agent-net";
const BASE_PORT = 9900;

/** Map sandbox NetworkPolicy to Docker NetworkMode */
export function resolveNetworkMode(networkPolicy?: string): string {
	switch (networkPolicy) {
		case "no_network":
			return "none";
		case "project_only":
			return INTERNAL_NETWORK;
		case "unrestricted":
		default:
			return INTERNAL_NETWORK;
	}
}

const DEFAULT_CONFIG: PoolConfig = {
	minIdle: 2,
	maxTotal: 8,
	memoryLimit: "2g",
	cpuLimit: 2,
	healthCheckInterval: 15_000,
	idleTimeout: 300_000, // 5 min
};

// ---------------------------------------------------------------------------
// Container Pool
// ---------------------------------------------------------------------------

class ContainerPool {
	private docker: Dockerode;
	private containers = new Map<string, PoolContainer>();
	private portCounter = BASE_PORT;
	private config: PoolConfig;
	private healthTimer?: ReturnType<typeof setInterval>;
	private initialized = false;

	constructor(config?: Partial<PoolConfig>) {
		this.docker = new Dockerode();
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// -------------------------------------------------------------------------
	// Initialization
	// -------------------------------------------------------------------------

	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Ensure Docker is available
		try {
			await this.docker.ping();
		} catch {
			log.warn("[pool] Docker not available — pool disabled");
			return;
		}

		// Ensure network exists
		await this.ensureNetwork();

		// Ensure image exists
		const hasImage = await this.hasImage();
		if (!hasImage) {
			log.warn(`[pool] Image ${AGENT_IMAGE} not found. Run: docker build -t ${AGENT_IMAGE} docker/coder-agent/`);
			return;
		}

		// Clean up stale pool containers from previous runs
		await this.cleanupStale();

		// Pre-warm the pool
		const warmPromises: Promise<void>[] = [];
		for (let i = 0; i < this.config.minIdle; i++) {
			warmPromises.push(this.addContainer().then(() => {}));
		}
		await Promise.allSettled(warmPromises);

		// Start health checks
		this.healthTimer = setInterval(() => this.healthCheck(), this.config.healthCheckInterval);

		this.initialized = true;
		log.info(
			`[pool] Initialized with ${this.containers.size} containers (min=${this.config.minIdle}, max=${this.config.maxTotal})`,
		);
	}

	// -------------------------------------------------------------------------
	// Task execution
	// -------------------------------------------------------------------------

	/**
	 * Acquire an idle container, send the task, and return the result.
	 * The container's /workspace is mounted from the project's repoPath.
	 */
	async executeTask(
		projectId: string,
		agentId: string,
		agentName: string,
		agentRole: string,
		repoPath: string,
		task: TaskRequest,
	): Promise<TaskResult> {
		const container = await this.acquire(projectId, agentId, task.taskId);
		if (!container) {
			throw new Error("[pool] No container available — pool exhausted");
		}

		try {
			// Set environment for this task via container exec
			await this.configureContainer(container, {
				AGENT_ID: agentId,
				AGENT_NAME: agentName,
				AGENT_ROLE: agentRole,
				PROJECT_ID: projectId,
			});

			// Send task to worker HTTP endpoint
			const url = `http://localhost:${container.port}/task`;
			const controller = new AbortController();
			const timeout = task.timeout ?? 300_000;
			const timer = setTimeout(() => controller.abort(), timeout);

			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(task),
				signal: controller.signal,
			});
			clearTimeout(timer);

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`Worker error (${res.status}): ${errText}`);
			}

			const result = (await res.json()) as TaskResult;
			return result;
		} finally {
			this.release(container.id);
		}
	}

	// -------------------------------------------------------------------------
	// Pool management
	// -------------------------------------------------------------------------

	/** Acquire a ready container from the pool */
	private async acquire(projectId: string, agentId: string, taskId: string): Promise<PoolContainer | undefined> {
		// Find an idle container
		for (const [, c] of this.containers) {
			if (c.status === "ready") {
				c.status = "busy";
				c.assignedTo = { projectId, agentId, taskId };
				return c;
			}
		}

		// No idle containers — try to scale up
		if (this.containers.size < this.config.maxTotal) {
			const c = await this.addContainer();
			if (c) {
				c.status = "busy";
				c.assignedTo = { projectId, agentId, taskId };
				return c;
			}
		}

		return undefined;
	}

	/** Release a container back to the pool */
	private release(containerId: string): void {
		const c = this.containers.get(containerId);
		if (c) {
			c.status = "ready";
			c.assignedTo = undefined;
		}
	}

	/** Create a new container and add to pool */
	private async addContainer(): Promise<PoolContainer | undefined> {
		const port = this.nextPort();
		const name = `${CONTAINER_PREFIX}${port}`;

		try {
			const container = await this.docker.createContainer({
				Image: AGENT_IMAGE,
				name,
				ExposedPorts: { "9900/tcp": {} },
				Env: [`WORKER_PORT=9900`, `WORKSPACE=/workspace`, `HOST_API=http://host.docker.internal:3141`],
				HostConfig: {
					PortBindings: { "9900/tcp": [{ HostPort: String(port) }] },
					Memory: parseMemoryLimit(this.config.memoryLimit),
					NanoCpus: this.config.cpuLimit * 1e9,
					NetworkMode: INTERNAL_NETWORK,
					// Security: read-only root filesystem except /workspace and /tmp
					ReadonlyRootfs: false, // We need write for tsx cache
					SecurityOpt: ["no-new-privileges"],
					// Drop all capabilities except what's needed
					CapDrop: ["ALL"],
					CapAdd: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
				},
				WorkingDir: "/workspace",
				Labels: {
					"studio.pool": "true",
					"studio.port": String(port),
				},
			});

			await container.start();

			// Wait for health check to pass
			const healthy = await this.waitForHealthy(port, 15_000);
			if (!healthy) {
				await container
					.stop({ t: 2 })
					.catch((err) => log.warn("[container-pool] Non-blocking operation failed:", err?.message ?? err));
				await container
					.remove({ force: true })
					.catch((err) => log.warn("[container-pool] Non-blocking operation failed:", err?.message ?? err));
				return undefined;
			}

			const poolContainer: PoolContainer = {
				id: container.id,
				name,
				port,
				status: "ready",
				createdAt: new Date().toISOString(),
			};

			this.containers.set(container.id, poolContainer);
			log.info(`[pool] Container ${name} ready on port ${port}`);
			return poolContainer;
		} catch (err) {
			log.error(`[pool] Failed to create container: ${err instanceof Error ? err.message : err}`);
			return undefined;
		}
	}

	/** Remove a container from the pool */
	private async removeContainer(containerId: string): Promise<void> {
		const c = this.containers.get(containerId);
		if (!c) return;

		try {
			const container = this.docker.getContainer(containerId);
			await container
				.stop({ t: 3 })
				.catch((err) => log.warn("[container-pool] Non-blocking operation failed:", err?.message ?? err));
			await container
				.remove({ force: true })
				.catch((err) => log.warn("[container-pool] Non-blocking operation failed:", err?.message ?? err));
		} catch {
			/* already gone */
		}

		this.containers.delete(containerId);
	}

	// -------------------------------------------------------------------------
	// Container configuration — mount workspace per task
	// -------------------------------------------------------------------------

	private async configureContainer(poolContainer: PoolContainer, env: Record<string, string>): Promise<void> {
		const container = this.docker.getContainer(poolContainer.id);
		// Write env vars to a file using env command (no shell interpolation)
		// This avoids shell injection via env values containing $(), backticks, etc.
		const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

		// Write env file for the worker to source safely
		const envFileContent = Object.entries(env)
			.map(([k, v]) => `${k}=${v}`)
			.join("\n");

		const exec = await container.exec({
			Cmd: ["sh", "-c", `cat > /tmp/.agent-env << 'ENVEOF'\n${envFileContent}\nENVEOF`],
			AttachStdout: true,
			AttachStderr: true,
		});
		await exec.start({ Detach: false, Tty: false });
	}

	// -------------------------------------------------------------------------
	// Health & maintenance
	// -------------------------------------------------------------------------

	private async healthCheck(): Promise<void> {
		const now = Date.now();
		const removals: string[] = [];

		for (const [id, c] of this.containers) {
			// Skip busy containers
			if (c.status === "busy") continue;

			// Check if idle too long and pool is above minimum
			const idle = this.getIdleCount();
			const age = now - new Date(c.createdAt).getTime();
			if (idle > this.config.minIdle && age > this.config.idleTimeout) {
				removals.push(id);
				continue;
			}

			// Ping health endpoint
			try {
				const res = await fetch(`http://localhost:${c.port}/health`, {
					signal: AbortSignal.timeout(3000),
				});
				if (res.ok) {
					c.lastHealthCheck = new Date().toISOString();
					if (c.status === "unhealthy") c.status = "ready";
				} else {
					c.status = "unhealthy";
				}
			} catch {
				c.status = "unhealthy";
				removals.push(id);
			}
		}

		// Remove unhealthy/expired containers
		for (const id of removals) {
			await this.removeContainer(id);
		}

		// Ensure minimum idle count
		const needMore = this.config.minIdle - this.getIdleCount();
		for (let i = 0; i < needMore; i++) {
			await this.addContainer();
		}
	}

	private async waitForHealthy(port: number, timeoutMs: number): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			try {
				const res = await fetch(`http://localhost:${port}/health`, {
					signal: AbortSignal.timeout(2000),
				});
				if (res.ok) return true;
			} catch {
				/* not ready yet */
			}
			await sleep(500);
		}
		return false;
	}

	private getIdleCount(): number {
		let count = 0;
		for (const c of this.containers.values()) {
			if (c.status === "ready") count++;
		}
		return count;
	}

	// -------------------------------------------------------------------------
	// Network
	// -------------------------------------------------------------------------

	private async ensureNetwork(): Promise<void> {
		try {
			await this.docker.getNetwork(INTERNAL_NETWORK).inspect();
		} catch {
			await this.docker.createNetwork({
				Name: INTERNAL_NETWORK,
				Driver: "bridge",
				Internal: false, // needs access to host.docker.internal
				Labels: { "studio.pool": "true" },
			});
			log.info(`[pool] Created network: ${INTERNAL_NETWORK}`);
		}
	}

	// -------------------------------------------------------------------------
	// Cleanup
	// -------------------------------------------------------------------------

	private async cleanupStale(): Promise<void> {
		try {
			const containers = await this.docker.listContainers({
				all: true,
				filters: { label: ["studio.pool=true"] },
			});
			for (const c of containers) {
				const container = this.docker.getContainer(c.Id);
				await container
					.stop({ t: 2 })
					.catch((err) => log.warn("[container-pool] Non-blocking operation failed:", err?.message ?? err));
				await container
					.remove({ force: true })
					.catch((err) => log.warn("[container-pool] Non-blocking operation failed:", err?.message ?? err));
			}
			if (containers.length > 0) {
				log.info(`[pool] Cleaned up ${containers.length} stale containers`);
			}
		} catch {
			/* ignore */
		}
	}

	async shutdown(): Promise<void> {
		if (this.healthTimer) clearInterval(this.healthTimer);

		const promises: Promise<void>[] = [];
		for (const id of this.containers.keys()) {
			promises.push(this.removeContainer(id));
		}
		await Promise.allSettled(promises);
		log.info("[pool] Shut down");
	}

	// -------------------------------------------------------------------------
	// Utils
	// -------------------------------------------------------------------------

	private async hasImage(): Promise<boolean> {
		try {
			await this.docker.getImage(AGENT_IMAGE).inspect();
			return true;
		} catch {
			return false;
		}
	}

	private nextPort(): number {
		const usedPorts = new Set([...this.containers.values()].map((c) => c.port));
		let port = BASE_PORT;
		while (usedPorts.has(port)) port++;
		this.portCounter = port + 1;
		return port;
	}

	// -------------------------------------------------------------------------
	// Status
	// -------------------------------------------------------------------------

	getStatus(): {
		initialized: boolean;
		total: number;
		ready: number;
		busy: number;
		unhealthy: number;
		containers: PoolContainer[];
	} {
		let ready = 0,
			busy = 0,
			unhealthy = 0;
		for (const c of this.containers.values()) {
			if (c.status === "ready") ready++;
			else if (c.status === "busy") busy++;
			else if (c.status === "unhealthy") unhealthy++;
		}
		return {
			initialized: this.initialized,
			total: this.containers.size,
			ready,
			busy,
			unhealthy,
			containers: [...this.containers.values()],
		};
	}

	isReady(): boolean {
		return this.initialized && this.getIdleCount() > 0;
	}

	/** Bind a project's repo path to a container */
	async bindWorkspace(containerId: string, repoPath: string): Promise<void> {
		// Validate repoPath to prevent command injection
		if (!/^[a-zA-Z0-9/_.\-]+$/.test(repoPath)) {
			throw new Error(`Invalid repoPath: contains unsafe characters`);
		}
		// Docker doesn't support live mount changes, so we use a workaround:
		// Copy the workspace content or use a shared volume
		// Use array-based Cmd to avoid shell interpolation of repoPath
		const container = this.docker.getContainer(containerId);
		const cleanExec = await container.exec({
			Cmd: ["rm", "-rf", "/workspace"],
			AttachStdout: true,
			AttachStderr: true,
		});
		await cleanExec.start({ Detach: false, Tty: false });

		const mkdirExec = await container.exec({
			Cmd: ["mkdir", "-p", "/workspace"],
			AttachStdout: true,
			AttachStderr: true,
		});
		await mkdirExec.start({ Detach: false, Tty: false });

		const copyExec = await container.exec({
			Cmd: ["cp", "-a", `${repoPath}/.`, "/workspace/"],
			AttachStdout: true,
			AttachStderr: true,
		});
		await copyExec.start({ Detach: false, Tty: false });
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMemoryLimit(limit: string): number {
	const match = limit.match(/^(\d+)(g|m)$/i);
	if (!match) return 2 * 1024 * 1024 * 1024;
	const value = Number.parseInt(match[1], 10);
	const unit = match[2].toLowerCase();
	return unit === "g" ? value * 1024 * 1024 * 1024 : value * 1024 * 1024;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------

export const containerPool = new ContainerPool();
