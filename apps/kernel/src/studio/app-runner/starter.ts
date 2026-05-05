// ---------------------------------------------------------------------------
// app-runner/starter.ts — High-level startApp orchestration
// (dependency install, DB provisioning, port resolution, service wiring)
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDbConnectionInfo, provisionDatabase } from "../db-provisioner.js";
import { createLogger } from "../logger.js";
import { analyzeProject, generateStudioConfig, writeEnvFile } from "../runtime-analyzer.js";
import type { DetectedService } from "../runtime-analyzer.js";
import { detectDockerCompose, loadStudioConfig } from "./detection.js";
import { resolvePort } from "./port-manager.js";
import { startService, stopApp } from "./process-manager.js";
import { runningApps } from "./state.js";
import type { RunningService, ServiceConfig, StudioConfig } from "./types.js";

const log = createLogger("app-runner");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * StudioConfig'dan başlat (ortak mantık).
 */
export async function startFromConfig(
	projectId: string,
	repoPath: string,
	config: StudioConfig,
	onLog: (msg: string) => void,
): Promise<{ services: { name: string; url: string }[]; previewUrl: string | null }> {
	onLog(`[app-runner] ${config.services.length} servis, preview: ${config.preview}`);

	// Port conflict resolution — çakışan portları otomatik değiştir
	const usedPorts = new Set<number>();
	for (const svc of config.services) {
		const resolved = resolvePort(svc.port, usedPorts);
		if (resolved !== svc.port) {
			onLog(`[app-runner] Port çakışması: ${svc.name} :${svc.port} → :${resolved}`);
			svc.port = resolved;
		}
		usedPorts.add(svc.port);
	}

	// Frontend servisine backend URL'ini Vite proxy target olarak enjekte et
	// (port çakışma çözümü sonrası gerçek portları kullan)
	if (config.services.length > 1) {
		const backendSvc = config.services.find((s) => s.name !== config.preview);
		const frontendSvc = config.services.find((s) => s.name === config.preview);
		if (backendSvc && frontendSvc) {
			const backendUrl = `http://localhost:${backendSvc.port}`;
			frontendSvc.env = {
				...frontendSvc.env,
				API_TARGET: backendUrl,
			};
			onLog(`[app-runner] Frontend env: API_TARGET=${backendUrl}`);
		}
	}

	const running: RunningService[] = [];
	const isDocker = config.services.some((s) => s.command.startsWith("docker compose"));

	if (isDocker) {
		onLog("[app-runner] Docker Compose başlatılıyor...");
		try {
			const svc = await startService(
				repoPath,
				{
					name: "docker-compose",
					path: ".",
					command: "docker compose up",
					port: config.services[0]?.port || 3000,
					readyPattern: config.services[0]?.readyPattern || "started|ready",
				},
				onLog,
			);
			running.push(svc);
			for (const s of config.services) {
				if (s.name !== "docker-compose") {
					running.push({
						name: s.name,
						process: svc.process,
						port: s.port,
						url: `http://localhost:${s.port}`,
					});
				}
			}
		} catch (err) {
			onLog(`[app-runner] Docker Compose başarısız: ${err instanceof Error ? err.message : String(err)}`);
		}
	} else {
		for (const svcConfig of config.services) {
			try {
				const svc = await startService(repoPath, svcConfig, onLog);
				running.push(svc);
			} catch (err) {
				onLog(`[app-runner] ${svcConfig.name} başarısız: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	if (running.length === 0) {
		throw new Error("Hiçbir servis başlatılamadı");
	}

	runningApps.set(projectId, { services: running, previewService: config.preview });
	const previewSvc = running.find((s) => s.name === config.preview) || running[0];

	return {
		services: running.map((s) => ({ name: s.name, url: s.url })),
		previewUrl: previewSvc?.url || null,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start all services for a project.
 * Akıllı fallback zinciri:
 *   1. .studio.json varsa → onu kullan
 *   2. runtime-analyzer ile analiz → dependency install → direct start
 *   3. Hepsi fail → Docker Compose dene (son çare)
 */
export async function startApp(
	projectId: string,
	repoPath: string,
	onLog: (msg: string) => void,
	settingsOverride?: StudioConfig | null,
): Promise<{ services: { name: string; url: string }[]; previewUrl: string | null }> {
	// Stop existing
	await stopApp(projectId, onLog);

	// --- Strateji 1: .studio.json veya settings override ---
	if (settingsOverride?.services?.length) {
		onLog("[app-runner] Settings override ile başlatılıyor...");
		return startFromConfig(projectId, repoPath, settingsOverride, onLog);
	}
	const studioConfig = loadStudioConfig(repoPath);
	if (studioConfig) {
		onLog("[app-runner] .studio.json ile başlatılıyor...");
		return startFromConfig(projectId, repoPath, studioConfig, onLog);
	}

	// --- Strateji 2: Runtime analizi + direct start ---
	onLog("[app-runner] Proje analiz ediliyor...");
	const analysis = analyzeProject(repoPath);

	if (analysis.services.length > 0) {
		// DB provisioning (Docker container)
		if (analysis.databases.length > 0) {
			onLog(`[app-runner] ${analysis.databases.length} veritabanı algılandı, hazırlanıyor...`);
			const dbEnvVars: Record<string, string> = {};
			for (const db of analysis.databases) {
				try {
					const result = await provisionDatabase(projectId, db, onLog);
					Object.assign(dbEnvVars, result.envVars);
				} catch (err) {
					onLog(
						`[app-runner] DB provisioning atlandı (${db.type}): ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
			// DB env var'larını .env'ye yaz (eksik olanları)
			if (Object.keys(dbEnvVars).length > 0) {
				try {
					writeEnvFile(repoPath, dbEnvVars);
					onLog(`[app-runner] DB env var'ları .env'ye yazıldı`);
				} catch {
					/* non-blocking */
				}
			}

			// Migration çalıştır (package.json'da migrate script varsa)
			try {
				const pkgPath = join(repoPath, "package.json");
				if (existsSync(pkgPath)) {
					const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
					const migrateScript = pkg.scripts?.migrate || pkg.scripts?.["db:migrate"] || pkg.scripts?.["db:setup"];
					if (migrateScript) {
						const scriptName = pkg.scripts?.migrate
							? "migrate"
							: pkg.scripts?.["db:migrate"]
								? "db:migrate"
								: "db:setup";
						onLog(`[app-runner] Migration çalıştırılıyor: npm run ${scriptName}`);
						const pmCmd = existsSync(join(repoPath, "pnpm-lock.yaml"))
							? "pnpm"
							: existsSync(join(repoPath, "yarn.lock"))
								? "yarn"
								: "npm";
						execSync(`${pmCmd} run ${scriptName}`, {
							cwd: repoPath,
							encoding: "utf-8",
							timeout: 30000,
							stdio: "pipe",
							env: { ...process.env, ...dbEnvVars },
						});
						onLog("[app-runner] Migration başarılı");
					}
				}
			} catch (err) {
				onLog(`[app-runner] Migration atlandı: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
			}
		}

		// Dependency installation
		for (const svc of analysis.services) {
			if (!svc.depsInstalled && svc.installCommand) {
				const svcPath = svc.path === "." ? repoPath : join(repoPath, svc.path);
				// Append --ignore-scripts to npm/pnpm/yarn to prevent arbitrary lifecycle script execution
				const safeInstallCmd = /^(npm|pnpm|yarn)\s+install/.test(svc.installCommand)
					? `${svc.installCommand} --ignore-scripts`
					: svc.installCommand;
				onLog(`[app-runner] Bağımlılıklar kuruluyor: ${safeInstallCmd} (${svc.name})`);
				try {
					execSync(safeInstallCmd, {
						cwd: svcPath,
						encoding: "utf-8",
						timeout: 120000,
						stdio: "pipe",
					});
					onLog(`[app-runner] Bağımlılıklar kuruldu: ${svc.name}`);
				} catch (err) {
					onLog(
						`[app-runner] Bağımlılık kurulumu başarısız (${svc.name}): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
					);
				}
			}
		}

		// Port conflict resolution
		const usedPorts2 = new Set<number>();
		for (const svc of analysis.services) {
			const resolved = resolvePort(svc.port, usedPorts2);
			if (resolved !== svc.port) {
				onLog(`[app-runner] Port çakışması: ${svc.name} :${svc.port} → :${resolved}`);
				svc.port = resolved;
			}
			usedPorts2.add(svc.port);
		}

		// Frontend servisine backend URL'ini Vite proxy target olarak enjekte et
		type ServiceWithEnv = DetectedService & { env?: Record<string, string> };
		const servicesWithEnv = analysis.services as ServiceWithEnv[];
		if (analysis.services.length > 1) {
			const backendSvc = servicesWithEnv.find((s) => s.type === "backend");
			const frontendSvc = servicesWithEnv.find((s) => s.type === "frontend" || s.type === "fullstack");
			if (backendSvc && frontendSvc) {
				const backendUrl = `http://localhost:${backendSvc.port}`;
				frontendSvc.env = {
					...frontendSvc.env,
					API_TARGET: backendUrl,
				};
				onLog(`[app-runner] Frontend env: API_TARGET=${backendUrl}`);
			}
		}

		// Direct start — each service
		const running: RunningService[] = [];
		for (const svc of servicesWithEnv) {
			try {
				const svcConfig: ServiceConfig = {
					name: svc.name,
					path: svc.path,
					command: svc.startCommand,
					port: svc.port,
					readyPattern: svc.readyPattern,
					env: svc.env,
				};
				const started = await startService(repoPath, svcConfig, onLog);
				running.push(started);
			} catch (err) {
				onLog(
					`[app-runner] ${svc.name} başlatılamadı: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
				);
			}
		}

		if (running.length > 0) {
			const previewName =
				analysis.services.find((s) => s.type === "frontend" || s.type === "fullstack")?.name ||
				analysis.services[0]?.name ||
				"app";

			runningApps.set(projectId, { services: running, previewService: previewName });

			// Başarılı — .studio.json oluştur (sadece başarılı başlayan servislerle)
			try {
				const runningNames = new Set(running.map((r) => r.name));
				const successfulServices = analysis.services.filter((s) => runningNames.has(s.name));
				if (successfulServices.length > 0) {
					generateStudioConfig(repoPath, successfulServices, previewName);
					onLog(
						`[app-runner] .studio.json oluşturuldu (${successfulServices.length}/${analysis.services.length} servis)`,
					);
				}
			} catch {
				/* non-blocking */
			}

			const previewSvc = running.find((s) => s.name === previewName) || running[0];
			return {
				services: running.map((s) => ({ name: s.name, url: s.url })),
				previewUrl: previewSvc?.url || null,
			};
		}

		onLog("[app-runner] Direct start başarısız — Docker Compose deneniyor...");
	}

	// --- Strateji 3: Docker Compose (son çare) ---
	const dockerConfig = detectDockerCompose(repoPath);
	if (dockerConfig) {
		onLog("[app-runner] Docker Compose ile başlatılıyor...");
		return startFromConfig(projectId, repoPath, dockerConfig, onLog);
	}

	throw new Error(
		"Çalıştırılabilir servis bulunamadı. " + "Lütfen Runtime panelinden yapılandırma yapın veya .studio.json ekleyin.",
	);
}
