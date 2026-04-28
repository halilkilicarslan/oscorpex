import { FileText } from 'lucide-react';
import type { DocFreshnessItem } from '../../../lib/studio-api';

interface DocsFreshnessPanelProps {
	items: DocFreshnessItem[];
}

export default function DocsFreshnessPanel({ items }: DocsFreshnessPanelProps) {
	if (items.length === 0) return null;

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<FileText size={14} className="text-[#60a5fa]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Dokumantasyon Durumu</h3>
				<span className="ml-auto text-[10px] text-[#525252]">
					{items.filter((d) => d.status === 'filled').length}/{items.length} dolu
				</span>
			</div>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
				{items.map((doc) => (
					<div
						key={doc.file}
						className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
							doc.status === 'filled'
								? 'border-[#166534] bg-[#052e16]/40'
								: doc.status === 'tbd'
									? 'border-[#854d0e] bg-[#422006]/40'
									: 'border-[#7f1d1d] bg-[#450a0a]/40'
						}`}
					>
						<div
							className={`w-2 h-2 rounded-full ${
								doc.status === 'filled'
									? 'bg-[#22c55e]'
									: doc.status === 'tbd'
										? 'bg-[#eab308]'
										: 'bg-[#ef4444]'
							}`}
						/>
						<span className="text-[11px] text-[#a3a3a3] truncate">{doc.file}</span>
					</div>
				))}
			</div>
		</div>
	);
}
