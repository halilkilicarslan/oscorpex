// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer — Database Detection
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_ENV_PATTERNS } from "./env-detection.js";
import type { DatabaseType, DetectedDatabase, EnvVarRequirement } from "./types.js";

const DB_DOCKER_IMAGES: Record<DatabaseType, { image: string; port: number }> = {
	postgresql: { image: "postgres:16-alpine", port: 5432 },
	mysql: { image: "mysql:8", port: 3306 },
	mongodb: { image: "mongo:7", port: 27017 },
	redis: { image: "redis:7-alpine", port: 6379 },
	sqlite: { image: "", port: 0 }, // No container needed
};

/** docker-compose.yml'dan DB servislerini algıla */
export function detectDatabasesFromCompose(repoPath: string): DetectedDatabase[] {
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
export function detectDatabasesFromEnv(
	envVars: EnvVarRequirement[],
	composeDbs: DetectedDatabase[],
): DetectedDatabase[] {
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
