// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer
// Proje dizinini analiz ederek çalıştırma gereksinimlerini tespit eder:
//   - Framework & start komutu
//   - Env var ihtiyaçları (.env.example parse)
//   - DB ihtiyaçları (docker-compose & env pattern)
//   - Bağımlılık kurulum komutu
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatabaseType = "postgresql" | "mysql" | "mongodb" | "redis" | "sqlite";

export interface DetectedDatabase {
	type: DatabaseType;
	/** Docker image (ör. postgres:16-alpine) */
	image: string;
	/** Varsayılan port */
	port: number;
	/** Bu DB'nin ihtiyaç duyduğu env var key'leri */
	envVars: string[];
	/** docker-compose'da tanımlı mı */
	fromCompose: boolean;
}

export interface EnvVarRequirement {
	key: string;
	/** Zorunlu mu (default yok) */
	required: boolean;
	/** Varsayılan değer (varsa) */
	defaultValue?: string;
	/** .env.example'daki açıklama (# ile başlayan satır) */
	description?: string;
	/** Hassas mi (password, secret, key, token) */
	sensitive: boolean;
	/** Kategori */
	category: "database" | "auth" | "api" | "app" | "other";
}

export type FrameworkType =
	| "express"
	| "hono"
	| "fastify"
	| "koa"
	| "nestjs"
	| "nextjs"
	| "nuxt"
	| "vite"
	| "cra"
	| "angular"
	| "django"
	| "fastapi"
	| "flask"
	| "spring-boot"
	| "quarkus"
	| "go"
	| "gin"
	| "fiber"
	| "rails"
	| "rust-actix"
	| "rust-axum"
	| "generic-node"
	| "generic-python"
	| "unknown";

export interface DetectedService {
	name: string;
	framework: FrameworkType;
	language: "node" | "python" | "java" | "go" | "ruby" | "rust" | "unknown";
	/** Çalıştırma komutu (${PORT} placeholder) */
	startCommand: string;
	/** Bağımlılık kurulum komutu */
	installCommand: string | null;
	/** Varsayılan port */
	port: number;
	/** Ready pattern regex */
	readyPattern: string;
	/** Servis tipi */
	type: "backend" | "frontend" | "fullstack";
	/** Servis dizini (repo root'a göre relative) */
	path: string;
	/** Bağımlılıklar kurulu mu */
	depsInstalled: boolean;
}

export interface RuntimeRequirements {
	services: DetectedService[];
	databases: DetectedDatabase[];
	envVars: EnvVarRequirement[];
	/** Genel bağımlılık kurulum durumu */
	allDepsInstalled: boolean;
	/** Tüm zorunlu env var'lar set mi */
	allEnvVarsSet: boolean;
	/** DB'ler hazır mı (sadece analiz tahmini, gerçek check ayrı) */
	dbReady: boolean;
	/** .studio.json mevcut mu */
	hasStudioConfig: boolean;
	/** docker-compose.yml mevcut mu */
	hasDockerCompose: boolean;
}

// ---------------------------------------------------------------------------
// Env Var Detection
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = /password|secret|key|token|api_key|apikey|auth|credential/i;

const DB_ENV_PATTERNS: Record<DatabaseType, RegExp[]> = {
	postgresql: [/DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|DATABASE_URL|POSTGRES/i],
	mysql: [/MYSQL_HOST|MYSQL_PORT|MYSQL_USER|MYSQL_PASSWORD|MYSQL_DATABASE/i],
	mongodb: [/MONGO_URI|MONGO_URL|MONGODB_URI|MONGO_HOST/i],
	redis: [/REDIS_HOST|REDIS_PORT|REDIS_URL|REDIS_PASSWORD/i],
	sqlite: [/SQLITE_PATH|DB_PATH/i],
};

