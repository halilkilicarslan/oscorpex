import { Tag, X } from 'lucide-react';

interface TagPillProps {
	tag: string;
	onRemove?: () => void;
}

export function TagPill({ tag, onRemove }: TagPillProps) {
	return (
		<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1f1f1f] border border-[#333] text-[10px] text-[#a3a3a3]">
			<Tag size={8} className="shrink-0" />
			{tag}
			{onRemove && (
				<button onClick={onRemove} className="ml-0.5 hover:text-[#ef4444] transition-colors">
					<X size={8} />
				</button>
			)}
		</span>
	);
}
