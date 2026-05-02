import type { InspectorTimelineItem } from '../../lib/studio-api/inspector';

const severityDot: Record<string, string> = {
	info: 'bg-blue-400',
	success: 'bg-green-400',
	warning: 'bg-yellow-400',
	error: 'bg-red-400',
};

export function InspectorTimeline({ items }: { items: InspectorTimelineItem[] }) {
	if (items.length === 0) {
		return <div className="text-sm text-[#525252]">No timeline events</div>;
	}

	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
			<h3 className="mb-3 text-sm font-semibold text-white">Timeline</h3>
			<div className="space-y-2">
				{items.map((item) => (
					<div key={item.id} className="flex items-start gap-3 text-sm">
						<div className="mt-1.5 flex flex-col items-center">
							<div className={`h-2 w-2 rounded-full ${severityDot[item.severity] ?? 'bg-neutral-400'}`} />
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2">
								<span className="font-medium text-[#e5e5e5]">{item.title}</span>
								{item.timestamp && (
									<span className="flex-shrink-0 text-xs text-[#525252]">
										{formatTime(item.timestamp)}
									</span>
								)}
							</div>
							{item.detail && (
								<p className="mt-0.5 text-xs text-[#737373]">{item.detail}</p>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleTimeString();
	} catch {
		return iso;
	}
}

export default InspectorTimeline;
