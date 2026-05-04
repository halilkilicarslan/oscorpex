import { useState } from 'react';
import { Copy, Check, History, Edit3, FileCode, Trash2, Layers, BarChart2, Clock } from 'lucide-react';
import { type PromptTemplate, previewLines, relativeTime } from './types.js';
import { CategoryBadge } from './CategoryBadge.js';
import { TagPill } from './TagPill.js';
import { VariablePill } from './VariablePill.js';

export interface TemplateCardProps {
	template: PromptTemplate;
	onEdit: (t: PromptTemplate) => void;
	onDuplicate: (t: PromptTemplate) => void;
	onDelete: (t: PromptTemplate) => void;
	onCopy: (t: PromptTemplate) => void;
	onViewHistory: (t: PromptTemplate) => void;
}

export function TemplateCard({ template, onEdit, onDuplicate, onDelete, onCopy, onViewHistory }: TemplateCardProps) {
	const [copied, setCopied] = useState(false);
	const preview = previewLines(template.content, 3);

	const handleCopy = () => {
		navigator.clipboard.writeText(template.content).then(() => {
			setCopied(true);
			onCopy(template);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden hover:border-[#333] transition-colors group flex flex-col">
			{/* Header */}
			<div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 mb-1 flex-wrap">
						<h3 className="text-[14px] font-semibold text-[#fafafa] truncate">{template.name}</h3>
						<CategoryBadge category={template.category} />
					</div>
					{template.description && (
						<p className="text-[12px] text-[#737373] line-clamp-2 leading-relaxed">
							{template.description}
						</p>
					)}
				</div>
				{/* Actions */}
				<div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
					<button onClick={handleCopy} title="Copy content" className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
						{copied
							? <Check size={13} className="text-[#22c55e]" />
							: <Copy size={13} className="text-[#525252] hover:text-[#a3a3a3]" />}
					</button>
					<button onClick={() => onViewHistory(template)} title="Version history" className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
						<History size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
					</button>
					<button onClick={() => onEdit(template)} title="Edit" className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
						<Edit3 size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
					</button>
					<button onClick={() => onDuplicate(template)} title="Duplicate" className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
						<FileCode size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
					</button>
					<button onClick={() => onDelete(template)} title="Delete" className="p-1.5 rounded-lg hover:bg-[#ef4444]/10 transition-colors">
						<Trash2 size={13} className="text-[#525252] hover:text-[#ef4444]" />
					</button>
				</div>
			</div>

			{/* Content preview */}
			<div className="mx-4 mb-3 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg p-3 flex-1">
				<pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-words leading-relaxed line-clamp-3">
					{preview}
				</pre>
			</div>

			{/* Variables */}
			{template.variables.length > 0 && (
				<div className="px-4 mb-3 flex flex-wrap gap-1.5">
					{template.variables.map((v) => <VariablePill key={v} name={v} />)}
				</div>
			)}

			{/* Tags */}
			{template.tags.length > 0 && (
				<div className="px-4 mb-3 flex flex-wrap gap-1.5">
					{template.tags.map((t) => <TagPill key={t} tag={t} />)}
				</div>
			)}

			{/* Footer */}
			<div className="px-4 pb-3 flex items-center gap-3 text-[10px] text-[#525252] border-t border-[#1a1a1a] pt-2 mt-auto">
				<span className="flex items-center gap-1"><Layers size={9} />v{template.version}</span>
				<span className="flex items-center gap-1"><BarChart2 size={9} />{template.usage_count} uses</span>
				<span className="flex items-center gap-1 ml-auto"><Clock size={9} />{relativeTime(template.updated_at)}</span>
			</div>
		</div>
	);
}
