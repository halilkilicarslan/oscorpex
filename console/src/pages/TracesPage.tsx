import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  Clock,
  BarChart3,
  Coins,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  Search,
  Filter,
  X,
  Cpu,
  Wrench,
  Bot,
  AlertCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// API taban URL
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3141/api/observability';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type TraceStatus = 'success' | 'error' | 'running';
type SpanType = 'agent' | 'llm' | 'tool';

interface ApiTrace {
  trace_id: string;
  root_span_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
  start_time: string;
  end_time: string | null;
  span_count: number;
  duration_ms: number | null;
  status: TraceStatus;
  total_tokens: number | null;
}

interface ApiSpan {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  entity_id: string | null;
  name: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
  status_code: number;
  status_message: string | null;
  span_type: SpanType;
  llm_model: string | null;
  tool_name: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  input: string | null;
  output: string | null;
  attributes: Record<string, unknown>;
}

interface TraceStats {
  totalTraces: number;
  avgDurationMs: number | null;
  errorRate: number;
  totalTokens: number;
  topAgents: { name: string; count: number }[];
}

interface TraceDetail {
  trace: ApiTrace;
  spans: ApiSpan[];
}

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// Span'ları parent->child ağacına düzenle
function buildSpanTree(spans: ApiSpan[]): ApiSpan[] {
  const byId = new Map<string, ApiSpan>(spans.map((s) => [s.span_id, s]));
  const roots: ApiSpan[] = [];
  const children = new Map<string, ApiSpan[]>();

  for (const span of spans) {
    if (span.parent_span_id && byId.has(span.parent_span_id)) {
      const list = children.get(span.parent_span_id) ?? [];
      list.push(span);
      children.set(span.parent_span_id, list);
    } else {
      roots.push(span);
    }
  }

  const result: Array<{ span: ApiSpan; depth: number }> = [];

  function walk(span: ApiSpan, depth: number) {
    result.push({ span, depth });
    const kids = children.get(span.span_id) ?? [];
    kids.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    for (const kid of kids) walk(kid, depth + 1);
  }

  roots.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  for (const root of roots) walk(root, 0);

  // Düzleştirilmiş span'ları (depth bilgisi attribute olarak) dön
  return result.map(({ span, depth }) => ({ ...span, _depth: depth } as ApiSpan & { _depth: number }));
}

// ---------------------------------------------------------------------------
// Renk sabitler
// ---------------------------------------------------------------------------

const SPAN_BADGE: Record<SpanType, string> = {
  agent: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
  llm: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20',
  tool: 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20',
};

const SPAN_BAR: Record<SpanType, string> = {
  agent: 'bg-[#22c55e]',
  llm: 'bg-[#3b82f6]',
  tool: 'bg-[#a855f7]',
};

// ---------------------------------------------------------------------------
// Status ikonları
// ---------------------------------------------------------------------------

function StatusIcon({ status, size = 14 }: { status: TraceStatus; size?: number }) {
  if (status === 'success') return <CheckCircle2 size={size} className="text-[#22c55e] shrink-0" />;
  if (status === 'error') return <XCircle size={size} className="text-[#ef4444] shrink-0" />;
  return <Loader2 size={size} className="text-[#f59e0b] animate-spin shrink-0" />;
}

// ---------------------------------------------------------------------------
// Span tip ikonu
// ---------------------------------------------------------------------------

function SpanTypeIcon({ type, size = 12 }: { type: SpanType; size?: number }) {
  if (type === 'llm') return <Cpu size={size} />;
  if (type === 'tool') return <Wrench size={size} />;
  return <Bot size={size} />;
}

// ---------------------------------------------------------------------------
// Stat kartı
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
// Trace satırı (sol panel)
// ---------------------------------------------------------------------------

