// ---------------------------------------------------------------------------
// Oscorpex — Universal App Runner
// .studio.json, Docker Compose, ve otomatik dil algılama ile proje çalıştırma.
//
// Öncelik sırası:
//   1. .studio.json (tam kontrol)
//   2. docker-compose.yml (dil bağımsız)
//   3. Otomatik detection (package.json, requirements.txt, pom.xml, go.mod...)
//   4. Project settings override (DB'den)
// ---------------------------------------------------------------------------

import { type ChildProcess, execFileSync, execSync, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getDbConnectionInfo, provisionDatabase } from "./db-provisioner.js";
import { createLogger } from "./logger.js";
import { analyzeProject, generateStudioConfig, writeEnvFile } from "./runtime-analyzer.js";
import type { DetectedService, RuntimeRequirements } from "./runtime-analyzer.js";
const log = createLogger("app-runner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceConfig {
	name: string;
	path: string; // relative to repoPath
	command: string; // start command (${PORT} placeholder)
	port: number;
	readyPattern: string; // regex to detect server ready
	env?: Record<string, string>;
}

export interface StudioConfig {
	services: ServiceConfig[];
	preview: string; // service name to show in preview iframe
}

export interface RunningService {
	name: string;
	process: ChildProcess;
	port: number;
	url: string;
}

