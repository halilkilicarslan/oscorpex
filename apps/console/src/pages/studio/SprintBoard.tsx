import { useState, useEffect, useCallback, lazy, Suspense } from 'react';

const VelocityTrendChart = lazy(() => import('./charts/VelocityTrendChart'));
import {
	Loader2,
	Plus,
	Calendar,
	Target,
	TrendingUp,
	ChevronDown,
	CheckCircle2,
	Clock,
	Play,
	Square,
	XCircle,
	X,
	Users,
} from 'lucide-react';
import BurndownChart from './sprint-board/BurndownChart.js';
import CreateSprintModal from './sprint-board/CreateSprintModal.js';
import AddWorkItemPicker from './sprint-board/AddWorkItemPicker.js';
import { STATUS_BADGE, ITEM_STATUS_COLORS, formatDate } from './sprint-board/helpers.js';
import { httpGet, httpPost, httpPatch } from '../../lib/studio-api/base.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

type SprintStatus = 'planned' | 'active' | 'completed' | 'cancelled';

interface Sprint {
	id: string;
	name: string;
	goal?: string;
	startDate?: string;
	endDate?: string;
	status: SprintStatus;
	velocity?: number;
	workItems?: SprintWorkItem[];
}

interface SprintWorkItem {
	id: string;
	title: string;
	type: string;
	priority: string;
	status: string;
	sprintId?: string | null;
}

interface BurndownPoint {
	date: string;
	remaining: number;
}

