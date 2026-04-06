import { useEffect, useRef, useState, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  AlertCircle,
  Zap,
  GitBranch,
  WifiOff,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType =
  | 'plan:approved'
  | 'plan:rejected'
  | 'execution:started'
  | 'task:assigned'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'phase:started'
  | 'phase:completed'
  | 'project:completed'
  | 'escalation';

interface StudioEvent {
  id: string;
  type: EventType | string;
  payload: Record<string, unknown>;
  timestamp: string;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

// ---------------------------------------------------------------------------
// Event visual config
// ---------------------------------------------------------------------------

interface EventStyle {
  icon: React.ReactNode;
  labelColor: string;
  dotColor: string;
  borderColor: string;
}

function getEventStyle(type: string): EventStyle {
  switch (type) {
    case 'task:completed':
    case 'plan:approved':
    case 'project:completed':
      return {
        icon: <CheckCircle2 size={13} className="text-[#22c55e] shrink-0" />,
        labelColor: 'text-[#22c55e]',
        dotColor: 'bg-[#22c55e]',
        borderColor: 'border-[#22c55e]/20',
      };

    case 'task:failed':
    case 'plan:rejected':
      return {
        icon: <XCircle size={13} className="text-[#ef4444] shrink-0" />,
        labelColor: 'text-[#ef4444]',
        dotColor: 'bg-[#ef4444]',
        borderColor: 'border-[#ef4444]/20',
      };

    case 'task:started':
    case 'task:assigned':
      return {
        icon: <Loader2 size={13} className="text-[#f59e0b] shrink-0 animate-spin" />,
        labelColor: 'text-[#f59e0b]',
        dotColor: 'bg-[#f59e0b]',
        borderColor: 'border-[#f59e0b]/20',
      };

    case 'phase:started':
    case 'phase:completed':
      return {
        icon: <GitBranch size={13} className="text-[#3b82f6] shrink-0" />,
        labelColor: 'text-[#3b82f6]',
        dotColor: 'bg-[#3b82f6]',
        borderColor: 'border-[#3b82f6]/20',
      };

    case 'execution:started':
      return {
        icon: <Play size={13} className="text-[#22c55e] shrink-0" />,
        labelColor: 'text-[#22c55e]',
        dotColor: 'bg-[#22c55e]',
        borderColor: 'border-[#22c55e]/20',
      };

    case 'escalation':
      return {
        icon: <AlertCircle size={13} className="text-[#f97316] shrink-0" />,
        labelColor: 'text-[#f97316]',
        dotColor: 'bg-[#f97316]',
        borderColor: 'border-[#f97316]/20',
      };

    default:
      return {
        icon: <Zap size={13} className="text-[#a3a3a3] shrink-0" />,
        labelColor: 'text-[#a3a3a3]',
        dotColor: 'bg-[#525252]',
        borderColor: 'border-[#262626]',
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function formatEventType(type: string): string {
  return type.replace(':', ': ').replace(/_/g, ' ');
}

function payloadSummary(payload: Record<string, unknown>): string | null {
  const candidates: (keyof typeof payload)[] = [
    'title',
    'name',
    'message',
    'taskTitle',
    'phaseName',
    'reason',
    'agent',
  ];
  for (const key of candidates) {
    const val = payload[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

function EventRow({ event, isNew }: { event: StudioEvent; isNew: boolean }) {
  const style = getEventStyle(event.type);
  const summary = payloadSummary(event.payload);

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-2.5 border-b border-[#1a1a1a]
        hover:bg-[#111111] transition-colors
        ${isNew ? 'animate-pulse-once' : ''}
      `}
    >
      {/* Timeline dot + icon */}
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        {style.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${style.labelColor}`}>
            {formatEventType(event.type)}
          </span>
          <span className="text-[10px] text-[#525252] font-mono">{formatTime(event.timestamp)}</span>
        </div>
        {summary && (
          <p className="text-[12px] text-[#a3a3a3] mt-0.5 truncate" title={summary}>
            {summary}
          </p>
        )}
      </div>

      {/* Accent dot */}
      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${style.dotColor}`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventFeed
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 3000;
const MAX_EVENTS = 200;

export default function EventFeed({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Auto-scroll to bottom when new events arrive
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Append events, de-duplicate by id, cap at MAX_EVENTS
  const appendEvents = useCallback((incoming: StudioEvent[], markNew = false) => {
    setEvents((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const fresh = incoming.filter((e) => !existingIds.has(e.id));
      if (fresh.length === 0) return prev;
      const merged = [...prev, ...fresh];
      return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
    });

    if (markNew) {
      const ids = new Set(incoming.map((e) => e.id));
      setNewEventIds((prev) => new Set([...prev, ...ids]));
      // Clear "new" marker after 1.5s
      setTimeout(() => {
        setNewEventIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, 1500);
    }
  }, []);

  // Fetch recent events on mount
  useEffect(() => {
    let cancelled = false;

    fetch(`/api/studio/projects/${projectId}/events/recent?limit=30`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StudioEvent[]>;
      })
      .then((data) => {
        if (cancelled) return;
        appendEvents(data, false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, appendEvents]);

  // SSE connection
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    setConnectionState('connecting');

    const es = new EventSource(`/api/studio/projects/${projectId}/events`);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState('connected');
    };

    es.onmessage = (e: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      try {
        const event = JSON.parse(e.data) as StudioEvent;
        appendEvents([event], true);
        // Defer scroll so DOM has updated
        requestAnimationFrame(scrollToBottom);
      } catch {
        // Malformed event — ignore
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      setConnectionState('disconnected');

      // Schedule reconnect
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, RECONNECT_DELAY_MS);
    };
  }, [projectId, appendEvents, scrollToBottom]);

  // Mount / unmount SSE lifecycle
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  // Scroll to bottom after initial events load
  useEffect(() => {
    if (!loading) requestAnimationFrame(scrollToBottom);
  }, [loading, scrollToBottom]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#262626] bg-[#0d0d0d] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest">
            Event Stream
          </span>
          <span className="text-[10px] text-[#525252]">({events.length})</span>
        </div>

        {/* Connection badge */}
        <div className="flex items-center gap-1.5">
          {connectionState === 'connected' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-[10px] text-[#22c55e] font-medium">Live</span>
            </>
          )}
          {connectionState === 'connecting' && (
            <>
              <Loader2 size={10} className="text-[#f59e0b] animate-spin" />
              <span className="text-[10px] text-[#f59e0b] font-medium">Connecting</span>
            </>
          )}
          {connectionState === 'disconnected' && (
            <>
              <WifiOff size={10} className="text-[#ef4444]" />
              <span className="text-[10px] text-[#ef4444] font-medium">Disconnected</span>
              <span className="text-[10px] text-[#525252]">— retrying in {RECONNECT_DELAY_MS / 1000}s</span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={18} className="text-[#525252] animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle size={20} className="text-[#ef4444] mx-auto mb-2" />
              <p className="text-[12px] text-[#ef4444]">Failed to load events</p>
              <p className="text-[11px] text-[#525252] mt-1">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <Zap size={22} className="text-[#262626] mb-3" />
            <p className="text-[12px] text-[#525252]">No events yet</p>
            <p className="text-[11px] text-[#383838] mt-1">
              Events will appear here as the project progresses
            </p>
          </div>
        )}

        {!loading && events.length > 0 && (
          <div>
            {events.map((event) => (
              <EventRow key={event.id} event={event} isNew={newEventIds.has(event.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
