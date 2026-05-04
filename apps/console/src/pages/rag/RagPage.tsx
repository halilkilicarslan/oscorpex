import { useState, useEffect, useCallback } from 'react';
import {
	Database,
	FileText,
	Layers,
	Search,
	Zap,
	RefreshCw,
} from 'lucide-react';
import { observabilityGet } from '../../lib/observability-api.js';
import { StatsCards, type StatCardDef } from '../../components/StatsCards.js';
import {
	type KnowledgeBase,
	type Stats,
} from '../studio/settings/rag-types.js';
import { KBTab } from './KBTab.js';
import { DocumentsTab } from './DocumentsTab.js';
import { QueryLogTab } from './QueryLogTab.js';
import { TypeBadge } from './TypeBadge.js';

export default function RagPage() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
	const [activeTab, setActiveTab] = useState<'kbs' | 'documents' | 'queries'>('kbs');
	const [statsLoading, setStatsLoading] = useState(true);

	const loadData = useCallback(async () => {
		setStatsLoading(true);
		try {
			const [statsData, kbsData] = await Promise.all([
				observabilityGet<Stats>('/rag/knowledge-bases/stats'),
				observabilityGet<{ knowledgeBases?: KnowledgeBase[] }>('/rag/knowledge-bases'),
			]);
			setStats(statsData);
			setKbs(kbsData.knowledgeBases ?? []);
		} finally {
			setStatsLoading(false);
		}
	}, []);

	useEffect(() => { loadData(); }, [loadData]);

	const TABS = [
		{ key: 'kbs' as const, label: 'Knowledge Bases', count: stats?.totalKBs },
		{ key: 'documents' as const, label: 'Documents', count: stats?.totalDocuments },
		{ key: 'queries' as const, label: 'Query Log', count: stats?.totalQueries },
	];

	return (
		<div className="min-h-screen bg-[#0a0a0a] text-[#fafafa]">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

				{/* Header */}
				<div className="flex items-start justify-between mb-6">
					<div>
						<div className="flex items-center gap-3 mb-1">
							<Database className="w-6 h-6 text-[#22c55e]" />
							<h1 className="text-xl font-bold text-[#fafafa]">RAG</h1>
						</div>
						<p className="text-sm text-[#525252]">Retrieval Augmented Generation — manage knowledge bases, documents, and query logs</p>
					</div>
					<button
						onClick={loadData}
						disabled={statsLoading}
						className="p-2 text-[#525252] hover:text-[#a3a3a3] bg-[#111111] border border-[#262626] rounded-lg hover:border-[#404040] transition-colors disabled:opacity-50"
						title="Refresh"
					>
						<RefreshCw className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
					</button>
				</div>

				{/* Stats Row */}
				<StatsCards
					columns={5}
					className="mb-6"
					stats={[
						{ label: 'Knowledge Bases', value: statsLoading ? '—' : (stats?.totalKBs ?? 0), icon: <Database className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
						{ label: 'Total Documents',  value: statsLoading ? '—' : (stats?.totalDocuments ?? 0), icon: <FileText className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
						{ label: 'Total Chunks',     value: statsLoading ? '—' : (stats?.totalChunks ?? 0).toLocaleString(), icon: <Layers className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
						{ label: 'Queries',          value: statsLoading ? '—' : (stats?.totalQueries ?? 0), sub: 'all time', icon: <Search className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
						{ label: 'Avg Latency',      value: statsLoading ? '—' : stats?.avgLatency ? `${stats.avgLatency}ms` : '—', icon: <Zap className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
					] satisfies StatCardDef[]}
				/>

				{/* Type distribution */}
				{stats && Object.values(stats.byType).some(v => v > 0) && (
					<div className="flex items-center gap-3 flex-wrap mb-6">
						<span className="text-xs text-[#525252]">By type:</span>
						{Object.entries(stats.byType).filter(([, v]) => v > 0).map(([type, count]) => (
							<span key={type} className="inline-flex items-center gap-1">
								<TypeBadge type={type} />
								<span className="text-xs text-[#525252]">{count}</span>
							</span>
						))}
					</div>
				)}

				{/* Tab Toggle */}
				<div className="flex items-center gap-1 mb-6 bg-[#111111] border border-[#262626] rounded-xl p-1 w-fit">
					{TABS.map(tab => (
						<button
							key={tab.key}
							onClick={() => setActiveTab(tab.key)}
							className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
								activeTab === tab.key
									? 'bg-[#1a1a1a] text-[#fafafa] border border-[#262626]'
									: 'text-[#525252] hover:text-[#a3a3a3]'
							}`}
						>
							{tab.label}
							{tab.count != null && tab.count > 0 && (
								<span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#1a1a1a] text-[#525252]'}`}>
									{tab.count}
								</span>
							)}
						</button>
					))}
				</div>

				{/* Tab Content */}
				{activeTab === 'kbs' && (
					<KBTab kbs={kbs} onRefresh={loadData} />
				)}
				{activeTab === 'documents' && (
					<DocumentsTab knowledgeBases={kbs} onRefresh={loadData} />
				)}
				{activeTab === 'queries' && (
					<QueryLogTab knowledgeBases={kbs} />
				)}
			</div>
		</div>
	);
}
