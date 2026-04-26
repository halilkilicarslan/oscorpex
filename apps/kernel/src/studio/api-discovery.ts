// ---------------------------------------------------------------------------
// Oscorpex — API Discovery Engine
// Express/Fastify/Hono route dosyalarını parse ederek API endpoint'lerini keşfeder.
// OpenAPI spec varsa onu kullanır, yoksa kaynak kod + probe ile keşif yapar.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DiscoveredRoute {
	method: HttpMethod;
	path: string;
	/** Hangi dosyadan keşfedildi */
	source?: string;
	/** Route açıklaması (OpenAPI'den veya yorum satırından) */
	description?: string;
	/** Parametreler (path params) */
	params?: string[];
}

export interface ApiDiscoveryResult {
	/** Keşif yöntemi */
	discoveryMethod: "openapi" | "source-parse" | "probe" | "none";
	/** Base path (örn: /api/v1) */
	basePath: string;
	/** Keşfedilen route'lar */
	routes: DiscoveredRoute[];
	/** OpenAPI spec URL (varsa) */
	openApiUrl?: string;
}

// ---------------------------------------------------------------------------
// 1. OpenAPI / Swagger Spec Detection
// ---------------------------------------------------------------------------

const OPENAPI_FILES = [
	"swagger.json",
	"swagger.yaml",
	"swagger.yml",
	"openapi.json",
	"openapi.yaml",
	"openapi.yml",
	"docs/swagger.json",
	"docs/openapi.json",
	"api/swagger.json",
	"api/openapi.json",
	"public/swagger.json",
	"public/openapi.json",
];

const OPENAPI_ENDPOINTS = [
	"/swagger.json",
	"/openapi.json",
	"/api-docs",
	"/api/docs",
	"/docs",
	"/swagger",
	"/api/swagger.json",
	"/api/v1/docs",
	"/api/v1/swagger.json",
];

function findOpenApiSpec(repoPath: string): { routes: DiscoveredRoute[]; basePath: string } | null {
	for (const file of OPENAPI_FILES) {
		const fullPath = join(repoPath, file);
		if (!existsSync(fullPath)) continue;
		try {
			const content = readFileSync(fullPath, "utf-8");
			if (file.endsWith(".json")) {
				return parseOpenApiJson(JSON.parse(content));
			}
			// YAML desteği basit — sadece JSON destekliyoruz şimdilik
		} catch {
			/* ignore parse errors */
		}
	}
	return null;
}

function parseOpenApiJson(spec: any): { routes: DiscoveredRoute[]; basePath: string } | null {
	const paths = spec.paths;
	if (!paths || typeof paths !== "object") return null;

	const basePath = spec.basePath || spec.servers?.[0]?.url || "";
	const routes: DiscoveredRoute[] = [];

	for (const [path, methods] of Object.entries(paths)) {
		if (typeof methods !== "object" || !methods) continue;
		for (const [method, detail] of Object.entries(methods as Record<string, any>)) {
			const upper = method.toUpperCase();
			if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) continue;

			const params = (path.match(/\{(\w+)\}/g) || []).map((p: string) => p.replace(/[{}]/g, ""));
			routes.push({
				method: upper as HttpMethod,
				path,
				description: detail.summary || detail.description || undefined,
				params: params.length > 0 ? params : undefined,
			});
		}
	}

	return routes.length > 0 ? { routes, basePath } : null;
}

// ---------------------------------------------------------------------------
// 2. Source Code Route Parsing
// ---------------------------------------------------------------------------

