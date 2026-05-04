import { useState, useEffect, useCallback, useRef } from 'react';
import {
	ScrollText,
	Plus,
	Tag,
	Search,
	ChevronDown,
	Check,
	BarChart2,
	Layers,
} from 'lucide-react';
import { httpGet, httpPost, httpPut, httpDelete } from '../../lib/studio-api/base.js';
import { useModalState } from '../../hooks/useModalState.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { StatsCards, type StatCardDef } from '../../components/StatsCards.js';
import {
	type PromptTemplate,
	type PromptStats,
	type TemplateListResponse,
	type EditorFormState,
	type SortOrder,
	API_BASE,
	CATEGORIES,
} from './types.js';
import { TemplateCard } from './TemplateCard.js';
import { TemplateEditor } from './TemplateEditor.js';
import { VersionHistoryPanel } from './VersionHistoryPanel.js';
import { DeleteConfirmModal } from './DeleteConfirmModal.js';
import { TagPill } from './TagPill.js';

export default function PromptsPage() {
	// Stats (separate fetch — not paginated)
	const [stats, setStats] = useState<PromptStats | null>(null);
	const [statsLoading, setStatsLoading] = useState(true);

	// Template list state
	const [templates, setTemplates] = useState<PromptTemplate[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);

	// Filters
	const [category, setCategory] = useState('all');
	const [search, setSearch] = useState('');
	const [sort, setSort] = useState<SortOrder>('recent');
	const [tagFilter, setTagFilter] = useState('');
	const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
	const tagDropdownRef = useRef<HTMLDivElement>(null);

	// Modals via shared hooks
	const editorModal = useModalState<PromptTemplate>();
	const historyModal = useModalState<string>(); // stores templateId
	const deleteModal = useModalState<PromptTemplate>();
	const deleteAction = useAsyncAction();

	// All tags derived from loaded templates
	const allTags = Array.from(new Set(templates.flatMap((t) => t.tags))).sort();

	// ---------------------------------------------------------------------------
	// Data loading
	// ---------------------------------------------------------------------------

	const loadStats = useCallback(() => {
		setStatsLoading(true);
		httpGet<PromptStats>(`${API_BASE}/stats`)
			.then(setStats)
			.catch(console.error)
			.finally(() => setStatsLoading(false));
	}, []);

	const loadTemplates = useCallback(() => {
		setLoading(true);
		const params = new URLSearchParams();
		params.set('limit', '100');
		params.set('sort', sort);
		if (category !== 'all') params.set('category', category);
		if (search) params.set('search', search);
		if (tagFilter) params.set('tag', tagFilter);

		httpGet<TemplateListResponse>(`${API_BASE}?${params.toString()}`)
			.then((data) => {
				setTemplates(data.templates);
				setTotal(data.total);
			})
			.catch(console.error)
			.finally(() => setLoading(false));
	}, [category, search, sort, tagFilter]);

	useEffect(() => { loadStats(); }, [loadStats]);
	useEffect(() => { loadTemplates(); }, [loadTemplates]);

	// Close tag dropdown on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
				setTagDropdownOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, []);

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	const handleCreate = async (data: EditorFormState) => {
		await httpPost<{ template: PromptTemplate }>(API_BASE, data);
		editorModal.close();
		loadTemplates();
		loadStats();
	};

	const handleEdit = async (data: EditorFormState) => {
		if (!editorModal.selectedItem) return;
		await httpPut<{ template: PromptTemplate }>(`${API_BASE}/${editorModal.selectedItem.id}`, data);
		editorModal.close();
		loadTemplates();
		loadStats();
	};

	const handleDuplicate = async (t: PromptTemplate) => {
		await httpPost<{ template: PromptTemplate }>(`${API_BASE}/${t.id}/duplicate`);
		loadTemplates();
		loadStats();
	};

	const handleDelete = async () => {
		if (!deleteModal.selectedItem) return;
		const id = deleteModal.selectedItem.id;
		await deleteAction.execute(async () => {
			await httpDelete<{ success: boolean }>(`${API_BASE}/${id}`);
			deleteModal.close();
			loadTemplates();
			loadStats();
		});
	};

	const handleCopyUsage = async (t: PromptTemplate) => {
		try {
			await httpPost(`${API_BASE}/${t.id}/use`);
			setTemplates((prev) =>
				prev.map((x) => (x.id === t.id ? { ...x, usage_count: x.usage_count + 1 } : x)),
			);
		} catch {
			// ignore
		}
	};

	// ---------------------------------------------------------------------------
	// Stats cards definition
	// ---------------------------------------------------------------------------

	const mostUsedName = stats?.mostUsed?.[0]?.name ?? '—';
	const categoriesCount = stats ? Object.values(stats.byCategory).filter((v) => v > 0).length : 0;

	const statCards: StatCardDef[] = [
		{
			label: 'Total Templates',
			value: statsLoading ? '...' : (stats?.totalTemplates ?? 0),
			icon: <ScrollText size={16} className="text-[#22c55e]" />,
		},
		{
			label: 'Categories',
			value: statsLoading ? '...' : categoriesCount,
			icon: <Tag size={16} className="text-[#3b82f6]" />,
			sub: statsLoading ? undefined : Object.entries(stats?.byCategory ?? {})
				.filter(([, v]) => v > 0)
				.map(([k, v]) => `${k}: ${v}`)
				.join(', '),
		},
		{
			label: 'Most Used',
			value: statsLoading ? '...' : mostUsedName,
			icon: <BarChart2 size={16} className="text-[#a855f7]" />,
			sub: statsLoading ? undefined : stats?.mostUsed?.[0] ? `${stats.mostUsed[0].usage_count} uses` : undefined,
		},
		{
			label: 'Total Versions',
			value: statsLoading ? '...' : (stats?.totalVersions ?? 0),
			icon: <Layers size={16} className="text-[#f59e0b]" />,
		},
	];

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Page header */}
			<div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-xl font-semibold text-[#fafafa]">Prompts</h1>
						<p className="text-sm text-[#737373] mt-0.5">Manage and version prompt templates for your agents</p>
					</div>
					<button
						onClick={() => editorModal.open()}
						className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[13px] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
					>
						<Plus size={14} />
						Create Template
					</button>
				</div>
			</div>

			{/* Stats row */}
			<div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
				<StatsCards stats={statCards} columns={4} />
			</div>

			{/* Filter bar */}
			<div className="px-6 py-3 border-b border-[#1a1a1a] flex items-center gap-3 flex-wrap shrink-0">
				{/* Category pills */}
				<div className="flex items-center gap-1">
					{CATEGORIES.map((c) => (
						<button
							key={c.value}
							onClick={() => setCategory(c.value)}
							className={`px-3 py-1 rounded-lg text-[12px] font-medium transition-colors ${
								category === c.value
									? 'bg-[#1f1f1f] text-[#fafafa] border border-[#333]'
									: 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]'
							}`}
						>
							{c.label}
							{c.value !== 'all' && stats?.byCategory?.[c.value] !== undefined && (
								<span className="ml-1 text-[10px] text-[#525252]">{stats.byCategory[c.value]}</span>
							)}
						</button>
					))}
				</div>

				<div className="flex-1" />

				{/* Search */}
				<div className="relative">
					<Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
					<input
						type="text"
						placeholder="Search templates..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="bg-[#111111] border border-[#262626] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333] w-52"
					/>
				</div>

				{/* Tag filter */}
				<div className="relative" ref={tagDropdownRef}>
					<button
						onClick={() => setTagDropdownOpen((v) => !v)}
						className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${
							tagFilter
								? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'
								: 'bg-[#111111] border-[#262626] text-[#a3a3a3] hover:border-[#333]'
						}`}
					>
						<Tag size={11} />
						{tagFilter || 'Tag'}
						<ChevronDown size={11} />
					</button>
					{tagDropdownOpen && (
						<div className="absolute right-0 top-full mt-1 w-48 bg-[#111111] border border-[#262626] rounded-xl shadow-2xl z-20 overflow-hidden">
							<div className="py-1">
								<button
									onClick={() => { setTagFilter(''); setTagDropdownOpen(false); }}
									className={`w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2 ${
										!tagFilter ? 'text-[#fafafa] bg-[#1f1f1f]' : 'text-[#a3a3a3] hover:bg-[#141414]'
									}`}
								>
									{!tagFilter && <Check size={11} className="text-[#22c55e]" />}
									<span className={!tagFilter ? 'ml-0' : 'ml-[19px]'}>All tags</span>
								</button>
								{allTags.map((t) => (
									<button
										key={t}
										onClick={() => { setTagFilter(t); setTagDropdownOpen(false); }}
										className={`w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2 ${
											tagFilter === t ? 'text-[#fafafa] bg-[#1f1f1f]' : 'text-[#a3a3a3] hover:bg-[#141414]'
										}`}
									>
										{tagFilter === t && <Check size={11} className="text-[#22c55e]" />}
										<span className={tagFilter === t ? 'ml-0' : 'ml-[19px]'}>{t}</span>
									</button>
								))}
								{allTags.length === 0 && (
									<div className="px-3 py-2 text-[11px] text-[#525252]">No tags yet</div>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Sort */}
				<div className="relative">
					<select
						value={sort}
						onChange={(e) => setSort(e.target.value as SortOrder)}
						className="appearance-none bg-[#111111] border border-[#262626] rounded-lg pl-3 pr-7 py-1.5 text-[12px] text-[#a3a3a3] focus:outline-none focus:border-[#333]"
					>
						<option value="recent">Recent</option>
						<option value="most_used">Most Used</option>
						<option value="alpha">Alphabetical</option>
					</select>
					<ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
				</div>
			</div>

			{/* Template grid */}
			<div className="flex-1 overflow-y-auto px-6 py-5">
				{loading ? (
					<div className="flex items-center justify-center py-20">
						<div className="w-7 h-7 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
					</div>
				) : templates.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-24 text-center">
						<div className="w-20 h-20 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-5">
							<ScrollText size={36} className="text-[#333]" />
						</div>
						<h2 className="text-[16px] font-semibold text-[#a3a3a3] mb-2">No templates found</h2>
						<p className="text-[13px] text-[#525252] max-w-sm leading-relaxed mb-5">
							{search || tagFilter || category !== 'all'
								? 'Try adjusting your filters or search query.'
								: 'Create your first prompt template to get started.'}
						</p>
						{!search && !tagFilter && category === 'all' && (
							<button
								onClick={() => editorModal.open()}
								className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[13px] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
							>
								<Plus size={14} />
								Create Template
							</button>
						)}
					</div>
				) : (
					<>
						<div className="flex items-center justify-between mb-4">
							<p className="text-[12px] text-[#525252]">
								{total} template{total !== 1 ? 's' : ''}
								{tagFilter && (
									<span className="ml-1">
										tagged <span className="text-[#a3a3a3]">{tagFilter}</span>
										<button
											onClick={() => setTagFilter('')}
											className="ml-1 inline-flex"
										>
											<TagPill tag={tagFilter} onRemove={() => setTagFilter('')} />
										</button>
									</span>
								)}
							</p>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
							{templates.map((t) => (
								<TemplateCard
									key={t.id}
									template={t}
									onEdit={(tmpl) => editorModal.open(tmpl)}
									onDuplicate={handleDuplicate}
									onDelete={(tmpl) => deleteModal.open(tmpl)}
									onCopy={handleCopyUsage}
									onViewHistory={(tmpl) => historyModal.open(tmpl.id)}
								/>
							))}
						</div>
					</>
				)}
			</div>

			{/* Template editor modal */}
			{editorModal.isOpen && (
				<TemplateEditor
					initial={editorModal.selectedItem}
					onClose={editorModal.close}
					onSave={editorModal.selectedItem ? handleEdit : handleCreate}
				/>
			)}

			{/* Version history panel */}
			{historyModal.isOpen && historyModal.selectedItem && (
				<VersionHistoryPanel
					templateId={historyModal.selectedItem}
					onClose={historyModal.close}
				/>
			)}

			{/* Delete confirm */}
			{deleteModal.isOpen && deleteModal.selectedItem && (
				<DeleteConfirmModal
					template={deleteModal.selectedItem}
					onConfirm={handleDelete}
					onCancel={deleteModal.close}
					deleting={deleteAction.isLoading}
				/>
			)}
		</div>
	);
}
