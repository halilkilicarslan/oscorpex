import { Database, FileText, Layers, Zap, Clock, Plus, Edit3, Trash2 } from 'lucide-react';
import { observabilityDelete, observabilityPost, observabilityPut } from '../../lib/observability-api.js';
import { useModalState } from '../../hooks/useModalState.js';
import type { KnowledgeBase } from '../studio/settings/rag-types.js';
import { KBFormModal, type KBFormData } from './KBFormModal.js';
import { KBDocsModal } from './KBDocsModal.js';
import { TypeBadge } from './TypeBadge.js';
import { StatusDot } from './StatusBadges.js';
import { formatRelTime, truncate } from './constants.js';

interface KBTabProps {
	kbs: KnowledgeBase[];
	onRefresh: () => void;
}

export function KBTab({ kbs, onRefresh }: KBTabProps) {
	const createModal = useModalState<KnowledgeBase>();
	const editModal = useModalState<KnowledgeBase>();
	const docsModal = useModalState<KnowledgeBase>();

	async function handleCreate(data: KBFormData) {
		await observabilityPost('/rag/knowledge-bases', data);
		onRefresh();
	}

	async function handleUpdate(data: KBFormData) {
		if (!editModal.selectedItem) return;
		await observabilityPut(`/rag/knowledge-bases/${editModal.selectedItem.id}`, data);
		onRefresh();
	}

	async function handleDelete(kb: KnowledgeBase) {
		if (!confirm(`Delete "${kb.name}"? This will also delete all documents.`)) return;
		await observabilityDelete(`/rag/knowledge-bases/${kb.id}`);
		onRefresh();
	}

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<p className="text-sm text-[#525252]">{kbs.length} knowledge base{kbs.length !== 1 ? 's' : ''}</p>
				<button
					onClick={() => createModal.open()}
					className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] transition-colors"
				>
					<Plus className="w-4 h-4" />
					Create Knowledge Base
				</button>
			</div>

			{kbs.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-24 text-center">
					<Database className="w-12 h-12 text-[#262626] mb-4" />
					<p className="text-[#525252] text-sm">No knowledge bases yet</p>
					<p className="text-[#404040] text-xs mt-1">Create one to start indexing documents</p>
					<button
						onClick={() => createModal.open()}
						className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] transition-colors"
					>
						<Plus className="w-4 h-4" />
						Create Knowledge Base
					</button>
				</div>
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					{kbs.map(kb => {
						return (
							<div key={kb.id} className="bg-[#111111] border border-[#262626] rounded-xl p-5 hover:border-[#404040] transition-colors">
								<div className="flex items-start justify-between mb-3">
									<div className="flex items-center gap-2 flex-wrap">
										<span className="text-[#fafafa] font-semibold text-sm">{kb.name}</span>
										<TypeBadge type={kb.type} />
									</div>
									<StatusDot status={kb.status} />
								</div>

								{kb.description && (
									<p className="text-xs text-[#525252] mb-3 leading-relaxed">{truncate(kb.description, 120)}</p>
								)}

								<div className="flex items-center gap-4 text-xs text-[#a3a3a3] mb-3">
									<span className="flex items-center gap-1">
										<FileText className="w-3.5 h-3.5 text-[#525252]" />
										{kb.document_count} docs
									</span>
									<span className="flex items-center gap-1">
										<Layers className="w-3.5 h-3.5 text-[#525252]" />
										{kb.total_chunks.toLocaleString()} chunks
									</span>
									<span className="flex items-center gap-1">
										<Clock className="w-3.5 h-3.5 text-[#525252]" />
										{formatRelTime(kb.last_indexed_at)}
									</span>
								</div>

								<div className="flex items-center gap-2 flex-wrap mb-4">
									<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626]">
										<Zap className="w-3 h-3 text-[#525252]" />
										{kb.embedding_model}
									</span>
									<span className="text-xs text-[#525252] bg-[#1a1a1a] border border-[#262626] rounded px-2 py-0.5">
										size: {kb.chunk_size}
									</span>
									<span className="text-xs text-[#525252] bg-[#1a1a1a] border border-[#262626] rounded px-2 py-0.5">
										overlap: {kb.chunk_overlap}
									</span>
								</div>

								<div className="flex items-center gap-2 pt-3 border-t border-[#1e1e1e]">
									<button
										onClick={() => docsModal.open(kb)}
										className="flex-1 text-xs font-medium text-[#a3a3a3] hover:text-[#fafafa] bg-[#1a1a1a] hover:bg-[#222] border border-[#262626] rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1.5"
									>
										<FileText className="w-3.5 h-3.5" />
										View Documents
									</button>
									<button
										onClick={() => editModal.open(kb)}
										className="p-1.5 text-[#525252] hover:text-[#a3a3a3] bg-[#1a1a1a] hover:bg-[#222] border border-[#262626] rounded-lg transition-colors"
										title="Edit"
									>
										<Edit3 className="w-3.5 h-3.5" />
									</button>
									<button
										onClick={() => handleDelete(kb)}
										className="p-1.5 text-[#525252] hover:text-red-400 bg-[#1a1a1a] hover:bg-red-400/10 border border-[#262626] hover:border-red-400/30 rounded-lg transition-colors"
										title="Delete"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</button>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{createModal.isOpen && (
				<KBFormModal onClose={createModal.close} onSave={handleCreate} />
			)}
			{editModal.isOpen && editModal.selectedItem && (
				<KBFormModal initial={editModal.selectedItem} onClose={editModal.close} onSave={handleUpdate} />
			)}
			{docsModal.isOpen && docsModal.selectedItem && (
				<KBDocsModal kb={docsModal.selectedItem} onClose={() => { docsModal.close(); onRefresh(); }} />
			)}
		</div>
	);
}
