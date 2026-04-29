import type { StudioEvent } from './types.js';
import getEventStyle from './event-style.js';
import { formatTime, formatEventType, payloadSummary } from './helpers.js';

interface EventRowProps {
	event: StudioEvent;
	isNew: boolean;
}

export default function EventRow({ event, isNew }: EventRowProps) {
	const style = getEventStyle(event.type);
	const summary = payloadSummary(event.payload);

	return (
		<div
			className={`
				flex items-start gap-3 px-4 py-2.5 border-b border-[#1a1a1a]
				hover:bg-[#111111] transition-colors
				${isNew ? 'animate-pulse-once' : ''}
			`}
		>
			<div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">{style.icon}</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2 flex-wrap">
					<span className={`text-[11px] font-semibold uppercase tracking-wide ${style.labelColor}`}>
						{formatEventType(event.type)}
					</span>
					<span className="text-[10px] text-[#525252] font-mono">{formatTime(event.timestamp)}</span>
				</div>
				{summary && (
					<p className="text-[12px] text-[#a3a3a3] mt-0.5 truncate" title={summary}>
						{summary}
					</p>
				)}
			</div>

			<div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${style.dotColor}`} />
		</div>
	);
}
