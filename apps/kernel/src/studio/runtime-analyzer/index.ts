// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer — Main Entry
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createLogger } from "../logger.js";
import { detectDatabasesFromCompose, detectDatabasesFromEnv } from "./db-detection.js";
import { loadExistingEnv, parseEnvExample } from "./env-detection.js";
import { detectFramework, detectPort } from "./framework-detection.js";
import type { DetectedService, RuntimeRequirements } from "./types.js";

const log = createLogger("runtime-analyzer");

/**
 * Proje dizinini analiz ederek tüm çalıştırma gereksinimlerini döndürür.
 */
export function analyzeProject(repoPath: string): RuntimeRequirements {
	log.info({ repoPath }, "analyzeProject called");

	// 1. Env var'ları algıla
	const envVars = parseEnvExample(repoPath);
	const existingEnv = loadExistingEnv(repoPath);

	// 2. DB ihtiyaçlarını algıla
	const composeDbs = detectDatabasesFromCompose(repoPath);
	const envDbs = detectDatabasesFromEnv(envVars, composeDbs);
	const databases = [...composeDbs, ...envDbs];

	// 3. Servisleri algıla
	const services: DetectedService[] = [];
	const scannedDirs = new Set<string>();

	// Monorepo subdirectory'leri kontrol et
	const knownDirs = ["backend", "server", "api", "frontend", "web", "client", "app"];
	for (const dir of knownDirs) {
		const fullPath = join(repoPath, dir);
		if (existsSync(fullPath)) {
			const detected = detectFramework(fullPath, dir);
			if (detected) {
				services.push({
					...detected,
					path: dir,
					port: detectPort(fullPath, detected.framework),
				});
				scannedDirs.add(dir);
			}
		}
	}

	// Monorepo workspace dizinleri: packages/*, apps/* + package.json workspaces
	const workspaceDirs = new Set<string>();

	// Turborepo/Lerna convention: apps/, packages/
	for (const container of ["packages", "apps"]) {
		const containerPath = join(repoPath, container);
		if (existsSync(containerPath) && statSync(containerPath).isDirectory()) {
			try {
				for (const entry of readdirSync(containerPath)) {
					const entryPath = join(containerPath, entry);
					if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "package.json"))) {
						workspaceDirs.add(`${container}/${entry}`);
					}
				}
			} catch {
				/* ignore */
			}
		}
	}

	// package.json workspaces field
	try {
		const rootPkg = JSON.parse(readFileSync(join(repoPath, "package.json"), "utf-8"));
		const wsPatterns: string[] = Array.isArray(rootPkg.workspaces)
			? rootPkg.workspaces
			: rootPkg.workspaces?.packages || [];
		for (const pattern of wsPatterns) {
			// Basit glob: "packages/*", "apps/*" etc.
			const clean = pattern.replace(/\/?\*\*?$/, "");
			if (clean && existsSync(join(repoPath, clean)) && statSync(join(repoPath, clean)).isDirectory()) {
				try {
					for (const entry of readdirSync(join(repoPath, clean))) {
						const entryPath = join(repoPath, clean, entry);
						if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "package.json"))) {
							workspaceDirs.add(`${clean}/${entry}`);
						}
					}
				} catch {
					/* ignore */
				}
			}
		}
	} catch {
		/* no root package.json or parse error */
	}

	// Workspace alt paketlerini tara
	for (const wsDir of workspaceDirs) {
		if (scannedDirs.has(wsDir)) continue;
		const fullPath = join(repoPath, wsDir);
		const dirName = wsDir.split("/").pop() || wsDir;
		const detected = detectFramework(fullPath, dirName);
		if (detected) {
			services.push({
				...detected,
				path: wsDir,
				port: detectPort(fullPath, detected.framework),
			});
			scannedDirs.add(wsDir);
		}
	}

	// Root dizini kontrol et — her zaman kontrol et (subdir yanında root backend olabilir)
	if (!scannedDirs.has(".")) {
		const rootName = services.length > 0 ? "server" : basename(repoPath);
		const rootDetected = detectFramework(repoPath, rootName);
		if (rootDetected) {
			services.push({
				...rootDetected,
				path: ".",
				port: detectPort(repoPath, rootDetected.framework),
			});
		}
	}

	// NOT: Port çakışma kontrolü burada YAPILMAZ. analyzeProject saf bir
	// fonksiyondur ve servislerin framework default'larını döner. Port
	// allocation app-runner katmanının sorumluluğudur (resolvePort), böylece
	// testler deterministik kalır.

	// 4. Durumları hesapla
	const allDepsInstalled = services.every((s) => s.depsInstalled);
	const requiredEnvVars = envVars.filter((v) => v.required);
	const allEnvVarsSet = requiredEnvVars.every((v) => existingEnv.has(v.key));

	return {
		services,
		databases,
		envVars,
		allDepsInstalled,
		allEnvVarsSet,
		dbReady: databases.length === 0,
		hasStudioConfig: existsSync(join(repoPath, ".studio.json")),
		hasDockerCompose: ["docker-compose.yml", "docker-compose.yaml", "compose.yml"].some((f) =>
			existsSync(join(repoPath, f)),
		),
	};
}

/**
 * .studio.json dosyası oluşturur (başarılı çalıştırma sonrası).
 */
export function generateStudioConfig(repoPath: string, services: DetectedService[], previewServiceName?: string): void {
	const config = {
		services: services.map((s) => ({
			name: s.name,
			path: s.path,
			command: s.startCommand,
			port: s.port,
			readyPattern: s.readyPattern,
		})),
		preview:
			previewServiceName ||
			services.find((s) => s.type === "frontend" || s.type === "fullstack")?.name ||
			services[0]?.name ||
			"app",
	};

	writeFileSync(join(repoPath, ".studio.json"), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export { writeEnvFile } from "./env-detection.js";
