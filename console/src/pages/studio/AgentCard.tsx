import { useState } from 'react';
import { Play, Square, Loader2, Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import type { AgentConfig } from '../../lib/studio-api';
import AgentTerminal from './AgentTerminal';

type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

const STATUS_STYLES: Record<RuntimeStatus, { color: string; label: string }> = {
  idle: { color: 'bg-[#525252]', label: 'Idle' },
  starting: { color: 'bg-[#f59e0b] animate-pulse', label: 'Starting' },
  running: { color: 'bg-[#22c55e] animate-pulse', label: 'Running' },
  stopping: { color: 'bg-[#f59e0b] animate-pulse', label: 'Stopping' },
  error: { color: 'bg-[#ef4444]', label: 'Error' },
};

export default function AgentCard({
  agent,
  projectId,
  status: externalStatus,
  onStart,
  onStop,
}: {
  agent: AgentConfig;
  projectId: string;
  status: RuntimeStatus;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [showTerminal, setShowTerminal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const status = actionLoading
    ? externalStatus === 'running'
      ? 'stopping'
      : 'starting'
    : externalStatus;
  const s = STATUS_STYLES[status];
  const isRunning = externalStatus === 'running';

  const handleAction = async () => {
    setActionLoading(true);
    try {
      if (isRunning) {
        await onStop();
      } else {
        await onStart();
      }
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="border border-[#262626] rounded-xl bg-[#111111] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-lg bg-[#1f1f1f] flex items-center justify-center text-lg shrink-0">
          {agent.avatar}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#fafafa] truncate">{agent.name}</span>
            <div className={`w-2 h-2 rounded-full ${s.color}`} title={s.label} />
          </div>
          <span className="text-[11px] text-[#525252] block truncate">{agent.role}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`p-1.5 rounded-lg text-[#525252] hover:text-[#22c55e] hover:bg-[#1f1f1f] transition-colors ${
                showTerminal ? 'bg-[#1f1f1f] text-[#22c55e]' : ''
              }`}
              title="Toggle terminal"
            >
              <Terminal size={14} />
            </button>
          )}

          <button
            onClick={handleAction}
            disabled={actionLoading}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              isRunning
                ? 'text-[#ef4444] hover:bg-[#ef4444]/10'
                : 'text-[#22c55e] hover:bg-[#22c55e]/10'
            }`}
            title={isRunning ? 'Stop agent' : 'Start agent'}
          >
            {actionLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isRunning ? (
              <Square size={14} />
            ) : (
              <Play size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Skills */}
      {agent.skills.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1">
          {agent.skills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#737373] border border-[#262626]"
            >
              {skill}
            </span>
          ))}
          {agent.skills.length > 4 && (
            <span className="text-[10px] px-1.5 py-0.5 text-[#525252]">
              +{agent.skills.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Terminal */}
      {showTerminal && isRunning && (
        <div className="border-t border-[#262626]">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d0d]">
            <span className="text-[10px] text-[#525252] font-medium">TERMINAL</span>
            <button
              onClick={() => setShowTerminal(false)}
              className="text-[#525252] hover:text-[#a3a3a3]"
            >
              <ChevronUp size={12} />
            </button>
          </div>
          <div className="h-[250px]">
            <AgentTerminal projectId={projectId} agentId={agent.id} />
          </div>
        </div>
      )}
    </div>
  );
}
