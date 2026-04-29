import { Loader2, WifiOff, Radio } from 'lucide-react';
import type { WSConnectionState } from '../../../hooks/useStudioWebSocket';

interface ConnectionBadgeProps {
	state: WSConnectionState;
	transport: 'ws' | 'sse';
}

export default function ConnectionBadge({ state, transport }: ConnectionBadgeProps) {
	if (state === 'connected') {
		return (
			<>
				<span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
				<span className="text-[10px] text-[#22c55e] font-medium">Live</span>
				<span className="text-[10px] text-[#383838] ml-0.5">({transport.toUpperCase()})</span>
			</>
		);
	}
	if (state === 'connecting') {
		return (
			<>
				<Loader2 size={10} className="text-[#f59e0b] animate-spin" />
				<span className="text-[10px] text-[#f59e0b] font-medium">Connecting</span>
			</>
		);
	}
	if (state === 'error') {
		return (
			<>
				<Radio size={10} className="text-[#f97316]" />
				<span className="text-[10px] text-[#f97316] font-medium">WS Error — SSE fallback</span>
			</>
		);
	}
	return (
		<>
			<WifiOff size={10} className="text-[#ef4444]" />
			<span className="text-[10px] text-[#ef4444] font-medium">Disconnected</span>
			<span className="text-[10px] text-[#525252]">— retrying…</span>
		</>
	);
}
