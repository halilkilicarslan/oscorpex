export default function StatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		pending: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30',
		approved: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
		rejected: 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30',
		expired: 'bg-[#525252]/10 text-[#525252] border-[#525252]/30',
		open: 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30',
		acknowledged: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30',
		resolved: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
		online: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
		offline: 'bg-[#525252]/10 text-[#525252] border-[#525252]/30',
		degraded: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30',
		cooldown: 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/30',
		active: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
	};
	const cls = styles[status] ?? 'bg-[#525252]/10 text-[#525252] border-[#525252]/30';
	return (
		<span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
			{status}
		</span>
	);
}
