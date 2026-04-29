import { CheckCircle2, ThumbsUp, ThumbsDown, TrendingUp } from 'lucide-react';
import type { RetroResult } from './types.js';
export default function RetroView({ data }: { data: RetroResult | null }) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <ThumbsUp size={28} className="text-[#333] mb-3" />
        <p className="text-[13px] text-[#a3a3a3] mb-1">No retrospective results yet</p>
        <p className="text-[11px] text-[#525252]">Run a retrospective to see team insights.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.runAt && (
        <p className="text-[11px] text-[#525252]">
          Last run: {new Date(data.runAt).toLocaleString()}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RetroColumn
          bg="#052e16"
          color="#22c55e"
          icon={<ThumbsUp size={13} className="text-[#22c55e]" />}
          label="What Went Well"
          items={data.data.wentWell}
          marker="+"
        />
        <RetroColumn
          bg="#422006"
          color="#f97316"
          icon={<ThumbsDown size={13} className="text-[#f97316]" />}
          label="Could Improve"
          items={data.data.couldImprove}
          marker="△"
        />
        <RetroColumn
          bg="#1e3a5f"
          color="#3b82f6"
          icon={<CheckCircle2 size={13} className="text-[#3b82f6]" />}
          label="Action Items"
          items={data.data.actionItems}
          marker="→"
        />
      </div>

      {/* Agent Performance Stats */}
      {data.agentStats && data.agentStats.length > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <TrendingUp size={13} className="text-[#a855f7]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Agent Performance</h3>
            <span className="ml-auto text-[10px] text-[#525252]">{data.agentStats.length} agents</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#0d0d0d] text-[#525252]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Agent</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Completed</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Avg Revisions</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.agentStats.map((s) => (
                  <tr key={s.agentId} className="border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-2 text-[#e5e5e5]">{s.agentName}</td>
                    <td className="px-4 py-2 text-right text-[#22c55e] font-medium">{s.tasksCompleted}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${
                        s.avgRevisions > 1.5 ? 'text-[#f97316]' : 'text-[#a3a3a3]'
                      }`}
                    >
                      {s.avgRevisions.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${
                        s.successRate >= 0.9
                          ? 'text-[#22c55e]'
                          : s.successRate >= 0.7
                            ? 'text-[#f59e0b]'
                            : 'text-[#ef4444]'
                      }`}
                    >
                      {Math.round(s.successRate * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RetroColumn({
  bg,
  color,
  icon,
  label,
  items,
  marker,
}: {
  bg: string;
  color: string;
  icon: React.ReactNode;
  label: string;
  items: string[];
  marker: string;
}) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]"
        style={{ backgroundColor: `${bg}4d` }}
      >
        {icon}
        <h3 className="text-[12px] font-semibold" style={{ color }}>{label}</h3>
        <span className="ml-auto text-[10px] text-[#525252]">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-0">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 px-4 py-2.5 border-t border-[#1a1a1a] first:border-0">
            <span className="text-[11px] mt-0.5 shrink-0" style={{ color: `${color}99` }}>{marker}</span>
            <span className="text-[11px] text-[#a3a3a3] leading-snug">{item}</span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="flex items-center justify-center py-8 text-[11px] text-[#333]">—</li>
        )}
      </ul>
    </div>
  );
}
