import { Bot, Loader2 } from 'lucide-react';

interface StreamingBubbleProps {
	text: string;
}

export default function StreamingBubble({ text }: StreamingBubbleProps) {
	return (
		<div className="flex gap-3">
			<div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[#22c55e]/10">
				<Bot size={14} className="text-[#22c55e]" />
			</div>
			<div className="max-w-[80%] rounded-2xl rounded-tl-md px-4 py-2.5 bg-[#1a1a1a] border border-[#262626] text-[13px] leading-relaxed text-[#d4d4d4] whitespace-pre-wrap">
				{text || (
					<span className="flex items-center gap-2 text-[#525252]">
						<Loader2 size={12} className="animate-spin" />
						Thinking...
					</span>
				)}
			</div>
		</div>
	);
}
