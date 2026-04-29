import { Check, Copy, Clock } from 'lucide-react';
import { statusColor, formatBody } from './helpers.js';

interface ResponsePanelProps {
	response: {
		status: number;
		headers: Record<string, string>;
		body: string;
		duration: number;
	};
	responseTab: 'body' | 'headers';
	onTabChange: (tab: 'body' | 'headers') => void;
	onCopy: () => void;
	copied: boolean;
}

export default function ResponsePanel({
	response,
	responseTab,
	onTabChange,
	onCopy,
	copied,
}: ResponsePanelProps) {
	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="flex items-center gap-3 px-3 py-2 border-b border-[#262626] bg-[#111111]">
				<span className="text-[11px] font-medium text-[#a3a3a3]">Response</span>
				<span className={`text-[12px] font-bold ${statusColor(response.status)}`}>
					{response.status}
				</span>
				<span className="flex items-center gap-1 text-[10px] text-[#525252]">
					<Clock size={10} />
					{response.duration}ms
				</span>
				<div className="ml-auto flex items-center gap-1">
					{(['body', 'headers'] as const).map((tab) => (
						<button
							key={tab}
							onClick={() => onTabChange(tab)}
							className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
								responseTab === tab
									? 'bg-[#262626] text-[#e5e5e5]'
									: 'text-[#525252] hover:text-[#a3a3a3]'
							}`}
						>
							{tab === 'body' ? 'Body' : `Headers (${Object.keys(response.headers).length})`}
						</button>
					))}
					<button
						onClick={onCopy}
						className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors ml-1"
					>
						{copied ? <Check size={10} className="text-[#22c55e]" /> : <Copy size={10} />}
						{copied ? 'Kopyalandi' : 'Kopyala'}
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-auto p-3">
				{responseTab === 'body' ? (
					<pre className="text-[11px] text-[#e5e5e5] font-mono whitespace-pre-wrap break-words leading-relaxed">
						{formatBody(response.body)}
					</pre>
				) : (
					<div className="space-y-0.5">
						{Object.entries(response.headers).map(([key, val]) => (
							<div key={key} className="flex gap-2 text-[11px] font-mono py-0.5">
								<span className="text-[#3b82f6] shrink-0">{key}:</span>
								<span className="text-[#a3a3a3] break-all">{val}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
