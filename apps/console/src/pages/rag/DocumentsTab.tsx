import { useState, useEffect, useCallback } from 'react';
import { FileText, Layers, Clock, Plus, Trash2, ChevronDown } from 'lucide-react';
import { observabilityDelete, observabilityGet, observabilityPost } from '../../lib/observability-api.js';
import type { KnowledgeBase, RagDocument } from '../studio/settings/rag-types.js';
import { AddDocumentModal } from './AddDocumentModal.js';
import { StatusBadge } from './StatusBadges.js';
import { formatBytes, formatRelTime } from './constants.js';

interface DocumentsTabProps {
	knowledgeBases: KnowledgeBase[];
	onRefresh: () => void;
}

export function DocumentsTab({ knowledgeBases, onRefresh }: DocumentsTabProps) {
	const [selectedKbId, setSelectedKbId] = useState<string>('all');
	const [docs, setDocs] = useState<RagDocument[]>([]);
	const [loading, setLoading] = useState(false);
	const [showAdd, setShowAdd] = useState(false);
	const [kbMap, setKbMap] = useState<Record<string, string>>({});

	useEffect(() => {
		const m: Record<string, string> = {};
		for (const kb of knowledgeBases) m[kb.id] = kb.name;
		setKbMap(m);
	}, [knowledgeBases]);

	const loadDocs = useCallback(async () => {
		setLoading(true);
		try {
			if (selectedKbId === 'all') {
				const all: RagDocument[] = [];
				for (const kb of knowledgeBases) {
					const data = await observabilityGet<{ documents?: RagDocument[] }>(`/rag/knowledge-bases/${kb.id}`);
					if (data.documents) all.push(...data.documents);
				}
				setDocs(all.sort((a, b) => b.created_at.localeCompare(a.created_at)));
			} else {
				const data = await observabilityGet<{ documents?: RagDocument[] }>(`/rag/knowledge-bases/${selectedKbId}`);
				setDocs(data.documents ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [selectedKbId, knowledgeBases]);

	useEffect(() => { loadDocs(); }, [loadDocs]);

	async function handleDelete(doc: RagDocument) {
		if (!confirm('Delete this document?')) return;
		await observabilityDelete(`/rag/knowledge-bases/${doc.kb_id}/documents/${doc.id}`);
		loadDocs();
		onRefresh();
	}

	async function handleAddDoc(kbId: string, data: { name: string; source: string; content: string; chunk_count: number }) {
		await observabilityPost(`/rag/knowledge-bases/${kbId}/documents`, data);
		onRefresh();
		loadDocs();
	}

	return (
		<div>
			<div className="flex items-center gap-3 mb-4 flex-wrap">
				<div className="relative flex-shrink-0">
					<select
						value={selectedKbId}
						onChange={e => setSelectedKbId(e.target.value)}
						className="appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
					>
						<option value="all">All Knowledge Bases</option>
						{knowledgeBases.map(kb => (
							<option key={kb.id} value={kb.id}>{kb.name}</option>
						))}
					</select>
					<ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
				</div>
				<span className="text-xs text-[#525252]">{docs.length} document{docs.length !== 1 ? 's' : ''}</span>
				<button
					onClick={() => setShowAdd(true)}
					disabled={knowledgeBases.length === 0}
					className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-40 transition-colors"
				>
					<Plus className="w-4 h-4" />
					Add Document
				</button>
			</div>

			{loading ? (
				<div className="text-center py-12 text-[#525252] text-sm">Loading documents...</div>
			) : docs.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-24 text-center">
					<FileText className="w-12 h-12 text-[#262626] mb-4" />
					<p className="text-[#525252] text-sm">No documents found</p>
					{knowledgeBases.length > 0 && (
						<button
							onClick={() => setShowAdd(true)}
							className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] transition-colors"
						>
							<Plus className="w-4 h-4" />
							Add Document
						</button>
					)}
				</div>
			) : (
				<div className="space-y-2">
					{docs.map(doc => (
						<div key={doc.id} className="bg-[#111111] border border-[#262626] rounded-xl p-4 hover:border-[#404040] transition-colors">
							<div className="flex items-start justify-between gap-3">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 flex-wrap mb-1">
										<span className="text-sm font-semibold text-[#fafafa]">{doc.name}</span>
										<StatusBadge status={doc.status} />
										{kbMap[doc.kb_id] && (
											<span className="text-xs text-[#525252] bg-[#1a1a1a] border border-[#262626] rounded px-1.5 py-0.5">
												{kbMap[doc.kb_id]}
											</span>
										)}
									</div>
									{doc.source && (
										<p className="text-xs text-[#525252] mb-2 truncate">{doc.source}</p>
									)}
									<div className="flex items-center gap-4 text-xs text-[#525252] mb-2">
										<span className="flex items-center gap-1">
											<Layers className="w-3 h-3" />
											{doc.chunk_count} chunks
										</span>
										<span>{formatBytes(doc.size_bytes)}</span>
										<span className="flex items-center gap-1">
											<Clock className="w-3 h-3" />
											{formatRelTime(doc.created_at)}
										</span>
									</div>
									{doc.content_preview && (
										<pre className="text-xs text-[#a3a3a3] font-mono bg-[#0a0a0a] border border-[#1e1e1e] rounded p-2 overflow-hidden" style={{ maxHeight: '2.8em', lineHeight: '1.4' }}>
											{doc.content_preview.split('\n').slice(0, 2).join('\n')}
										</pre>
									)}
								</div>
								<button
									onClick={() => handleDelete(doc)}
									className="p-2 text-[#525252] hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 rounded-lg transition-colors flex-shrink-0"
									title="Delete document"
								>
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{showAdd && (
				<AddDocumentModal
					knowledgeBases={knowledgeBases}
					defaultKbId={selectedKbId !== 'all' ? selectedKbId : undefined}
					onClose={() => setShowAdd(false)}
					onSave={handleAddDoc}
				/>
			)}
		</div>
	);
}
