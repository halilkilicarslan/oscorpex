import type {
  AppStatus,
  AppConfig,
  RuntimeAnalysis,
  DatabaseType,
  DbProvisionMethod,
  DbStatus,
} from './types.js';
import { API, json } from './base.js';

export async function startApp(projectId: string): Promise<{ ok: boolean; services: { name: string; url: string }[]; previewUrl: string | null }> {
  return json(`${API}/projects/${projectId}/app/start`, { method: 'POST' });
}

export async function stopApp(projectId: string): Promise<{ ok: boolean }> {
  return json(`${API}/projects/${projectId}/app/stop`, { method: 'POST' });
}

export async function fetchAppStatus(projectId: string): Promise<AppStatus> {
  return json(`${API}/projects/${projectId}/app/status`);
}

export async function switchPreviewService(projectId: string, service: string): Promise<{ ok: boolean }> {
  return json(`${API}/projects/${projectId}/app/switch-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service }),
  });
}

export async function detectApiOnlyPreview(projectId: string): Promise<boolean> {
  const res = await fetch(`${API}/projects/${projectId}/app/proxy/`); // DIRECT_FETCH_INTENTIONAL: preview detection must inspect raw proxied content-type and text body.
  if (res.headers.get('content-type')?.includes('text/html')) {
    const body = await res.text();
    return body.includes('API-Only Application');
  }
  return true;
}

export async function fetchAppConfig(projectId: string): Promise<AppConfig> {
  return json(`${API}/projects/${projectId}/app/config`);
}

/** Proje runtime gereksinimlerini analiz et */
export async function analyzeRuntime(projectId: string): Promise<RuntimeAnalysis> {
  return json(`${API}/projects/${projectId}/runtime/analyze`);
}

/** Env var'ları .env dosyasına kaydet */
export async function saveEnvVars(projectId: string, values: Record<string, string>): Promise<{ ok: boolean }> {
  return json(`${API}/projects/${projectId}/runtime/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
}

/** DB provision (Docker / Cloud) */
export async function provisionDb(
  projectId: string,
  type: DatabaseType,
  method: DbProvisionMethod,
  cloudUrl?: string,
  port?: number,
): Promise<{ ok: boolean; status?: DbStatus; envVars?: Record<string, string> }> {
  return json(`${API}/projects/${projectId}/runtime/db/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, method, cloudUrl, port }),
  });
}

/** DB durdur */
export async function stopDb(projectId: string, type?: DatabaseType): Promise<{ ok: boolean }> {
  return json(`${API}/projects/${projectId}/runtime/db/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
}

/** DB durumları */
export async function fetchDbStatus(projectId: string): Promise<DbStatus[]> {
  return json(`${API}/projects/${projectId}/runtime/db/status`);
}

/** Bağımlılık kur */
export async function installDeps(
  projectId: string,
  serviceName?: string,
): Promise<{ ok: boolean; results: { name: string; success: boolean; error?: string }[] }> {
  return json(`${API}/projects/${projectId}/runtime/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName }),
  });
}
