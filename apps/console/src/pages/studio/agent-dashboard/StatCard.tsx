// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}

export default function StatCard({ label, value, sub, icon, accent = '#22c55e' }: StatCardProps) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#737373] uppercase tracking-wider">{label}</span>
        <span style={{ color: accent }} className="opacity-70">{icon}</span>
      </div>
      <div>
        <span className="text-[26px] font-bold text-[#fafafa] leading-none">{value}</span>
        {sub && <span className="ml-2 text-[11px] text-[#525252]">{sub}</span>}
      </div>
    </div>
  );
}
