import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  fetchProviderLatency,
  fetchProviderRecords,
  type ProviderExecutionTelemetry,
  type ProviderLatencySnapshot,
  type ProviderErrorClassification,
} from '../../lib/studio-api';

type StatusFilter = 'all' | 'success' | 'failure';
type ProviderFilter = 'all' | string;

const CLASSIFICATION_LABELS: Record<ProviderErrorClassification, string> = {
  unavailable: 'Unavailable',
  timeout: 'Timeout',
  rate_limited: 'Rate Limited',
  killed: 'Killed',
  tool_restriction_unsupported: 'Tool Restriction',
  cli_error: 'CLI Error',
  spawn_failure: 'Spawn Failure',
  unknown: 'Unknown',
};

const CLASSIFICATION_STYLES: Record<ProviderErrorClassification, string> = {
  unavailable: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  timeout: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/20',
  rate_limited: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  killed: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
  tool_restriction_unsupported: 'text-[#a3a3a3] bg-[#1f1f1f] border-[#262626]',
  cli_error: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
  spawn_failure: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
  unknown: 'text-[#737373] bg-[#1f1f1f] border-[#262626]',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function SuccessBadge({ success }: { success: boolean }) {
  if (success) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] text-[#22c55e]">
        <CheckCircle2 size={10} />
        success
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#ef4444]/20 bg-[#ef4444]/10 px-2 py-0.5 text-[10px] text-[#ef4444]">
      <XCircle size={10} />
      failed
    </span>
  );
}

function ClassificationBadge({ classification }: { classification?: ProviderErrorClassification }) {
  if (!classification) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${CLASSIFICATION_STYLES[classification]}`}>
      {CLASSIFICATION_LABELS[classification]}
    </span>
  );
}

function LatencyCard({ snapshot }: { snapshot: ProviderLatencySnapshot }) {
  const successRate = snapshot.totalExecutions > 0
    ? Math.round((snapshot.successfulExecutions / snapshot.totalExecutions) * 100)
    : 0;

  return (
    <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f1f1f] text-[#22c55e]">
            <Zap size={16} />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#fafafa]">{snapshot.providerId}</div>
            <div className="text-[10px] text-[#525252]">{snapshot.totalExecutions} runs</div>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${successRate >= 90 ? 'border-[#22c55e]/20 text-[#22c55e] bg-[#22c55e]/10' : successRate >= 70 ? 'border-[#f59e0b]/20 text-[#f59e0b] bg-[#f59e0b]/10' : 'border-[#ef4444]/20 text-[#ef4444] bg-[#ef4444]/10'}`}>
          {successRate}% success
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Avg latency</div>
          <div className="text-[#fafafa] font-medium">{formatDuration(snapshot.averageLatencyMs)}</div>
        </div>
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">P95 latency</div>
          <div className="text-[#fafafa] font-medium">{formatDuration(snapshot.p95LatencyMs)}</div>
        </div>
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Successful</div>
          <div className="text-[#22c55e]">{snapshot.successfulExecutions}</div>
        </div>
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Failed</div>
          <div className="text-[#ef4444]">{snapshot.failedExecutions}</div>
        </div>
      </div>

      {snapshot.lastFailureAt && (
        <div className="mt-3 flex items-center gap-2 text-[10px] text-[#525252]">
          <AlertTriangle size={10} className="text-[#f59e0b]" />
          Last failure: {formatDateTime(snapshot.lastFailureAt)}
          {snapshot.lastFailureClassification && (
            <ClassificationBadge classification={snapshot.lastFailureClassification} />
          )}
        </div>
      )}
    </div>
  );
}

