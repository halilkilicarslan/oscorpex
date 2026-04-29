import { CheckCircle2, Zap, AlertTriangle, Clock } from 'lucide-react';
import type { StandupResult } from './types.js';
export default function StandupView({ data }: { data: StandupResult | null }) {
  if (!data || data.agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Clock size={28} className="text-[#333] mb-3" />
        <p className="text-[13px] text-[#a3a3a3] mb-1">
          {!data ? 'No standup results yet' : 'No agents configured'}
        </p>
        <p className="text-[11px] text-[#525252]">
          {!data ? 'Run a standup to see agent updates.' : 'Add agents to the project to generate standups.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {data.runAt && (
        <p className="text-[11px] text-[#525252] mb-3">
          Last run: {new Date(data.runAt).toLocaleString()}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.agents.map((agent) => (
          <div key={agent.agentId} className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 flex items-center justify-center text-[11px] font-bold text-[#22c55e]">
                {agent.agentName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-[12px] font-semibold text-[#fafafa]">{agent.agentName}</p>
                <p className="text-[10px] text-[#525252]">{agent.role}</p>
              </div>
            </div>

            {agent.completed.length > 0 && (
              <StandupSection icon={<CheckCircle2 size={11} className="text-[#22c55e]" />} label="Completed" color="#22c55e" items={agent.completed} />
            )}
            {agent.inProgress.length > 0 && (
              <StandupSection icon={<Zap size={11} className="text-[#f59e0b]" />} label="In Progress" color="#f59e0b" items={agent.inProgress} />
            )}
            {agent.blockers.length > 0 && (
              <StandupSection icon={<AlertTriangle size={11} className="text-[#ef4444]" />} label="Blockers" color="#ef4444" items={agent.blockers} />
            )}

            {agent.completed.length === 0 && agent.inProgress.length === 0 && agent.blockers.length === 0 && (
              <p className="text-[11px] text-[#525252] italic">No updates</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function StandupSection({
  icon,
  label,
  color,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  items: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{label}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li
            key={`${label}-${i}`}
            className="text-[11px] text-[#a3a3a3] leading-snug pl-2 border-l"
            style={{ borderColor: `${color}33` }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
