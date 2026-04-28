// ---------------------------------------------------------------------------
// Fallback Order Panel
// ---------------------------------------------------------------------------

import { ChevronUp, ChevronDown } from 'lucide-react';
import type { AIProvider } from '../../../lib/studio-api';
import { TypeBadge, getFallbackLabel } from './helpers.js';

interface FallbackOrderPanelProps {
	chain: AIProvider[];
	onMoveUp: (index: number) => void;
	onMoveDown: (index: number) => void;
	saving: boolean;
}

export default function FallbackOrderPanel({ chain, onMoveUp, onMoveDown, saving }: FallbackOrderPanelProps) {
	if (chain.length === 0) {
		return <div className="text-[12px] text-[#525252] py-4 text-center">No active providers yet</div>;
	}

	return (
		<div className="flex flex-col gap-2">
			{chain.map((provider, index) => {
				const isPrimary = index === 0;
				const label = getFallbackLabel(index);

				return (
					<div key={provider.id} className="flex items-stretch gap-0">
						<div className="flex flex-col items-center w-6 shrink-0 mr-2">
							{index > 0 && <div className="w-px flex-1 bg-[#2a2a2a] mb-0.5" />}
							<div className={`w-2 h-2 rounded-full shrink-0 my-1 ${isPrimary ? 'bg-[#22c55e]' : 'bg-[#333]'}`} />
							{index < chain.length - 1 && <div className="w-px flex-1 bg-[#2a2a2a] mt-0.5" />}
						</div>

						<div
							className={`flex items-center gap-3 flex-1 rounded-lg px-3 py-2.5 mb-1.5 transition-colors ${
								isPrimary
									? 'bg-[#0d1a0d] border border-[#22c55e]/25'
									: 'bg-[#111111] border border-[#262626]'
							}`}
						>
							<span className={`shrink-0 ${label.className}`}>{label.text}</span>
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<TypeBadge type={provider.type} />
								<span className="text-[12px] text-[#fafafa] truncate font-medium">{provider.name}</span>
								{provider.model && (
									<span className="text-[10px] text-[#525252] truncate hidden sm:block">{provider.model}</span>
								)}
							</div>
							<div className="flex items-center gap-0.5 shrink-0">
								<button
									onClick={() => onMoveUp(index)}
									disabled={index === 0 || saving}
									className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
									title="Move up"
								>
									<ChevronUp size={14} />
								</button>
								<button
									onClick={() => onMoveDown(index)}
									disabled={index === chain.length - 1 || saving}
									className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
									title="Move down"
								>
									<ChevronDown size={14} />
								</button>
							</div>
						</div>
					</div>
				);
			})}
			<p className="text-[11px] text-[#404040] mt-1 pl-8">
				If the primary provider fails, the next provider in the chain is tried automatically.
			</p>
		</div>
	);
}