function RecordDrawer({
  record,
  onClose,
}: {
  record: ProviderExecutionTelemetry;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l border-[#262626] bg-[#0a0a0a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-[16px] font-semibold text-[#fafafa]">Execution Detail</h2>
            <p className="mt-1 text-[11px] text-[#525252]">{record.runId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-[#525252] hover:bg-[#1f1f1f] hover:text-[#a3a3a3]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-2">
            <SuccessBadge success={record.success} />
            {record.errorClassification && <ClassificationBadge classification={record.errorClassification} />}
            {record.degradedMode && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-2 py-0.5 text-[10px] text-[#f59e0b]">
                <ShieldAlert size={10} />
                degraded
              </span>
            )}
            {record.canceled && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#ef4444]/20 bg-[#ef4444]/10 px-2 py-0.5 text-[10px] text-[#ef4444]">
                <X size={10} />
                canceled
              </span>
            )}
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
              <div className="text-[#525252]">Task</div>
              <div className="mt-1 text-[#fafafa] truncate">{record.taskId}</div>
            </div>
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
              <div className="text-[#525252]">Latency</div>
              <div className="mt-1 text-[#fafafa]">{formatDuration(record.latencyMs)}</div>
            </div>
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
              <div className="text-[#525252]">Primary</div>
              <div className="mt-1 text-[#fafafa]">{record.primaryProvider}</div>
            </div>
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
              <div className="text-[#525252]">Final</div>
              <div className="mt-1 text-[#fafafa]">{record.finalProvider ?? '—'}</div>
            </div>
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
              <div className="text-[#525252]">Started</div>
              <div className="mt-1 text-[#fafafa]">{formatDateTime(record.startedAt)}</div>
            </div>
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
              <div className="text-[#525252]">Completed</div>
              <div className="mt-1 text-[#fafafa]">{record.completedAt ? formatDateTime(record.completedAt) : '—'}</div>
            </div>
          </div>

          {/* Fallback timeline */}
          {record.fallbackTimeline.length > 0 && (
            <div className="rounded-2xl border border-[#262626] bg-[#111111]">
              <div className="flex items-center gap-2 border-b border-[#262626] px-4 py-3">
                <ArrowRightLeft size={14} className="text-[#22c55e]" />
                <span className="text-[12px] font-medium text-[#fafafa]">Fallback Timeline</span>
                <span className="ml-auto text-[10px] text-[#525252]">{record.fallbackCount} hop(s)</span>
              </div>
              <div className="divide-y divide-[#1f1f1f]">
                {record.fallbackTimeline.map((entry, index) => (
                  <div key={index} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#525252]">{entry.fromProvider}</span>
                        <ArrowRightLeft size={10} className="text-[#333]" />
                        <span className="text-[#fafafa]">{entry.toProvider}</span>
                      </div>
                      <span className="text-[10px] text-[#525252]">{formatDuration(entry.latencyMs)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-[#737373]">{entry.reason}</span>
                      <ClassificationBadge classification={entry.errorClassification} />
                    </div>
                    <div className="mt-1 text-[10px] text-[#525252]">{formatDateTime(entry.timestamp)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error message */}
          {record.errorMessage && (
            <div className="rounded-2xl border border-[#ef4444]/20 bg-[#ef4444]/5 p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[#ef4444]">
                <AlertTriangle size={14} />
                Error
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-[#ef4444]/80 font-mono leading-relaxed">
                {record.errorMessage}
              </pre>
            </div>
          )}

          {/* Degraded message */}
          {record.degradedMessage && (
            <div className="rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/5 p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[#f59e0b]">
                <ShieldAlert size={14} />
                Degraded
              </div>
              <p className="mt-2 text-[11px] text-[#f59e0b]/80">{record.degradedMessage}</p>
            </div>
          )}

          {/* Cancel reason */}
          {record.cancelReason && (
            <div className="rounded-2xl border border-[#ef4444]/20 bg-[#ef4444]/5 p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[#ef4444]">
                <X size={14} />
                Canceled
              </div>
              <p className="mt-2 text-[11px] text-[#ef4444]/80">{record.cancelReason}</p>
            </div>
          )}

          {/* Retry reason */}
          {record.retryReason && (
            <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[#fafafa]">
                <RefreshCw size={14} />
                Retry Reason
              </div>
              <p className="mt-2 text-[11px] text-[#737373]">{record.retryReason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProviderTelemetryPage() {
  const [latency, setLatency] = useState<ProviderLatencySnapshot[]>([]);
  const [records, setRecords] = useState<ProviderExecutionTelemetry[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [selectedRecord, setSelectedRecord] = useState<ProviderExecutionTelemetry | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [latencyData, recordsData] = await Promise.all([
        fetchProviderLatency(),
        fetchProviderRecords(100),
      ]);
      setLatency(latencyData.providers);
      setRecords(recordsData.records);
      setTotalRecords(recordsData.total);
    } catch {
      // silently fail — page shows empty states
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

  const handleFilterChange = async (status: StatusFilter, provider: ProviderFilter) => {
    const success = status === 'all' ? undefined : status === 'success';
    const providerId = provider === 'all' ? undefined : provider;
    try {
      const data = await fetchProviderRecords(100, providerId, success);
      setRecords(data.records);
      setTotalRecords(data.total);
    } catch {
      // ignore
    }
  };

  const filteredRecords = useMemo(() => {
    // Server already filters; this is for local safety if needed.
    return records;
  }, [records]);

  const providerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of records) {
      ids.add(r.finalProvider ?? r.primaryProvider);
    }
    return Array.from(ids).sort();
  }, [records]);

  const totalRuns = latency.reduce((sum, p) => sum + p.totalExecutions, 0);
  const totalSuccess = latency.reduce((sum, p) => sum + p.successfulExecutions, 0);
  const totalFailed = latency.reduce((sum, p) => sum + p.failedExecutions, 0);
  const avgLatency = latency.length > 0
    ? Math.round(latency.reduce((sum, p) => sum + p.averageLatencyMs, 0) / latency.length)
    : 0;

  // TASK 13: Performance metrics
  const avgQueueWait = records.length > 0
    ? Math.round(records.reduce((sum, r) => sum + (r.queueWaitMs ?? 0), 0) / records.length)
    : 0;
  const fallbackRate = totalRuns > 0
    ? Math.round((records.filter((r) => r.fallbackCount > 0).length / records.length) * 100)
    : 0;
  const timeoutRate = totalRuns > 0
    ? Math.round((records.filter((r) => r.errorClassification === 'timeout').length / records.length) * 100)
    : 0;

  const topSlowProviders = useMemo(() => {
    return [...latency]
      .sort((a, b) => b.averageLatencyMs - a.averageLatencyMs)
      .slice(0, 5);
  }, [latency]);

  const topFailureClassifications = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      if (r.errorClassification) {
        counts.set(r.errorClassification, (counts.get(r.errorClassification) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [records]);

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
          <h1 className="text-xl font-semibold">Provider Telemetry</h1>
          <p className="mt-1 text-[13px] text-[#737373]">
            Per-provider execution latency, fallback chains, and failure classification.
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

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Total runs</div>
          <div className="mt-2 text-2xl font-bold">{totalRuns}</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Successful</div>
          <div className="mt-2 text-2xl font-bold text-[#22c55e]">{totalSuccess}</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Failed</div>
          <div className="mt-2 text-2xl font-bold text-[#ef4444]">{totalFailed}</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Avg latency</div>
          <div className="mt-2 text-2xl font-bold">{formatDuration(avgLatency)}</div>
        </div>
      </div>

      {/* Performance summary cards (TASK 13) */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Avg queue wait</div>
          <div className="mt-2 text-2xl font-bold">{formatDuration(avgQueueWait)}</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Fallback rate</div>
          <div className="mt-2 text-2xl font-bold text-[#f59e0b]">{fallbackRate}%</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Timeout rate</div>
          <div className="mt-2 text-2xl font-bold text-[#f97316]">{timeoutRate}%</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Cooldown active</div>
          <div className="mt-2 text-2xl font-bold text-[#ef4444]">
            {latency.filter((p) => p.lastFailureAt && !p.lastFailureClassification?.includes('success')).length}
          </div>
        </div>
      </div>

      {/* Latency cards */}
      {latency.length > 0 && (
        <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {latency.map((snapshot) => (
            <LatencyCard key={snapshot.providerId} snapshot={snapshot} />
          ))}
        </div>
      )}

      {/* Top slow providers & failure classifications (TASK 13) */}
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {topSlowProviders.length > 0 && (
          <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#fafafa]">
              <Gauge size={14} className="text-[#f59e0b]" />
              Top Slow Providers
            </div>
            <div className="space-y-2">
              {topSlowProviders.map((p) => (
                <div key={p.providerId} className="flex items-center justify-between text-[11px]">
                  <span className="text-[#a3a3a3]">{p.providerId}</span>
                  <span className="text-[#f59e0b]">{formatDuration(p.averageLatencyMs)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {topFailureClassifications.length > 0 && (
          <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#fafafa]">
              <AlertTriangle size={14} className="text-[#ef4444]" />
              Top Failure Classifications
            </div>
            <div className="space-y-2">
              {topFailureClassifications.map(([classification, count]) => (
                <div key={classification} className="flex items-center justify-between text-[11px]">
                  <ClassificationBadge classification={classification as ProviderErrorClassification} />
                  <span className="text-[#ef4444]">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Records table */}
      <div className="rounded-3xl border border-[#262626] bg-[#111111]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] px-5 py-4">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-[#22c55e]" />
            <span className="text-[14px] font-semibold text-[#fafafa]">Execution Records</span>
            <span className="text-[11px] text-[#525252]">({totalRecords})</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Provider filter */}
            <div className="relative">
              <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#525252]" />
              <select
                value={providerFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setProviderFilter(val);
                  handleFilterChange(statusFilter, val);
                }}
                className="appearance-none rounded-xl border border-[#262626] bg-[#0a0a0a] py-1.5 pl-7 pr-6 text-[11px] text-[#a3a3a3] focus:border-[#22c55e] focus:outline-none"
              >
                <option value="all">All providers</option>
                {providerIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
            </div>

            {/* Status filter */}
            <div className="relative">
              <Gauge size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#525252]" />
              <select
                value={statusFilter}
                onChange={(e) => {
                  const val = e.target.value as StatusFilter;
                  setStatusFilter(val);
                  handleFilterChange(val, providerFilter);
                }}
                className="appearance-none rounded-xl border border-[#262626] bg-[#0a0a0a] py-1.5 pl-7 pr-6 text-[11px] text-[#a3a3a3] focus:border-[#22c55e] focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#262626] text-[10px] uppercase tracking-wider text-[#525252]">
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="px-5 py-3 font-medium">Latency</th>
                <th className="px-5 py-3 font-medium">Fallbacks</th>
                <th className="px-5 py-3 font-medium">Started</th>
                <th className="px-5 py-3 font-medium">Classification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f1f]">
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[#737373]">
                    No execution records found.
                  </td>
                </tr>
              )}
              {filteredRecords.map((record) => (
                <tr
                  key={`${record.runId}:${record.taskId}`}
                  className="cursor-pointer transition-colors hover:bg-[#141414]"
                  onClick={() => setSelectedRecord(record)}
                >
                  <td className="px-5 py-3">
                    <SuccessBadge success={record.success} />
                    {record.degradedMode && (
                      <span className="ml-1 inline-flex items-center rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-1.5 py-0.5 text-[9px] text-[#f59e0b]">
                        deg
                      </span>
                    )}
                    {record.canceled && (
                      <span className="ml-1 inline-flex items-center rounded-full border border-[#ef4444]/20 bg-[#ef4444]/10 px-1.5 py-0.5 text-[9px] text-[#ef4444]">
                        can
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[#fafafa]">{record.finalProvider ?? record.primaryProvider}</td>
                  <td className="px-5 py-3 text-[#a3a3a3] truncate max-w-[160px]">{record.taskId}</td>
                  <td className="px-5 py-3 text-[#a3a3a3]">{formatDuration(record.latencyMs)}</td>
                  <td className="px-5 py-3 text-[#a3a3a3]">{record.fallbackCount}</td>
                  <td className="px-5 py-3 text-[#a3a3a3]">{formatTime(record.startedAt)}</td>
                  <td className="px-5 py-3">
                    {record.errorClassification ? (
                      <ClassificationBadge classification={record.errorClassification} />
                    ) : (
                      <span className="text-[#525252]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedRecord && <RecordDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    </div>
  );
}
