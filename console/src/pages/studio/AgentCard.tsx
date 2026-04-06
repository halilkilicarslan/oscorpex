import { useState } from 'react';
import { Play, Square, Loader2, Terminal, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import type { ProjectAgent } from '../../lib/studio-api';
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
  onClick,
  onEdit,
  onDelete,
}: {
  agent: ProjectAgent;
  projectId: string;
  status: RuntimeStatus;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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
    <div
      className={`bg-[#111111] border border-[#262626] border-l-4 rounded-xl overflow-hidden ${onClick ? 'hover:border-[#333] transition-colors' : ''}`}
      style={{ borderLeftColor: agent.color ?? '#22c55e' }}
    >
      <div
        className={`flex items-center gap-3 px-4 py-3 ${onClick ? 'cursor-pointer' : ''}`}
        onClick={onClick}
      >
        {/* Avatar */}
        <div className="w-10 h-10 rounded-lg bg-[#1f1f1f] flex items-center justify-center text-lg shrink-0">
          {agent.avatar}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#fafafa] truncate">{agent.name}</span>
            <div className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} title={s.label} />
            {/* Template / Custom badge */}
            <span
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${
                agent.sourceAgentId
                  ? 'bg-[#a3a3a3]/10 text-[#525252] border border-[#333]'
                  : 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
              }`}
            >
              {agent.sourceAgentId ? 'Template' : 'Custom'}
            </span>
          </div>
          <span className="text-[11px] text-[#525252] block truncate capitalize">{agent.role}</span>
        </div>

        {/* Actions — stop propagation so card click doesn't fire */}
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Edit */}
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
              title="Edit agent"
            >
              <Pencil size={13} />
            </button>
          )}

          {/* Delete */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-[#525252] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
              title="Delete agent"
            >
              <Trash2 size={13} />
            </button>
          )}

          {/* Terminal toggle */}
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

          {/* Start / Stop */}
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
