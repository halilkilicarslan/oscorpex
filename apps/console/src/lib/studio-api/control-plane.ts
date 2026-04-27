// ---------------------------------------------------------------------------
// Studio API — Control Plane client
// ---------------------------------------------------------------------------

import { json } from './base.js';
import type {
  ApprovalRequest,
  AuditEvent,
  SecurityEvent,
  Incident,
  AgentInstance,
  ProviderRuntime,
  ControlPlaneSummary,
} from '../../types/control-plane.js';

const API = '';

export async function fetchControlPlaneSummary(): Promise<{
  summary: ControlPlaneSummary;
  approvals: { pendingCount: number; expiredCount: number; escalatedCount: number; byKind: Record<string, number> };
  runtime: { onlineCount: number; degradedCount: number; cooldownCount: number; offlineCount: number; providerDetails: Array<{ providerId: string; state: string; lastSeenAt: string | null }> };
}> {
  return json(`${API}/api/studio/summary`);
}

export async function fetchApprovals(status?: string): Promise<{ approvals: ApprovalRequest[] }> {
  const qs = status ? `?status=${status}` : '';
  return json(`${API}/api/studio/approvals${qs}`);
}

export async function approveRequest(id: string): Promise<{ approval: ApprovalRequest }> {
  return json(`${API}/api/studio/approvals/${id}/approve`, { method: 'POST' });
}

export async function rejectRequest(id: string): Promise<{ approval: ApprovalRequest }> {
  return json(`${API}/api/studio/approvals/${id}/reject`, { method: 'POST' });
}

export async function fetchAuditEvents(filters?: { category?: string; severity?: string }): Promise<{ events: AuditEvent[] }> {
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.severity) params.set('severity', filters.severity);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return json(`${API}/api/studio/audit${qs}`);
}

export async function fetchSecurityEvents(): Promise<{ events: SecurityEvent[] }> {
  return json(`${API}/api/studio/security-events`);
}

export async function fetchIncidents(status?: string): Promise<{ incidents: Incident[] }> {
  const qs = status ? `?status=${status}` : '';
  return json(`${API}/api/studio/incidents${qs}`);
}

export async function ackIncident(id: string): Promise<{ incident: Incident }> {
  return json(`${API}/api/studio/incidents/${id}/ack`, { method: 'POST' });
}

export async function resolveIncident(id: string): Promise<{ incident: Incident }> {
  return json(`${API}/api/studio/incidents/${id}/resolve`, { method: 'POST' });
}

export async function fetchRegistryAgents(): Promise<{ agents: AgentInstance[] }> {
  return json(`${API}/api/studio/registry/agents`);
}

export async function fetchRegistryProviders(): Promise<{ providers: ProviderRuntime[] }> {
  return json(`${API}/api/studio/registry/providers`);
}

export async function fetchProjectCost(projectId: string, days = 30): Promise<{
  rollup: Array<{ project_id: string; provider_id: string; task_count: string; token_input: string; token_output: string; total_tokens: string; cost_usd: string }>;
  budget: { projectId: string; spentUsd: number; maxBudgetUsd: number | null; remainingUsd: number | null; alertFired: boolean } | undefined;
}> {
  return json(`${API}/api/studio/cost/projects/${projectId}?days=${days}`);
}