/** Express/Fastify/Hono/Koa route pattern'lerini yakalar */
const ROUTE_PATTERNS = [
	// Express: router.get('/path', ...), app.post('/path', ...)
	/(?:router|app|route)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
	// Fastify: fastify.get('/path', ...)
	/fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
	// Hono: app.get('/path', ...), c.get('/path', ...)
	/(?:app|c|hono)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
	// Decorator style (NestJS): @Get('/path'), @Post('/path')
	/@(Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/gi,
];

/** Route index dosyasından mount prefix'leri yakalar */
const MOUNT_PATTERNS = [
	// router.use('/prefix', someRouter)
	/\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g,
	// app.route('/prefix').get(...)
	/\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
];

interface MountInfo {
	prefix: string;
	routerName: string;
	sourceFile?: string;
}

function findRouteFiles(dirPath: string): string[] {
	const results: string[] = [];
	const routeDirs = ["routes", "router", "api", "controllers", "src/routes", "src/router", "src/api"];

	for (const dir of routeDirs) {
		const fullDir = join(dirPath, dir);
		if (!existsSync(fullDir)) continue;
		try {
			const files = readdirSync(fullDir);
			for (const file of files) {
				const ext = extname(file).toLowerCase();
				if ([".js", ".ts", ".mjs"].includes(ext)) {
					results.push(join(fullDir, file));
				}
			}
		} catch {
			/* ignore */
		}
	}

	// Root'taki app.js, server.js, index.js
	for (const file of [
		"app.js",
		"app.ts",
		"server.js",
		"server.ts",
		"index.js",
		"index.ts",
		"src/app.js",
		"src/app.ts",
		"src/server.js",
		"src/server.ts",
		"src/index.js",
		"src/index.ts",
	]) {
		const fullPath = join(dirPath, file);
		if (existsSync(fullPath) && !results.includes(fullPath)) {
			results.push(fullPath);
		}
	}

	return results;
}

function parseRouteFile(filePath: string): { routes: DiscoveredRoute[]; mounts: MountInfo[] } {
	const routes: DiscoveredRoute[] = [];
	const mounts: MountInfo[] = [];

	try {
		const content = readFileSync(filePath, "utf-8");
		const relativeName = filePath.split("/").slice(-2).join("/");

		// Route pattern'lerini ara
		for (const pattern of ROUTE_PATTERNS) {
			pattern.lastIndex = 0;
			let match;
			while ((match = pattern.exec(content)) !== null) {
				const method = match[1].toUpperCase() as HttpMethod;
				const path = match[2] || "/";
				const params = (path.match(/:(\w+)/g) || []).map((p) => p.slice(1));

				// Yorum satırından description al
				const lineStart = content.lastIndexOf("\n", match.index) + 1;
				const prevLines = content.slice(Math.max(0, lineStart - 200), lineStart);
				const commentMatch = prevLines.match(/\/\/\s*(.+)\s*$/m) || prevLines.match(/\/\*\*?\s*(.+?)\s*\*\//);
				const description = commentMatch?.[1]?.trim();

				routes.push({
					method,
					path,
					source: relativeName,
					description,
					params: params.length > 0 ? params : undefined,
				});
			}
		}

		// Mount prefix'lerini ara
		for (const pattern of MOUNT_PATTERNS) {
			pattern.lastIndex = 0;
			let match;
			while ((match = pattern.exec(content)) !== null) {
				mounts.push({
					prefix: match[1],
					routerName: match[2] || "",
					sourceFile: relativeName,
				});
			}
		}
	} catch {
		/* ignore read errors */
	}

	return { routes, mounts };
}

function parseSourceRoutes(repoPath: string): { routes: DiscoveredRoute[]; basePath: string } | null {
	const files = findRouteFiles(repoPath);
	if (files.length === 0) return null;

	const allRoutes: DiscoveredRoute[] = [];
	const allMounts: MountInfo[] = [];

	for (const file of files) {
		const { routes, mounts } = parseRouteFile(file);
		allRoutes.push(...routes);
		allMounts.push(...mounts);
	}

	if (allRoutes.length === 0) return null;

	// Mount prefix'lerinden base path tahmin et
	// Örn: router.use('/health', healthRouter) + router.use('/items', itemsRouter)
	// ve app.use('/api/v1', router) → basePath = /api/v1
	let basePath = "";
	const appMounts = allMounts.filter((m) => m.prefix.startsWith("/api"));
	if (appMounts.length > 0) {
		basePath = appMounts[0].prefix;
	}

	// Route path'lerini mount prefix'leri ile birleştir
	// Her route dosyasının hangi prefix'e mount edildiğini bul
	const resolvedRoutes: DiscoveredRoute[] = [];
	const fileToPrefix = new Map<string, string>();

	for (const mount of allMounts) {
		// routerName → dosya adı eşleştirmesi
		// itemsRouter → items, healthRouter → health, userRouter → user
		const routerBase = mount.routerName.toLowerCase().replace(/router$/i, "");
		const mountBase = mount.prefix.replace(/^\//, "").split("/").pop() || "";
		const routerFile = files.find((f) => {
			const name = (
				f
					.split("/")
					.pop()
					?.replace(/\.(js|ts|mjs)$/, "") || ""
			).toLowerCase();
			return name === routerBase || name === mountBase || routerBase.includes(name) || name.includes(routerBase);
		});
		if (routerFile) {
			const relativeName = routerFile.split("/").slice(-2).join("/");
			fileToPrefix.set(relativeName, mount.prefix);
		}
	}

	for (const route of allRoutes) {
		const prefix = route.source ? fileToPrefix.get(route.source) || "" : "";
		resolvedRoutes.push({
			...route,
			path: prefix ? `${prefix}${route.path === "/" ? "" : route.path}` : route.path,
		});
	}

	// Duplicate'leri kaldır
	const seen = new Set<string>();
	const uniqueRoutes = resolvedRoutes.filter((r) => {
		const key = `${r.method}:${r.path}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	return uniqueRoutes.length > 0 ? { routes: uniqueRoutes, basePath } : null;
}

// ---------------------------------------------------------------------------
// 3. Endpoint Probe (Runtime)
// ---------------------------------------------------------------------------

async function probeEndpoints(appUrl: string): Promise<{ routes: DiscoveredRoute[]; basePath: string }> {
	const routes: DiscoveredRoute[] = [];
	const probePaths = [
		"/api/v1/health",
		"/api/health",
		"/health",
		"/healthz",
		"/api/v1",
		"/api/v2",
		"/api",
		"/api/v1/users",
		"/api/v1/items",
		"/api/v1/products",
		"/api/users",
		"/api/items",
		"/api/products",
		...OPENAPI_ENDPOINTS,
	];

	const baseUrl = appUrl.replace(/\/$/, "");

	for (const path of probePaths) {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				method: "GET",
				signal: AbortSignal.timeout(2000),
			});
			// 2xx veya 401/403 (auth gerekli ama route var) = route mevcut
			if (res.status < 500) {
				routes.push({
					method: "GET",
					path,
					description: `Probed (${res.status})`,
				});
			}
		} catch {
			/* timeout or connection error */
		}
	}

	// Base path'i en yaygın prefix'ten çıkar
	const prefixes = routes.map((r) => {
		const parts = r.path.split("/").filter(Boolean);
		return parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : `/${parts[0] || ""}`;
	});
	const prefixCount = new Map<string, number>();
	for (const p of prefixes) {
		prefixCount.set(p, (prefixCount.get(p) || 0) + 1);
	}
	let basePath = "";
	let maxCount = 0;
	for (const [p, c] of prefixCount) {
		if (c > maxCount) {
			basePath = p;
			maxCount = c;
		}
	}

	return { routes, basePath };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Proje API endpoint'lerini keşfet.
 * Öncelik: OpenAPI spec → source parse → runtime probe
 */
export async function discoverApi(repoPath: string, appUrl?: string): Promise<ApiDiscoveryResult> {
	// 1. OpenAPI spec dosyası
	const openApi = findOpenApiSpec(repoPath);
	if (openApi && openApi.routes.length > 0) {
		return {
			discoveryMethod: "openapi",
			basePath: openApi.basePath,
			routes: openApi.routes,
			openApiUrl: OPENAPI_FILES.find((f) => existsSync(join(repoPath, f))),
		};
	}

	// 2. Source code parsing
	const sourceRoutes = parseSourceRoutes(repoPath);
	if (sourceRoutes && sourceRoutes.routes.length > 0) {
		return {
			discoveryMethod: "source-parse",
			basePath: sourceRoutes.basePath,
			routes: sourceRoutes.routes,
		};
	}

	// 3. Runtime probe (app çalışıyorsa)
	if (appUrl) {
		const probed = await probeEndpoints(appUrl);
		if (probed.routes.length > 0) {
			return {
				discoveryMethod: "probe",
				basePath: probed.basePath,
				routes: probed.routes,
			};
		}
	}

	return { discoveryMethod: "none", basePath: "", routes: [] };
}

// ---------------------------------------------------------------------------
// Collection Persistence
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createLogger } from "./logger.js";
const log = createLogger("api-discovery");

const COLLECTIONS_BASE = join(process.cwd(), ".oscorpex", "api-collections");

export interface SavedRequest {
	id: string;
	method: HttpMethod;
	path: string;
	headers?: Record<string, string>;
	body?: string;
	/** Son response status */
	lastStatus?: number;
	/** Son response body (truncated) */
	lastResponse?: string;
	/** Son response süresi (ms) */
	lastDuration?: number;
	createdAt: string;
	updatedAt: string;
}

export interface ApiCollection {
	projectId: string;
	requests: SavedRequest[];
}

function collectionPath(projectId: string): string {
	return join(COLLECTIONS_BASE, `${projectId}.json`);
}

export async function loadCollection(projectId: string): Promise<ApiCollection> {
	try {
		const raw = await readFile(collectionPath(projectId), "utf-8");
		return JSON.parse(raw);
	} catch {
		return { projectId, requests: [] };
	}
}

export async function saveCollection(collection: ApiCollection): Promise<void> {
	try {
		await mkdir(COLLECTIONS_BASE, { recursive: true });
		await writeFile(collectionPath(collection.projectId), JSON.stringify(collection, null, 2), "utf-8");
	} catch (err) {
		log.warn("[api-discovery] Collection kaydedilemedi: " + (err instanceof Error ? err.message : String(err)));
	}
}
