import { CheckCircle2, XCircle, Loader2, Play, AlertCircle, Zap, GitBranch } from 'lucide-react';
import type { EventStyle } from './types.js';

export default function getEventStyle(type: string): EventStyle {
	switch (type) {
		case 'task:completed':
		case 'plan:approved':
		case 'project:completed':
			return {
				icon: <CheckCircle2 size={13} className="text-[#22c55e] shrink-0" />,
				labelColor: 'text-[#22c55e]',
				dotColor: 'bg-[#22c55e]',
				borderColor: 'border-[#22c55e]/20',
			};

		case 'task:failed':
		case 'plan:rejected':
			return {
				icon: <XCircle size={13} className="text-[#ef4444] shrink-0" />,
				labelColor: 'text-[#ef4444]',
				dotColor: 'bg-[#ef4444]',
				borderColor: 'border-[#ef4444]/20',
			};

		case 'task:started':
		case 'task:assigned':
			return {
				icon: <Loader2 size={13} className="text-[#f59e0b] shrink-0 animate-spin" />,
				labelColor: 'text-[#f59e0b]',
				dotColor: 'bg-[#f59e0b]',
				borderColor: 'border-[#f59e0b]/20',
			};

		case 'phase:started':
		case 'phase:completed':
			return {
				icon: <GitBranch size={13} className="text-[#3b82f6] shrink-0" />,
				labelColor: 'text-[#3b82f6]',
				dotColor: 'bg-[#3b82f6]',
				borderColor: 'border-[#3b82f6]/20',
			};

		case 'execution:started':
			return {
				icon: <Play size={13} className="text-[#22c55e] shrink-0" />,
				labelColor: 'text-[#22c55e]',
				dotColor: 'bg-[#22c55e]',
				borderColor: 'border-[#22c55e]/20',
			};

		case 'escalation':
			return {
				icon: <AlertCircle size={13} className="text-[#f97316] shrink-0" />,
				labelColor: 'text-[#f97316]',
				dotColor: 'bg-[#f97316]',
				borderColor: 'border-[#f97316]/20',
			};

		default:
			return {
				icon: <Zap size={13} className="text-[#a3a3a3] shrink-0" />,
				labelColor: 'text-[#a3a3a3]',
				dotColor: 'bg-[#525252]',
				borderColor: 'border-[#262626]',
			};
	}
}
