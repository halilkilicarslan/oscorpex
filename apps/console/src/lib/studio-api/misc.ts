import type {
  DocFreshnessItem,
  SonarStatus,
  SonarScanResult,
  SonarLatestScan,
  PoolStatus,
  HttpMethod,
  ApiDiscoveryResult,
  ApiCollection,
  SavedRequest,
} from './types.js';
import { API, json, httpDelete, httpPost } from './base.js';

export async function fetchDocsFreshness(projectId: string): Promise<DocFreshnessItem[]> {
  return json(`${API}/projects/${projectId}/docs/freshness`);
}

export async function fetchSonarStatus(projectId: string): Promise<SonarStatus> {
  return json(`${API}/projects/${projectId}/sonar/status`);
}

export async function triggerSonarScan(projectId: string): Promise<SonarScanResult> {
  return json(`${API}/projects/${projectId}/sonar/scan`, { method: 'POST' });
}

export async function fetchLatestSonarScan(projectId: string): Promise<SonarLatestScan> {
  return json(`${API}/projects/${projectId}/sonar/latest`);
}

export async function fetchPoolStatus(): Promise<PoolStatus> {
  return json(`${API}/pool/status`);
}

const ROLE_LABELS: Record<string, string> = {
  // v2 roles
  'product-owner': 'Product Owner',
  'scrum-master': 'Scrum Master',
  'tech-lead': 'Tech Lead',
  'business-analyst': 'Business Analyst',
  'design-lead': 'Design Lead',
  'frontend-dev': 'Frontend Developer',
  'backend-dev': 'Backend Developer',
  'frontend-qa': 'Frontend QA Engineer',
  'backend-qa': 'Backend QA Engineer',
  'frontend-reviewer': 'Frontend Code Reviewer',
  'backend-reviewer': 'Backend Code Reviewer',
  devops: 'DevOps Engineer',
  // legacy roles
  pm: 'Project Manager',
  architect: 'Software Architect',
  frontend: 'Frontend Developer',
  backend: 'Backend Developer',
  coder: 'Full-Stack Developer',
  qa: 'QA Engineer',
  reviewer: 'Code Reviewer',
  designer: 'UI/UX Designer',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export async function discoverApiRoutes(projectId: string): Promise<ApiDiscoveryResult> {
  return json(`${API}/projects/${projectId}/api/discover`);
}

export async function loadApiCollection(projectId: string): Promise<ApiCollection> {
  return json(`${API}/projects/${projectId}/api/collection`);
}

export async function saveApiRequest(projectId: string, request: SavedRequest): Promise<void> {
  await httpPost<void>(`${API}/projects/${projectId}/api/collection`, { request });
}

export async function deleteApiRequest(projectId: string, requestId: string): Promise<void> {
  await httpDelete<void>(`${API}/projects/${projectId}/api/collection/${requestId}`);
}

/** Proxy üzerinden API çağrısı yap */
export async function sendProxyRequest(
  projectId: string,
  method: HttpMethod,
  path: string,
  headers?: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string; duration: number }> {
  const proxyPath = `/api/studio/projects/${projectId}/app/proxy${path.startsWith('/') ? path : '/' + path}`;
  const start = performance.now();
  const res = await fetch(proxyPath, { // DIRECT_FETCH_INTENTIONAL: API explorer must expose raw proxied status, headers, and text body.
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method !== 'GET' && method !== 'DELETE' ? body : undefined,
  });
  const duration = Math.round(performance.now() - start);
  const resBody = await res.text();
  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });
  return { status: res.status, headers: resHeaders, body: resBody, duration };
}