function categorizeEnvVar(key: string): EnvVarRequirement["category"] {
	if (/^DB_|^DATABASE|^POSTGRES|^MYSQL|^MONGO|^REDIS|^SQLITE/i.test(key)) return "database";
	if (/^AUTH|^JWT|^SESSION|^OAUTH|^COOKIE/i.test(key)) return "auth";
	if (/^API_|^OPENAI|^ANTHROPIC|^STRIPE|^SENDGRID|^TWILIO/i.test(key)) return "api";
	if (/^PORT$|^HOST$|^NODE_ENV|^APP_|^BASE_URL|^CORS/i.test(key)) return "app";
	return "other";
}

/** .env.example dosyasını parse ederek env var listesi çıkarır */
function parseEnvExample(repoPath: string): EnvVarRequirement[] {
	const candidates = [".env.example", ".env.sample", ".env.template", ".env.local.example"];
	let filePath: string | null = null;
	for (const f of candidates) {
		const p = join(repoPath, f);
		if (existsSync(p)) {
			filePath = p;
			break;
		}
	}
	if (!filePath) return [];

	const content = readFileSync(filePath, "utf-8");
	const vars: EnvVarRequirement[] = [];
	let lastComment = "";

	for (const line of content.split("\n")) {
		const trimmed = line.trim();

		// Yorum satırı — bir sonraki var'ın açıklaması olabilir
		if (trimmed.startsWith("#")) {
			lastComment = trimmed.replace(/^#+\s*/, "");
			continue;
		}

		// Boş satır
		if (!trimmed || !trimmed.includes("=")) {
			lastComment = "";
			continue;
		}

		const eqIndex = trimmed.indexOf("=");
		const key = trimmed.slice(0, eqIndex).trim();
		const rawValue = trimmed.slice(eqIndex + 1).trim();

		// Değer var mı (boş değilse default var demektir)
		const hasDefault = rawValue.length > 0 && rawValue !== '""' && rawValue !== "''";

		vars.push({
			key,
			required: !hasDefault,
			defaultValue: hasDefault ? rawValue.replace(/^["']|["']$/g, "") : undefined,
			description: lastComment || undefined,
			sensitive: SENSITIVE_PATTERNS.test(key),
			category: categorizeEnvVar(key),
		});
		lastComment = "";
	}

	return vars;
}

/** Mevcut .env dosyasından set edilmiş key'leri okur */
function loadExistingEnv(repoPath: string): Map<string, string> {
	const envPath = join(repoPath, ".env");
	const map = new Map<string, string>();
	if (!existsSync(envPath)) return map;

	try {
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
			const eqIndex = trimmed.indexOf("=");
			const key = trimmed.slice(0, eqIndex).trim();
			const value = trimmed
				.slice(eqIndex + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
			if (value) map.set(key, value);
		}
	} catch {
		/* ignore */
	}
	return map;
}

// ---------------------------------------------------------------------------
// Database Detection
// ---------------------------------------------------------------------------

const DB_DOCKER_IMAGES: Record<DatabaseType, { image: string; port: number }> = {
	postgresql: { image: "postgres:16-alpine", port: 5432 },
	mysql: { image: "mysql:8", port: 3306 },
	mongodb: { image: "mongo:7", port: 27017 },
	redis: { image: "redis:7-alpine", port: 6379 },
	sqlite: { image: "", port: 0 }, // No container needed
};

/** docker-compose.yml'dan DB servislerini algıla */
function detectDatabasesFromCompose(repoPath: string): DetectedDatabase[] {
	const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
	let content = "";
	for (const f of composeFiles) {
		const p = join(repoPath, f);
		if (existsSync(p)) {
			content = readFileSync(p, "utf-8");
			break;
		}
	}
	if (!content) return [];

	const dbs: DetectedDatabase[] = [];
	const lower = content.toLowerCase();

	if (lower.includes("postgres")) {
		const portMatch = content.match(/['"]?(\d+):5432['"]?/);
		dbs.push({
			type: "postgresql",
			image: content.match(/image:\s*['"]?(postgres[^'"\s]*)/)?.[1] || "postgres:16-alpine",
			port: portMatch ? Number.parseInt(portMatch[1]) : 5432,
			envVars: ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"],
			fromCompose: true,
		});
	}

	if (lower.includes("mysql") || lower.includes("mariadb")) {
		const portMatch = content.match(/['"]?(\d+):3306['"]?/);
		dbs.push({
			type: "mysql",
			image: content.match(/image:\s*['"]?(mysql[^'"\s]*|mariadb[^'"\s]*)/)?.[1] || "mysql:8",
			port: portMatch ? Number.parseInt(portMatch[1]) : 3306,
			envVars: ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"],
			fromCompose: true,
		});
	}

	if (lower.includes("mongo")) {
		const portMatch = content.match(/['"]?(\d+):27017['"]?/);
		dbs.push({
			type: "mongodb",
			image: content.match(/image:\s*['"]?(mongo[^'"\s]*)/)?.[1] || "mongo:7",
			port: portMatch ? Number.parseInt(portMatch[1]) : 27017,
			envVars: ["MONGO_URI"],
			fromCompose: true,
		});
	}

	if (lower.includes("redis")) {
		const portMatch = content.match(/['"]?(\d+):6379['"]?/);
		dbs.push({
			type: "redis",
			image: content.match(/image:\s*['"]?(redis[^'"\s]*)/)?.[1] || "redis:7-alpine",
			port: portMatch ? Number.parseInt(portMatch[1]) : 6379,
			envVars: ["REDIS_HOST", "REDIS_PORT"],
			fromCompose: true,
		});
	}

	return dbs;
}

/** Env var pattern'lerinden DB ihtiyacı algıla (compose yoksa) */
function detectDatabasesFromEnv(envVars: EnvVarRequirement[], composeDbs: DetectedDatabase[]): DetectedDatabase[] {
	const detected: DetectedDatabase[] = [];
	const existingTypes = new Set(composeDbs.map((d) => d.type));

	for (const [dbType, patterns] of Object.entries(DB_ENV_PATTERNS) as [DatabaseType, RegExp[]][]) {
		if (existingTypes.has(dbType)) continue;
		const matchingVars = envVars.filter((v) => patterns.some((p) => p.test(v.key)));
		if (matchingVars.length > 0) {
			const info = DB_DOCKER_IMAGES[dbType];
			detected.push({
				type: dbType,
				image: info.image,
				port: info.port,
				envVars: matchingVars.map((v) => v.key),
				fromCompose: false,
			});
		}
	}

	return detected;
}

// ---------------------------------------------------------------------------
// Service Detection (framework-aware)
// ---------------------------------------------------------------------------

interface FrameworkDetection {
	name: string;
	framework: FrameworkType;
	language: DetectedService["language"];
	startCommand: string;
	installCommand: string | null;
	readyPattern: string;
	type: DetectedService["type"];
	depsInstalled: boolean;
}

// ---------------------------------------------------------------------------
// Port Detection — .env → kaynak kodu → framework default
// ---------------------------------------------------------------------------

const FRAMEWORK_DEFAULT_PORTS: Partial<Record<FrameworkType, number>> = {
	express: 3000,
	fastify: 3000,
	koa: 3000,
	hono: 3000,
	nestjs: 3000,
	nextjs: 3000,
	nuxt: 3000,
	vite: 5173,
	cra: 3000,
	angular: 4200,
	django: 8000,
	flask: 5000,
	fastapi: 8000,
	"spring-boot": 8080,
	gin: 8080,
	rails: 3000,
	"rust-actix": 8080,
};

function detectPort(dirPath: string, framework: FrameworkType): number {
	// 1. .env dosyasından PORT oku
	const envPath = join(dirPath, ".env");
	if (existsSync(envPath)) {
		try {
			const envContent = readFileSync(envPath, "utf-8");
			const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
			if (portMatch) return Number.parseInt(portMatch[1]);
		} catch {
			/* ignore */
		}
	}

	// 2. Kaynak kodundan port parse et
	const sourceFiles = [
		"src/server.js",
		"src/index.js",
		"src/app.js",
		"server.js",
		"index.js",
		"app.js",
		"src/server.ts",
		"src/index.ts",
		"src/app.ts",
		"src/main.ts",
	];
	for (const file of sourceFiles) {
		const filePath = join(dirPath, file);
		if (!existsSync(filePath)) continue;
		try {
			const content = readFileSync(filePath, "utf-8");
			// .listen(3000), .listen(PORT || 3000), listen(process.env.PORT || 4000)
			const listenMatch = content.match(/\.listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{3,5})/);
			if (listenMatch) return Number.parseInt(listenMatch[1]);
			// const PORT = 3000 veya const port = 8080
			const constMatch = content.match(/(?:const|let|var)\s+[Pp][Oo][Rr][Tt]\s*=\s*(\d{3,5})/);
			if (constMatch) return Number.parseInt(constMatch[1]);
		} catch {
			/* ignore */
		}
	}

	// 3. Framework default
	return FRAMEWORK_DEFAULT_PORTS[framework] ?? 3000;
}

/** Synchronous port-in-use check via lsof */
function isPortInUse(port: number): boolean {
	try {
		execSync(`lsof -ti:${port}`, { stdio: "pipe", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

/** Find next available port starting from given port */
function findFreePort(startPort: number, usedPorts: Set<number>): number {
	let port = startPort;
	while (usedPorts.has(port) || isPortInUse(port)) {
		port++;
		if (port > 65535) break;
	}
	return port;
}

function detectFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	// ---- Node.js ----
	if (existsSync(join(dirPath, "package.json"))) {
		try {
			const pkg = JSON.parse(readFileSync(join(dirPath, "package.json"), "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			const usePnpm = existsSync(join(dirPath, "pnpm-lock.yaml"));
			const useYarn = existsSync(join(dirPath, "yarn.lock"));
			const pm = usePnpm ? "pnpm" : useYarn ? "yarn" : "npm";
			const exec = usePnpm ? "pnpm exec" : "npx";
			const depsInstalled = existsSync(join(dirPath, "node_modules"));
			const installCmd = `${pm} install`;

			// NestJS
			if (deps["@nestjs/core"]) {
				return {
					name: dirName,
					framework: "nestjs",
					language: "node",
					startCommand: pkg.scripts?.["start:dev"] ? `${pm} run start:dev` : `${exec} nest start --watch`,
					installCommand: installCmd,
					readyPattern: "listening|started|nest application",
					type: "backend",
					depsInstalled,
				};
			}
			// Next.js
			if (deps["next"]) {
				return {
					name: dirName,
					framework: "nextjs",
					language: "node",
					startCommand: `${exec} next dev --port \${PORT}`,
					installCommand: installCmd,
					readyPattern: "ready|compiled|started",
					type: "fullstack",
					depsInstalled,
				};
			}
			// Nuxt
			if (deps["nuxt"]) {
				return {
					name: dirName,
					framework: "nuxt",
					language: "node",
					startCommand: `${exec} nuxi dev --port \${PORT}`,
					installCommand: installCmd,
					readyPattern: "ready|listening|local",
					type: "fullstack",
					depsInstalled,
				};
			}
			// Vite
			if (deps["vite"]) {
				return {
					name: dirName,
					framework: "vite",
					language: "node",
					startCommand: `${exec} vite --port \${PORT}`,
					installCommand: installCmd,
					readyPattern: "ready|local|localhost",
					type: "frontend",
					depsInstalled,
				};
			}
			// CRA
			if (deps["react-scripts"]) {
				return {
					name: dirName,
					framework: "cra",
					language: "node",
					startCommand: `${exec} react-scripts start`,
					installCommand: installCmd,
					readyPattern: "compiled|webpack|ready",
					type: "frontend",
					depsInstalled,
				};
			}
			// Angular
			if (deps["@angular/core"]) {
				return {
					name: dirName,
					framework: "angular",
					language: "node",
					startCommand: `${exec} ng serve --port \${PORT}`,
					installCommand: installCmd,
					readyPattern: "compiled|listening|angular",
					type: "frontend",
					depsInstalled,
				};
			}
			// Express / Hono / Fastify / Koa
			const backendFramework = deps["express"]
				? ("express" as const)
				: deps["hono"]
					? ("hono" as const)
					: deps["fastify"]
						? ("fastify" as const)
						: deps["koa"]
							? ("koa" as const)
							: null;

			if (backendFramework) {
				const devScript = pkg.scripts?.dev;
				return {
					name: dirName,
					framework: backendFramework,
					language: "node",
					startCommand: devScript ? `${pm} run dev` : `${exec} tsx src/index.ts`,
					installCommand: installCmd,
					readyPattern: "listening|running|started|ready",
					type: "backend",
					depsInstalled,
				};
			}
			// Generic Node with dev script
			if (pkg.scripts?.dev || pkg.scripts?.start) {
				const cmd = pkg.scripts?.dev ? `${pm} run dev` : `${pm} run start`;
				return {
					name: dirName,
					framework: "generic-node",
					language: "node",
					startCommand: cmd,
					installCommand: installCmd,
					readyPattern: "listening|running|started|ready|compiled",
					type: "backend",
					depsInstalled,
				};
			}
		} catch {
			/* ignore */
		}
	}

	// ---- Python ----
	const hasPython =
		existsSync(join(dirPath, "requirements.txt")) ||
		existsSync(join(dirPath, "pyproject.toml")) ||
		existsSync(join(dirPath, "Pipfile"));

	if (hasPython) {
		const usePipenv = existsSync(join(dirPath, "Pipfile"));
		const hasPyproject = existsSync(join(dirPath, "pyproject.toml"));
		const usePoetry = hasPyproject && readFileSync(join(dirPath, "pyproject.toml"), "utf-8").includes("[tool.poetry]");
		const useUv = existsSync(join(dirPath, "uv.lock"));
		const prefix = useUv ? "uv run" : usePoetry ? "poetry run" : usePipenv ? "pipenv run" : "python";
		const installCmd = useUv
			? "uv sync"
			: usePoetry
				? "poetry install"
				: usePipenv
					? "pipenv install"
					: "pip install -r requirements.txt";
		const venvExists = existsSync(join(dirPath, ".venv")) || existsSync(join(dirPath, "venv"));

		// Django
		if (existsSync(join(dirPath, "manage.py"))) {
			return {
				name: dirName,
				framework: "django",
				language: "python",
				startCommand: `${prefix} manage.py runserver 0.0.0.0:\${PORT}`,
				installCommand: installCmd,
				readyPattern: "starting development server|watching for file changes",
				type: "backend",
				depsInstalled: venvExists,
			};
		}
		// FastAPI
		if (existsSync(join(dirPath, "main.py")) || existsSync(join(dirPath, "app", "main.py"))) {
			const mainFile = existsSync(join(dirPath, "app", "main.py")) ? "app.main:app" : "main:app";
			return {
				name: dirName,
				framework: "fastapi",
				language: "python",
				startCommand: `${prefix} uvicorn ${mainFile} --host 0.0.0.0 --port \${PORT} --reload`,
				installCommand: installCmd,
				readyPattern: "uvicorn running|started server|application startup",
				type: "backend",
				depsInstalled: venvExists,
			};
		}
		// Flask
		if (existsSync(join(dirPath, "app.py")) || existsSync(join(dirPath, "wsgi.py"))) {
			return {
				name: dirName,
				framework: "flask",
				language: "python",
				startCommand: `${prefix} flask run --host 0.0.0.0 --port \${PORT}`,
				installCommand: installCmd,
				readyPattern: "running on|debugger is active",
				type: "backend",
				depsInstalled: venvExists,
			};
		}
		// Generic Python
		return {
			name: dirName,
			framework: "generic-python",
			language: "python",
			startCommand: `${prefix} main.py`,
			installCommand: installCmd,
			readyPattern: "running|started|listening",
			type: "backend",
			depsInstalled: venvExists,
		};
	}

	// ---- Java — Maven ----
	if (existsSync(join(dirPath, "pom.xml"))) {
		const wrapper = existsSync(join(dirPath, "mvnw")) ? "./mvnw" : "mvn";
		return {
			name: dirName,
			framework: "spring-boot",
			language: "java",
			startCommand: `${wrapper} spring-boot:run -Dspring-boot.run.arguments=--server.port=\${PORT}`,
			installCommand: `${wrapper} clean install -DskipTests`,
			readyPattern: "started|tomcat started|netty started|listening",
			type: "backend",
			depsInstalled: existsSync(join(dirPath, "target")),
		};
	}

	// ---- Java — Gradle ----
	if (existsSync(join(dirPath, "build.gradle")) || existsSync(join(dirPath, "build.gradle.kts"))) {
		const wrapper = existsSync(join(dirPath, "gradlew")) ? "./gradlew" : "gradle";
		return {
			name: dirName,
			framework: "spring-boot",
			language: "java",
			startCommand: `${wrapper} bootRun --args='--server.port=\${PORT}'`,
			installCommand: `${wrapper} build -x test`,
			readyPattern: "started|tomcat started|netty started|listening",
			type: "backend",
			depsInstalled: existsSync(join(dirPath, "build")),
		};
	}

	// ---- Go ----
	if (existsSync(join(dirPath, "go.mod"))) {
		const framework =
			existsSync(join(dirPath, "go.sum")) &&
			readFileSync(join(dirPath, "go.sum"), "utf-8").includes("github.com/gin-gonic/gin")
				? ("gin" as const)
				: ("go" as const);
		return {
			name: dirName,
			framework,
			language: "go",
			startCommand: "go run .",
			installCommand: "go mod download",
			readyPattern: "listening|started|running|serving",
			type: "backend",
			depsInstalled: true, // Go modules auto-download
		};
	}

	// ---- Ruby / Rails ----
	if (existsSync(join(dirPath, "Gemfile"))) {
		const isRails = existsSync(join(dirPath, "config", "routes.rb"));
		return {
			name: dirName,
			framework: isRails ? ("rails" as any) : "unknown",
			language: "ruby",
			startCommand: isRails ? `bundle exec rails server -p \${PORT}` : "bundle exec ruby app.rb",
			installCommand: "bundle install",
			readyPattern: "listening|puma starting|rails.*started",
			type: "backend",
			depsInstalled: existsSync(join(dirPath, "vendor", "bundle")),
		};
	}

	// ---- Rust ----
	if (existsSync(join(dirPath, "Cargo.toml"))) {
		return {
			name: dirName,
			framework: "rust-actix",
			language: "rust",
			startCommand: "cargo run",
			installCommand: "cargo build",
			readyPattern: "listening|started|running|serving",
			type: "backend",
			depsInstalled: existsSync(join(dirPath, "target")),
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Ana Analiz Fonksiyonu
// ---------------------------------------------------------------------------

/**
 * Proje dizinini analiz ederek tüm çalıştırma gereksinimlerini döndürür.
 */
export function analyzeProject(repoPath: string): RuntimeRequirements {
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

	// 3.5. Port çakışma kontrolü — aynı port veya kullanımda olan portları çöz
	const usedPorts = new Set<number>();
	for (const svc of services) {
		if (usedPorts.has(svc.port) || isPortInUse(svc.port)) {
			const oldPort = svc.port;
			svc.port = findFreePort(oldPort + 1, usedPorts);
		}
		usedPorts.add(svc.port);
	}

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
		dbReady: databases.length === 0, // DB yoksa hazır
		hasStudioConfig: existsSync(join(repoPath, ".studio.json")),
		hasDockerCompose: ["docker-compose.yml", "docker-compose.yaml", "compose.yml"].some((f) =>
			existsSync(join(repoPath, f)),
		),
	};
}

/**
 * .env dosyasına verilen key-value çiftlerini yazar/günceller.
 */
export function writeEnvFile(repoPath: string, values: Record<string, string>): void {
	const envPath = join(repoPath, ".env");
	const existing = loadExistingEnv(repoPath);

	// Mevcut değerleri güncelle, yenilerini ekle
	for (const [key, value] of Object.entries(values)) {
		existing.set(key, value);
	}

	const content =
		Array.from(existing.entries())
			.map(([k, v]) => `${k}=${v}`)
			.join("\n") + "\n";

	writeFileSync(envPath, content, "utf-8");
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

	writeFileSync(join(repoPath, ".studio.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
}
