import { Suspense, lazy } from 'react';
import { ChevronUp } from 'lucide-react';
import TerminalLoader from './terminal-loader.js';

const AgentTerminal = lazy(() => import('../AgentTerminal'));

interface EmbeddedTerminalProps {
	projectId: string;
	agentId: string;
	agentName: string;
	agentAvatar?: string;
	show: boolean;
	onClose: () => void;
}

export default function EmbeddedTerminal({
	projectId,
	agentId,
	agentName,
	agentAvatar,
	show,
	onClose,
}: EmbeddedTerminalProps) {
	if (!show) return null;

	return (
		<div className="border-t border-[#262626]">
			<div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d0d]">
				<span className="text-[10px] text-[#525252] font-medium uppercase tracking-wide">Terminal</span>
				<button
					onClick={onClose}
					className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
					title="Terminali kapat"
				>
					<ChevronUp size={12} />
				</button>
			</div>
			<div className="h-[250px]">
				<Suspense fallback={<TerminalLoader />}>
					<AgentTerminal
						projectId={projectId}
						agentId={agentId}
						agentName={agentName}
						agentAvatar={agentAvatar}
					/>
				</Suspense>
			</div>
		</div>
	);
}
