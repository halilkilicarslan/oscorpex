// ---------------------------------------------------------------------------
// app-runner/process-manager.ts — Service start/stop lifecycle
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { basename, resolve as resolvePath } from "node:path";
import { resolveContainedCwd } from "../security/contained-fs.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";
import { postStartHealthCheck } from "./port-manager.js";
import { runningApps } from "./state.js";
import type { RunningService, ServiceConfig } from "./types.js";

const CONTAINER_BINARIES = new Set(["docker", "docker-compose", "podman", "nerdctl"]);

export function startService(
	repoPath: string,
	config: ServiceConfig,
	onLog: (msg: string) => void,
): Promise<RunningService> {
	return new Promise((resolve, reject) => {
		// The service dir comes from tenant-controlled config: its REAL path must be inside the repo (an absolute path or a
		// symlink out of it is refused), and the process starts from that real directory.
		let servicePath: string;
		try {
			servicePath = resolveContainedCwd(repoPath, resolvePath(repoPath, config.path)).realCwd;
		} catch (err) {
			reject(new Error(`Service ${config.name} refused: ${err instanceof Error ? err.message : String(err)}`));
			return;
		}
		const command = config.command.replace(/\$\{PORT\}/g, String(config.port));

		// Defense-in-depth guard, not an isolation boundary; isolation is a separate epic.
		if (
			process.env.OSCORPEX_AUTH_ENABLED === "true" &&
			CONTAINER_BINARIES.has(basename(command.trim().split(/\s+/)[0] ?? ""))
		) {
			reject(new Error("Docker/container commands are disabled in multi-tenant mode (auth enabled)"));
			return;
		}

		// Validate readyPattern to prevent ReDoS from untrusted .studio.json
		let readyPattern: RegExp;
		try {
			if (config.readyPattern.length > 200) throw new Error("Pattern too long");
			readyPattern = new RegExp(config.readyPattern, "i");
		} catch {
			readyPattern = /ready|listening|started/i;
			onLog(`[app-runner] Invalid readyPattern "${config.readyPattern.slice(0, 50)}", using default`);
		}

		onLog(`[app-runner] Starting ${config.name}: ${command} (port ${config.port})`);

		// Split command into parts
		const parts = command.split(/\s+/);
		const bin = parts[0];
		const args = parts.slice(1);

		const childEnv = buildSafeChildEnv({ profile: "app_runner", extra: { PORT: String(config.port) } });
		for (const [key, value] of Object.entries(config.env ?? {})) childEnv[key] = value;

		const proc = spawn(bin, args, {
			cwd: servicePath,
			env: childEnv,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true, // isolate from main process group — prevents killing console Vite
		});

		const output: string[] = [];
		const timeout = 45000; // 45 seconds max

		const timer = setTimeout(async () => {
			// Process çöktüyse direkt reject
			if (proc.killed || proc.exitCode !== null) {
				reject(new Error(`${config.name}: process başlatıldı ama kapandı (exit: ${proc.exitCode})`));
				return;
			}
			// HTTP health check — process gerçekten dinliyor mu?
			onLog(`[app-runner] ${config.name}: ready pattern bulunamadı, health check yapılıyor...`);
			const alive = await postStartHealthCheck(config.port);
			if (alive) {
				onLog(`[app-runner] ${config.name}: health check başarılı — http://localhost:${config.port}`);
			} else {
				onLog(`[app-runner] ${config.name}: health check başarısız — port ${config.port} yanıt vermiyor`);
			}
			// Her durumda resolve et — process hala çalışıyor olabilir (slow start)
			resolve({
				name: config.name,
				process: proc,
				port: config.port,
				url: `http://localhost:${config.port}`,
			});
		}, timeout);

		let resolved = false;
		const onData = (data: Buffer) => {
			const line = data.toString();
			output.push(line);
			if (!resolved && readyPattern.test(line)) {
				resolved = true;
				clearTimeout(timer);
				onLog(`[app-runner] ${config.name} ready at http://localhost:${config.port}`);
				// Kısa bir gecikme + health check — process "ready" deyip crash olabilir
				setTimeout(async () => {
					const alive = await postStartHealthCheck(config.port, 3);
					if (!alive && (proc.killed || proc.exitCode !== null)) {
						onLog(`[app-runner] ${config.name}: ready mesajı geldi ama process crash oldu`);
						reject(new Error(`${config.name}: process crash — ${output.join("").slice(-300)}`));
						return;
					}
					resolve({
						name: config.name,
						process: proc,
						port: config.port,
						url: `http://localhost:${config.port}`,
					});
				}, 2000);
			}
		};

		proc.stdout?.on("data", onData);
		proc.stderr?.on("data", onData);

		proc.on("error", (err) => {
			clearTimeout(timer);
			onLog(`[app-runner] ${config.name} error: ${err.message}`);
			reject(err);
		});

		proc.on("exit", (code) => {
			if (code !== 0 && code !== null) {
				clearTimeout(timer);
				const msg = `${config.name} exited with code ${code}\n${output.join("").slice(-500)}`;
				onLog(`[app-runner] ${msg}`);
				reject(new Error(msg));
			}
		});
	});
}

/**
 * Stop all running services for a project.
 */
export async function stopApp(projectId: string, onLog?: (msg: string) => void): Promise<void> {
	const existing = runningApps.get(projectId);
	if (!existing) return;

	onLog?.("[app-runner] Stopping services...");

	// Collect unique processes (docker compose shares one process)
	const procs = new Set(existing.services.map((s) => s.process));

	for (const proc of procs) {
		try {
			// Kill entire process group (detached children) with negative PID
			if (proc.pid) process.kill(-proc.pid, "SIGTERM");
			else proc.kill("SIGTERM");
		} catch {
			/* ignore */
		}
	}

	await new Promise((r) => setTimeout(r, 1500));

	for (const proc of procs) {
		try {
			if (proc.pid) process.kill(-proc.pid, "SIGKILL");
			else proc.kill("SIGKILL");
		} catch {
			/* ignore */
		}
	}

	runningApps.delete(projectId);
}

/**
 * Get status of running app services.
 */
export function getAppStatus(projectId: string) {
	const entry = runningApps.get(projectId);
	if (!entry) {
		return { running: false, services: [], previewUrl: null, backendUrl: null, frontendUrl: null };
	}

	const services = entry.services.map((s) => ({
		name: s.name,
		url: s.url,
		isPreview: s.name === entry.previewService,
	}));

	const previewSvc = entry.services.find((s) => s.name === entry.previewService) || entry.services[0];
	const backendSvc = entry.services.find(
		(s) => ["backend", "server", "api"].includes(s.name) || s.name === "docker-compose",
	);
	const frontendSvc = entry.services.find((s) => ["frontend", "web", "client"].includes(s.name)) || previewSvc;

	return {
		running: true,
		services,
		previewUrl: previewSvc?.url || null,
		backendUrl: backendSvc?.url || null,
		frontendUrl: frontendSvc?.url || previewSvc?.url || null,
	};
}

/**
 * Switch the active preview service (proxy target).
 */
export function switchPreviewService(projectId: string, serviceName: string): boolean {
	const entry = runningApps.get(projectId);
	if (!entry) return false;
	const svc = entry.services.find((s) => s.name === serviceName);
	if (!svc) return false;
	entry.previewService = serviceName;
	return true;
}
