// ---------------------------------------------------------------------------
// Timeline Chart (last 7 days)
// ---------------------------------------------------------------------------

import type { ActivityTimeline } from '../../../lib/studio-api';

interface TimelineChartProps {
  data: ActivityTimeline[];
}

export default function TimelineChart({ data }: TimelineChartProps) {
  const maxVal = Math.max(1, ...data.map((d) => d.tasksCompleted + d.runsStarted));

  return (
    <div className="flex items-end gap-1 h-20">
      {data.map((d) => {
        const total = d.tasksCompleted + d.runsStarted;
        const pct = (total / maxVal) * 100;
        const shortDate = d.date.slice(5); // MM-DD
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col items-center justify-end h-14">
              {total > 0 && (
                <div
                  className="w-full rounded-t-sm transition-all duration-500"
                  style={{
                    height: `${Math.max(pct, 4)}%`,
                    background: 'linear-gradient(to top, #22c55e88, #22c55e33)',
                    border: '1px solid #22c55e44',
                  }}
                  title={`${d.date}: ${d.tasksCompleted} gorev, ${d.runsStarted} calistirma`}
                />
              )}
              {total === 0 && (
                <div className="w-full h-[2px] bg-[#1a1a1a] rounded" />
              )}
            </div>
            <span className="text-[9px] text-[#525252] leading-none">{shortDate}</span>
          </div>
        );
      })}
    </div>
  );
}
