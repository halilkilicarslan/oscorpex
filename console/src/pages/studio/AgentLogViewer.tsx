// ---------------------------------------------------------------------------
// Orenda — Agent Log Viewer
// Real-time log streaming from agent containers / virtual processes
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Loader2, Circle, ChevronDown } from 'lucide-react';
import { fetchProjectAgents, roleLabel, type ProjectAgent } from '../../lib/studio-api';

const BASE = `/api/studio`;

// ---------------------------------------------------------------------------
// SSE stream hook for agent output
// ---------------------------------------------------------------------------

function useAgentStream(projectId: string, agentId: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!agentId) {
      setLines([]);
      setConnected(false);
      return;
    }

    setLines([]);
    const url = `${BASE}/projects/${projectId}/agents/${agentId}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const line = data.line ?? data.output ?? e.data;
        if (typeof line === 'string' && line.trim()) {
          setLines((prev) => {
            const next = [...prev, line];
            // Keep last 500 lines
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      } catch {
        if (e.data?.trim()) {
          setLines((prev) => {
            const next = [...prev, e.data];
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [projectId, agentId]);

  const clear = useCallback(() => setLines([]), []);

  return { lines, connected, clear };
}

// ---------------------------------------------------------------------------
// Line renderer with ANSI color stripping
// ---------------------------------------------------------------------------

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function LogLine({ line }: { line: string }) {
  const clean = stripAnsi(line);
  let color = 'text-[#a3a3a3]';
  let icon = '';

  // Tool call indicators (from CLI runtime)
  if (clean.includes('>> Write:') || clean.includes('>> Edit:')) {
    color = 'text-[#a78bfa]'; // purple for file modifications
    icon = clean.includes('>> Write:') ? '+' : '~';
  } else if (clean.includes('>> Read:')) {
    color = 'text-[#60a5fa]'; // blue for file reads
    icon = 'r';
  } else if (clean.includes('>> Bash:')) {
    color = 'text-[#fbbf24]'; // yellow for bash commands
    icon = '$';
  } else if (clean.includes('>> Glob:') || clean.includes('>> Grep:')) {
    color = 'text-[#34d399]'; // green for search
    icon = '?';
  } else if (clean.includes('[result]')) {
    color = 'text-[#525252]'; // dim for tool results
  } else if (clean.includes('[error]') || clean.includes('Error') || clean.includes('FAIL') || clean.includes('Hata')) {
    color = 'text-[#ef4444]';
  } else if (clean.includes('[warn]') || clean.includes('Warning')) {
    color = 'text-[#f59e0b]';
  } else if (clean.includes('Tamamlandı') || clean.includes('completed') || clean.includes('APPROVED')) {
    color = 'text-[#22c55e]';
  } else if (clean.includes('tokens') || clean.includes('$')) {
    color = 'text-[#06b6d4]'; // cyan for cost info
  } else if (clean.startsWith('[')) {
    color = 'text-[#06b6d4]';
  }

  return (
    <div className={`${color} whitespace-pre-wrap break-all flex`}>
      {icon && (
        <span className="inline-block w-5 text-center shrink-0 opacity-60">{icon}</span>
      )}
      <span>{clean}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgentLogViewer({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { lines, connected, clear } = useAgentStream(projectId, selectedAgent);

  // Load agents
  useEffect(() => {
    fetchProjectAgents(projectId)
      .then((data) => {
        setAgents(data);
        if (data.length > 0 && !selectedAgent) {
          setSelectedAgent(data[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll]);

  const selected = agents.find((a) => a.id === selectedAgent);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header: agent selector + controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal size={16} className="text-[#22c55e]" />
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Agent Logs</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Agent selector */}
          <div className="relative">
            <select
              value={selectedAgent ?? ''}
              onChange={(e) => { setSelectedAgent(e.target.value || null); clear(); }}
              className="appearance-none pl-3 pr-7 py-1.5 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e] min-w-[160px]"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({roleLabel(a.role)})
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
          </div>

          {/* Connection indicator */}
          <span className="flex items-center gap-1 text-[11px] text-[#525252]">
            <Circle size={6} className={connected ? 'fill-[#22c55e] text-[#22c55e]' : 'fill-[#525252] text-[#525252]'} />
            {connected ? 'Live' : 'Disconnected'}
          </span>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              autoScroll
                ? 'bg-[#22c55e]/10 text-[#22c55e]'
                : 'bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            Auto-scroll
          </button>

          {/* Clear */}
          <button
            onClick={clear}
            className="px-2 py-1 rounded text-[10px] bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Agent info bar */}
      {selected && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg text-[11px]">
          <span className="text-[#fafafa] font-medium">{selected.name}</span>
          <span className="text-[#525252]">|</span>
          <span className="text-[#737373]">{roleLabel(selected.role)}</span>
          <span className="text-[#525252]">|</span>
          <span className="text-[#525252]">{selected.model}</span>
          <span className="ml-auto text-[#525252]">{lines.length} lines</span>
        </div>
      )}

      {/* Log output */}
      <div
        className="bg-[#0a0a0a] border border-[#262626] rounded-xl p-4 font-mono text-[11px] leading-[18px] h-[500px] overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          if (!isAtBottom && autoScroll) setAutoScroll(false);
          if (isAtBottom && !autoScroll) setAutoScroll(true);
        }}
      >
        {lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#333]">
            {connected ? 'Waiting for output...' : 'Select an agent to view logs'}
          </div>
        ) : (
          <>
            {lines.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
            <div ref={logEndRef} />
          </>
        )}
      </div>
    </div>
  );
}
