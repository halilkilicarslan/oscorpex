import { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, RefreshCw } from 'lucide-react';
import { observabilityGet } from '../../lib/observability-api.js';
import type { KnowledgeBase, RagQuery } from '../studio/settings/rag-types.js';
import { formatRelTime, truncate } from './constants.js';

interface QueryLogTabProps {
	knowledgeBases: KnowledgeBase[];
}

export function QueryLogTab({ knowledgeBases }: QueryLogTabProps) {
	const [queries, setQueries] = useState<RagQuery[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [filterKb, setFilterKb] = useState('');
	const [page, setPage] = useState(0);
	const PAGE_SIZE = 20;

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams({
				limit: String(PAGE_SIZE),
				offset: String(page * PAGE_SIZE),
			});
			if (filterKb) params.set('kb_id', filterKb);
			const data = await observabilityGet<{ queries?: RagQuery[]; total?: number }>(`/rag/queries?${params}`);
			setQueries(data.queries ?? []);
			setTotal(data.total ?? 0);
		} finally {
			setLoading(false);
		}
	}, [filterKb, page]);

	useEffect(() => { load(); }, [load]);

	const todayCutoff = new Date();
	todayCutoff.setHours(0, 0, 0, 0);
	const queriesToday = queries.filter(q => new Date(q.created_at) >= todayCutoff).length;
	const latencies = queries.filter(q => q.latency_ms != null).map(q => q.latency_ms!);
	const avgLat = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
	const kbCounts: Record<string, number> = {};
	for (const q of queries) if (q.kb_name) kbCounts[q.kb_name] = (kbCounts[q.kb_name] ?? 0) + 1;
	const topKb = Object.entries(kbCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

	return (
		<div>
			<div className="grid grid-cols-3 gap-3 mb-4">
				<div className="bg-[#111111] border border-[#262626] rounded-lg p-3 text-center">
					<p className="text-xs text-[#525252] mb-1">Queries Today</p>
					<p className="text-lg font-semibold text-[#fafafa]">{queriesToday}</p>
				</div>
				<div className="bg-[#111111] border border-[#262626] rounded-lg p-3 text-center">
					<p className="text-xs text-[#525252] mb-1">Avg Latency</p>
					<p className="text-lg font-semibold text-[#fafafa]">{avgLat > 0 ? `${avgLat}ms` : '—'}</p>
				</div>
				<div className="bg-[#111111] border border-[#262626] rounded-lg p-3 text-center">
					<p className="text-xs text-[#525252] mb-1">Top Queried KB</p>
					<p className="text-sm font-semibold text-[#fafafa] truncate">{topKb}</p>
				</div>
			</div>

			<div className="flex items-center gap-3 mb-4">
				<div className="relative">
					<select
						value={filterKb}
						onChange={e => { setFilterKb(e.target.value); setPage(0); }}
						className="appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
					>
						<option value="">All KBs</option>
						{knowledgeBases.map(kb => (
							<option key={kb.id} value={kb.id}>{kb.name}</option>
						))}
					</select>
					<ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
				</div>
				<span className="text-xs text-[#525252]">{total} total queries</span>
				<button onClick={load} className="ml-auto p-1.5 text-[#525252] hover:text-[#a3a3a3] transition-colors" title="Refresh">
					<RefreshCw className="w-4 h-4" />
				</button>
			</div>

			{loading ? (
				<div className="text-center py-12 text-[#525252] text-sm">Loading queries...</div>
			) : queries.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-24 text-center">
					<Search className="w-12 h-12 text-[#262626] mb-4" />
					<p className="text-[#525252] text-sm">No queries logged yet</p>
				</div>
			) : (
				<>
					<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-[#262626]">
									<th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide">Query</th>
									<th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden md:table-cell">KB</th>
									<th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden sm:table-cell">Results</th>
									<th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden sm:table-cell">Latency</th>
									<th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden md:table-cell">Agent</th>
									<th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide">Time</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[#1e1e1e]">
								{queries.map(q => (
									<tr key={q.id} className="hover:bg-[#161616] transition-colors">
										<td className="px-4 py-3 text-[#a3a3a3] max-w-xs">
											<span className="truncate block" title={q.query}>{truncate(q.query, 60)}</span>
										</td>
										<td className="px-4 py-3 hidden md:table-cell">
											{q.kb_name ? (
												<span className="text-xs text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded px-1.5 py-0.5">{q.kb_name}</span>
											) : <span className="text-[#525252]">—</span>}
										</td>
										<td className="px-4 py-3 text-[#a3a3a3] hidden sm:table-cell">{q.results_count}</td>
										<td className="px-4 py-3 hidden sm:table-cell">
											{q.latency_ms != null ? (
												<span className="text-[#22c55e] text-xs font-mono">{q.latency_ms}ms</span>
											) : <span className="text-[#525252]">—</span>}
										</td>
										<td className="px-4 py-3 hidden md:table-cell text-[#525252] text-xs">
											{q.agent_id ? truncate(q.agent_id, 20) : '—'}
										</td>
										<td className="px-4 py-3 text-[#525252] text-xs whitespace-nowrap">
											{formatRelTime(q.created_at)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{total > PAGE_SIZE && (
						<div className="flex items-center justify-between mt-4">
							<span className="text-xs text-[#525252]">
								Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
							</span>
							<div className="flex gap-2">
								<button
									onClick={() => setPage(p => Math.max(0, p - 1))}
									disabled={page === 0}
									className="px-3 py-1.5 text-xs font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg disabled:opacity-40 hover:border-[#404040] transition-colors"
								>
									Previous
								</button>
								<button
									onClick={() => setPage(p => p + 1)}
									disabled={(page + 1) * PAGE_SIZE >= total}
									className="px-3 py-1.5 text-xs font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg disabled:opacity-40 hover:border-[#404040] transition-colors"
								>
									Next
								</button>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
