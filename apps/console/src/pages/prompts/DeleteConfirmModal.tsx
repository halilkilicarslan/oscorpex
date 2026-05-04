import { Trash2 } from 'lucide-react';
import { type PromptTemplate } from './types.js';

interface DeleteConfirmModalProps {
	template: PromptTemplate;
	onConfirm: () => void;
	onCancel: () => void;
	deleting: boolean;
}

export function DeleteConfirmModal({ template, onConfirm, onCancel, deleting }: DeleteConfirmModalProps) {
	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onCancel}>
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center gap-3 mb-3">
					<div className="w-9 h-9 rounded-lg bg-[#ef4444]/10 flex items-center justify-center">
						<Trash2 size={16} className="text-[#ef4444]" />
					</div>
					<div>
						<h3 className="text-[14px] font-semibold text-[#fafafa]">Delete template</h3>
						<p className="text-[11px] text-[#525252]">This cannot be undone</p>
					</div>
				</div>
				<p className="text-[12px] text-[#a3a3a3] mb-5 leading-relaxed">
					Delete <span className="text-[#fafafa] font-medium">{template.name}</span>? The template will be soft-deleted and no longer visible.
				</p>
				<div className="flex gap-2">
					<button onClick={onCancel} className="flex-1 px-3 py-2 rounded-lg border border-[#262626] text-[12px] text-[#a3a3a3] hover:border-[#333] transition-colors">
						Cancel
					</button>
					<button
						onClick={onConfirm}
						disabled={deleting}
						className="flex-1 px-3 py-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 text-[12px] text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
					>
						{deleting && <div className="w-3 h-3 rounded-full border border-[#ef4444]/30 border-t-[#ef4444] animate-spin" />}
						Delete
					</button>
				</div>
			</div>
		</div>
	);
}
