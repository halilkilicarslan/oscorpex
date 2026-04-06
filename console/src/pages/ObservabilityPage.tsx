import { useState, useEffect } from 'react';
import {
  Activity,
  Clock,
  BarChart3,
  Coins,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { subscribeToTraces, clearTraces } from '../lib/traceStore';
import type { Trace, Span } from '../lib/traceStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '--';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status, size = 14 }: { status: Trace['status']; size?: number }) {
  if (status === 'success') {
    return <CheckCircle2 size={size} className="text-[#22c55e] shrink-0" />;
  }
  if (status === 'error') {
    return <XCircle size={size} className="text-[#ef4444] shrink-0" />;
  }
  return <Loader2 size={size} className="text-[#f59e0b] animate-spin shrink-0" />;
}

// ---------------------------------------------------------------------------
// Span type badge
// ---------------------------------------------------------------------------

const SPAN_COLORS: Record<Span['type'], string> = {
  agent: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
  llm: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20',
  tool: 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20',
};

const SPAN_BAR_COLORS: Record<Span['type'], string> = {
  agent: 'bg-[#22c55e]',
  llm: 'bg-[#3b82f6]',
  tool: 'bg-[#a855f7]',
};

function SpanTypeBadge({ type }: { type: Span['type'] }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${SPAN_COLORS[type]}`}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Span timeline row
// ---------------------------------------------------------------------------

function SpanRow({ span, traceStart, traceDuration }: {
  span: Span;
  traceStart: number;
  traceDuration: number;
}) {
  const offsetMs = span.startTime - traceStart;
  const spanDuration = span.duration ?? (Date.now() - span.startTime);
  const totalMs = traceDuration > 0 ? traceDuration : 1;

  const leftPct = Math.min((offsetMs / totalMs) * 100, 95);
  const widthPct = Math.max((spanDuration / totalMs) * 100, 1);

  return (
    <div className="flex items-center gap-3 py-1.5 px-3 hover:bg-[#1a1a1a] rounded-lg transition-colors">
      {/* Left: name + badge */}
      <div className="flex items-center gap-2 w-48 shrink-0">
        <SpanTypeBadge type={span.type} />
        <span className="text-[12px] text-[#a3a3a3] truncate">{span.name}</span>
      </div>

      {/* Center: mini timeline bar */}
      <div className="flex-1 h-4 bg-[#1f1f1f] rounded-full relative overflow-hidden">
        <div
          className={`absolute top-1 h-2 rounded-full opacity-80 ${SPAN_BAR_COLORS[span.type]}`}
          style={{
            left: `${leftPct}%`,
            width: `${Math.min(widthPct, 100 - leftPct)}%`,
          }}
        />
      </div>

      {/* Right: duration + status */}
      <div className="flex items-center gap-2 shrink-0 w-24 justify-end">
        <span className="text-[11px] text-[#525252] font-mono">{fmtDuration(span.duration)}</span>
        <StatusIcon status={span.status} size={12} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trace row (expandable)
// ---------------------------------------------------------------------------

function TraceRow({ trace }: { trace: Trace }) {
  const [expanded, setExpanded] = useState(false);

  const tokenStr = trace.totalTokens != null
    ? trace.totalTokens.toLocaleString()
    : trace.inputTokens != null || trace.outputTokens != null
    ? ((trace.inputTokens ?? 0) + (trace.outputTokens ?? 0)).toLocaleString()
    : '--';

  return (
    <div className="border border-[#1f1f1f] rounded-xl overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#141414] transition-colors text-left"
      >
        {/* Expand chevron */}
        <span className="text-[#525252] shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Status */}
        <StatusIcon status={trace.status} />

        {/* Trace ID */}
        <span className="font-mono text-[11px] text-[#525252] w-20 shrink-0">
          {shortId(trace.id)}
        </span>

        {/* Agent */}
        <span className="text-[12px] text-[#fafafa] font-medium flex-1 truncate">
          {trace.agentName}
        </span>

        {/* Duration */}
        <span className="text-[12px] text-[#a3a3a3] font-mono w-20 text-right shrink-0">
          {fmtDuration(trace.duration)}
        </span>

        {/* Spans */}
        <span className="text-[12px] text-[#525252] w-16 text-right shrink-0">
          {trace.spans.length} span{trace.spans.length !== 1 ? 's' : ''}
        </span>

        {/* Tokens */}
        <span className="text-[12px] text-[#525252] w-16 text-right shrink-0 font-mono">
          {tokenStr}
        </span>

        {/* Timestamp */}
        <span className="text-[11px] text-[#525252] w-20 text-right shrink-0">
          {fmtTime(trace.startTime)}
        </span>
      </button>

      {/* Expanded span timeline */}
      {expanded && (
        <div className="border-t border-[#1f1f1f] bg-[#0d0d0d] px-2 py-2">
          {trace.spans.length === 0 ? (
            <p className="text-[12px] text-[#525252] px-3 py-2">No spans recorded.</p>
          ) : (
            trace.spans.map((span) => (
              <SpanRow
                key={span.id}
                span={span}
                traceStart={trace.startTime}
                traceDuration={trace.duration ?? (Date.now() - trace.startTime)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
}

function StatCard({ label, value, icon, sub }: StatCardProps) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-[#525252] font-medium">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-[#1f1f1f] flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-[#fafafa]">{value}</span>
        {sub && <span className="text-[11px] text-[#525252] font-medium mb-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ObservabilityPage() {
  const [traces, setTraces] = useState<Trace[]>([]);

  // Subscribe to trace store changes
  useEffect(() => {
    const unsubscribe = subscribeToTraces((updated) => {
      setTraces(updated);
    });
    return unsubscribe;
  }, []);

  // Derived stats
  const totalTraces = traces.length;

  const completedTraces = traces.filter((t) => t.status !== 'running');

  const avgLatency: string = (() => {
    const withDuration = completedTraces.filter((t) => t.duration !== undefined);
    if (withDuration.length === 0) return '--';
    const avg = withDuration.reduce((sum, t) => sum + (t.duration ?? 0), 0) / withDuration.length;
    return fmtDuration(Math.round(avg));
  })();

  const successRate: string = (() => {
    if (completedTraces.length === 0) return '--';
    const successes = completedTraces.filter((t) => t.status === 'success').length;
    return `${Math.round((successes / completedTraces.length) * 100)}%`;
  })();

  const totalTokens: string = (() => {
    const anyHasTokens = traces.some(
      (t) => t.totalTokens != null || t.inputTokens != null || t.outputTokens != null,
    );
    if (!anyHasTokens) return '--';
    const sum = traces.reduce((acc, t) => {
      if (t.totalTokens != null) return acc + t.totalTokens;
      return acc + (t.inputTokens ?? 0) + (t.outputTokens ?? 0);
    }, 0);
    return sum.toLocaleString();
  })();

  return (
    <div className="p-6 max-w-6xl">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#fafafa]">Observability</h1>
          <p className="text-sm text-[#737373] mt-1">
            Monitor agent execution traces and performance metrics
          </p>
        </div>
        {traces.length > 0 && (
          <button
            onClick={clearTraces}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[#525252] border border-[#262626] hover:border-[#333] hover:text-[#a3a3a3] transition-colors"
          >
            <Trash2 size={13} />
            Clear traces
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Traces"
          value={String(totalTraces)}
          icon={<Activity size={16} className="text-[#22c55e]" />}
        />
        <StatCard
          label="Avg Latency"
          value={avgLatency}
          icon={<Clock size={16} className="text-[#3b82f6]" />}
        />
        <StatCard
          label="Success Rate"
          value={successRate}
          icon={<BarChart3 size={16} className="text-[#a855f7]" />}
        />
        <StatCard
          label="Total Tokens"
          value={totalTokens}
          icon={<Coins size={16} className="text-[#f59e0b]" />}
        />
      </div>

      {/* Trace list */}
      {traces.length === 0 ? (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-4">
            <BarChart3 size={28} className="text-[#333]" />
          </div>
          <h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">No traces yet</h3>
          <p className="text-[13px] text-[#525252] max-w-sm">
            Start chatting with your agents to generate traces. They will appear here with
            detailed execution timelines.
          </p>
        </div>
      ) : (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1f1f1f] bg-[#0d0d0d]">
            <span className="w-4 shrink-0" />
            <span className="w-4 shrink-0" />
            <span className="text-[11px] text-[#525252] font-medium w-20 shrink-0">Trace ID</span>
            <span className="text-[11px] text-[#525252] font-medium flex-1">Agent</span>
            <span className="text-[11px] text-[#525252] font-medium w-20 text-right shrink-0">Duration</span>
            <span className="text-[11px] text-[#525252] font-medium w-16 text-right shrink-0">Spans</span>
            <span className="text-[11px] text-[#525252] font-medium w-16 text-right shrink-0">Tokens</span>
            <span className="text-[11px] text-[#525252] font-medium w-20 text-right shrink-0">Time</span>
          </div>

          {/* Trace rows */}
          <div className="p-2 flex flex-col gap-1">
            {traces.map((trace) => (
              <TraceRow key={trace.id} trace={trace} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
