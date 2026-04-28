import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

interface SectionProps {
	title: string;
	icon: React.ReactNode;
	expanded: boolean;
	onToggle: () => void;
	badge?: string;
	status?: 'ok' | 'warning';
	children: React.ReactNode;
}

export default function Section({ title, icon, expanded, onToggle, badge, status, children }: SectionProps) {
	return (
		<div className="bg-[#0a0a0b] rounded-lg border border-[#27272a]">
			<button
				onClick={onToggle}
				className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#18181b] rounded-t-lg"
			>
				<div className="flex items-center gap-2 text-sm text-[#fafafa]">
					{icon}
					{title}
					{badge && (
						<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#27272a] text-[#a1a1aa]">
							{badge}
						</span>
					)}
					{status === 'ok' && <CheckCircle2 size={12} className="text-[#22c55e]" />}
					{status === 'warning' && <AlertTriangle size={12} className="text-[#f59e0b]" />}
				</div>
				{expanded ? (
					<ChevronDown size={14} className="text-[#71717a]" />
				) : (
					<ChevronRight size={14} className="text-[#71717a]" />
				)}
			</button>
			{expanded && <div className="px-3 pb-3">{children}</div>}
		</div>
	);
}