export interface AppRunnerStatus {
	running: boolean;
	services: { name: string; url: string; isPreview: boolean }[];
	previewUrl: string | null;
	// backward compat
	backendUrl: string | null;
	frontendUrl: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const runningApps = new Map<
	string,
	{
		services: RunningService[];
		previewService: string;
	}
>();

// ---------------------------------------------------------------------------
// Detection — .studio.json
// ---------------------------------------------------------------------------

function loadStudioConfig(repoPath: string): StudioConfig | null {
	const configPath = join(repoPath, ".studio.json");
	if (!existsSync(configPath)) return null;
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf-8"));
		if (!raw.services || !Array.isArray(raw.services)) return null;
		return {
			services: raw.services.map((s: any) => ({
				name: s.name || "app",
				path: s.path || ".",
				command: s.command || "npm start",
				port: s.port || 3000,
				readyPattern: s.readyPattern || "listening|ready|started",
				env: s.env || {},
			})),
			preview: raw.preview || raw.services[0]?.name || "app",
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Detection — Docker Compose
// ---------------------------------------------------------------------------

function detectDockerCompose(repoPath: string): StudioConfig | null {
	const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
	const found = composeFiles.find((f) => existsSync(join(repoPath, f)));
	if (!found) return null;

	// Parse compose file to extract service names and ports
	try {
		const content = readFileSync(join(repoPath, found), "utf-8");
		const services: ServiceConfig[] = [];
		let previewService = "";

		// Simple YAML parsing for services and ports
		const serviceMatches = content.match(/^\s{2}(\w[\w-]*):\s*$/gm);
		if (!serviceMatches) return null;

		for (const match of serviceMatches) {
			const name = match.trim().replace(":", "");
			// Find port mapping for this service
			const serviceBlock = content.split(new RegExp(`^\\s{2}${name}:`, "m"))[1]?.split(/^\s{2}\w/m)[0] || "";
			const portMatch = serviceBlock.match(/["']?(\d+):(\d+)["']?/);
			const port = portMatch ? Number.parseInt(portMatch[1]) : 0;

			if (port > 0) {
				services.push({
					name,
					path: ".",
					command: `docker compose up ${name}`,
					port,
					readyPattern: "started|ready|listening",
				});
				// First service with common frontend ports is likely the preview
				if (!previewService && [3000, 3001, 4200, 5173, 8080].includes(port)) {
					previewService = name;
				}
			}
		}

		if (services.length === 0) {
			// Fallback: just docker compose up
			services.push({
				name: "app",
				path: ".",
				command: "docker compose up",
				port: 3000,
				readyPattern: "started|ready|listening|running",
			});
		}

		return {
			services,
			preview: previewService || services[0]?.name || "app",
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Detection — Auto-detect by language/framework
// ---------------------------------------------------------------------------

interface LangDetection {
	name: string;
	path: string;
	command: string;
	readyPattern: string;
	type: "backend" | "frontend" | "fullstack";
}

function detectLanguage(dirPath: string, dirName: string): LangDetection | null {
	// Node.js
	if (existsSync(join(dirPath, "package.json"))) {
		try {
			const pkg = JSON.parse(readFileSync(join(dirPath, "package.json"), "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			const usePnpm = existsSync(join(dirPath, "pnpm-lock.yaml"));
			const useYarn = existsSync(join(dirPath, "yarn.lock"));
			const pm = usePnpm ? "pnpm" : useYarn ? "yarn" : "npm";
			const exec = usePnpm ? "pnpm exec" : "npx";

			// Next.js (fullstack)
			if (deps["next"]) {
				return {
					name: dirName,
					path: dirPath,
					command: `${exec} next dev --port \${PORT}`,
					readyPattern: "ready|compiled|started",
					type: "fullstack",
				};
			}
			// Nuxt
			if (deps["nuxt"]) {
				return {
					name: dirName,
					path: dirPath,
					command: `${exec} nuxi dev --port \${PORT}`,
					readyPattern: "ready|listening|local",
					type: "fullstack",
				};
			}
			// Vite / React / Vue / Svelte (frontend)
			if (deps["vite"]) {
				return {
					name: dirName,
					path: dirPath,
					command: `${exec} vite --port \${PORT}`,
					readyPattern: "ready|local|localhost",
					type: "frontend",
				};
			}
			// Create React App
			if (deps["react-scripts"]) {
				return {
					name: dirName,
					path: dirPath,
					command: `${exec} react-scripts start`,
					readyPattern: "compiled|webpack|ready",
					type: "frontend",
				};
			}
			// Angular
			if (deps["@angular/core"]) {
				return {
					name: dirName,
					path: dirPath,
					command: `${exec} ng serve --port \${PORT}`,
					readyPattern: "compiled|listening|angular",
					type: "frontend",
				};
			}
			// Express / Hono / Fastify / Koa (backend)
			if (deps["express"] || deps["hono"] || deps["fastify"] || deps["koa"]) {
				const devScript = pkg.scripts?.dev;
				if (devScript) {
					return {
						name: dirName,
						path: dirPath,
						command: `${pm} run dev`,
						readyPattern: "listening|running|started|ready",
						type: "backend",
					};
				}
				return {
					name: dirName,
					path: dirPath,
					command: `${exec} tsx src/index.ts`,
					readyPattern: "listening|running|started|ready",
					type: "backend",
				};
			}
			// Generic Node.js with dev script
			if (pkg.scripts?.dev) {
				return {
					name: dirName,
					path: dirPath,
					command: `${pm} run dev`,
					readyPattern: "listening|running|started|ready|compiled",
					type: "backend",
				};
			}
		} catch {
			/* ignore */
		}
	}

	// Python
	if (
		existsSync(join(dirPath, "requirements.txt")) ||
		existsSync(join(dirPath, "pyproject.toml")) ||
		existsSync(join(dirPath, "Pipfile"))
	) {
		const usePipenv = existsSync(join(dirPath, "Pipfile"));
		const usePoetry =
			existsSync(join(dirPath, "pyproject.toml")) &&
			readFileSync(join(dirPath, "pyproject.toml"), "utf-8").includes("[tool.poetry]");
		const prefix = usePoetry ? "poetry run" : usePipenv ? "pipenv run" : "python";

		// Django
		if (existsSync(join(dirPath, "manage.py"))) {
			return {
				name: dirName,
				path: dirPath,
				command: `${prefix} ${usePoetry || usePipenv ? "" : "-m "}manage.py runserver 0.0.0.0:\${PORT}`.replace(
					"  ",
					" ",
				),
				readyPattern: "starting development server|watching for file changes",
				type: "backend",
			};
		}
		// FastAPI
		if (existsSync(join(dirPath, "main.py")) || existsSync(join(dirPath, "app", "main.py"))) {
			const mainFile = existsSync(join(dirPath, "app", "main.py")) ? "app.main:app" : "main:app";
			return {
				name: dirName,
				path: dirPath,
				command: `${prefix} uvicorn ${mainFile} --host 0.0.0.0 --port \${PORT} --reload`,
				readyPattern: "uvicorn running|started server|application startup",
				type: "backend",
			};
		}
		// Flask
		if (existsSync(join(dirPath, "app.py")) || existsSync(join(dirPath, "wsgi.py"))) {
			return {
				name: dirName,
				path: dirPath,
				command: `${prefix} flask run --host 0.0.0.0 --port \${PORT}`,
				readyPattern: "running on|debugger is active",
				type: "backend",
			};
		}
		// Generic Python
		return {
			name: dirName,
			path: dirPath,
			command: `${prefix} ${usePoetry || usePipenv ? "" : "-m "}uvicorn main:app --port \${PORT}`.replace("  ", " "),
			readyPattern: "running|started|listening",
			type: "backend",
		};
	}

	// Java — Maven
	if (existsSync(join(dirPath, "pom.xml"))) {
		const wrapper = existsSync(join(dirPath, "mvnw")) ? "./mvnw" : "mvn";
		return {
			name: dirName,
			path: dirPath,
			command: `${wrapper} spring-boot:run -Dspring-boot.run.arguments=--server.port=\${PORT}`,
			readyPattern: "started|tomcat started|netty started|listening",
			type: "backend",
		};
	}

	// Java — Gradle
	if (existsSync(join(dirPath, "build.gradle")) || existsSync(join(dirPath, "build.gradle.kts"))) {
		const wrapper = existsSync(join(dirPath, "gradlew")) ? "./gradlew" : "gradle";
		return {
			name: dirName,
			path: dirPath,
			command: `${wrapper} bootRun --args='--server.port=\${PORT}'`,
			readyPattern: "started|tomcat started|netty started|listening",
			type: "backend",
		};
	}

	// Go
	if (existsSync(join(dirPath, "go.mod"))) {
		return {
			name: dirName,
			path: dirPath,
			command: `go run . --port \${PORT}`,
			readyPattern: "listening|started|running|serving",
			type: "backend",
		};
	}

	// Ruby — Rails
	if (existsSync(join(dirPath, "Gemfile"))) {
		if (existsSync(join(dirPath, "config", "routes.rb"))) {
			return {
				name: dirName,
				path: dirPath,
				command: `bundle exec rails server -p \${PORT}`,
				readyPattern: "listening|puma starting|rails.*started",
				type: "backend",
			};
		}
	}

	// Rust — Cargo
	if (existsSync(join(dirPath, "Cargo.toml"))) {
		return {
			name: dirName,
			path: dirPath,
			command: `cargo run`,
			readyPattern: "listening|started|running|serving",
			type: "backend",
		};
	}

	return null;
}

function autoDetect(repoPath: string): StudioConfig | null {
	const detected: LangDetection[] = [];
	const detectedPaths = new Set<string>();

	// 1. Check common monorepo subdirectories
	const subdirs = ["backend", "server", "api", "frontend", "web", "client", "app"];
	for (const dir of subdirs) {
		const fullPath = join(repoPath, dir);
		if (existsSync(fullPath)) {
			const lang = detectLanguage(fullPath, dir);
			if (lang) {
				detected.push(lang);
				detectedPaths.add(fullPath);
			}
		}
	}

	// 2. Always check root too — may have backend alongside client/ subdir
	if (!detectedPaths.has(repoPath)) {
		const rootLang = detectLanguage(repoPath, detected.length > 0 ? "server" : "app");
		if (rootLang) detected.push(rootLang);
	}

	if (detected.length === 0) return null;

	// Assign ports (skip reserved Oscorpex ports)
	let portCounter = 4100;
	const nextPort = () => {
		while (RESERVED_PORTS.has(portCounter)) portCounter++;
		return portCounter++;
	};
	const services: ServiceConfig[] = detected.map((d) => ({
		name: d.name,
		path: d.path,
		command: d.command,
		port: nextPort(),
		readyPattern: d.readyPattern,
	}));

	// Pick preview: prefer frontend/fullstack, fallback to first
	const previewService = detected.find((d) => d.type === "frontend" || d.type === "fullstack") || detected[0];

	return {
		services,
		preview: previewService.name,
	};
}

// ---------------------------------------------------------------------------
// Post-start health check
// ---------------------------------------------------------------------------

async function postStartHealthCheck(port: number, maxRetries = 5): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
			// Herhangi bir HTTP response (404 dahil) = process çalışıyor
			return true;
		} catch {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Port conflict resolution
// ---------------------------------------------------------------------------

function isPortInUse(port: number): boolean {
	try {
		execFileSync("lsof", ["-ti", `:${port}`], { stdio: "pipe", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

/** Ports reserved for Oscorpex core services — agents must never bind to these */
const RESERVED_PORTS = new Set([5173, 4242, 3141, 3142]);

function resolvePort(desiredPort: number, usedPorts: Set<number>): number {
	let port = desiredPort;
	while (usedPorts.has(port) || RESERVED_PORTS.has(port) || isPortInUse(port)) {
		port++;
	}
	return port;
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

function startService(repoPath: string, config: ServiceConfig, onLog: (msg: string) => void): Promise<RunningService> {
	return new Promise((resolve, reject) => {
		const servicePath = config.path.startsWith("/") ? config.path : join(repoPath, config.path);
		const command = config.command.replace(/\$\{PORT\}/g, String(config.port));
		const readyPattern = new RegExp(config.readyPattern, "i");

		onLog(`[app-runner] Starting ${config.name}: ${command} (port ${config.port})`);

		// Split command into parts
		const parts = command.split(/\s+/);
		const bin = parts[0];
		const args = parts.slice(1);

		const proc = spawn(bin, args, {
			cwd: servicePath,
			env: { ...process.env, PORT: String(config.port), ...config.env },
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve config from all sources with priority:
 * 1. .studio.json
 * 2. docker-compose.yml
 * 3. Auto-detection
 * 4. settingsOverride (from DB project settings)
 */
export function resolveConfig(repoPath: string, settingsOverride?: StudioConfig | null): StudioConfig | null {
	// Settings override takes highest priority if explicitly set
	if (settingsOverride?.services?.length) return settingsOverride;

	// .studio.json
	const studioConfig = loadStudioConfig(repoPath);
	if (studioConfig) return studioConfig;

	// Docker Compose
	const dockerConfig = detectDockerCompose(repoPath);
	if (dockerConfig) return dockerConfig;

	// Auto-detection
	return autoDetect(repoPath);
}

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
						onLog(`[app-runner] Migration başarılı`);
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
		if (analysis.services.length > 1) {
			const backendSvc = analysis.services.find((s) => s.type === "backend");
			const frontendSvc = analysis.services.find((s) => s.type === "frontend" || s.type === "fullstack");
			if (backendSvc && frontendSvc) {
				const backendUrl = `http://localhost:${backendSvc.port}`;
				(frontendSvc as any).env = {
					...((frontendSvc as any).env || {}),
					API_TARGET: backendUrl,
				};
				onLog(`[app-runner] Frontend env: API_TARGET=${backendUrl}`);
			}
		}

		// Direct start — each service
		const running: RunningService[] = [];
		for (const svc of analysis.services) {
			try {
				const svcConfig: ServiceConfig = {
					name: svc.name,
					path: svc.path,
					command: svc.startCommand,
					port: svc.port,
					readyPattern: svc.readyPattern,
					env: (svc as any).env,
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

/**
 * StudioConfig'dan başlat (ortak mantık).
 */
async function startFromConfig(
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

/**
 * Stop all running services for a project.
 */
export async function stopApp(projectId: string, onLog?: (msg: string) => void): Promise<void> {
	const existing = runningApps.get(projectId);
	if (!existing) return;

	onLog?.("[app-runner] Stopping services...");

	// Collect unique processes (docker compose shares one process)
	const procs = new Set<ChildProcess>();
	for (const svc of existing.services) {
		procs.add(svc.process);
	}

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
export function getAppStatus(projectId: string): AppRunnerStatus {
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

/**
 * Get the resolved config (for display in Settings UI).
 */
export function getResolvedConfig(repoPath: string): StudioConfig | null {
	return resolveConfig(repoPath);
}