export default function SprintBoard({ projectId }: { projectId: string }) {
	const [sprints, setSprints] = useState<Sprint[]>([]);
	const [selectedId, setSelectedId] = useState<string>('');
	const [loading, setLoading] = useState(true);
	const [burndown, setBurndown] = useState<BurndownPoint[]>([]);
	const [teamVelocity, setTeamVelocity] = useState<number | null>(null);
	const [allItems, setAllItems] = useState<SprintWorkItem[]>([]);
	const [showCreate, setShowCreate] = useState(false);

	const loadSprints = useCallback(async () => {
		try {
			const data = await httpGet<{ sprints?: Sprint[] } | Sprint[]>(`${BASE}/api/studio/projects/${projectId}/sprints`);
			const list: Sprint[] = Array.isArray(data) ? data : (data.sprints ?? []);
			setSprints(list);
			setSelectedId((current) => {
				if (current && list.some((s) => s.id === current)) return current;
				const active = list.find((s) => s.status === 'active');
				return active?.id ?? list[0]?.id ?? '';
			});
		} catch { /* ignore */ }
		finally {
			setLoading(false);
		}
	}, [projectId]);

	const loadAllItems = useCallback(async () => {
		try {
			const data = await httpGet<{ items?: SprintWorkItem[]; workItems?: SprintWorkItem[] } | SprintWorkItem[]>(`${BASE}/api/studio/projects/${projectId}/work-items`);
			const list: SprintWorkItem[] = Array.isArray(data) ? data : (data.items ?? data.workItems ?? []);
			setAllItems(list);
		} catch {
			setAllItems([]);
		}
	}, [projectId]);

	const loadTeamVelocity = useCallback(async () => {
		try {
			const body = await httpGet<{ velocity?: number }>(`${BASE}/api/studio/projects/${projectId}/velocity`);
			setTeamVelocity(typeof body.velocity === 'number' ? body.velocity : null);
		} catch {
			setTeamVelocity(null);
		}
	}, [projectId]);

	useEffect(() => {
		loadSprints();
		loadAllItems();
		loadTeamVelocity();
	}, [loadSprints, loadAllItems, loadTeamVelocity]);

	useEffect(() => {
		if (!selectedId) {
			setBurndown([]);
			return;
		}
		httpGet<{ data?: BurndownPoint[] }>(`${BASE}/api/studio/sprints/${selectedId}/burndown`)
			.then((body) => setBurndown(Array.isArray(body?.data) ? body.data : []))
			.catch(() => setBurndown([]));
	}, [selectedId]);

	const handleLifecycleAction = async (sprintId: string, action: 'start' | 'complete' | 'cancel') => {
		try {
			await httpPost(`${BASE}/api/studio/sprints/${sprintId}/${action}`);
			await loadSprints();
			await loadTeamVelocity();
		} catch (e: any) {
			alert(e?.message ?? `Sprint ${action} failed`);
		}
	};

	const handleAssignToSprint = async (itemId: string, sprintId: string | null) => {
		try {
			await httpPatch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, { sprintId });
			await loadSprints();
			await loadAllItems();
		} catch (e: any) {
			alert(e?.message ?? 'Assign failed');
		}
	};

	const selected = sprints.find((s) => s.id === selectedId);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 size={20} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	const doneCount = selected?.workItems?.filter((i) => i.status === 'done').length ?? 0;
	const totalCount = selected?.workItems?.length ?? 0;
	const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
	const unassigned = allItems.filter((i) => !i.sprintId);

	return (
		<div className="flex flex-col h-full p-5 gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-[15px] font-semibold text-[#fafafa]">Sprint Board</h2>
					<p className="text-[11px] text-[#525252] mt-0.5">{sprints.length} sprint{sprints.length !== 1 ? 's' : ''}</p>
				</div>
				<button
					type="button"
					onClick={() => setShowCreate(true)}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
				>
					<Plus size={12} />
					Yeni Sprint
				</button>
			</div>

			{sprints.length === 0 ? (
				<div className="flex flex-col items-center justify-center flex-1 text-center">
					<Calendar size={32} className="text-[#333] mb-3" />
					<h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Sprints Yet</h3>
					<p className="text-[12px] text-[#525252]">Create a sprint to start planning work.</p>
				</div>
			) : (
				<>
					<div className="relative">
						<select
							value={selectedId}
							onChange={(e) => setSelectedId(e.target.value)}
							className="w-full appearance-none bg-[#111111] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50 transition-colors pr-8"
						>
							{sprints.map((s) => (
								<option key={s.id} value={s.id}>{s.name}</option>
							))}
						</select>
						<ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
					</div>

					{selected && (
						<div className="flex flex-col gap-4 flex-1 overflow-y-auto">
							<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
								<div className="flex items-start justify-between mb-3">
									<div>
										<h3 className="text-[14px] font-semibold text-[#fafafa]">{selected.name}</h3>
										{selected.goal && (
											<p className="text-[12px] text-[#737373] mt-1 flex items-start gap-1.5">
												<Target size={12} className="text-[#22c55e] mt-0.5 shrink-0" />
												{selected.goal}
											</p>
										)}
									</div>
									<div className="flex items-center gap-2">
										<span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_BADGE[selected.status]}`}>
											{selected.status}
										</span>
										{selected.status === 'planned' && (
											<button
												type="button"
												onClick={() => handleLifecycleAction(selected.id, 'start')}
												className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold bg-[#052e16] text-[#86efac] border-[#166534] hover:bg-[#083b1d] transition-colors"
											>
												<Play size={10} /> Start
											</button>
										)}
										{selected.status === 'active' && (
											<button
												type="button"
												onClick={() => handleLifecycleAction(selected.id, 'complete')}
												className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold bg-[#1e3a5f] text-[#93c5fd] border-[#2563eb] hover:bg-[#254877] transition-colors"
											>
												<Square size={10} /> Complete
											</button>
										)}
										{(selected.status === 'planned' || selected.status === 'active') && (
											<button
												type="button"
												onClick={() => handleLifecycleAction(selected.id, 'cancel')}
												className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold bg-[#450a0a] text-[#fca5a5] border-[#991b1b] hover:bg-[#5a0e0e] transition-colors"
											>
												<XCircle size={10} /> Cancel
											</button>
										)}
									</div>
								</div>

								<div className="flex items-center gap-6 text-[11px] text-[#525252]">
									<span className="flex items-center gap-1.5">
										<Calendar size={11} />
										{formatDate(selected.startDate)} — {formatDate(selected.endDate)}
									</span>
									<span className="flex items-center gap-1.5">
										<CheckCircle2 size={11} className="text-[#22c55e]" />
										{doneCount} / {totalCount} items done
									</span>
								</div>

								{totalCount > 0 && (
									<div className="mt-3">
										<div className="flex items-center justify-between mb-1">
											<span className="text-[10px] text-[#525252]">Progress</span>
											<span className="text-[10px] font-semibold text-[#22c55e]">{progress}%</span>
										</div>
										<div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
											<div className="h-1.5 rounded-full bg-[#22c55e] transition-all duration-500" style={{ width: `${progress}%` }} />
										</div>
									</div>
								)}
							</div>

							<div className="grid grid-cols-4 gap-3">
								<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
									<span className="text-[10px] text-[#525252] uppercase tracking-wider">Items</span>
									<span className="text-[20px] font-bold text-[#fafafa]">{totalCount}</span>
									<span className="text-[10px] text-[#525252]">in sprint</span>
								</div>
								<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
									<span className="text-[10px] text-[#525252] uppercase tracking-wider">Completed</span>
									<span className="text-[20px] font-bold text-[#22c55e]">{doneCount}</span>
									<span className="text-[10px] text-[#525252]">work items</span>
								</div>
								<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
									<span className="text-[10px] text-[#525252] uppercase tracking-wider flex items-center gap-1">
										<TrendingUp size={10} /> Sprint Vel.
									</span>
									<span className="text-[20px] font-bold text-[#3b82f6]">{selected.velocity ?? doneCount}</span>
									<span className="text-[10px] text-[#525252]">done in sprint</span>
								</div>
								<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
									<span className="text-[10px] text-[#525252] uppercase tracking-wider flex items-center gap-1">
										<Users size={10} /> Team Vel.
									</span>
									<span className="text-[20px] font-bold text-[#a855f7]">{teamVelocity ?? '—'}</span>
									<span className="text-[10px] text-[#525252]">avg / sprint</span>
								</div>
							</div>

							<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
								<div className="flex items-center gap-2 mb-3">
									<TrendingUp size={14} className="text-[#3b82f6]" />
									<h3 className="text-[12px] font-semibold text-[#fafafa]">Burndown Chart</h3>
									<span className="ml-auto text-[10px] text-[#525252]">{burndown.length} gün</span>
								</div>
								<BurndownChart points={burndown} totalItems={totalCount} />
							</div>

							{sprints.some((s) => s.status === 'completed') && (
								<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
									<div className="flex items-center gap-2 mb-3">
										<TrendingUp size={14} className="text-[#22c55e]" />
										<h3 className="text-[12px] font-semibold text-[#fafafa]">Velocity Trend</h3>
										<span className="ml-auto text-[10px] text-[#525252]">completed sprints</span>
									</div>
									<Suspense fallback={<div className="h-[200px] animate-pulse bg-[#1a1a1a] rounded-lg" />}>
										<VelocityTrendChart sprints={sprints} />
									</Suspense>
								</div>
							)}

							<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
								<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
									<Clock size={14} className="text-[#f59e0b]" />
									<h3 className="text-[12px] font-semibold text-[#fafafa]">Work Items</h3>
									<span className="text-[10px] text-[#525252]">{totalCount} items</span>
									<span className="ml-auto">
										<AddWorkItemPicker unassigned={unassigned} onAdd={(id) => handleAssignToSprint(id, selected.id)} />
									</span>
								</div>
								{!selected.workItems || selected.workItems.length === 0 ? (
									<div className="flex items-center justify-center py-10 text-[12px] text-[#525252]">
										No work items assigned to this sprint
									</div>
								) : (
									<div>
										{selected.workItems.map((item) => (
											<div
												key={item.id}
												className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors group"
											>
												<span className={`text-[11px] font-medium ${ITEM_STATUS_COLORS[item.status] ?? 'text-[#525252]'}`}>•</span>
												<span className="text-[12px] text-[#e5e5e5] flex-1 truncate">{item.title}</span>
												<span className="text-[10px] text-[#525252] bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#262626]">{item.type}</span>
												<span className="text-[10px] text-[#525252] w-16 text-right capitalize">{item.status.replace('_', ' ')}</span>
												<button
													type="button"
													onClick={() => handleAssignToSprint(item.id, null)}
													className="opacity-0 group-hover:opacity-100 text-[#525252] hover:text-[#f87171] transition-all"
													title="Remove from sprint"
												>
													<X size={11} />
												</button>
											</div>
										))}
										</div>
									)}
								</div>
							</div>
						)}
					</>
				)}

			{showCreate && (
				<CreateSprintModal
					projectId={projectId}
					defaultName={`Sprint ${sprints.length + 1}`}
					onClose={() => setShowCreate(false)}
					onCreated={() => { loadSprints(); loadTeamVelocity(); }}
				/>
			)}
		</div>
	);
}
