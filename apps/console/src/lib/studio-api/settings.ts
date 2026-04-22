import type {
  SettingsMap,
  PolicyRule,
  MemoryFact,
  MemorySnapshot,
  Webhook,
  CreateWebhookData,
  UpdateWebhookData,
} from './types.js';
import { API, json } from './base.js';

export async function fetchProjectSettings(projectId: string): Promise<SettingsMap> {
  return json(`${API}/projects/${projectId}/settings`);
}

export async function saveProjectSettings(
  projectId: string,
  category: string,
  entries: Record<string, string>,
): Promise<{ ok: boolean }> {
  return json(
    `${API}/projects/${projectId}/settings/${category}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    },
  );
}

const BUILTIN_IDS = new Set([
  'max_cost_per_task',
  'require_approval_for_large',
  'multi_reviewer',
]);

export function isBuiltinPolicy(rule: PolicyRule): boolean {
  return BUILTIN_IDS.has(rule.id);
}

/** Fetches only custom policies (built-ins are merged client-side for display). */
export async function fetchCustomPolicyRules(projectId: string): Promise<PolicyRule[]> {
  const settings = await fetchProjectSettings(projectId);
  const raw = settings?.policy?.rules;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.rules)) return parsed.rules as PolicyRule[];
    if (Array.isArray(parsed)) return parsed as PolicyRule[];
    return [];
  } catch {
    return [];
  }
}

export async function saveCustomPolicyRules(
  projectId: string,
  rules: PolicyRule[],
): Promise<{ ok: boolean }> {
  return saveProjectSettings(projectId, 'policy', {
    rules: JSON.stringify({ rules }),
  });
}

const DEFAULT_APPROVAL_KEYWORDS = [
  'deploy',
  'database migration',
  'drop',
  'truncate',
  'migration',
  'seed',
  'production',
];

export async function fetchApprovalKeywords(projectId: string): Promise<string[]> {
  const settings = await fetchProjectSettings(projectId);
  const raw = settings?.approval?.keywords;
  if (!raw) return DEFAULT_APPROVAL_KEYWORDS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_APPROVAL_KEYWORDS;
  } catch {
    return DEFAULT_APPROVAL_KEYWORDS;
  }
}

export async function saveApprovalKeywords(
  projectId: string,
  keywords: string[],
): Promise<{ ok: boolean }> {
  return saveProjectSettings(projectId, 'approval', {
    keywords: JSON.stringify(keywords),
  });
}

export async function fetchMemoryContext(projectId: string): Promise<string> {
  const data = await json<{ text: string }>(`${API}/projects/${projectId}/memory/context`);
  return data.text;
}

export async function fetchMemorySnapshot(projectId: string): Promise<MemorySnapshot | null> {
  const data = await json<{ snapshot: MemorySnapshot | null }>(
    `${API}/projects/${projectId}/memory/snapshot`,
  );
  return data.snapshot;
}

export async function refreshMemorySnapshot(projectId: string): Promise<MemorySnapshot | null> {
  const data = await json<{ snapshot: MemorySnapshot | null }>(
    `${API}/projects/${projectId}/memory/refresh`,
    { method: 'POST' },
  );
  return data.snapshot;
}

export async function fetchMemoryFacts(projectId: string, scope?: string): Promise<MemoryFact[]> {
  const url = scope
    ? `${API}/projects/${projectId}/memory/facts?scope=${encodeURIComponent(scope)}`
    : `${API}/projects/${projectId}/memory/facts`;
  const data = await json<{ facts: MemoryFact[] }>(url);
  return data.facts;
}

export async function upsertMemoryFact(
  projectId: string,
  input: { scope: string; key: string; value: string; confidence?: number; source?: string },
): Promise<MemoryFact> {
  return json(
    `${API}/projects/${projectId}/memory/facts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function deleteMemoryFact(
  projectId: string,
  scope: string,
  key: string,
): Promise<{ ok: boolean }> {
  const url = `${API}/projects/${projectId}/memory/facts?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`;
  return json(url, { method: 'DELETE' });
}

/** Projeye ait webhook'ları listele */
export async function fetchWebhooks(projectId: string): Promise<Webhook[]> {
  return json(`${API}/projects/${projectId}/webhooks`);
}

/** Yeni webhook oluştur */
export async function createWebhook(
  projectId: string,
  data: CreateWebhookData,
): Promise<Webhook> {
  return json(
    `${API}/projects/${projectId}/webhooks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}

/** Webhook'u güncelle */
export async function updateWebhook(
  projectId: string,
  webhookId: string,
  data: UpdateWebhookData,
): Promise<Webhook> {
  return json(
    `${API}/projects/${projectId}/webhooks/${webhookId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}

/** Webhook'u sil */
export async function deleteWebhook(
  projectId: string,
  webhookId: string,
): Promise<void> {
  await json(
    `${API}/projects/${projectId}/webhooks/${webhookId}`,
    { method: 'DELETE' },
  );
}

/** Test bildirimi gönder */
export async function testWebhook(
  projectId: string,
  webhookId: string,
): Promise<{ success: boolean; message: string }> {
  return json(
    `${API}/projects/${projectId}/webhooks/${webhookId}/test`,
    { method: 'POST' },
  );
}
