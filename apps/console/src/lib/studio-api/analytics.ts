import type {
  ProjectAnalytics,
  AgentAnalytics,
  ActivityTimeline,
  ProjectCostSummary,
  CostBreakdownEntry,
} from './types.js';
import { API, json } from './base.js';

export async function fetchProjectAnalytics(projectId: string): Promise<ProjectAnalytics> {
  return json(`${API}/projects/${projectId}/analytics/overview`);
}

export async function fetchAgentAnalytics(projectId: string): Promise<AgentAnalytics[]> {
  return json(`${API}/projects/${projectId}/analytics/agents`);
}

export async function fetchActivityTimeline(projectId: string, days = 7): Promise<ActivityTimeline[]> {
  return json(`${API}/projects/${projectId}/analytics/timeline?days=${days}`);
}

export async function fetchProjectCosts(projectId: string): Promise<ProjectCostSummary> {
  return json(`${API}/projects/${projectId}/costs`);
}

export async function fetchCostBreakdown(projectId: string): Promise<CostBreakdownEntry[]> {
  return json(`${API}/projects/${projectId}/costs/breakdown`);
}

export interface ContextMetricsResponse {
  metrics: {
    totalSources: number;
    totalChunks: number;
    codeChunks: number;
    proseChunks: number;
    searchCalls: number;
    searchHits: number;
    totalEvents: number;
    eventsByCategory: Record<string, number>;
    estimatedTokensIndexed: number;
  };
  perTask: Array<{
    taskId: string;
    taskTitle: string;
    sourceLabel: string;
    chunkCount: number;
    codeChunkCount: number;
    indexedAt: string;
  }>;
}

export async function fetchContextMetrics(projectId: string): Promise<ContextMetricsResponse> {
  return json(`${API}/projects/${projectId}/analytics/context`);
}

// ---------------------------------------------------------------------------
// v4.1: Agent Dashboard v2
// ---------------------------------------------------------------------------

export interface AgentHeatMapCell {
  agentId: string;
  agentName: string;
  date: string;
  value: number;
}

export interface AgentPerformancePoint {
  date: string;
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed: number;
  costUsd: number;
  avgTaskTimeMs: number;
}

export interface AgentComparisonEntry {
  agentId: string;
  agentName: string;
  role: string;
  avatar: string;
  score: number;
  tasksCompleted: number;
  avgTaskTimeMs: number;
  firstPassRate: number;
  costPerTask: number;
}

export async function fetchAgentHeatMap(projectId: string, days = 14): Promise<AgentHeatMapCell[]> {
  const res = await json<{ data: AgentHeatMapCell[] }>(`${API}/projects/${projectId}/analytics/agents/heatmap?days=${days}`);
  return res.data;
}

export async function fetchAgentTimeline(projectId: string, agentId: string, days = 14): Promise<AgentPerformancePoint[]> {
  const res = await json<{ data: AgentPerformancePoint[] }>(`${API}/projects/${projectId}/analytics/agents/${agentId}/timeline?days=${days}`);
  return res.data;
}

export async function fetchAgentComparison(projectId: string): Promise<AgentComparisonEntry[]> {
  const res = await json<{ data: AgentComparisonEntry[] }>(`${API}/projects/${projectId}/analytics/agents/comparison`);
  return res.data;
}

// ---------------------------------------------------------------------------
// v4.1: RAG Observability
// ---------------------------------------------------------------------------

export interface SearchLogEntry {
  id: string;
  projectId: string;
  queryText: string;
  resultCount: number;
  topRank: number | null;
  latencyMs: number;
  sourceFilter: string | null;
  contentType: string | null;
  createdAt: string;
}

export interface SearchObservabilityData {
  totalSearches: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  avgLatencyMs: number;
  avgResultCount: number;
  avgTopRank: number;
  recentSearches: SearchLogEntry[];
  hourlyBreakdown: Array<{ hour: string; searches: number; hits: number; avgLatency: number }>;
}

export async function fetchSearchObservability(projectId: string, days = 7): Promise<SearchObservabilityData> {
  return json(`${API}/projects/${projectId}/analytics/context/observability?days=${days}`);
}
