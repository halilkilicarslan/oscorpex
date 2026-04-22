import type {
  AIProvider,
  ProviderCreateInput,
  PlannerCLIProviderInfo,
  CLIProviderId,
  CLIUsageSnapshot,
  CLIUsageTrendPoint,
  CLIProbeEvent,
  OscorpexUsageSnapshot,
  ProviderProbePermission,
} from './types.js';
import { API, json } from './base.js';

export async function fetchProviders(): Promise<AIProvider[]> {
  return json(`${API}/providers`);
}

/**
 * Aktif provider'ları fallback öncelik sırasına göre getirir.
 * Default provider her zaman başta yer alır.
 */
export async function fetchFallbackChain(): Promise<AIProvider[]> {
  return json(`${API}/providers/fallback-chain`);
}

/**
 * Provider'ların fallback sıralamasını günceller.
 * @param orderedIds — Provider ID'leri, istenen sıraya göre dizili (birincisi en önce denenir).
 */
export async function updateFallbackOrder(orderedIds: string[]): Promise<AIProvider[]> {
  return json(
    `${API}/providers/fallback-chain`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    },
  );
}

export async function createProvider(
  data: ProviderCreateInput,
): Promise<AIProvider> {
  return json(
    `${API}/providers`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}

export async function updateProvider(id: string, data: Partial<AIProvider>): Promise<AIProvider> {
  return json(
    `${API}/providers/${id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteProvider(id: string): Promise<void> {
  await json(`${API}/providers/${id}`, { method: 'DELETE' });
}

export async function setDefaultProvider(id: string): Promise<void> {
  await json(`${API}/providers/${id}/default`, { method: 'POST' });
}

export async function testProvider(id: string): Promise<{ valid: boolean; message: string }> {
  return json(`${API}/providers/${id}/test`, { method: 'POST' });
}

export async function fetchDockerStatus(): Promise<{ docker: boolean; coderImage: boolean }> {
  return json(`${API}/docker/status`);
}

export async function fetchConfigStatus(): Promise<{
  openaiConfigured: boolean;
  providerConfigured: boolean;
  providerName?: string;
  plannerAvailable: boolean;
}> {
  return json(`${API}/config/status`);
}

export async function fetchPlannerProviders(): Promise<PlannerCLIProviderInfo[]> {
  return json(`${API}/planner/providers`);
}

export async function fetchCLIUsageProviders(): Promise<CLIUsageSnapshot[]> {
  return json(`${API}/cli-usage/providers`);
}

export async function refreshCLIUsageProviders(): Promise<CLIUsageSnapshot[]> {
  return json(`${API}/cli-usage/refresh`, { method: 'POST' });
}

export async function fetchCLIUsageSnapshots(): Promise<CLIUsageSnapshot[]> {
  return json(`${API}/cli-usage/snapshots`);
}

export async function fetchCLIUsageHistory(providerId?: CLIProviderId, limit = 100): Promise<CLIUsageTrendPoint[]> {
  const params = new URLSearchParams();
  if (providerId) params.set('providerId', providerId);
  params.set('limit', String(limit));
  return json(`${API}/cli-usage/history?${params}`);
}

export async function fetchCLIProbeEvents(providerId?: CLIProviderId, limit = 50): Promise<CLIProbeEvent[]> {
  const params = new URLSearchParams();
  if (providerId) params.set('providerId', providerId);
  params.set('limit', String(limit));
  return json(`${API}/cli-usage/events?${params}`);
}

export async function fetchCLIUsageProvider(providerId: CLIProviderId): Promise<CLIUsageSnapshot> {
  return json(`${API}/cli-usage/providers/${providerId}`);
}

export async function refreshCLIUsageProvider(providerId: CLIProviderId): Promise<CLIUsageSnapshot> {
  return json(`${API}/cli-usage/providers/${providerId}/refresh`, { method: 'POST' });
}

export async function updateCLIUsageSettings(
  providerId: CLIProviderId,
  settings: Partial<ProviderProbePermission>,
): Promise<ProviderProbePermission> {
  return json(`${API}/cli-usage/providers/${providerId}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export async function fetchOscorpexCLIUsage(): Promise<Record<CLIProviderId, OscorpexUsageSnapshot>> {
  return json(`${API}/cli-usage/oscorpex`);
}
