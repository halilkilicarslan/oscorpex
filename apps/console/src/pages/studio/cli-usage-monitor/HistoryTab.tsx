import { STATUS_STYLE } from './helpers';
import type { CLIUsageSnapshot, CLIUsageTrendPoint, CLIProbeEvent } from "../../../lib/studio-api";

interface HistoryTabProps {
	selected: CLIUsageSnapshot;
	history: CLIUsageTrendPoint[];
	events: CLIProbeEvent[];
}

export default function HistoryTab({ selected, history, events }: HistoryTabProps) {
	const providerHistory = history.filter((point) => point.providerId === selected.providerId);
	const providerEvents = events.filter((event) => event.providerId === selected.providerId);

	return (
		<div className="space-y-4">
			<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a]">
				<div className="border-b border-[#262626] px-4 py-3 text-[12px] font-medium text-[#fafafa]">
					Snapshot trend
				</div>
				<div className="divide-y divide-[#1f1f1f]">
					{providerHistory.length === 0 && (
						<div className="px-4 py-5 text-[12px] text-[#737373]">
							No persisted snapshots yet. Refresh this provider after enabling probes.
						</div>
					)}
					{providerHistory.map((point) => (
						<div
							key={`${point.providerId}-${point.capturedAt}`}
							className="flex items-center justify-between gap-3 px-4 py-3 text-[12px]"
						>
							<div>
								<div className="text-[#fafafa]">{new Date(point.capturedAt).toLocaleString()}</div>
								<div className="text-[10px] text-[#525252]">
									{point.source} · {point.confidence}
								</div>
							</div>
							<span
								className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[point.worstStatus]}`}
							>
								{point.lowestPercentRemaining != null
									? `${Math.round(point.lowestPercentRemaining)}% left`
									: point.worstStatus}
							</span>
						</div>
					))}
				</div>
			</div>

			<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a]">
				<div className="border-b border-[#262626] px-4 py-3 text-[12px] font-medium text-[#fafafa]">
					Probe events
				</div>
				<div className="divide-y divide-[#1f1f1f]">
					{providerEvents.length === 0 && (
						<div className="px-4 py-5 text-[12px] text-[#737373]">No probe events yet.</div>
					)}
					{providerEvents.map((event) => (
						<div key={event.id} className="px-4 py-3 text-[12px]">
							<div className="flex items-center justify-between gap-3">
								<span className="font-medium text-[#fafafa]">{event.status}</span>
								<span className="text-[10px] text-[#525252]">
									{new Date(event.createdAt).toLocaleString()}
								</span>
							</div>
							<div className="mt-1 text-[#737373]">{event.message}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
