import { useState } from 'react';
import { ScrollText, X, ChevronDown, Check, AlertCircle } from 'lucide-react';
import { type PromptTemplate, type Category, type EditorFormState, CATEGORIES, extractVariables } from './types.js';
import { TagInput } from './TagInput.js';
import { VariablePill } from './VariablePill.js';

interface TemplateEditorProps {
	initial?: PromptTemplate | null;
	onClose: () => void;
	onSave: (data: EditorFormState) => Promise<void>;
}

export function TemplateEditor({ initial, onClose, onSave }: TemplateEditorProps) {
	const [form, setForm] = useState<EditorFormState>({
		name: initial?.name ?? '',
		description: initial?.description ?? '',
		category: (initial?.category as Category) ?? 'general',
		content: initial?.content ?? '',
		variables: initial?.variables ?? [],
		tags: initial?.tags ?? [],
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const detectedVars = extractVariables(form.content);

	const handleContentChange = (content: string) => {
		const vars = extractVariables(content);
		setForm((f) => ({ ...f, content, variables: vars }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.name.trim() || !form.content.trim()) {
			setError('Name and content are required.');
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onSave({ ...form, variables: detectedVars });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
			<div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-[#1f1f1f] shrink-0">
					<div className="flex items-center gap-2">
						<div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 flex items-center justify-center">
							<ScrollText size={15} className="text-[#22c55e]" />
						</div>
						<h2 className="text-[15px] font-semibold text-[#fafafa]">
							{initial ? 'Edit Template' : 'Create Template'}
						</h2>
					</div>
					<button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
						<X size={16} className="text-[#525252]" />
					</button>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="p-6 space-y-5 flex-1">
					{/* Name */}
					<div>
						<label className="block text-[11px] font-medium text-[#737373] mb-1.5">
							Name <span className="text-[#ef4444]">*</span>
						</label>
						<input
							type="text"
							value={form.name}
							onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
							placeholder="e.g. System Prompt - Helpful Assistant"
							className="w-full bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 text-[13px] text-[#fafafa] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333]"
						/>
					</div>

					{/* Category */}
					<div>
						<label className="block text-[11px] font-medium text-[#737373] mb-1.5">Category</label>
						<div className="relative">
							<select
								value={form.category}
								onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
								className="w-full appearance-none bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 text-[13px] text-[#a3a3a3] focus:outline-none focus:border-[#333] pr-8"
							>
								{CATEGORIES.filter((c) => c.value !== 'all').map((c) => (
									<option key={c.value} value={c.value}>{c.label}</option>
								))}
							</select>
							<ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
						</div>
					</div>

					{/* Description */}
					<div>
						<label className="block text-[11px] font-medium text-[#737373] mb-1.5">Description</label>
						<textarea
							value={form.description}
							onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
							placeholder="Brief description of what this prompt does..."
							rows={2}
							className="w-full bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 text-[13px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333] resize-none leading-relaxed"
						/>
					</div>

					{/* Content */}
					<div>
						<div className="flex items-center justify-between mb-1.5">
							<label className="text-[11px] font-medium text-[#737373]">
								Content <span className="text-[#ef4444]">*</span>
							</label>
							{detectedVars.length > 0 && (
								<span className="text-[10px] text-[#525252]">
									{detectedVars.length} variable{detectedVars.length !== 1 ? 's' : ''} detected
								</span>
							)}
						</div>
						<textarea
							value={form.content}
							onChange={(e) => handleContentChange(e.target.value)}
							placeholder={"You are a helpful assistant.\n\nUser context: {{context}}\nTask: {{task}}"}
							rows={10}
							className="w-full bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2.5 text-[12px] text-[#d4d4d4] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333] resize-none font-mono leading-relaxed"
						/>
						{detectedVars.length > 0 && (
							<div className="mt-2 flex flex-wrap gap-1.5">
								{detectedVars.map((v) => <VariablePill key={v} name={v} />)}
							</div>
						)}
					</div>

					{/* Tags */}
					<div>
						<label className="block text-[11px] font-medium text-[#737373] mb-1.5">Tags</label>
						<TagInput tags={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
						<p className="text-[10px] text-[#525252] mt-1">Press Enter or comma to add a tag</p>
					</div>

					{/* Error */}
					{error && (
						<div className="flex items-center gap-2 px-3 py-2 bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg">
							<AlertCircle size={13} className="text-[#ef4444] shrink-0" />
							<p className="text-[12px] text-[#ef4444]">{error}</p>
						</div>
					)}

					{/* Actions */}
					<div className="flex gap-2 pt-1">
						<button
							type="button"
							onClick={onClose}
							className="flex-1 px-4 py-2 rounded-lg border border-[#262626] text-[13px] text-[#a3a3a3] hover:border-[#333] transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={saving}
							className="flex-1 px-4 py-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[13px] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							{saving
								? <div className="w-4 h-4 rounded-full border-2 border-[#22c55e]/30 border-t-[#22c55e] animate-spin" />
								: <Check size={14} />}
							{initial ? 'Save Changes' : 'Create Template'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
