import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Loader2, RefreshCw, CheckCircle2, XCircle, DollarSign, Activity, TrendingUp, FileText, Clock, Database, Code2, FileSearch } from 'lucide-react';
import { fetchContextMetrics, type ContextMetricsResponse } from '../../lib/studio-api/analytics.js';
import { SearchObservability } from './SearchObservability';

const ComplexityPieChart = lazy(() => import('./charts/ComplexityPieChart'));

const BASE = import.meta.env.VITE_API_BASE ?? '';

interface ReportData {
  summary: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalCostUsd: number;
    durationMs?: number;
  };
  quality: {
    reviewPassRate: number;
    avgRevisions: number;
    firstPassRate: number;
  };
  topChangedFiles: { path: string; changeCount: number }[];
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}

function StatCard({ label, value, sub, icon, accent = '#22c55e' }: StatCardProps) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#737373] uppercase tracking-wider">{label}</span>
        <span style={{ color: accent }} className="opacity-70">{icon}</span>
      </div>
      <div>
        <span className="text-[26px] font-bold text-[#fafafa] leading-none">{value}</span>
        {sub && <span className="ml-2 text-[11px] text-[#525252]">{sub}</span>}
      </div>
    </div>
  );
}

interface MetricRowProps {
  label: string;
  value: string | number;
  bar?: number;
  color?: string;
}

