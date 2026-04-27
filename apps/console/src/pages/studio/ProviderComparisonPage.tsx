import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BadgeDollarSign,
  ChevronDown,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  fetchProviderLatency,
  fetchProviderRecords,
  type ProviderLatencySnapshot,
  type ProviderExecutionTelemetry,
} from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComparisonRow {
  providerId: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  failureRate: number;
  fallbackRate: number;
  timeoutRate: number;
  costScore: number;
}

// ---------------------------------------------------------------------------
// Cost scores (mirror of kernel model-router)
// ---------------------------------------------------------------------------

const COST_SCORES: Record<string, number> = {
  'gpt-4o-mini': 1,
  'gemini-1.5-flash': 1,
  'gemini-2.0-flash': 1,
  'claude-haiku-4-5-20251001': 2,
  'cursor-small': 2,
  'gpt-4o': 5,
  'gemini-1.5-pro': 5,
  'claude-sonnet-4-6': 6,
  'cursor-large': 6,
  o3: 8,
  'claude-opus-4-6': 10,
};

function getCostScore(providerId: string): number {
  // Map provider id to a representative model cost score
  const mapping: Record<string, string> = {
    'claude-code': 'claude-sonnet-4-6',
    codex: 'gpt-4o',
    cursor: 'cursor-large',
    gemini: 'gemini-1.5-pro',
    ollama: 'llama3.2',
  };
  return COST_SCORES[mapping[providerId] ?? ''] ?? 5;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function FastestBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] text-[#22c55e]">
      <Zap size={10} />
      Fastest
    </span>
  );
}

function CheapestBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-2 py-0.5 text-[10px] text-[#3b82f6]">
      <BadgeDollarSign size={10} />
      Cheapest
    </span>
  );
}

function MostReliableBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] text-[#22c55e]">
      <ShieldCheck size={10} />
      Reliable
    </span>
  );
}

function NoisyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-2 py-0.5 text-[10px] text-[#f59e0b]">
      <ShieldAlert size={10} />
      Noisy
    </span>
  );
}

// ---------------------------------------------------------------------------
// Metric cell
// ---------------------------------------------------------------------------

