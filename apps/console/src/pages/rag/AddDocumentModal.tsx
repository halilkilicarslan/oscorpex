import { useState } from 'react';
import { X, ChevronDown, AlertCircle } from 'lucide-react';
import type { KnowledgeBase } from '../studio/settings/rag-types.js';

interface AddDocumentModalProps {
	knowledgeBases: KnowledgeBase[];
	defaultKbId?: string;
	onClose: () => void;
	onSave: (kbId: string, data: { name: string; source: string; content: string; chunk_count: number }) => Promise<void>;
}

export function AddDocumentModal({ knowledgeBases, defaultKbId, onClose, onSave }: AddDocumentModalProps) {
	const [kbId, setKbId] = useState(defaultKbId ?? knowledgeBases[0]?.id ?? '');
	const [name, setName] = useState('');
	const [source, setSource] = useState('');
	const [content, setContent] = useState('');
	const [chunkCount, setChunkCount] = useState(0);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!kbId) { setError('Select a knowledge base'); return; }
		if (!name.trim()) { setError('Name is required'); return; }
		setSaving(true);
		setError('');
		try {
			await onSave(kbId, { name: name.trim(), source: source.trim(), content, chunk_count: chunkCount });
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
					<h2 className="text-[#fafafa] font-semibold text-base">Add Document</h2>
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
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Knowledge Base</label>
						<div className="relative">
							<select
								value={kbId}
								onChange={e => setKbId(e.target.value)}
								className="w-full appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
							>
								{knowledgeBases.map(kb => (
									<option key={kb.id} value={kb.id}>{kb.name}</option>
								))}
							</select>
							<ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
						</div>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Document Name</label>
						<input
							type="text"
							value={name}
							onChange={e => setName(e.target.value)}
							placeholder="e.g. company-policy.pdf"
							className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Source (URL or path)</label>
						<input
							type="text"
							value={source}
							onChange={e => setSource(e.target.value)}
							placeholder="https://example.com/doc or /path/to/file"
							className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Content</label>
						<textarea
							value={content}
							onChange={e => setContent(e.target.value)}
							placeholder="Paste document content here..."
							rows={5}
							className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] font-mono placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Chunk Count</label>
						<input
							type="number"
							min={0}
							value={chunkCount}
							onChange={e => setChunkCount(parseInt(e.target.value) || 0)}
							className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
						/>
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
							{saving ? 'Adding...' : 'Add Document'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