function MetricRow({ label, value, bar, color = '#22c55e' }: MetricRowProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-t border-[#1a1a1a] first:border-0">
      <span className="text-[12px] text-[#a3a3a3] w-48 shrink-0">{label}</span>
      <span className="text-[13px] font-semibold text-[#fafafa] w-20 text-right">{value}</span>
      {bar !== undefined && (
        <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(bar, 100)}%`, backgroundColor: color }}
          />
        </div>
      )}
    </div>
  );
}

export default function ProjectReport({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [ctxMetrics, setCtxMetrics] = useState<ContextMetricsResponse | null>(null);
  const [complexityDist, setComplexityDist] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [reportRes, ctxRes, tasksRes] = await Promise.all([
        fetch(`${BASE}/api/studio/projects/${projectId}/report`).then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
          return d as ReportData;
        }),
        fetchContextMetrics(projectId).then((r) => r?.metrics ? r : null).catch(() => null),
        fetch(`${BASE}/api/studio/projects/${projectId}/tasks`)
          .then((r) => r.ok ? r.json() : { tasks: [] })
          .catch(() => ({ tasks: [] })),
      ]);
      setReport(reportRes);
      setCtxMetrics(ctxRes);

      // Compute complexity distribution from tasks
      const tasks: Array<{ complexity?: string }> = Array.isArray(tasksRes)
        ? tasksRes
        : (tasksRes.tasks ?? []);
      const dist: Record<string, number> = {};
      for (const t of tasks) {
        if (t.complexity) dist[t.complexity] = (dist[t.complexity] ?? 0) + 1;
      }
      setComplexityDist(dist);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-[13px] text-[#ef4444]">{error}</p>
        <button
          onClick={() => load()}
          className="text-[12px] text-[#525252] hover:text-[#a3a3a3] underline transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const completionRate = report && report.summary.totalTasks > 0
    ? Math.round((report.summary.completedTasks / report.summary.totalTasks) * 100)
    : 0;

  const failRate = report && report.summary.totalTasks > 0
    ? Math.round((report.summary.failedTasks / report.summary.totalTasks) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-5 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Project Report</h2>
          <p className="text-[11px] text-[#525252] mt-0.5">Summary metrics and quality indicators</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414] border border-[#262626] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Tasks"
          value={report?.summary.totalTasks ?? 0}
          sub={`${completionRate}% complete`}
          icon={<Activity size={16} />}
          accent="#22c55e"
        />
        <StatCard
          label="Completed"
          value={report?.summary.completedTasks ?? 0}
          sub={`${report?.summary.totalTasks ?? 0} total`}
          icon={<CheckCircle2 size={16} />}
          accent="#3b82f6"
        />
        <StatCard
          label="Failed"
          value={report?.summary.failedTasks ?? 0}
          sub={failRate > 0 ? `${failRate}% failure rate` : undefined}
          icon={<XCircle size={16} />}
          accent="#ef4444"
        />
        <StatCard
          label="Total Cost"
          value={`$${(report?.summary.totalCostUsd ?? 0).toFixed(4)}`}
          sub={report?.summary.durationMs ? formatDuration(report.summary.durationMs) : undefined}
          icon={<DollarSign size={16} />}
          accent="#10b981"
        />
      </div>

      {/* Duration card */}
      {report?.summary.durationMs && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex items-center gap-3">
          <Clock size={16} className="text-[#f59e0b]" />
          <div>
            <p className="text-[11px] text-[#737373] uppercase tracking-wider">Total Duration</p>
            <p className="text-[20px] font-bold text-[#fafafa]">{formatDuration(report.summary.durationMs)}</p>
          </div>
        </div>
      )}

      {/* Quality metrics */}
      <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
          <TrendingUp size={14} className="text-[#22c55e]" />
          <h3 className="text-[12px] font-semibold text-[#fafafa]">Quality Metrics</h3>
        </div>
        {(() => {
          const reviewPct = Math.round((report?.quality.reviewPassRate ?? 0) * 100);
          const firstPct = Math.round((report?.quality.firstPassRate ?? 0) * 100);
          return (
            <>
              <MetricRow
                label="Review Pass Rate"
                value={`${reviewPct}%`}
                bar={reviewPct}
                color={reviewPct >= 80 ? '#22c55e' : reviewPct >= 50 ? '#f59e0b' : '#ef4444'}
              />
              <MetricRow
                label="First Pass Rate"
                value={`${firstPct}%`}
                bar={firstPct}
                color={firstPct >= 80 ? '#22c55e' : firstPct >= 50 ? '#f59e0b' : '#ef4444'}
              />
            </>
          );
        })()}
        <MetricRow
          label="Avg Revisions per Task"
          value={(report?.quality.avgRevisions ?? 0).toFixed(1)}
        />
        <MetricRow
          label="Task Completion Rate"
          value={`${completionRate}%`}
          bar={completionRate}
          color={completionRate >= 80 ? '#22c55e' : completionRate >= 50 ? '#f59e0b' : '#ef4444'}
        />
      </div>

      {/* Complexity Distribution */}
      {Object.keys(complexityDist).length > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-[#f59e0b]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Task Complexity Distribution</h3>
            <span className="ml-auto text-[10px] text-[#525252]">
              {Object.values(complexityDist).reduce((a, b) => a + b, 0)} tasks
            </span>
          </div>
          <Suspense fallback={<div className="h-[220px] animate-pulse bg-[#1a1a1a] rounded-lg" />}>
            <ComplexityPieChart data={complexityDist} />
          </Suspense>
        </div>
      )}

      {/* Top changed files */}
      {(report?.topChangedFiles?.length ?? 0) > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <FileText size={14} className="text-[#60a5fa]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Top Changed Files</h3>
            <span className="ml-auto text-[10px] text-[#525252]">{report!.topChangedFiles.length} files</span>
          </div>
          <div>
            {report!.topChangedFiles.map((file, i) => {
              const max = report!.topChangedFiles[0]?.changeCount ?? 1;
              const pct = (file.changeCount / max) * 100;
              return (
                <div
                  key={file.path}
                  className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1a1a1a] first:border-0 hover:bg-[#141414] transition-colors"
                >
                  <span className="text-[10px] text-[#525252] w-5 shrink-0">{i + 1}</span>
                  <span className="text-[11px] text-[#a3a3a3] font-mono flex-1 truncate">{file.path}</span>
                  <div className="w-24 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden shrink-0">
                    <div
                      className="h-1.5 rounded-full bg-[#3b82f6] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-[#525252] w-8 text-right shrink-0">{file.changeCount}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Context Efficiency (v4.0) */}
      {ctxMetrics?.metrics && ctxMetrics.metrics.totalChunks > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <Database size={14} className="text-[#a78bfa]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Context Efficiency</h3>
            <span className="ml-auto text-[10px] text-[#525252]">
              {ctxMetrics.metrics.totalSources} sources indexed
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1a1a1a]">
            <div className="bg-[#111111] p-3">
              <p className="text-[10px] text-[#525252] uppercase tracking-wider">Total Chunks</p>
              <p className="text-[18px] font-bold text-[#fafafa] mt-1">{ctxMetrics.metrics.totalChunks}</p>
            </div>
            <div className="bg-[#111111] p-3">
              <div className="flex items-center gap-1">
                <Code2 size={10} className="text-[#60a5fa]" />
                <p className="text-[10px] text-[#525252] uppercase tracking-wider">Code Chunks</p>
              </div>
              <p className="text-[18px] font-bold text-[#fafafa] mt-1">{ctxMetrics.metrics.codeChunks}</p>
            </div>
            <div className="bg-[#111111] p-3">
              <div className="flex items-center gap-1">
                <FileSearch size={10} className="text-[#22c55e]" />
                <p className="text-[10px] text-[#525252] uppercase tracking-wider">Tokens Indexed</p>
              </div>
              <p className="text-[18px] font-bold text-[#fafafa] mt-1">
                {ctxMetrics.metrics.estimatedTokensIndexed.toLocaleString()}
              </p>
            </div>
            <div className="bg-[#111111] p-3">
              <p className="text-[10px] text-[#525252] uppercase tracking-wider">Session Events</p>
              <p className="text-[18px] font-bold text-[#fafafa] mt-1">{ctxMetrics.metrics.totalEvents}</p>
            </div>
          </div>

          {ctxMetrics.perTask.length > 0 && (
            <div className="border-t border-[#1a1a1a]">
              <div className="px-4 py-2">
                <p className="text-[10px] text-[#525252] uppercase tracking-wider">Indexed Tasks</p>
              </div>
              {ctxMetrics.perTask.slice(0, 10).map((t) => (
                <div
                  key={t.sourceLabel}
                  className="flex items-center gap-3 px-4 py-2 border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors"
                >
                  <span className="text-[11px] text-[#a3a3a3] flex-1 truncate">{t.taskTitle}</span>
                  <span className="text-[10px] text-[#525252] shrink-0">
                    {t.chunkCount} chunks ({t.codeChunkCount} code)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* v4.1: RAG Observability */}
      <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
          <FileSearch size={14} className="text-[#22c55e]" />
          <h3 className="text-[12px] font-semibold text-[#fafafa]">Arama Kalitesi (RAG Observability)</h3>
        </div>
        <div className="p-4">
          <SearchObservability projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
