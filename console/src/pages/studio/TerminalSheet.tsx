// ---------------------------------------------------------------------------
// Terminal Sheet — Sağdan açılan agent terminal paneli
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Terminal, Loader2, Circle } from 'lucide-react';
import { streamAgentOutputWS, type ProjectAgent } from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';
import { roleLabel } from '../../lib/studio-api';

interface TerminalSheetProps {
  projectId: string;
  taskId: string;
  taskTitle: string;
  agent: ProjectAgent | null;
  isRunning: boolean;
  onClose: () => void;
}

export default function TerminalSheet({
  projectId,
  taskId,
  taskTitle,
  agent,
  isRunning,
  onClose,
}: TerminalSheetProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll: kullanıcı yukarı scroll ettiyse durdur
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll]);

  // WebSocket agent output stream — agent varsa agentId ile, yoksa taskId ile filtrele
  useEffect(() => {
    if (!agent && !taskId) return;

    setConnected(true);
    const stop = streamAgentOutputWS(
      projectId,
      agent?.id,
      (line) => {
        setLines((prev) => [...prev, line]);
      },
      () => {
        setConnected(false);
      },
      agent ? undefined : taskId,
    );

    return () => {
      stop();
      setConnected(false);
    };
  }, [projectId, agent, taskId]);

  // ESC tuşu ile kapat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[560px] max-w-[90vw] bg-[#0a0a0a] border-l border-[#262626] flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#262626] shrink-0">
          <Terminal size={14} className="text-[#22c55e]" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {agent && (
                <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="xs" />
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#fafafa] truncate">
                  {agent?.name ?? taskTitle}
                </p>
                {agent ? (
                  <p className="text-[9px] text-[#525252] truncate">{roleLabel(agent.role)}</p>
                ) : (
                  <p className="text-[9px] text-[#525252] truncate">System Task</p>
                )}
              </div>
            </div>
          </div>

          {/* Task title */}
          <span className="text-[10px] text-[#525252] truncate max-w-[140px]" title={taskTitle}>
            {taskTitle}
          </span>

          {/* Status indicator */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isRunning ? (
              <>
                <Circle size={6} className="text-[#22c55e] fill-[#22c55e] animate-pulse" />
                <span className="text-[9px] text-[#22c55e]">Canli</span>
              </>
            ) : connected ? (
              <>
                <Circle size={6} className="text-[#525252] fill-[#525252]" />
                <span className="text-[9px] text-[#525252]">Bagli</span>
              </>
            ) : (
              <>
                <Circle size={6} className="text-[#525252]" />
                <span className="text-[9px] text-[#525252]">Baglaniyor</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1a1a1a] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Terminal body */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#525252]">
              {isRunning ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-[11px]">Agent ciktisi bekleniyor...</span>
                </>
              ) : (
                <>
                  <Terminal size={16} />
                  <span className="text-[11px]">Henuz terminal ciktisi yok</span>
                </>
              )}
            </div>
          ) : (
            <>
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="text-[#a3a3a3] whitespace-pre-wrap break-words py-0.5 hover:bg-[#111] -mx-1 px-1 rounded"
                >
                  <span className="text-[#333] select-none mr-2 text-[9px]">{i + 1}</span>
                  {line}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#262626] text-[9px] text-[#525252] shrink-0">
          <span>{lines.length} satir</span>
          {!autoScroll && lines.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAutoScroll(true);
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
            >
              En alta git
            </button>
          )}
        </div>
      </div>
    </>
  );
}
