/**
 * SonarQube / SonarCloud integration for AI Dev Studio.
 *
 * - initSonarConfig(repoPath, projectKey) — scaffolds sonar-project.properties
 * - runSonarScan(repoPath) — runs sonar-scanner CLI
 * - fetchQualityGate(projectKey) — fetches quality gate status from SonarQube API
 *
 * Configuration via env vars:
 *   SONAR_HOST_URL  — SonarQube server URL (default: http://localhost:9000)
 *   SONAR_TOKEN     — Authentication token
 *   SONAR_ENABLED   — Set to "true" to enable (default: disabled)
 */

import { existsSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getSonarConfig() {
  return {
    enabled: process.env.SONAR_ENABLED === 'true',
    hostUrl: process.env.SONAR_HOST_URL || 'http://localhost:9000',
    token: process.env.SONAR_TOKEN || '',
  };
}

export function isSonarEnabled(): boolean {
  return getSonarConfig().enabled;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const DEFAULT_SONAR_PROPERTIES = (projectKey: string, projectName: string) => `
sonar.projectKey=${projectKey}
sonar.projectName=${projectName}
sonar.sources=.
sonar.exclusions=**/node_modules/**,**/dist/**,**/build/**,**/.next/**,**/coverage/**
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.typescript.lcov.reportPaths=coverage/lcov.info
sonar.sourceEncoding=UTF-8
`.trim();

/** Scaffold sonar-project.properties if it doesn't exist. */
export async function initSonarConfig(
  repoPath: string,
  projectKey: string,
  projectName: string,
): Promise<void> {
  const propsPath = join(repoPath, 'sonar-project.properties');
  if (existsSync(propsPath)) return;

  await writeFile(propsPath, DEFAULT_SONAR_PROPERTIES(projectKey, projectName), 'utf-8');
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

interface ScanResult {
  success: boolean;
  output: string;
  error?: string;
}

function exec(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
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
        const code = err && 'code' in err ? (err as any).code : 0;
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: typeof code === 'number' ? code : 1 });
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
): Promise<ScanResult> {
  const config = getSonarConfig();

  if (!config.enabled) {
    return { success: true, output: 'SonarQube disabled (SONAR_ENABLED != true)' };
  }

  if (!existsSync(join(repoPath, 'sonar-project.properties'))) {
    return { success: false, output: '', error: 'sonar-project.properties not found' };
  }

  log?.('[sonar] SonarQube scan baslatiliyor...');

  const args = [
    'sonar-scanner',
    `-Dsonar.host.url=${config.hostUrl}`,
  ];

  if (config.token) {
    args.push(`-Dsonar.token=${config.token}`);
  }

  const { stdout, stderr, code } = await exec('npx', args, repoPath);

  if (code !== 0) {
    const errorMsg = stderr.slice(0, 500) || stdout.slice(0, 500);
    log?.(`[sonar] Scan basarisiz: ${errorMsg.slice(0, 200)}`);
    return { success: false, output: stdout, error: errorMsg };
  }

  log?.('[sonar] Scan tamamlandi');
  return { success: true, output: stdout };
}

// ---------------------------------------------------------------------------
// Quality Gate
// ---------------------------------------------------------------------------

export interface QualityGateResult {
  status: 'OK' | 'WARN' | 'ERROR' | 'NONE';
  conditions: QualityGateCondition[];
}

export interface QualityGateCondition {
  metricKey: string;
  status: 'OK' | 'WARN' | 'ERROR' | 'NO_VALUE';
  actualValue?: string;
  errorThreshold?: string;
}

/**
 * Fetch quality gate status from SonarQube API.
 * Returns NONE if SonarQube is disabled or unreachable.
 */
export async function fetchQualityGate(projectKey: string): Promise<QualityGateResult> {
  const config = getSonarConfig();

  if (!config.enabled) {
    return { status: 'NONE', conditions: [] };
  }

  try {
    const url = `${config.hostUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
    const headers: Record<string, string> = {};
    if (config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    }

    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      return { status: 'NONE', conditions: [] };
    }

    const data = await resp.json() as any;
    const ps = data.projectStatus;

    return {
      status: ps?.status ?? 'NONE',
      conditions: (ps?.conditions ?? []).map((c: any) => ({
        metricKey: c.metricKey,
        status: c.status,
        actualValue: c.actualValue,
        errorThreshold: c.errorThreshold,
      })),
    };
  } catch {
    return { status: 'NONE', conditions: [] };
  }
}

// ---------------------------------------------------------------------------
// DB integration — store scan results
// ---------------------------------------------------------------------------

import { getDb } from './db.js';
import { randomUUID } from 'node:crypto';

// Note: sonar_scans table is created in db.ts migrate(), not here.

export function recordSonarScan(
  projectId: string,
  gate: QualityGateResult,
  scanOutput: string,
): string {
  const db = getDb();
  const id = randomUUID();
  const ts = new Date().toISOString();
  db.prepare(
    'INSERT INTO sonar_scans (id, project_id, quality_gate, conditions, scan_output, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, gate.status, JSON.stringify(gate.conditions), scanOutput.slice(0, 5000), ts);
  return id;
}

export interface SonarScanRecord {
  id: string;
  projectId: string;
  qualityGate: string;
  conditions: QualityGateCondition[];
  createdAt: string;
}

export function getLatestSonarScan(projectId: string): SonarScanRecord | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM sonar_scans WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(projectId) as any;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    qualityGate: row.quality_gate,
    conditions: JSON.parse(row.conditions || '[]'),
    createdAt: row.created_at,
  };
}
