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
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProjectSetting } from "./db.js";
import { execute, query, queryOne } from "./pg.js";
import { createLogger } from "./logger.js";
const log = createLogger("sonar-runner");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function getSonarConfig(projectId?: string) {
	// Project-level settings take priority over env vars
	const dbEnabled = projectId ? await getProjectSetting(projectId, "sonarqube", "enabled") : undefined;
	const dbHost = projectId ? await getProjectSetting(projectId, "sonarqube", "hostUrl") : undefined;
	const dbToken = projectId ? await getProjectSetting(projectId, "sonarqube", "token") : undefined;

	return {
		enabled: dbEnabled !== undefined ? dbEnabled === "true" : process.env.SONAR_ENABLED === "true",
		hostUrl: dbHost || process.env.SONAR_HOST_URL || "http://localhost:9000",
		token: dbToken || process.env.SONAR_TOKEN || "",
	};
}

export async function isSonarEnabled(projectId?: string): Promise<boolean> {
	return (await getSonarConfig(projectId)).enabled;
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
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{
				cwd,
				timeout: 120_000,
				maxBuffer: 5 * 1024 * 1024,
				env: { ...process.env, ...env },
			},
			(err, stdout, stderr) => {
				const code = err && "code" in err ? (err as any).code : 0;
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
	const config = await getSonarConfig(projectId);

	if (!config.enabled) {
		return { success: true, output: "SonarQube disabled (SONAR_ENABLED != true)" };
	}

	if (!existsSync(join(repoPath, "sonar-project.properties"))) {
		return { success: false, output: "", error: "sonar-project.properties not found" };
	}

	log?.("[sonar] SonarQube scan baslatiliyor...");

	const args = ["sonar-scanner", `-Dsonar.host.url=${config.hostUrl}`];

	if (config.token) {
		args.push(`-Dsonar.token=${config.token}`);
	}

	const { stdout, stderr, code } = await exec("npx", args, repoPath);

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
	const config = await getSonarConfig(projectId);

	if (!config.enabled) {
		return { status: "NONE", conditions: [] };
	}

	try {
		const url = `${config.hostUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
		const headers: Record<string, string> = {};
		if (config.token) {
			headers["Authorization"] = `Bearer ${config.token}`;
		}

		const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
		if (!resp.ok) {
			return { status: "NONE", conditions: [] };
		}

		const data = (await resp.json()) as any;
		const ps = data.projectStatus;

		return {
			status: ps?.status ?? "NONE",
			conditions: (ps?.conditions ?? []).map((c: any) => ({
				metricKey: c.metricKey,
				status: c.status,
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
