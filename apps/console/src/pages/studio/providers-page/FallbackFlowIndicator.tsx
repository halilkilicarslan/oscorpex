// ---------------------------------------------------------------------------
// Fallback Flow Indicator
// ---------------------------------------------------------------------------

import { ArrowRight } from 'lucide-react';
import type { AIProvider } from '../../../lib/studio-api';
import { getFallbackLabel } from './helpers.js';

interface FallbackFlowIndicatorProps {
	chain: AIProvider[];
}

export default function FallbackFlowIndicator({ chain }: FallbackFlowIndicatorProps) {
	if (chain.length < 2) return null;

	return (
		<div className="flex items-center gap-1.5 flex-wrap mb-4 px-1">
			{chain.map((provider, index) => {
				const label = getFallbackLabel(index);
				return (
					<div key={provider.id} className="flex items-center gap-1.5">
						<div className="flex items-center gap-1">
							<span
								className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
									index === 0
										? 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30'
										: 'bg-[#1a1a1a] text-[#525252] border border-[#2a2a2a]'
								}`}
							>
								{label.text}
							</span>
							<span className="text-[11px] text-[#404040] truncate max-w-[80px]">
								{provider.name}
							</span>
						</div>
						{index < chain.length - 1 && <ArrowRight size={11} className="text-[#333] shrink-0" />}
					</div>
				);
			})}
		</div>
	);
}
