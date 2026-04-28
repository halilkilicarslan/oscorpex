import { useState, useEffect, useCallback } from 'react';
import { Plus, Filter, Loader2, ChevronDown } from 'lucide-react';
import { fetchWorkItemsPaginated } from '../../lib/studio-api';
import {
	NewItemModal,
	FilterBar,
	BacklogColumn,
	BASE,
	PAGE_SIZE,
	COLUMNS,
	type WorkItem,
	type WorkItemStatus,
	type WorkItemType,
	type Priority,
	type SprintOption,
	type NewItemForm,
} from './backlog-board';

export default function BacklogBoard({ projectId }: { projectId: string }) {
	const [items, setItems] = useState<WorkItem[]>([]);
	const [sprints, setSprints] = useState<SprintOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [filterType, setFilterType] = useState<WorkItemType | ''>('');
	const [filterPriority, setFilterPriority] = useState<Priority | ''>('');
	const [filterSource, setFilterSource] = useState('');
	const [showFilters, setShowFilters] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [total, setTotal] = useState(0);
	const [wiOffset, setWiOffset] = useState(0);
	const [loadingMore, setLoadingMore] = useState(false);

	const load = useCallback(() => {
		Promise.all([
			fetchWorkItemsPaginated(projectId, PAGE_SIZE, 0),
			fetch(`${BASE}/api/studio/projects/${projectId}/sprints`)
				.then((r) => r.json())
				.catch(() => []),
		])
			.then(([result, sp]) => {
				setItems(result.data as WorkItem[]);
				setTotal(result.total);
				setWiOffset(PAGE_SIZE);
				setHasMore(result.data.length < result.total);
				setSprints(Array.isArray(sp) ? sp : (sp.sprints ?? []));
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [projectId]);

	const handleLoadMore = useCallback(async () => {
		if (loadingMore || !hasMore) return;
		setLoadingMore(true);
		try {
			const result = await fetchWorkItemsPaginated(projectId, PAGE_SIZE, wiOffset);
			setItems((prev) => [...prev, ...(result.data as WorkItem[])]);
			setWiOffset((prev) => prev + PAGE_SIZE);
			setTotal(result.total);
			setHasMore(items.length + result.data.length < result.total);
		} catch {
			// sessizce geç
		} finally {
			setLoadingMore(false);
		}
	}, [projectId, wiOffset, hasMore, loadingMore, items.length]);

	useEffect(() => {
		load();
	}, [load]);

	const handleCreate = async (form: NewItemForm) => {
		setShowModal(false);
		try {
			await fetch(`${BASE}/api/studio/projects/${projectId}/work-items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form),
			});
			load();
		} catch {}
	};

	const handleConvert = async (itemId: string) => {
		try {
			const res = await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}/plan`, {
				method: 'POST',
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.error ?? 'Convert failed');
				return;
			}
			load();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Convert failed');
		}
	};

	const handleAssignSprint = async (itemId: string, sprintId: string | null) => {
		try {
			await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sprintId }),
			});
			load();
		} catch {}
	};

	const handleStatusChange = async (itemId: string, status: WorkItemStatus) => {
		try {
			await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status }),
			});
			load();
		} catch {}
	};

	const handleDelete = async (itemId: string) => {
		try {
			await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
				method: 'DELETE',
			});
			load();
		} catch {}
	};

	const filtered = items.filter((i) => {
		if (filterType && i.type !== filterType) return false;
		if (filterPriority && i.priority !== filterPriority) return false;
		if (filterSource && i.source !== filterSource) return false;
		return true;
	});

	const grouped = new Map<WorkItemStatus, WorkItem[]>();
	for (const col of COLUMNS) grouped.set(col.key, []);
	for (const item of filtered) {
		const list = grouped.get(item.status);
		if (list) list.push(item);
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 size={20} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	return (
		<>
			{showModal && <NewItemModal onClose={() => setShowModal(false)} onSubmit={handleCreate} />}

			<div className="flex flex-col h-full p-5 gap-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-[15px] font-semibold text-[#fafafa]">Backlog</h2>
						<p className="text-[11px] text-[#525252] mt-0.5">
							{total > 0 ? total : items.length} work items
						</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setShowFilters((v) => !v)}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
								showFilters || filterType || filterPriority || filterSource
									? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'
									: 'text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414] border-[#262626]'
							}`}
						>
							<Filter size={12} />
							Filter
							<ChevronDown
								size={10}
								className={`transition-transform ${showFilters ? 'rotate-180' : ''}`}
							/>
						</button>
						<button
							type="button"
							onClick={() => setShowModal(true)}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
						>
							<Plus size={12} />
							New Work Item
						</button>
					</div>
				</div>

				{showFilters && (
					<FilterBar
						filterType={filterType}
						filterPriority={filterPriority}
						filterSource={filterSource}
						onFilterTypeChange={setFilterType}
						onFilterPriorityChange={setFilterPriority}
						onFilterSourceChange={setFilterSource}
						onClearFilters={() => {
							setFilterType('');
							setFilterPriority('');
							setFilterSource('');
						}}
					/>
				)}

				{hasMore && (
					<button
						onClick={handleLoadMore}
						disabled={loadingMore}
						className="w-full py-2 text-sm text-gray-400 hover:text-white bg-[#1a1a1a] border border-[#262626] rounded-lg hover:bg-[#222] transition-colors"
					>
						{loadingMore ? 'Loading...' : `Load more (${items.length} of ${total})`}
					</button>
				)}

				<div className="flex gap-4 flex-1 overflow-x-auto min-w-0">
					{COLUMNS.map((col) => (
						<BacklogColumn
							key={col.key}
							col={col}
							items={grouped.get(col.key) ?? []}
							sprints={sprints}
							onConvert={handleConvert}
							onAssignSprint={handleAssignSprint}
							onStatusChange={handleStatusChange}
							onDelete={handleDelete}
						/>
					))}
				</div>
			</div>
		</>
	);
}
