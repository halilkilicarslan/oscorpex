import { useState, useEffect, useCallback } from 'react';
import { X, FileText, Trash2 } from 'lucide-react';
import type { KnowledgeBase, RagDocument } from '../studio/settings/rag-types.js';
import { observabilityDelete, observabilityGet } from '../../lib/observability-api.js';
import { StatusBadge } from './StatusBadges.js';
import { formatBytes, formatRelTime } from './constants.js';

interface KBDocsModalProps {
	kb: KnowledgeBase;
	onClose: () => void;
}

export function KBDocsModal({ kb, onClose }: KBDocsModalProps) {
	const [docs, setDocs] = useState<RagDocument[]>([]);
	const [loading, setLoading] = useState(true);

	const loadDocs = useCallback(async () => {
		setLoading(true);
		try {
			const data = await observabilityGet<{ documents?: RagDocument[] }>(`/rag/knowledge-bases/${kb.id}`);
			setDocs(data.documents ?? []);
		} finally {
			setLoading(false);
		}
	}, [kb.id]);

	useEffect(() => { loadDocs(); }, [loadDocs]);

	async function handleDelete(docId: string) {
		if (!confirm('Delete this document?')) return;
		await observabilityDelete(`/rag/knowledge-bases/${kb.id}/documents/${docId}`);
		loadDocs();
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
			<div className="bg-[#111111] border border-[#262626] rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
				<div className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
					<div>
						<h2 className="text-[#fafafa] font-semibold text-base">{kb.name}</h2>
						<p className="text-xs text-[#525252] mt-0.5">Documents in this knowledge base</p>
					</div>
					<button onClick={onClose} className="text-[#525252] hover:text-[#fafafa] transition-colors">
						<X className="w-5 h-5" />
					</button>
				</div>
				<div className="overflow-y-auto flex-1 p-4 space-y-2">
					{loading ? (
						<div className="text-center py-8 text-[#525252] text-sm">Loading...</div>
					) : docs.length === 0 ? (
						<div className="text-center py-12">
							<FileText className="w-10 h-10 text-[#262626] mx-auto mb-3" />
							<p className="text-[#525252] text-sm">No documents yet</p>
						</div>
					) : (
						docs.map(doc => (
							<div key={doc.id} className="bg-[#161616] border border-[#262626] rounded-lg p-3">
								<div className="flex items-start justify-between gap-2">
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 flex-wrap mb-1">
											<span className="text-sm font-medium text-[#fafafa]">{doc.name}</span>
											<StatusBadge status={doc.status} />
										</div>
										{doc.source && (
											<p className="text-xs text-[#525252] mb-1 truncate">{doc.source}</p>
										)}
										<div className="flex items-center gap-3 text-xs text-[#525252] mb-2">
											<span>{doc.chunk_count} chunks</span>
											<span>{formatBytes(doc.size_bytes)}</span>
											<span>{formatRelTime(doc.created_at)}</span>
										</div>
										{doc.content_preview && (
											<pre className="text-xs text-[#a3a3a3] font-mono bg-[#0a0a0a] rounded p-2 overflow-hidden" style={{ maxHeight: '2.8em', lineHeight: '1.4' }}>
												{doc.content_preview.split('\n').slice(0, 2).join('\n')}
											</pre>
										)}
									</div>
									<button
										onClick={() => handleDelete(doc.id)}
										className="p-1.5 text-[#525252] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors flex-shrink-0"
									>
										<Trash2 className="w-4 h-4" />
									</button>
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
