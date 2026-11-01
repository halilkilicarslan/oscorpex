/**
 * SonarQube / SonarCloud integration for Oscorpex.
 *
 * - initSonarConfig(repoPath, projectKey) — scaffolds sonar-project.properties
 * - runSonarScan(repoPath) — runs sonar-scanner CLI
 * - fetchQualityGate(projectKey) — fetches quality gate status from SonarQube API
 *
 * Configuration priority: project settings (DB) > env vars > defaults
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectSetting } from "./db.js";
import { execute, query, queryOne } from "./db.js";
import { createLogger } from "./logger.js";
import { buildSafeChildEnv } from "./security/env-sanitizer.js";
import { validateOutboundHostUrl } from "./utils/url-validator.js";
const log = createLogger("sonar-runner");

/** Pinned scanner release run through npx (never a repo-local copy). */
const SONAR_SCANNER_VERSION = "4.3.0";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PLATFORM_DEFAULT_HOST = "http://localhost:9000";

/** Host URL comparison key: trimmed, lower-cased, without trailing slashes. */
export function normalizeSonarHost(url: string): string {
	return url.trim().toLowerCase().replace(/\/+$/, "");
}

/** True when `url` names the platform SonarQube (the legacy UI default or the configured platform host). */
export function isPlatformSonarHost(url: string): boolean {
	const n = normalizeSonarHost(url);
	return (
		n === normalizeSonarHost(PLATFORM_DEFAULT_HOST) ||
		n === normalizeSonarHost(process.env.SONAR_HOST_URL || PLATFORM_DEFAULT_HOST)
	);
}

interface SonarConfig {
	enabled: boolean;
	hostUrl: string;
	token: string;
	/** Set when the configuration must not be used (tenant-supplied host failed validation). */
	refused?: string;
}

async function getSonarConfig(projectId?: string): Promise<SonarConfig> {
	// Project-level settings take priority over env vars
	const dbEnabled = projectId ? await getProjectSetting(projectId, "sonarqube", "enabled") : undefined;
	const dbHost = projectId ? await getProjectSetting(projectId, "sonarqube", "hostUrl") : undefined;
	const dbToken = projectId ? await getProjectSetting(projectId, "sonarqube", "token") : undefined;

	const platformHost = process.env.SONAR_HOST_URL || PLATFORM_DEFAULT_HOST;
	const tenantHost = Boolean(dbHost) && !isPlatformSonarHost(dbHost as string);
	const config: SonarConfig = {
		enabled: dbEnabled !== undefined ? dbEnabled === "true" : process.env.SONAR_ENABLED === "true",
		hostUrl: dbHost || platformHost,
		// The platform token only ever goes to the platform host; a project token only to that project's host.
		token: dbToken || (tenantHost ? "" : process.env.SONAR_TOKEN || ""),
	};
	if (config.enabled && tenantHost) {
		const check = await validateOutboundHostUrl(config.hostUrl);
		if (!check.valid) config.refused = check.reason;
	}
	return config;
}

/**
 * SonarQube scanning is switched off until workload isolation (I5): the scanner reads and parses tenant code, so it may
 * only run inside the isolated runner. Everything below the guards is kept inert for I5 to re-enable.
 */
export const SONAR_DISABLED_MESSAGE = "SonarQube taraması iş yükü izolasyonu tamamlanana kadar devre dışı";
export const SONAR_DISABLED_KEY = "SonarQube scanning is disabled until workload isolation is complete";
const SONAR_SCANNING_DISABLED = true as boolean;

export async function isSonarEnabled(_projectId?: string): Promise<boolean> {
	if (SONAR_SCANNING_DISABLED) return false;
	return (await getSonarConfig(_projectId)).enabled;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const DEFAULT_SONAR_PROPERTIES = (projectKey: string, projectName: string) =>
	`
sonar.projectKey=${projectKey}
sonar.projectName=${projectName}
sonar.sources=.
sonar.exclusions=**/node_modules/**,**/dist/**,**/build/**,**/.next/**,**/coverage/**
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.typescript.lcov.reportPaths=coverage/lcov.info
sonar.sourceEncoding=UTF-8
`.trim();

/** Scaffold sonar-project.properties if it doesn't exist. */
export async function initSonarConfig(repoPath: string, projectKey: string, projectName: string): Promise<void> {
	const propsPath = join(repoPath, "sonar-project.properties");
	if (existsSync(propsPath)) return;

	await writeFile(propsPath, DEFAULT_SONAR_PROPERTIES(projectKey, projectName), "utf-8");
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

interface ScanResult {
	success: boolean;
	output: string;
	error?: string;
}

function exec(
	cmd: string,
	args: string[],
	cwd: string,
	env?: Record<string, string>,
	allowEnv: string[] = [],
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{
				cwd,
				timeout: 120_000,
				maxBuffer: 5 * 1024 * 1024,
				env: buildSafeChildEnv({ profile: "build_tool", extra: env, allow: allowEnv }),
			},
			(err, stdout, stderr) => {
				const code = err && "code" in err ? (err as NodeJS.ErrnoException).code : 0;
				resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: typeof code === "number" ? code : 1 });
			},
		);
	});
}

/**
 * Run sonar-scanner on the project.
 * Requires sonar-scanner CLI to be installed (npx sonar-scanner or globally).
 */
