import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, RefreshCw, X, ChevronDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ObservabilityLog {
  id: number;
  timestamp: string;
  trace_id: string | null;
  span_id: string | null;
  trace_flags: number | null;
  severity_text: string | null;
  body: string;
  attributes: Record<string, unknown> | null;
}

interface LogStats {
  total: number;
  bySeverity: Record<string, number>;
  recentRate: number;
}

interface StudioEvent {
  id: string;
  project_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

type Source = 'logs' | 'events';
type Severity = 'ALL' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3141/api/observability';
const PAGE_SIZE = 100;

const SEVERITY_STYLES: Record<string, string> = {
  DEBUG: 'text-[#71717a] bg-[#18181b] border border-[#27272a]',
  INFO:  'text-[#3b82f6] bg-[#172554] border border-[#1d4ed8]',
  WARN:  'text-[#f59e0b] bg-[#451a03] border border-[#b45309]',
  ERROR: 'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]',
};

const EVENT_TYPE_STYLES: Record<string, string> = {
  'task:completed':   'text-[#22c55e] bg-[#052e16] border border-[#16a34a]',
  'task:failed':      'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]',
  'task:started':     'text-[#3b82f6] bg-[#172554] border border-[#1d4ed8]',
  'pipeline:started': 'text-[#a855f7] bg-[#2e1065] border border-[#7c3aed]',
  'pipeline:completed': 'text-[#a855f7] bg-[#2e1065] border border-[#7c3aed]',
  'pipeline:failed':  'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]',
};

function getEventTypeStyle(type: string): string {
  return EVENT_TYPE_STYLES[type] ?? 'text-[#a3a3a3] bg-[#18181b] border border-[#27272a]';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch {
    return ts;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityBadge({ sev }: { sev: string | null }) {
  const label = (sev ?? 'DEBUG').toUpperCase();
  const cls = SEVERITY_STYLES[label] ?? SEVERITY_STYLES.DEBUG;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const cls = getEventTypeStyle(type);
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${cls}`}>
      {type}
    </span>
  );
}

function StatsBar({ stats }: { stats: LogStats | null }) {
  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[#525252]">
        <span>Loading stats...</span>
      </div>
    );
  }

  const badges = [
    { key: 'DEBUG', cls: 'text-[#71717a] bg-[#18181b] border border-[#27272a]' },
    { key: 'INFO',  cls: 'text-[#3b82f6] bg-[#172554] border border-[#1d4ed8]' },
    { key: 'WARN',  cls: 'text-[#f59e0b] bg-[#451a03] border border-[#b45309]' },
    { key: 'ERROR', cls: 'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]' },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-[#525252]">
        Total: <span className="text-[#fafafa] font-mono">{stats.total.toLocaleString()}</span>
      </span>
      <span className="text-[#262626]">|</span>
      {badges.map(({ key, cls }) => (
        <span key={key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${cls}`}>
          {key}: {(stats.bySeverity[key] ?? 0).toLocaleString()}
        </span>
      ))}
      <span className="text-[#262626]">|</span>
      <span className="text-[11px] text-[#525252]">
        Last 5m: <span className="text-[#22c55e] font-mono">{stats.recentRate}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log Row
// ---------------------------------------------------------------------------

