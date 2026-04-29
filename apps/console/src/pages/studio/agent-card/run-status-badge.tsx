export default function RunStatusBadge({ status }: { status: string }) {
	const colors: Record<string, string> = {
		running: 'text-[#22c55e]',
		stopped: 'text-[#737373]',
		error: 'text-[#ef4444]',
		completed: 'text-[#3b82f6]',
	};
	return (
		<span className={`text-[9px] font-medium uppercase ${colors[status] ?? 'text-[#525252]'}`}>
			{status}
		</span>
	);
}
