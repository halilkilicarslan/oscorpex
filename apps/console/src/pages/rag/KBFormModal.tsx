import { useState } from 'react';
import { X, ChevronDown, AlertCircle } from 'lucide-react';
import type { KnowledgeBase } from '../studio/settings/rag-types.js';
import { TYPE_CONFIG, EMBEDDING_MODELS } from './constants.js';

export interface KBFormData {
	name: string;
	description: string;
	type: string;
	embedding_model: string;
	chunk_size: number;
	chunk_overlap: number;
}

interface KBFormModalProps {
	initial?: KnowledgeBase | null;
	onClose: () => void;
	onSave: (data: KBFormData) => Promise<void>;
}

export function KBFormModal({ initial, onClose, onSave }: KBFormModalProps) {
	const [form, setForm] = useState<KBFormData>({
		name: initial?.name ?? '',
		description: initial?.description ?? '',
		type: initial?.type ?? 'text',
		embedding_model: initial?.embedding_model ?? 'text-embedding-3-small',
		chunk_size: initial?.chunk_size ?? 512,
		chunk_overlap: initial?.chunk_overlap ?? 50,
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!form.name.trim()) { setError('Name is required'); return; }
		setSaving(true);
		setError('');
		try {
			await onSave(form);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
			<div className="bg-[#111111] border border-[#262626] rounded-xl w-full max-w-lg mx-4 shadow-2xl">
				<div className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
					<h2 className="text-[#fafafa] font-semibold text-base">
						{initial ? 'Edit Knowledge Base' : 'Create Knowledge Base'}
					</h2>
					<button onClick={onClose} className="text-[#525252] hover:text-[#fafafa] transition-colors">
						<X className="w-5 h-5" />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="p-6 space-y-4">
					{error && (
						<div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
							<AlertCircle className="w-4 h-4 flex-shrink-0" />
							{error}
						</div>
					)}

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Name</label>
						<input
							type="text"
							value={form.name}
							onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
							placeholder="My Knowledge Base"
							className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Description</label>
						<textarea
							value={form.description}
							onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
							placeholder="Describe this knowledge base..."
							rows={2}
							className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Type</label>
						<div className="grid grid-cols-5 gap-2">
							{Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
								const { Icon, label, color } = cfg;
								const active = form.type === key;
								return (
									<button
										key={key}
										type="button"
										onClick={() => setForm(f => ({ ...f, type: key }))}
										className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all text-xs font-medium"
										style={{
											borderColor: active ? color : '#262626',
											backgroundColor: active ? `${color}15` : '#1a1a1a',
											color: active ? color : '#525252',
										}}
									>
										<Icon className="w-4 h-4" />
										{label}
									</button>
								);
							})}
						</div>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Embedding Model</label>
						<div className="relative">
							<select
								value={form.embedding_model}
								onChange={e => setForm(f => ({ ...f, embedding_model: e.target.value }))}
								className="w-full appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
							>
								{EMBEDDING_MODELS.map(m => (
									<option key={m} value={m}>{m}</option>
								))}
							</select>
							<ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">
								Chunk Size <span className="text-[#525252]">({form.chunk_size})</span>
							</label>
							<input
								type="range"
								min={128}
								max={2048}
								step={64}
								value={form.chunk_size}
								onChange={e => setForm(f => ({ ...f, chunk_size: parseInt(e.target.value) }))}
								className="w-full accent-[#22c55e]"
							/>
							<div className="flex justify-between text-xs text-[#525252] mt-0.5">
								<span>128</span><span>2048</span>
							</div>
						</div>
						<div>
							<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">
								Chunk Overlap <span className="text-[#525252]">({form.chunk_overlap})</span>
							</label>
							<input
								type="range"
								min={0}
								max={200}
								step={10}
								value={form.chunk_overlap}
								onChange={e => setForm(f => ({ ...f, chunk_overlap: parseInt(e.target.value) }))}
								className="w-full accent-[#22c55e]"
							/>
							<div className="flex justify-between text-xs text-[#525252] mt-0.5">
								<span>0</span><span>200</span>
							</div>
						</div>
					</div>

					<div className="flex gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="flex-1 px-4 py-2 text-sm font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg hover:text-[#fafafa] hover:border-[#404040] transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={saving}
							className="flex-1 px-4 py-2 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
						>
							{saving ? 'Saving...' : initial ? 'Update' : 'Create'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