export async function runSonarScan(
	repoPath: string,
	log?: (msg: string) => void,
	projectId?: string,
): Promise<ScanResult> {
	// Refuses even when called directly: nothing is spawned while scanning is disabled (see isSonarEnabled)
	if (SONAR_SCANNING_DISABLED) return { success: false, output: "", error: SONAR_DISABLED_MESSAGE };

	const config = await getSonarConfig(projectId);

	if (!config.enabled) {
		return { success: true, output: "SonarQube disabled (SONAR_ENABLED != true)" };
	}
	if (config.refused) {
		return { success: false, output: "", error: `SonarQube host refused: ${config.refused}` };
	}

	if (!existsSync(join(repoPath, "sonar-project.properties"))) {
		return { success: false, output: "", error: "sonar-project.properties not found" };
	}

	log?.("[sonar] SonarQube scan baslatiliyor...");

	// The scanner runs from an empty temp dir (npx would otherwise resolve a repo-local node_modules/.bin/sonar-scanner,
	// i.e. tenant code) and only reads the repo through projectBaseDir. The version is pinned.
	const args = [
		"--yes",
		`--package=sonarqube-scanner@${SONAR_SCANNER_VERSION}`,
		"sonar-scanner",
		`-Dsonar.host.url=${config.hostUrl}`,
		`-Dsonar.projectBaseDir=${repoPath}`,
	];

	// The token travels through the environment: argv is visible to every local user in `ps`. SONAR_TOKEN is always set
	// explicitly (possibly empty) so the kernel process's own platform token can never leak through to a tenant host.
	const scratch = await mkdtemp(join(tmpdir(), "oscorpex-sonar-"));
	let result: { stdout: string; stderr: string; code: number };
	try {
		result = await exec("npx", args, scratch, { SONAR_TOKEN: config.token }, ["SONAR_TOKEN"]);
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
	const { stdout, stderr, code } = result;

	if (code !== 0) {
		const errorMsg = stderr.slice(0, 500) || stdout.slice(0, 500);
		log?.(`[sonar] Scan basarisiz: ${errorMsg.slice(0, 200)}`);
		return { success: false, output: stdout, error: errorMsg };
	}

	log?.("[sonar] Scan tamamlandi");
	return { success: true, output: stdout };
}

// ---------------------------------------------------------------------------
// Quality Gate
// ---------------------------------------------------------------------------

export interface QualityGateResult {
	status: "OK" | "WARN" | "ERROR" | "NONE";
	conditions: QualityGateCondition[];
}

export interface QualityGateCondition {
	metricKey: string;
	status: "OK" | "WARN" | "ERROR" | "NO_VALUE";
	actualValue?: string;
	errorThreshold?: string;
}

/**
 * Fetch quality gate status from SonarQube API.
 * Returns NONE if SonarQube is disabled or unreachable.
 */
export async function fetchQualityGate(projectKey: string, projectId?: string): Promise<QualityGateResult> {
	if (SONAR_SCANNING_DISABLED) return { status: "NONE", conditions: [] };
	const config = await getSonarConfig(projectId);

	if (!config.enabled || config.refused) {
		return { status: "NONE", conditions: [] };
	}

	try {
		const url = `${config.hostUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
		const headers: Record<string, string> = {};
		if (config.token) {
			headers.Authorization = `Bearer ${config.token}`;
		}

		const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
		if (!resp.ok) {
			return { status: "NONE", conditions: [] };
		}

		interface SonarConditionRaw {
			metricKey: string;
			status: string;
			actualValue?: string;
			errorThreshold?: string;
		}
		interface SonarProjectStatusResponse {
			projectStatus?: { status?: string; conditions?: SonarConditionRaw[] };
		}
		const data = (await resp.json()) as SonarProjectStatusResponse;
		const ps = data.projectStatus;

		return {
			status: (ps?.status ?? "NONE") as QualityGateResult["status"],
			conditions: (ps?.conditions ?? []).map((c) => ({
				metricKey: c.metricKey,
				status: c.status as QualityGateCondition["status"],
				actualValue: c.actualValue,
				errorThreshold: c.errorThreshold,
			})),
		};
	} catch {
		return { status: "NONE", conditions: [] };
	}
}

// ---------------------------------------------------------------------------
// DB integration — store scan results
// ---------------------------------------------------------------------------

// Note: sonar_scans table is created in db.ts migrate(), not here.

export async function recordSonarScan(projectId: string, gate: QualityGateResult, scanOutput: string): Promise<string> {
	const id = randomUUID();
	const ts = new Date().toISOString();
	await execute(
		"INSERT INTO sonar_scans (id, project_id, quality_gate, conditions, scan_output, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
		[id, projectId, gate.status, JSON.stringify(gate.conditions), scanOutput.slice(0, 5000), ts],
	);
	return id;
}

export interface SonarScanRecord {
	id: string;
	projectId: string;
	qualityGate: string;
	conditions: QualityGateCondition[];
	createdAt: string;
}

export async function getLatestSonarScan(projectId: string): Promise<SonarScanRecord | null> {
	const row = await queryOne<any>("SELECT * FROM sonar_scans WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", [
		projectId,
	]);
	if (!row) return null;
	return {
		id: row.id,
		projectId: row.project_id,
		qualityGate: row.quality_gate,
		conditions: JSON.parse(row.conditions || "[]"),
		createdAt: row.created_at,
	};
}
