// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer — Env Var Detection
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseType, EnvVarRequirement } from "./types.js";

export const SENSITIVE_PATTERNS = /password|secret|key|token|api_key|apikey|auth|credential/i;

export const DB_ENV_PATTERNS: Record<DatabaseType, RegExp[]> = {
	postgresql: [/DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|DATABASE_URL|POSTGRES/i],
	mysql: [/MYSQL_HOST|MYSQL_PORT|MYSQL_USER|MYSQL_PASSWORD|MYSQL_DATABASE/i],
	mongodb: [/MONGO_URI|MONGO_URL|MONGODB_URI|MONGO_HOST/i],
	redis: [/REDIS_HOST|REDIS_PORT|REDIS_URL|REDIS_PASSWORD/i],
	sqlite: [/SQLITE_PATH|DB_PATH/i],
};

export function categorizeEnvVar(key: string): EnvVarRequirement["category"] {
	if (/^DB_|^DATABASE|^POSTGRES|^MYSQL|^MONGO|^REDIS|^SQLITE/i.test(key)) return "database";
	if (/^AUTH|^JWT|^SESSION|^OAUTH|^COOKIE/i.test(key)) return "auth";
	if (/^API_|^OPENAI|^ANTHROPIC|^STRIPE|^SENDGRID|^TWILIO/i.test(key)) return "api";
	if (/^PORT$|^HOST$|^NODE_ENV|^APP_|^BASE_URL|^CORS/i.test(key)) return "app";
	return "other";
}

/** .env.example dosyasını parse ederek env var listesi çıkarır */
export function parseEnvExample(repoPath: string): EnvVarRequirement[] {
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
export function loadExistingEnv(repoPath: string): Map<string, string> {
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

	const content = `${Array.from(existing.entries())
		.map(([k, v]) => `${k}=${v}`)
		.join("\n")}\n`;

	writeFileSync(envPath, content, "utf-8");
}