function TraceListRow({
  trace,
  selected,
  onClick,
}: {
  trace: ApiTrace;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        selected
          ? 'bg-[#1a1a1a] border border-[#333]'
          : 'hover:bg-[#141414] border border-transparent'
      }`}
    >
      {/* Status */}
      <StatusIcon status={trace.status} size={13} />

      {/* Agent adı + entity badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#fafafa] font-medium truncate">
            {trace.entity_id ?? 'unknown'}
          </span>
          {trace.entity_type && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#525252] border border-[#2a2a2a] shrink-0">
              {trace.entity_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-[#525252] font-mono">{shortId(trace.trace_id)}</span>
          <span className="text-[#3a3a3a]">·</span>
          <span className="text-[11px] text-[#525252]">{trace.span_count} span{trace.span_count !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Sağ bilgiler */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-[12px] text-[#a3a3a3] font-mono">{fmtDuration(trace.duration_ms)}</span>
        <span className="text-[11px] text-[#525252]">{fmtRelativeTime(trace.start_time)}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Waterfall span satırı (sağ panel)
// ---------------------------------------------------------------------------

function WaterfallRow({
  span,
  depth,
  traceStartMs,
  traceDurationMs,
  selected,
  onClick,
}: {
  span: ApiSpan;
  depth: number;
  traceStartMs: number;
  traceDurationMs: number;
  selected: boolean;
  onClick: () => void;
}) {
  const spanStartMs = new Date(span.start_time).getTime();
  const spanDurationMs = span.duration_ms ?? 0;
  const totalMs = traceDurationMs > 0 ? traceDurationMs : 1;

  const offsetPct = Math.min(((spanStartMs - traceStartMs) / totalMs) * 100, 95);
  const widthPct = Math.max((spanDurationMs / totalMs) * 100, 1);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors ${
        selected ? 'bg-[#1f1f1f]' : 'hover:bg-[#161616]'
      }`}
    >
      {/* Indent + tip ikonu */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        style={{ paddingLeft: `${depth * 16}px`, width: `${140 + depth * 16}px` }}
      >
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${SPAN_BADGE[span.span_type]}`}>
          <SpanTypeIcon type={span.span_type} size={10} />
          {span.span_type}
        </span>
        <span className="text-[11px] text-[#a3a3a3] truncate">
          {span.tool_name ?? (span.name.includes(':') ? span.name.split(':')[1] : span.name)}
        </span>
      </div>

      {/* Waterfall bar */}
      <div className="flex-1 h-5 bg-[#1a1a1a] rounded relative overflow-hidden">
        <div
          className={`absolute top-1 h-3 rounded-sm opacity-80 ${SPAN_BAR[span.span_type]}`}
          style={{
            left: `${offsetPct}%`,
            width: `${Math.min(widthPct, 100 - offsetPct)}%`,
          }}
        />
      </div>

      {/* Süre + status */}
      <div className="flex items-center gap-2 shrink-0 w-24 justify-end">
        <span className="text-[11px] text-[#525252] font-mono">{fmtDuration(span.duration_ms)}</span>
        {span.status_code === 2 ? (
          <XCircle size={11} className="text-[#ef4444]" />
        ) : (
          <CheckCircle2 size={11} className="text-[#22c55e]" />
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Span detay paneli
// ---------------------------------------------------------------------------

function SpanDetail({ span }: { span: ApiSpan }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="border-t border-[#1f1f1f] bg-[#0d0d0d] p-4 space-y-4">
      {/* Başlık satırı */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${SPAN_BADGE[span.span_type]}`}>
            <SpanTypeIcon type={span.span_type} size={11} />
            {span.span_type}
          </span>
          <span className="text-[13px] text-[#fafafa] font-medium">{span.name}</span>
        </div>
        <span className="text-[12px] font-mono text-[#a3a3a3]">{fmtDuration(span.duration_ms)}</span>
      </div>

      {/* Temel bilgiler */}
      <div className="grid grid-cols-2 gap-3">
        {span.llm_model && (
          <div>
            <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">Model</p>
            <p className="text-[12px] text-[#a3a3a3] font-mono">{span.llm_model}</p>
          </div>
        )}
        {span.total_tokens !== null && (
          <div>
            <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">Tokens</p>
            <p className="text-[12px] text-[#a3a3a3] font-mono">
              {span.prompt_tokens ?? 0} + {span.completion_tokens ?? 0} = {span.total_tokens}
            </p>
          </div>
        )}
        {span.tool_name && (
          <div>
            <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">Tool</p>
            <p className="text-[12px] text-[#a3a3a3]">{span.tool_name}</p>
          </div>
        )}
        {span.status_message && (
          <div className="col-span-2">
            <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">Status</p>
            <p className="text-[12px] text-[#ef4444]">{span.status_message}</p>
          </div>
        )}
      </div>

      {/* Input */}
      {span.input && (
        <div>
          <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1.5">Input</p>
          <pre className="text-[11px] text-[#a3a3a3] bg-[#111] border border-[#1f1f1f] rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap break-words">
            {span.input}
          </pre>
        </div>
      )}

      {/* Output */}
      {span.output && (
        <div>
          <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1.5">Output</p>
          <pre className="text-[11px] text-[#a3a3a3] bg-[#111] border border-[#1f1f1f] rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap break-words">
            {span.output}
          </pre>
        </div>
      )}

      {/* Raw attributes toggle */}
      <button
        onClick={() => setShowRaw((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
      >
        {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Raw attributes
      </button>
      {showRaw && (
        <pre className="text-[10px] text-[#525252] bg-[#111] border border-[#1f1f1f] rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap break-words">
          {JSON.stringify(span.attributes, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trace detay paneli — waterfall
// ---------------------------------------------------------------------------

function TraceDetailPanel({ traceId }: { traceId: string }) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSelectedSpanId(null);

    fetch(`${API_BASE}/traces/${traceId}`)
      .then((r) => r.json())
      .then((data) => setDetail(data as TraceDetail))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#525252]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle size={24} className="text-[#ef4444]" />
          <p className="text-[13px] text-[#ef4444]">Failed to load trace</p>
          <p className="text-[11px] text-[#525252]">{error}</p>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const { trace, spans } = detail;
  const traceStartMs = new Date(trace.start_time).getTime();
  const traceDurationMs = trace.duration_ms ?? 0;

  // Span ağacını düzenle
  const treeSpans = buildSpanTree(spans) as Array<ApiSpan & { _depth: number }>;

  const selectedSpan = selectedSpanId ? spans.find((s) => s.span_id === selectedSpanId) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Trace header */}
      <div className="px-4 py-3 border-b border-[#1f1f1f] bg-[#0d0d0d] flex items-center gap-4">
        <StatusIcon status={trace.status} size={16} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[#fafafa]">
              {trace.entity_id ?? 'unknown'}
            </span>
            <span className="text-[11px] text-[#525252] font-mono">{shortId(trace.trace_id)}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-[#525252]">{fmtDuration(trace.duration_ms)}</span>
            <span className="text-[#3a3a3a]">·</span>
            <span className="text-[11px] text-[#525252]">{trace.span_count} spans</span>
            {trace.total_tokens && (
              <>
                <span className="text-[#3a3a3a]">·</span>
                <span className="text-[11px] text-[#525252]">{trace.total_tokens.toLocaleString()} tokens</span>
              </>
            )}
          </div>
        </div>
        <span className="text-[11px] text-[#525252]">{fmtRelativeTime(trace.start_time)}</span>
      </div>

      {/* Waterfall */}
      <div className="flex-1 overflow-auto">
        {/* Kolon başlıkları */}
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#1a1a1a] sticky top-0 bg-[#0d0d0d] z-10">
          <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wider" style={{ width: 156 }}>
            Span
          </span>
          <span className="flex-1 text-[10px] text-[#525252] font-medium uppercase tracking-wider">
            Timeline
          </span>
          <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wider w-24 text-right">
            Duration
          </span>
        </div>

        <div className="p-2">
          {treeSpans.length === 0 ? (
            <p className="text-[12px] text-[#525252] px-2 py-4 text-center">No spans recorded</p>
          ) : (
            treeSpans.map((span) => (
              <div key={span.span_id}>
                <WaterfallRow
                  span={span}
                  depth={(span as ApiSpan & { _depth: number })._depth}
                  traceStartMs={traceStartMs}
                  traceDurationMs={traceDurationMs}
                  selected={selectedSpanId === span.span_id}
                  onClick={() =>
                    setSelectedSpanId((prev) => (prev === span.span_id ? null : span.span_id))
                  }
                />
                {selectedSpanId === span.span_id && selectedSpan && (
                  <SpanDetail span={selectedSpan} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio Trace tipler
// ---------------------------------------------------------------------------

interface StudioTrace {
  trace_id: string;
  entity_id: string;
  entity_type: string;
  title: string;
  start_time: string;
  end_time: string | null;
  status: TraceStatus;
  duration_ms: number | null;
  complexity: string;
  task_type: string;
  branch: string;
  output: string | null;
  error: string | null;
  span_count: number;
  spans: Array<{
    span_id: string;
    name: string;
    status: string;
    start_time: string | null;
    end_time: string | null;
    duration_ms: number | null;
    exit_code: number | null;
    output_summary: string | null;
  }>;
}

interface StudioTracesResponse {
  traces: StudioTrace[];
  total: number;
  agents: string[];
}

type TraceSource = 'voltagent' | 'studio';

// ---------------------------------------------------------------------------
// Studio trace list row
// ---------------------------------------------------------------------------

function StudioTraceListRow({
  trace,
  selected,
  onClick,
}: {
  trace: StudioTrace;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        selected
          ? 'bg-[#1a1a1a] border border-[#333]'
          : 'hover:bg-[#141414] border border-transparent'
      }`}
    >
      <StatusIcon status={trace.status} size={13} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#fafafa] font-medium truncate">
            {trace.title}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#525252] border border-[#2a2a2a] shrink-0">
            {trace.task_type}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-[#a855f7] font-medium">{trace.entity_id}</span>
          <span className="text-[#3a3a3a]">·</span>
          <span className="text-[11px] text-[#525252]">{trace.complexity}</span>
          {trace.branch && (
            <>
              <span className="text-[#3a3a3a]">·</span>
              <span className="text-[11px] text-[#525252] font-mono truncate max-w-[120px]">{trace.branch}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-[12px] text-[#a3a3a3] font-mono">{fmtDuration(trace.duration_ms)}</span>
        <span className="text-[11px] text-[#525252]">{fmtRelativeTime(trace.start_time)}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Studio trace detail panel
// ---------------------------------------------------------------------------

function StudioTraceDetailPanel({ traceId }: { traceId: string }) {
  const [detail, setDetail] = useState<{ trace: ApiTrace & { title?: string }; spans: ApiSpan[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSelectedSpanId(null);

    fetch(`${API_BASE}/studio/traces/${traceId}`)
      .then((r) => r.json())
      .then((data) => setDetail(data as { trace: ApiTrace & { title?: string }; spans: ApiSpan[] }))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#525252]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle size={24} className="text-[#ef4444]" />
          <p className="text-[13px] text-[#ef4444]">Failed to load trace</p>
          <p className="text-[11px] text-[#525252]">{error}</p>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const { trace, spans } = detail;
  const traceStartMs = new Date(trace.start_time).getTime();
  const traceDurationMs = trace.duration_ms ?? 0;
  const treeSpans = buildSpanTree(spans) as Array<ApiSpan & { _depth: number }>;
  const selectedSpan = selectedSpanId ? spans.find((s) => s.span_id === selectedSpanId) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1f1f1f] bg-[#0d0d0d] flex items-center gap-4">
        <StatusIcon status={trace.status} size={16} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[#fafafa]">
              {(trace as ApiTrace & { title?: string }).title ?? trace.entity_id ?? 'unknown'}
            </span>
            <span className="text-[11px] text-[#525252] font-mono">{shortId(trace.trace_id)}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-[#a855f7] font-medium">{trace.entity_id}</span>
            <span className="text-[#3a3a3a]">·</span>
            <span className="text-[11px] text-[#525252]">{fmtDuration(trace.duration_ms)}</span>
            <span className="text-[#3a3a3a]">·</span>
            <span className="text-[11px] text-[#525252]">{trace.span_count} spans</span>
          </div>
        </div>
        <span className="text-[11px] text-[#525252]">{fmtRelativeTime(trace.start_time)}</span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#1a1a1a] sticky top-0 bg-[#0d0d0d] z-10">
          <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wider" style={{ width: 156 }}>Span</span>
          <span className="flex-1 text-[10px] text-[#525252] font-medium uppercase tracking-wider">Timeline</span>
          <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wider w-24 text-right">Duration</span>
        </div>
        <div className="p-2">
          {treeSpans.length === 0 ? (
            <p className="text-[12px] text-[#525252] px-2 py-4 text-center">No spans recorded</p>
          ) : (
            treeSpans.map((span) => (
              <div key={span.span_id}>
                <WaterfallRow
                  span={span}
                  depth={(span as ApiSpan & { _depth: number })._depth}
                  traceStartMs={traceStartMs}
                  traceDurationMs={traceDurationMs}
                  selected={selectedSpanId === span.span_id}
                  onClick={() => setSelectedSpanId((prev) => (prev === span.span_id ? null : span.span_id))}
                />
                {selectedSpanId === span.span_id && selectedSpan && <SpanDetail span={selectedSpan} />}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ana TracesPage bileşeni
// ---------------------------------------------------------------------------

export default function TracesPage() {
  const [source, setSource] = useState<TraceSource>('voltagent');
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [traces, setTraces] = useState<ApiTrace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Studio traces state
  const [studioStats, setStudioStats] = useState<TraceStats | null>(null);
  const [studioTraces, setStudioTraces] = useState<StudioTrace[]>([]);
  const [studioTotal, setStudioTotal] = useState(0);
  const [studioAgents, setStudioAgents] = useState<string[]>([]);
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);

  // Filtreler
  const [entityFilter, setEntityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Seçili trace
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  // Pagination
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // Tüm agent ID listesi (filtre dropdown için)
  const agentIds = source === 'voltagent'
    ? (stats?.topAgents.map((a) => a.name) ?? [])
    : studioAgents;

  // ---------------------------------------------------------------------------
  // Source değişince state sıfırla
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setSelectedTraceId(null);
    setEntityFilter('');
    setStatusFilter('');
    setSearch('');
    setOffset(0);
  }, [source]);

  // ---------------------------------------------------------------------------
  // VoltAgent Stats yükleme
  // ---------------------------------------------------------------------------

  const loadStats = useCallback(() => {
    fetch(`${API_BASE}/traces/stats`)
      .then((r) => r.json())
      .then((data) => setStats(data as TraceStats))
      .catch(console.error);
  }, []);

  // ---------------------------------------------------------------------------
  // VoltAgent Trace listesi yükleme
  // ---------------------------------------------------------------------------

  const loadTraces = useCallback(() => {
    if (source !== 'voltagent') return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set('limit', String(LIMIT));
    params.set('offset', String(offset));
    if (entityFilter) params.set('entity_id', entityFilter);
    if (statusFilter) params.set('status', statusFilter);

    fetch(`${API_BASE}/traces?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        const resp = data as { traces: ApiTrace[]; total: number };
        setTraces(resp.traces);
        setTotal(resp.total);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [offset, entityFilter, statusFilter, source]);

  // ---------------------------------------------------------------------------
  // Studio Stats yükleme
  // ---------------------------------------------------------------------------

  const loadStudioStats = useCallback(() => {
    fetch(`${API_BASE}/studio/traces/stats`)
      .then((r) => r.json())
      .then((data) => setStudioStats(data as TraceStats))
      .catch(console.error);
  }, []);

  // ---------------------------------------------------------------------------
  // Studio Trace listesi yükleme
  // ---------------------------------------------------------------------------

  const loadStudioTraces = useCallback(() => {
    if (source !== 'studio') return;
    setStudioLoading(true);
    setStudioError(null);

    const params = new URLSearchParams();
    params.set('limit', String(LIMIT));
    params.set('offset', String(offset));
    if (entityFilter) params.set('agent', entityFilter);
    if (statusFilter) params.set('status', statusFilter);

    fetch(`${API_BASE}/studio/traces?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        const resp = data as StudioTracesResponse;
        setStudioTraces(resp.traces);
        setStudioTotal(resp.total);
        setStudioAgents(resp.agents);
      })
      .catch((e) => setStudioError(String(e)))
      .finally(() => setStudioLoading(false));
  }, [offset, entityFilter, statusFilter, source]);

  useEffect(() => {
    loadStats();
    loadStudioStats();
  }, [loadStats, loadStudioStats]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    loadStudioTraces();
  }, [loadStudioTraces]);

  // Filtre değişince offset sıfırla
  const prevFilters = useRef({ entityFilter, statusFilter });
  useEffect(() => {
    if (
      prevFilters.current.entityFilter !== entityFilter ||
      prevFilters.current.statusFilter !== statusFilter
    ) {
      setOffset(0);
      prevFilters.current = { entityFilter, statusFilter };
    }
  }, [entityFilter, statusFilter]);

  // ---------------------------------------------------------------------------
  // Arama — client-side
  // ---------------------------------------------------------------------------

  const filteredTraces = search
    ? traces.filter(
        (t) =>
          (t.entity_id ?? '').toLowerCase().includes(search.toLowerCase()) ||
          t.trace_id.toLowerCase().includes(search.toLowerCase()),
      )
    : traces;

  const filteredStudioTraces = search
    ? studioTraces.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.entity_id.toLowerCase().includes(search.toLowerCase()) ||
          t.trace_id.toLowerCase().includes(search.toLowerCase()),
      )
    : studioTraces;

  // Active source helpers
  const activeStats = source === 'voltagent' ? stats : studioStats;
  const activeLoading = source === 'voltagent' ? loading : studioLoading;
  const activeError = source === 'voltagent' ? error : studioError;
  const activeTotal = source === 'voltagent' ? total : studioTotal;
  const activeLoad = source === 'voltagent' ? loadTraces : loadStudioTraces;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Sayfa başlığı + tab toggle */}
      <div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
        <h1 className="text-[15px] font-semibold text-[#fafafa]">Traces</h1>
        <p className="text-[13px] text-[#525252] mt-0.5">
          Execution traces recorded by VoltAgent observability
        </p>
        <div className="flex items-center gap-1 mt-3">
          <button
            onClick={() => setSource('voltagent')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              source === 'voltagent'
                ? 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30'
                : 'text-[#525252] hover:text-[#a3a3a3] border border-transparent'
            }`}
          >
            VoltAgent Traces
          </button>
          <button
            onClick={() => setSource('studio')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              source === 'studio'
                ? 'bg-[#a855f7]/15 text-[#a855f7] border border-[#a855f7]/30'
                : 'text-[#525252] hover:text-[#a3a3a3] border border-transparent'
            }`}
          >
            Studio Traces
          </button>
        </div>
      </div>

      {/* Stats satırı */}
      {activeStats && (
        <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-[#1a1a1a] shrink-0">
          <StatCard
            label="Total Traces"
            value={String(activeStats.totalTraces)}
            icon={<Activity size={15} className={source === 'voltagent' ? 'text-[#22c55e]' : 'text-[#a855f7]'} />}
          />
          <StatCard
            label="Avg Duration"
            value={fmtDuration(activeStats.avgDurationMs)}
            icon={<Clock size={15} className="text-[#3b82f6]" />}
          />
          <StatCard
            label="Error Rate"
            value={`${activeStats.errorRate}%`}
            icon={<BarChart3 size={15} className="text-[#a855f7]" />}
          />
          <StatCard
            label={source === 'voltagent' ? 'Total Tokens' : 'Top Agents'}
            value={
              source === 'voltagent'
                ? (activeStats.totalTokens > 0 ? activeStats.totalTokens.toLocaleString() : '--')
                : String(activeStats.topAgents.length)
            }
            icon={<Coins size={15} className="text-[#f59e0b]" />}
          />
        </div>
      )}

      {/* Split panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sol panel — Trace listesi */}
        <div className="w-[40%] min-w-[300px] border-r border-[#1a1a1a] flex flex-col overflow-hidden">
          {/* Filtre çubuğu */}
          <div className="px-3 py-2 border-b border-[#1a1a1a] space-y-2 shrink-0">
            {/* Arama */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#525252]" />
              <input
                type="text"
                placeholder="Search by agent or trace ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 bg-[#111111] border border-[#262626] rounded-md text-[12px] text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#333] transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#a3a3a3]"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Dropdown filtreler */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#525252]" />
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 bg-[#111111] border border-[#262626] rounded-md text-[12px] text-[#a3a3a3] focus:outline-none focus:border-[#333] transition-colors appearance-none"
                >
                  <option value="">All agents</option>
                  {agentIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-[#111111] border border-[#262626] rounded-md text-[12px] text-[#a3a3a3] focus:outline-none focus:border-[#333] transition-colors appearance-none"
              >
                <option value="">All status</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="running">Running</option>
              </select>
            </div>
          </div>

          {/* Trace listesi */}
          <div className="flex-1 overflow-auto">
            {activeLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={18} className="animate-spin text-[#525252]" />
              </div>
            ) : activeError ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <AlertCircle size={20} className="text-[#ef4444] mb-2" />
                <p className="text-[13px] text-[#ef4444]">Failed to load traces</p>
                <p className="text-[11px] text-[#525252] mt-1">{activeError}</p>
                <button
                  onClick={activeLoad}
                  className="mt-3 px-3 py-1.5 text-[12px] text-[#a3a3a3] border border-[#262626] rounded-md hover:border-[#333] transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : source === 'voltagent' && filteredTraces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#1f1f1f] flex items-center justify-center mb-3">
                  <BarChart3 size={20} className="text-[#333]" />
                </div>
                <p className="text-[13px] text-[#a3a3a3] font-medium mb-1">No traces recorded yet</p>
                <p className="text-[11px] text-[#525252] max-w-xs">
                  Traces will appear here when you interact with agents.
                </p>
              </div>
            ) : source === 'studio' && filteredStudioTraces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#1f1f1f] flex items-center justify-center mb-3">
                  <BarChart3 size={20} className="text-[#333]" />
                </div>
                <p className="text-[13px] text-[#a3a3a3] font-medium mb-1">No studio traces yet</p>
                <p className="text-[11px] text-[#525252] max-w-xs">
                  Studio traces will appear here when Orenda tasks are executed.
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {source === 'voltagent'
                  ? filteredTraces.map((trace) => (
                      <TraceListRow
                        key={trace.trace_id}
                        trace={trace}
                        selected={selectedTraceId === trace.trace_id}
                        onClick={() =>
                          setSelectedTraceId((prev) =>
                            prev === trace.trace_id ? null : trace.trace_id,
                          )
                        }
                      />
                    ))
                  : filteredStudioTraces.map((trace) => (
                      <StudioTraceListRow
                        key={trace.trace_id}
                        trace={trace}
                        selected={selectedTraceId === trace.trace_id}
                        onClick={() =>
                          setSelectedTraceId((prev) =>
                            prev === trace.trace_id ? null : trace.trace_id,
                          )
                        }
                      />
                    ))}
              </div>
            )}

            {/* Pagination */}
            {!activeLoading && activeTotal > LIMIT && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-[#1a1a1a]">
                <span className="text-[11px] text-[#525252]">
                  {offset + 1}–{Math.min(offset + LIMIT, activeTotal)} of {activeTotal}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
                    className="px-2 py-1 text-[11px] text-[#525252] border border-[#262626] rounded disabled:opacity-40 hover:border-[#333] transition-colors"
                  >
                    Prev
                  </button>
                  <button
                    disabled={offset + LIMIT >= activeTotal}
                    onClick={() => setOffset((o) => o + LIMIT)}
                    className="px-2 py-1 text-[11px] text-[#525252] border border-[#262626] rounded disabled:opacity-40 hover:border-[#333] transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sağ panel — Trace detay / waterfall */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
          {selectedTraceId ? (
            source === 'voltagent' ? (
              <TraceDetailPanel traceId={selectedTraceId} />
            ) : (
              <StudioTraceDetailPanel traceId={selectedTraceId} />
            )
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-4">
                <ChevronRight size={28} className="text-[#333]" />
              </div>
              <p className="text-[14px] font-medium text-[#a3a3a3] mb-1">Select a trace</p>
              <p className="text-[12px] text-[#525252] max-w-xs">
                Click a trace from the list to see the full execution waterfall and span details.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
