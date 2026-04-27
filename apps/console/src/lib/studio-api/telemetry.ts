import {
  type ProviderExecutionTelemetry,
  type ProviderLatencySnapshot,
} from './types.js';
import { API, json } from './base.js';

export async function fetchProviderLatency(): Promise<{ providers: ProviderLatencySnapshot[] }> {
  return json(`${API}/telemetry/providers/latency`);
}

export async function fetchProviderRecords(
  limit = 50,
  provider?: string,
  success?: boolean,
): Promise<{ total: number; records: ProviderExecutionTelemetry[] }> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (provider) params.set('provider', provider);
  if (success !== undefined) params.set('success', String(success));
  return json(`${API}/telemetry/providers/records?${params}`);
}

export async function fetchProviderRecord(
  runId: string,
  taskId: string,
): Promise<{ record: ProviderExecutionTelemetry }> {
  return json(`${API}/telemetry/providers/records/${encodeURIComponent(runId)}/${encodeURIComponent(taskId)}`);
}
