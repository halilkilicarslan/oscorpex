// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer — Types
// ---------------------------------------------------------------------------

export type DatabaseType = "postgresql" | "mysql" | "mongodb" | "redis" | "sqlite";

export type ProjectType = "web" | "cli" | "library" | "unknown";

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
	/** Proje tipi (web / cli / library / unknown) */
	projectType: ProjectType;
}

/** Framework algılama sonucu (internal) */
export interface FrameworkDetection {
	name: string;
	framework: FrameworkType;
	language: DetectedService["language"];
	startCommand: string;
	installCommand: string | null;
	readyPattern: string;
	type: DetectedService["type"];
	depsInstalled: boolean;
}
