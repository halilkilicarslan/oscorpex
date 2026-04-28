// ---------------------------------------------------------------------------
// Agent Row
// ---------------------------------------------------------------------------

import AgentAvatarImg from '../../../components/AgentAvatar';
import { roleLabel, type AgentAnalytics } from '../../../lib/studio-api';
import { formatDuration, formatTokenCount, rateColor, scoreColor } from './helpers.js';

interface AgentRowProps {
  agent: AgentAnalytics;
}

export default function AgentRow({ agent }: AgentRowProps) {
  const successRate =
    agent.tasksAssigned > 0
      ? Math.round((agent.tasksCompleted / agent.tasksAssigned) * 100)
      : 0;

  const sc = agent.score ?? 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a] last:border-0 hover:bg-[#0f0f0f] transition-colors">
      {/* Avatar + name + role + score */}
      <div className="flex items-center gap-2.5 w-44 shrink-0">
        <div className="relative">
          <AgentAvatarImg avatar={agent.avatar} name={agent.agentName} size="sm" />
          {agent.tasksAssigned > 0 && (
            <span
              className="absolute -bottom-1 -right-1 text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center text-black"
              style={{ backgroundColor: scoreColor(sc) }}
              title={`Skor: ${sc}/100`}
            >
              {sc}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-[#fafafa] truncate">{agent.agentName}</p>
          <p className="text-[10px] text-[#525252] truncate">{roleLabel(agent.role)}</p>
        </div>
      </div>

      {/* Assigned / Done / Failed */}
      <div className="flex gap-3 text-center flex-wrap">
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#fafafa]">{agent.tasksAssigned}</p>
          <p className="text-[9px] text-[#525252]">Assigned</p>
        </div>
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#22c55e]">{agent.tasksCompleted}</p>
          <p className="text-[9px] text-[#525252]">Done</p>
        </div>
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#ef4444]">{agent.totalFailures ?? agent.tasksFailed}</p>
          <p className="text-[9px] text-[#525252]">Failed</p>
        </div>
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#f97316]">{agent.totalReviewRejections ?? 0}</p>
          <p className="text-[9px] text-[#525252]">Rejected</p>
        </div>
      </div>

      {/* Success rate bar */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-[11px] font-semibold ${rateColor(successRate)}`}>%{successRate}</span>
        </div>
        <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{
              width: `${successRate}%`,
              backgroundColor: successRate >= 80 ? '#22c55e' : successRate >= 50 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
      </div>

      {/* Runs */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#a3a3a3]">{agent.runCount}</p>
        <p className="text-[9px] text-[#525252]">Run</p>
      </div>

      {/* Time */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#a3a3a3]">{formatDuration(agent.totalRuntimeMs)}</p>
        <p className="text-[9px] text-[#525252]">Sure</p>
      </div>

      {/* Tokens */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#38bdf8]">{formatTokenCount(agent.totalTokens)}</p>
        <p className="text-[9px] text-[#525252]">Token</p>
      </div>

      {/* Cost */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#a78bfa]">${(agent.costUsd ?? 0).toFixed(2)}</p>
        <p className="text-[9px] text-[#525252]">Cost</p>
      </div>

      {/* Messages */}
      <div className="w-20 text-center shrink-0">
        <p className="text-[11px] text-[#a3a3a3]">
          <span className="text-[#22c55e]">{agent.messagesSent}</span>
          {' / '}
          <span className="text-[#3b82f6]">{agent.messagesReceived}</span>
        </p>
        <p className="text-[9px] text-[#525252]">Gonder/Al</p>
      </div>

      {/* Status */}
      <div className="w-16 flex justify-center shrink-0">
        {agent.isRunning ? (
          <span className="flex items-center gap-1 text-[10px] text-[#22c55e] bg-[#22c55e11] border border-[#22c55e33] px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            Aktif
          </span>
        ) : (
          <span className="text-[10px] text-[#525252] bg-[#1a1a1a] border border-[#262626] px-2 py-0.5 rounded-full">
            Bekliyor
          </span>
        )}
      </div>
    </div>
  );
}
