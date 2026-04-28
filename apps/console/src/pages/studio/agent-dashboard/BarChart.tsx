// ---------------------------------------------------------------------------
// Bar Chart (CSS-based)
// ---------------------------------------------------------------------------

import AgentAvatarImg from '../../../components/AgentAvatar';
import { roleLabel } from '../../../lib/studio-api';

export interface BarChartItem {
  label: string;
  value: number;
  color: string;
  avatar?: string;
  role?: string;
}

interface BarChartProps {
  items: BarChartItem[];
  maxValue: number;
}

export default function BarChart({ items, maxValue }: BarChartProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[#525252] text-[12px]">
        Henuz veri yok
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const pct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        return (
          <div key={item.label} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-36 shrink-0">
              <AgentAvatarImg avatar={item.avatar ?? ''} name={item.label} size="xs" />
              <div className="min-w-0">
                <p className="text-[11px] text-[#a3a3a3] font-medium truncate">{item.label}</p>
                {item.role && (
                  <p className="text-[9px] text-[#525252] truncate">{roleLabel(item.role)}</p>
                )}
              </div>
            </div>
            <div className="flex-1 bg-[#1a1a1a] rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: item.color }}
              />
            </div>
            <span className="text-[11px] text-[#a3a3a3] w-6 text-right shrink-0">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