function MetricCell({
  value,
  unit,
  highlight,
  warn,
}: {
  value: string;
  unit?: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="text-right">
      <span
        className={`text-[13px] font-medium ${
          highlight ? 'text-[#22c55e]' : warn ? 'text-[#ef4444]' : 'text-[#fafafa]'
        }`}
      >
        {value}
      </span>
      {unit && <span className="ml-1 text-[10px] text-[#525252]">{unit}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProviderComparisonPage() {
  const [latency, setLatency] = useState<ProviderLatencySnapshot[]>([]);
  const [records, setRecords] = useState<ProviderExecutionTelemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    try {
      const [latencyData, recordsData] = await Promise.all([
        fetchProviderLatency(),
        fetchProviderRecords(500),
      ]);
      setLatency(latencyData.providers);
      setRecords(recordsData.records);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  // Build comparison rows
  const rows: ComparisonRow[] = useMemo(() => {
    const providerRecords = new Map<string, ProviderExecutionTelemetry[]>();
    for (const r of records) {
      const pid = r.finalProvider ?? r.primaryProvider;
      const list = providerRecords.get(pid) ?? [];
      list.push(r);
      providerRecords.set(pid, list);
    }

    return latency.map((snap) => {
      const prs = providerRecords.get(snap.providerId) ?? [];
      const total = snap.totalExecutions;
      const fallbackCount = prs.filter((r) => r.fallbackCount > 0).length;
      const timeoutCount = prs.filter((r) => r.errorClassification === 'timeout').length;

      return {
        providerId: snap.providerId,
        avgLatencyMs: snap.averageLatencyMs,
        p95LatencyMs: snap.p95LatencyMs,
        totalExecutions: total,
        successfulExecutions: snap.successfulExecutions,
        failedExecutions: snap.failedExecutions,
        failureRate: total > 0 ? (snap.failedExecutions / total) * 100 : 0,
        fallbackRate: prs.length > 0 ? (fallbackCount / prs.length) * 100 : 0,
        timeoutRate: prs.length > 0 ? (timeoutCount / prs.length) * 100 : 0,
        costScore: getCostScore(snap.providerId),
      };
    });
  }, [latency, records]);

  const filteredRows = useMemo(() => {
    if (providerFilter === 'all') return rows;
    return rows.filter((r) => r.providerId === providerFilter);
  }, [rows, providerFilter]);

  // Compute badges
  const fastestProvider = useMemo(() => {
    if (rows.length === 0) return undefined;
    return rows.reduce((best, r) => (r.avgLatencyMs < best.avgLatencyMs ? r : best));
  }, [rows]);

  const cheapestProvider = useMemo(() => {
    if (rows.length === 0) return undefined;
    return rows.reduce((best, r) => (r.costScore < best.costScore ? r : best));
  }, [rows]);

  const mostReliableProvider = useMemo(() => {
    if (rows.length === 0) return undefined;
    return rows.reduce((best, r) => (r.failureRate < best.failureRate ? r : best));
  }, [rows]);

  const noisiestProvider = useMemo(() => {
    if (rows.length === 0) return undefined;
    return rows.reduce((worst, r) => (r.failureRate > worst.failureRate ? r : worst));
  }, [rows]);

  const providerIds = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.providerId))).sort();
  }, [rows]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#525252]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0a0a0a] p-6 text-[#fafafa]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Provider Comparison</h1>
          <p className="mt-1 text-[13px] text-[#737373]">
            Side-by-side provider performance, cost, and reliability metrics.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-[#a3a3a3] hover:border-[#333] hover:text-[#fafafa]"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {/* Badge summary */}
      {rows.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {fastestProvider && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2">
              <FastestBadge />
              <span className="text-[12px] text-[#a3a3a3]">{fastestProvider.providerId}</span>
              <span className="text-[11px] text-[#525252]">{formatDuration(fastestProvider.avgLatencyMs)}</span>
            </div>
          )}
          {cheapestProvider && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2">
              <CheapestBadge />
              <span className="text-[12px] text-[#a3a3a3]">{cheapestProvider.providerId}</span>
            </div>
          )}
          {mostReliableProvider && mostReliableProvider.failureRate < 10 && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2">
              <MostReliableBadge />
              <span className="text-[12px] text-[#a3a3a3]">{mostReliableProvider.providerId}</span>
              <span className="text-[11px] text-[#525252]">{formatPercent(mostReliableProvider.failureRate)} fail</span>
            </div>
          )}
          {noisiestProvider && noisiestProvider.failureRate > 20 && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2">
              <NoisyBadge />
              <span className="text-[12px] text-[#a3a3a3]">{noisiestProvider.providerId}</span>
              <span className="text-[11px] text-[#525252]">{formatPercent(noisiestProvider.failureRate)} fail</span>
            </div>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative">
          <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#525252]" />
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="appearance-none rounded-xl border border-[#262626] bg-[#0a0a0a] py-1.5 pl-7 pr-6 text-[11px] text-[#a3a3a3] focus:border-[#22c55e] focus:outline-none"
          >
            <option value="all">All providers</option>
            {providerIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
        </div>
      </div>

      {/* Comparison table */}
      <div className="rounded-3xl border border-[#262626] bg-[#111111] overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#262626] text-[10px] uppercase tracking-wider text-[#525252]">
              <th className="px-5 py-3 font-medium">Provider</th>
              <th className="px-5 py-3 font-medium text-right">Avg Latency</th>
              <th className="px-5 py-3 font-medium text-right">P95 Latency</th>
              <th className="px-5 py-3 font-medium text-right">Failure Rate</th>
              <th className="px-5 py-3 font-medium text-right">Fallback Rate</th>
              <th className="px-5 py-3 font-medium text-right">Timeout Rate</th>
              <th className="px-5 py-3 font-medium text-right">Cost Score</th>
              <th className="px-5 py-3 font-medium text-right">Runs</th>
              <th className="px-5 py-3 font-medium">Badges</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1f1f1f]">
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center text-[#737373]">
                  No provider data available.
                </td>
              </tr>
            )}
            {filteredRows.map((row) => {
              const isFastest = fastestProvider?.providerId === row.providerId;
              const isCheapest = cheapestProvider?.providerId === row.providerId;
              const isMostReliable = mostReliableProvider?.providerId === row.providerId;
              const isNoisiest = noisiestProvider?.providerId === row.providerId && row.failureRate > 20;

              return (
                <tr key={row.providerId} className="transition-colors hover:bg-[#141414]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[#fafafa]">{row.providerId}</span>
                      <ArrowUpRight size={12} className="text-[#525252]" />
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <MetricCell
                      value={formatDuration(row.avgLatencyMs)}
                      highlight={isFastest}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <MetricCell value={formatDuration(row.p95LatencyMs)} />
                  </td>
                  <td className="px-5 py-3">
                    <MetricCell
                      value={formatPercent(row.failureRate)}
                      warn={row.failureRate > 20}
                      highlight={isMostReliable}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <MetricCell
                      value={formatPercent(row.fallbackRate)}
                      warn={row.fallbackRate > 30}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <MetricCell
                      value={formatPercent(row.timeoutRate)}
                      warn={row.timeoutRate > 15}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <MetricCell
                      value={String(row.costScore)}
                      highlight={isCheapest}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-right text-[13px] text-[#fafafa]">{row.totalExecutions}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {isFastest && <FastestBadge />}
                      {isCheapest && <CheapestBadge />}
                      {isMostReliable && row.failureRate < 10 && <MostReliableBadge />}
                      {isNoisiest && <NoisyBadge />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty state helper */}
      {rows.length === 0 && !loading && (
        <div className="mt-8 rounded-2xl border border-[#262626] bg-[#111111] p-8 text-center">
          <Gauge size={32} className="mx-auto mb-3 text-[#333]" />
          <h3 className="text-[14px] font-medium text-[#a3a3a3]">No telemetry data yet</h3>
          <p className="mt-1 text-[12px] text-[#525252]">
            Execute some tasks to populate provider comparison metrics.
          </p>
        </div>
      )}
    </div>
  );
}
