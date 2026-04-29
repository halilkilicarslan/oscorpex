import { X } from 'lucide-react';
import AgentChat from '../AgentChat';
import type { ProjectAgent } from '../../../lib/studio-api';

interface ChatModalProps {
	projectId: string;
	chatAgent: ProjectAgent | null;
	onClose: () => void;
}

export default function ChatModal({ projectId, chatAgent, onClose }: ChatModalProps) {
	if (!chatAgent) return null;

	return (
		<div
			className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
			onClick={onClose}
		>
			<div
				className="bg-[#0a0a0a] border border-[#262626] rounded-xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					onClick={onClose}
					className="absolute top-4 right-4 p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors z-10"
					aria-label="Close"
				>
					<X size={14} />
				</button>
				<AgentChat
					projectId={projectId}
					agentId={chatAgent.id}
					agentName={chatAgent.name}
				/>
			</div>
		</div>
	);
}
