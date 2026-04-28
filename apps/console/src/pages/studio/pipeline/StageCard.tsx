// ---------------------------------------------------------------------------
// Stage Card
// ---------------------------------------------------------------------------

import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import type { PipelineStage } from '../../../lib/studio-api';
import AgentAvatarImg from '../../../components/AgentAvatar';
import { roleLabel } from '../../../lib/studio-api';
import { STAGE_STATUS_LABELS } from './constants.js';
import { getAgentColor, countDoneTasks } from './helpers.js';

interface StageCardProps {
  stage: PipelineStage;
  isSelected: boolean;
  isCurrent: boolean;
  onClick: () => void;
}

export default function StageCard({ stage, isSelected, isCurrent, onClick }: StageCardProps) {
  const doneTasks = countDoneTasks(stage.tasks);
  const totalTasks = stage.tasks.length;

  const borderStyle = (() => {
    if (stage.status === 'failed') return 'border-[#ef4444]';
    if (stage.status === 'completed') return 'border-[#22c55e]/40';
    if (stage.status === 'running') return 'border-[#22c55e]';
    return isSelected ? 'border-[#333]' : 'border-[#262626]';
  })();

  const glowStyle =
    stage.status === 'running'
      ? { boxShadow: '0 0 12px rgba(34, 197, 94, 0.15)' }
      : {};

  const bgStyle =
    stage.status === 'completed'
      ? 'bg-[#0e1a12]'
      : stage.status === 'failed'
      ? 'bg-[#1a0e0e]'
      : isSelected
      ? 'bg-[#141414]'
      : 'bg-[#111111]';

  const statusIcon = (() => {
    if (stage.status === 'completed')
      return <CheckCircle2 size={12} className="text-[#22c55e]" />;
    if (stage.status === 'failed')
      return <XCircle size={12} className="text-[#ef4444]" />;
    if (stage.status === 'running')
      return <Loader2 size={12} className="text-[#22c55e] animate-spin" />;
    return <Clock size={12} className="text-[#525252]" />;
  })();

  return (
    <button
      onClick={onClick}
      className={`w-[160px] shrink-0 rounded-xl border p-3 text-left transition-all ${borderStyle} ${bgStyle} hover:border-[#444] cursor-pointer`}
      style={glowStyle}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[#525252] font-mono">#{stage.order}</span>
        <div className="flex items-center gap-1">
          {isCurrent && stage.status === 'running' && (
            <span className="text-[9px] text-[#22c55e] font-semibold">AKTİF</span>
          )}
          {statusIcon}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-2.5">
        {stage.agents.map((agent) => {
          const hasRunningTask = stage.tasks.some(
            (t) =>
              (t.status === 'running' || t.status === 'assigned') &&
              (t.assignedAgent === agent.id || t.assignedAgentId === agent.id),
          );
          return (
            <div key={agent.id} className="flex items-center gap-1.5">
              <div className="relative">
                <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="sm" />
                {hasRunningTask && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#22c55e] rounded-full animate-pulse" />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className="text-[11px] font-medium truncate"
                  style={{ color: getAgentColor(agent) }}
                >
                  {agent.name}
                </span>
                <span className="text-[9px] text-[#525252] truncate">{roleLabel(agent.role)}</span>
              </div>
            </div>
          );
        })}
        {stage.agents.length === 0 && (
          <span className="text-[10px] text-[#525252] italic">No agents</span>
        )}
      </div>

      <div className="mt-auto">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[#525252]">
            {totalTasks > 0 ? `${doneTasks}/${totalTasks} tasks` : 'No tasks'}
          </span>
          <span className="text-[10px] text-[#525252]">
            {STAGE_STATUS_LABELS[stage.status]}
          </span>
        </div>
        {totalTasks > 0 && (
          <div className="h-1 rounded-full bg-[#1f1f1f] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(doneTasks / totalTasks) * 100}%`,
                backgroundColor: stage.status === 'failed' ? '#ef4444' : '#22c55e',
              }}
            />
          </div>
        )}
      </div>
    </button>
  );
}