function LogRow({ log }: { log: ObservabilityLog }) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails =
    (log.attributes && Object.keys(log.attributes).length > 0) ||
    log.span_id ||
    log.trace_flags !== null;

  return (
    <div
      className={`border-b border-[#1a1a1a] hover:bg-[#111111] transition-colors ${expanded ? 'bg-[#111111]' : ''}`}
    >
      <div
        className="flex items-start gap-3 px-4 py-2 cursor-pointer"
        onClick={() => hasDetails && setExpanded((p) => !p)}
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        onKeyDown={(e) => { if (hasDetails && e.key === 'Enter') setExpanded((p) => !p); }}
      >
        {/* Timestamp */}
        <span className="text-[#525252] font-mono text-[11px] shrink-0 pt-px whitespace-nowrap">
          {fmtTimestamp(log.timestamp)}
        </span>

        {/* Severity */}
        <SeverityBadge sev={log.severity_text} />

        {/* Body */}
        <span className="text-[#a3a3a3] font-mono text-[12px] break-all flex-1 leading-relaxed">
          {log.body}
        </span>

        {/* Trace link */}
        {log.trace_id && (
          <Link
            to={`/traces?id=${log.trace_id}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-[#525252] hover:text-[#22c55e] transition-colors"
            title={`Trace: ${log.trace_id}`}
          >
            <ExternalLink size={11} />
          </Link>
        )}

        {/* Expand chevron */}
        {hasDetails && (
          <ChevronDown
            size={11}
            className={`shrink-0 text-[#525252] transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="px-4 pb-3 pl-[calc(1rem+8ch+2rem)] space-y-1">
          {log.trace_id && (
            <div className="flex gap-2 text-[11px] font-mono">
              <span className="text-[#525252] w-24 shrink-0">trace_id</span>
              <span className="text-[#a3a3a3]">{log.trace_id}</span>
            </div>
          )}
          {log.span_id && (
            <div className="flex gap-2 text-[11px] font-mono">
              <span className="text-[#525252] w-24 shrink-0">span_id</span>
              <span className="text-[#a3a3a3]">{log.span_id}</span>
            </div>
          )}
          {log.attributes && Object.entries(log.attributes).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[11px] font-mono">
              <span className="text-[#525252] w-24 shrink-0 truncate">{k}</span>
              <span className="text-[#a3a3a3] break-all">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Row
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: StudioEvent }) {
  const [expanded, setExpanded] = useState(false);
  const payloadStr = JSON.stringify(event.payload, null, 2);

  return (
    <div
      className={`border-b border-[#1a1a1a] hover:bg-[#111111] transition-colors ${expanded ? 'bg-[#111111]' : ''}`}
    >
      <div
        className="flex items-start gap-3 px-4 py-2 cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') setExpanded((p) => !p); }}
      >
        {/* Timestamp */}
        <span className="text-[#525252] font-mono text-[11px] shrink-0 pt-px whitespace-nowrap">
          {fmtTimestamp(event.created_at)}
        </span>

        {/* Event type badge */}
        <EventTypeBadge type={event.type} />

        {/* Project ID */}
        <span className="text-[#525252] font-mono text-[11px] shrink-0">
          {event.project_id.slice(0, 8)}
        </span>

        {/* Payload preview */}
        <span className="text-[#a3a3a3] font-mono text-[12px] flex-1 truncate">
          {truncate(JSON.stringify(event.payload), 120)}
        </span>

        <ChevronDown
          size={11}
          className={`shrink-0 text-[#525252] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Expanded payload */}
      {expanded && (
        <div className="px-4 pb-3 pl-[calc(1rem+8ch+2rem)]">
          <pre className="text-[11px] font-mono text-[#a3a3a3] whitespace-pre-wrap break-all leading-relaxed">
            {payloadStr}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function LogsPage() {
  const [source, setSource] = useState<Source>('logs');

  // Logs state
  const [logs, setLogs] = useState<ObservabilityLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsOffset, setLogsOffset] = useState(0);
  const [stats, setStats] = useState<LogStats | null>(null);

  // Events state
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);

  // Filters
  const [severity, setSeverity] = useState<Severity>('ALL');
  const [search, setSearch] = useState('');
  const [traceIdFilter, setTraceIdFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');

  // UI
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/logs/stats`);
      if (!res.ok) return;
      const data = await res.json() as LogStats;
      setStats(data);
    } catch {
      // silent
    }
  }, []);

  const fetchLogs = useCallback(async (offset: number, append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (severity !== 'ALL') params.set('severity', severity);
      if (search) params.set('search', search);
      if (traceIdFilter) params.set('trace_id', traceIdFilter);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      const res = await fetch(`${API_BASE}/logs?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { logs: ObservabilityLog[]; total: number };
      setLogsTotal(data.total);
      setLogs((prev) => append ? [...prev, ...data.logs] : data.logs);
      setLogsOffset(offset + data.logs.length);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [severity, search, traceIdFilter, fromDate, toDate]);

  const fetchEvents = useCallback(async (offset: number, append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (eventTypeFilter) params.set('type', eventTypeFilter);

      const res = await fetch(`${API_BASE}/events?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { events: StudioEvent[]; total: number };
      setEventsTotal(data.total);
      setEvents((prev) => append ? [...prev, ...data.events] : data.events);
      setEventsOffset(offset + data.events.length);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [eventTypeFilter]);

  // Initial load + filter changes
  useEffect(() => {
    if (source === 'logs') {
      void fetchLogs(0, false);
      void fetchStats();
    } else {
      void fetchEvents(0, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, severity, search, traceIdFilter, fromDate, toDate, eventTypeFilter]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (!autoRefresh) return;

    autoRefreshRef.current = setInterval(() => {
      if (source === 'logs') {
        void fetchLogs(0, false);
        void fetchStats();
      } else {
        void fetchEvents(0, false);
      }
    }, 5000);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, source, fetchLogs, fetchEvents, fetchStats]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleClearFilters = () => {
    setSeverity('ALL');
    setSearch('');
    setTraceIdFilter('');
    setFromDate('');
    setToDate('');
    setEventTypeFilter('');
  };

  const hasFilters =
    severity !== 'ALL' || search || traceIdFilter || fromDate || toDate || eventTypeFilter;

  const loadMoreLogs = () => fetchLogs(logsOffset, true);
  const loadMoreEvents = () => fetchEvents(eventsOffset, true);

  const hasMoreLogs = logsOffset < logsTotal;
  const hasMoreEvents = eventsOffset < eventsTotal;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-[#fafafa]">
      {/* Top Bar */}
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-[#262626] bg-[#111111] shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Source toggle */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] rounded-lg p-1 border border-[#262626]">
            <button
              onClick={() => setSource('logs')}
              className={`px-3 py-1 rounded-md text-[13px] transition-colors ${
                source === 'logs'
                  ? 'bg-[#22c55e] text-[#0a0a0a] font-semibold'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              VoltAgent Logs
            </button>
            <button
              onClick={() => setSource('events')}
              className={`px-3 py-1 rounded-md text-[13px] transition-colors ${
                source === 'events'
                  ? 'bg-[#22c55e] text-[#0a0a0a] font-semibold'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              Studio Events
            </button>
          </div>

          {/* Auto-refresh + loading */}
          <div className="flex items-center gap-3">
            {loading && (
              <RefreshCw size={13} className="text-[#22c55e] animate-spin" />
            )}
            <button
              onClick={() => setAutoRefresh((p) => !p)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[12px] border transition-colors ${
                autoRefresh
                  ? 'border-[#22c55e] text-[#22c55e] bg-[#052e16]'
                  : 'border-[#262626] text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <RefreshCw size={11} className={autoRefresh ? 'animate-spin' : ''} />
              Auto-refresh
            </button>
          </div>
        </div>

        {/* Stats (only for logs) */}
        {source === 'logs' && <StatsBar stats={stats} />}
        {source === 'events' && (
          <div className="text-[11px] text-[#525252]">
            Total: <span className="text-[#fafafa] font-mono">{eventsTotal.toLocaleString()}</span> studio events
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1a1a1a] bg-[#0d0d0d] shrink-0 flex-wrap">
        {source === 'logs' && (
          <>
            {/* Severity */}
            <div className="relative">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className="appearance-none bg-[#111111] border border-[#262626] text-[#a3a3a3] text-[12px] rounded px-2 py-1 pr-6 cursor-pointer hover:border-[#404040] focus:outline-none focus:border-[#22c55e]"
              >
                <option value="ALL">All Levels</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Search log body..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#111111] border border-[#262626] text-[#a3a3a3] placeholder-[#404040] text-[12px] rounded px-2 py-1 w-52 focus:outline-none focus:border-[#22c55e] hover:border-[#404040]"
            />

            {/* Trace ID */}
            <input
              type="text"
              placeholder="Trace ID..."
              value={traceIdFilter}
              onChange={(e) => setTraceIdFilter(e.target.value)}
              className="bg-[#111111] border border-[#262626] text-[#a3a3a3] placeholder-[#404040] text-[12px] rounded px-2 py-1 w-36 font-mono focus:outline-none focus:border-[#22c55e] hover:border-[#404040]"
            />

            {/* From */}
            <input
              type="text"
              placeholder="From (ISO)..."
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-[#111111] border border-[#262626] text-[#a3a3a3] placeholder-[#404040] text-[12px] rounded px-2 py-1 w-36 font-mono focus:outline-none focus:border-[#22c55e] hover:border-[#404040]"
            />

            {/* To */}
            <input
              type="text"
              placeholder="To (ISO)..."
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-[#111111] border border-[#262626] text-[#a3a3a3] placeholder-[#404040] text-[12px] rounded px-2 py-1 w-36 font-mono focus:outline-none focus:border-[#22c55e] hover:border-[#404040]"
            />
          </>
        )}

        {source === 'events' && (
          <input
            type="text"
            placeholder="Event type (e.g. task:completed)..."
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            className="bg-[#111111] border border-[#262626] text-[#a3a3a3] placeholder-[#404040] text-[12px] rounded px-2 py-1 w-60 font-mono focus:outline-none focus:border-[#22c55e] hover:border-[#404040]"
          />
        )}

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={handleClearFilters}
            className="flex items-center gap-1 px-2 py-1 text-[12px] text-[#525252] hover:text-[#a3a3a3] border border-[#262626] rounded transition-colors"
          >
            <X size={11} />
            Clear
          </button>
        )}
      </div>

      {/* Log Stream */}
      <div className="flex-1 overflow-y-auto">
        {source === 'logs' && (
          <>
            {logs.length === 0 && !loading ? (
              <EmptyState />
            ) : (
              <>
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}

                {hasMoreLogs && (
                  <LoadMoreButton
                    onClick={loadMoreLogs}
                    loading={loading}
                    shown={logs.length}
                    total={logsTotal}
                  />
                )}
              </>
            )}
          </>
        )}

        {source === 'events' && (
          <>
            {events.length === 0 && !loading ? (
              <EmptyState message="No studio events recorded yet. Events will appear here as agents process tasks." />
            ) : (
              <>
                {events.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}

                {hasMoreEvents && (
                  <LoadMoreButton
                    onClick={loadMoreEvents}
                    loading={loading}
                    shown={events.length}
                    total={eventsTotal}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Load More Button
// ---------------------------------------------------------------------------

function LoadMoreButton({
  onClick,
  loading,
  shown,
  total,
}: {
  onClick: () => void;
  loading: boolean;
  shown: number;
  total: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-4 border-t border-[#1a1a1a]">
      <span className="text-[11px] text-[#525252]">
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
      </span>
      <button
        onClick={onClick}
        disabled={loading}
        className="px-4 py-1.5 text-[13px] text-[#22c55e] border border-[#16a34a] rounded hover:bg-[#052e16] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Loading...' : 'Load more'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="w-12 h-12 rounded-full bg-[#111111] border border-[#262626] flex items-center justify-center">
        <span className="text-[#525252] font-mono text-[18px]">$_</span>
      </div>
      <p className="text-[13px] text-[#525252] text-center max-w-sm">
        {message ?? 'No logs recorded yet. Logs will appear here as agents process requests.'}
      </p>
    </div>
  );
}
