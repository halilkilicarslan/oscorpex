import { useState, useEffect, useCallback, useRef } from 'react';
import {
	Workflow,
	Zap,
	Clock,
	Activity,
	Play,
	Trash2,
	Edit3,
	Plus,
	TestTube2,
	ChevronDown,
	ChevronUp,
	RefreshCw,
	ToggleLeft,
	ToggleRight,
	Eye,
	EyeOff,
	Filter,
	Search,
} from 'lucide-react';
import { httpGet, httpPost, httpPut, httpDelete } from '../../lib/studio-api/base.js';
import { useModalState } from '../../hooks/useModalState.js';
import { StatCard } from './StatCard.js';
import { TriggerFormModal } from './TriggerFormModal.js';
import {
	type Trigger,
	type TriggerLog,
	type TriggerStats,
	type TriggerType,
	type LogStatus,
	API_BASE,
	TYPE_META,
	LOG_STATUS_META,
	fmtTime,
	timeAgo,
	configSummary,
	actionSummary,
} from './types.js';

export default function TriggersPage() {
	const [activeTab, setActiveTab] = useState<'triggers' | 'logs'>('triggers');

	// Triggers state
	const [triggers, setTriggers] = useState<Trigger[]>([]);
	const [triggersLoading, setTriggersLoading] = useState(true);
	const [stats, setStats] = useState<TriggerStats | null>(null);

	// Filters
	const [typeFilter, setTypeFilter] = useState<TriggerType | 'ALL'>('ALL');
	const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'disabled'>('ALL');
	const [search, setSearch] = useState('');

	// Form modal
	const formModal = useModalState<Trigger>();

	// Logs state
	const [logs, setLogs] = useState<(TriggerLog & { trigger_name?: string })[]>([]);
	const [logsTotal, setLogsTotal] = useState(0);
	const [logsLoading, setLogsLoading] = useState(false);
	const [logsPage, setLogsPage] = useState(0);
	const [logsTriggerFilter, setLogsTriggerFilter] = useState<string>('ALL');
	const [logsStatusFilter, setLogsStatusFilter] = useState<LogStatus | 'ALL'>('ALL');
	const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
	const PAGE_SIZE = 25;

	// Auto-refresh
	const [autoRefresh, setAutoRefresh] = useState(false);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// ---------------------------------------------------------------------------
	// Data loading
	// ---------------------------------------------------------------------------

	const loadTriggers = useCallback(async () => {
		try {
			setTriggersLoading(true);
			const data = await httpGet<{ triggers: Trigger[] }>(`${API_BASE}/triggers`);
			setTriggers(data.triggers ?? []);
		} catch {
			// silent
		} finally {
			setTriggersLoading(false);
		}
	}, []);

	const loadStats = useCallback(async () => {
		try {
			const data = await httpGet<TriggerStats>(`${API_BASE}/triggers/stats`);
			setStats(data);
		} catch {
			// silent
		}
	}, []);

	const loadLogs = useCallback(async () => {
		try {
			setLogsLoading(true);
			// Load logs from all triggers and merge
			const triggerList = triggers.length > 0 ? triggers : [];
			if (triggerList.length === 0) { setLogs([]); setLogsTotal(0); return; }

			const targetTriggers = logsTriggerFilter === 'ALL'
				? triggerList
				: triggerList.filter((t) => t.id === logsTriggerFilter);

			const promises = targetTriggers.map(async (t) => {
				const params = new URLSearchParams({ limit: '100', offset: '0' });
				if (logsStatusFilter !== 'ALL') params.set('status', logsStatusFilter);
				const data = await httpGet<{ logs: TriggerLog[]; total: number }>(`${API_BASE}/triggers/${t.id}/logs?${params}`);
				return (data.logs ?? []).map((l) => ({ ...l, trigger_name: t.name }));
			});

			const results = await Promise.all(promises);
			const allLogs = results.flat().sort((a, b) =>
				new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime()
			);
			setLogsTotal(allLogs.length);
			setLogs(allLogs.slice(logsPage * PAGE_SIZE, (logsPage + 1) * PAGE_SIZE));
		} catch {
			// silent
		} finally {
			setLogsLoading(false);
		}
	}, [triggers, logsTriggerFilter, logsStatusFilter, logsPage]);

	const loadAll = useCallback(() => {
		void loadTriggers();
		void loadStats();
	}, [loadTriggers, loadStats]);

	useEffect(() => { void loadAll(); }, [loadAll]);
	useEffect(() => { if (activeTab === 'logs' && triggers.length >= 0) void loadLogs(); }, [activeTab, loadLogs, triggers]);

	useEffect(() => {
		if (autoRefresh) {
			timerRef.current = setInterval(() => { void loadAll(); }, 10000);
		} else {
			if (timerRef.current) clearInterval(timerRef.current);
		}
		return () => { if (timerRef.current) clearInterval(timerRef.current); };
	}, [autoRefresh, loadAll]);

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	async function deleteTrigger(id: string) {
		if (!confirm('Delete this trigger and all its logs?')) return;
		try {
			await httpDelete(`${API_BASE}/triggers/${id}`);
			void loadAll();
		} catch { /* silent */ }
	}

	async function toggleTrigger(id: string) {
		try {
			await httpPut(`${API_BASE}/triggers/${id}/toggle`);
			void loadAll();
		} catch { /* silent */ }
	}

	async function testFire(id: string) {
		try {
			await httpPost(`${API_BASE}/triggers/${id}/test`);
			void loadAll();
			if (activeTab === 'logs') void loadLogs();
		} catch { /* silent */ }
	}

	function toggleExpandLog(id: string) {
		setExpandedLogs((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// ---------------------------------------------------------------------------
	// Filtered triggers
	// ---------------------------------------------------------------------------

	const filteredTriggers = triggers.filter((t) => {
		if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
		if (statusFilter === 'active' && !t.enabled) return false;
		if (statusFilter === 'disabled' && t.enabled) return false;
		if (search) {
			const q = search.toLowerCase();
			return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
		}
		return true;
	});

	const totalLogsPages = Math.ceil(logsTotal / PAGE_SIZE);

	// Success rate
	const successRate = stats
		? stats.totalFires > 0
			? Math.round((stats.totalFires / stats.totalFires) * 100)
			: 0
		: 0;

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	return (
		<div className="flex flex-col h-full bg-[#0a0a0a] text-[#fafafa] overflow-hidden">
			{/* Header */}
			<div className="flex-shrink-0 px-6 py-4 border-b border-[#262626] flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] flex items-center justify-center">
						<Workflow className="w-4 h-4 text-[#22c55e]" />
					</div>
					<div>
						<h1 className="text-base font-semibold text-[#fafafa]">Triggers</h1>
						<p className="text-xs text-[#525252]">Event triggers and automation</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setAutoRefresh((v) => !v)}
						className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ${
							autoRefresh
								? 'bg-[#052e16] text-[#22c55e] border-[#16a34a]'
								: 'bg-[#111111] text-[#a3a3a3] border-[#262626] hover:border-[#3f3f46]'
						}`}
					>
						{autoRefresh ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
						Auto-refresh
					</button>
					<button
						onClick={loadAll}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] hover:border-[#3f3f46] transition-colors"
					>
						<RefreshCw className="w-3 h-3" />
						Refresh
					</button>
				</div>
			</div>

			{/* Stats Row */}
			<div className="flex-shrink-0 flex border-b border-[#262626]">
				<StatCard label="Total Triggers" value={stats?.total ?? 0} color="#a3a3a3" icon={<Workflow className="w-3.5 h-3.5" />} />
				<StatCard label="Active" value={stats?.active ?? 0} color="#22c55e" icon={<Play className="w-3.5 h-3.5" />} />
				<StatCard label="Fires (24h)" value={stats?.recentFires24h ?? 0} color="#3b82f6" icon={<Zap className="w-3.5 h-3.5" />} />
				<StatCard label="Success Rate" value={successRate} color="#f59e0b" icon={<Activity className="w-3.5 h-3.5" />} />
			</div>

			{/* Tab Toggle */}
			<div className="flex-shrink-0 flex items-center gap-1 px-6 py-3 border-b border-[#262626]">
				{(['triggers', 'logs'] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
							activeTab === tab
								? 'bg-[#1c1c1c] text-[#fafafa] border border-[#3f3f46]'
								: 'text-[#525252] hover:text-[#a3a3a3]'
						}`}
					>
						{tab === 'triggers' ? 'All Triggers' : 'Logs'}
					</button>
				))}
			</div>

			{/* Tab Content */}
			<div className="flex-1 overflow-hidden">
				{/* ================================================================
				    TAB: All Triggers
				================================================================ */}
				{activeTab === 'triggers' && (
					<div className="flex flex-col h-full">
						{/* Filter bar */}
						<div className="flex-shrink-0 flex items-center gap-2 px-6 py-3 border-b border-[#262626]">
							{/* Search */}
							<div className="relative flex-1 max-w-xs">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#525252]" />
								<input
									type="text"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search triggers..."
									className="w-full pl-7 pr-3 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#3f3f46]"
								/>
							</div>

							{/* Type filter */}
							<div className="flex items-center gap-1">
								<Filter className="w-3 h-3 text-[#525252]" />
								<select
									value={typeFilter}
									onChange={(e) => setTypeFilter(e.target.value as TriggerType | 'ALL')}
									className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
								>
									<option value="ALL">All Types</option>
									<option value="webhook">Webhook</option>
									<option value="schedule">Schedule</option>
									<option value="event">Event</option>
									<option value="condition">Condition</option>
								</select>
							</div>

							{/* Status filter */}
							<select
								value={statusFilter}
								onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'active' | 'disabled')}
								className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
							>
								<option value="ALL">All Status</option>
								<option value="active">Active</option>
								<option value="disabled">Disabled</option>
							</select>

							<span className="text-xs text-[#525252] ml-auto">{filteredTriggers.length} trigger{filteredTriggers.length !== 1 ? 's' : ''}</span>

							{/* Create button */}
							<button
								onClick={() => formModal.open()}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#22c55e] text-[#0a0a0a] font-medium hover:bg-[#16a34a] transition-colors"
							>
								<Plus className="w-3 h-3" />
								Create Trigger
							</button>
						</div>

						{/* Trigger list */}
						<div className="flex-1 overflow-y-auto p-4">
							{triggersLoading ? (
								<div className="flex items-center justify-center h-32">
									<RefreshCw className="w-4 h-4 text-[#525252] animate-spin" />
								</div>
							) : filteredTriggers.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-48 gap-3">
									<Workflow className="w-10 h-10 text-[#262626]" />
									<p className="text-sm text-[#525252]">No triggers configured yet</p>
									<button
										onClick={() => formModal.open()}
										className="text-xs text-[#22c55e] hover:underline"
									>
										Create your first trigger
									</button>
								</div>
							) : (
								<div className="space-y-2 max-w-4xl">
									{filteredTriggers.map((trigger) => {
										const meta = TYPE_META[trigger.type as TriggerType] ?? TYPE_META.webhook;
										return (
											<div
												key={trigger.id}
												className={`rounded-lg border bg-[#111111] hover:border-[#3f3f46] transition-colors ${
													trigger.enabled ? 'border-[#262626]' : 'border-[#1c1c1c] opacity-70'
												}`}
											>
												<div className="px-4 py-3 flex items-start gap-3">
													{/* Type icon */}
													<div className={`mt-0.5 w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
														trigger.type === 'webhook'   ? 'bg-[#172554] text-[#3b82f6]' :
														trigger.type === 'schedule'  ? 'bg-[#451a03] text-[#f59e0b]' :
														trigger.type === 'event'     ? 'bg-[#2e1065] text-[#a855f7]' :
														                               'bg-[#052e16] text-[#22c55e]'
													}`}>
														{meta.icon}
													</div>

													<div className="flex-1 min-w-0">
														{/* Top row */}
														<div className="flex items-center gap-2 flex-wrap">
															<span className={`text-sm font-medium ${trigger.enabled ? 'text-[#fafafa]' : 'text-[#525252]'}`}>
																{trigger.name}
															</span>
															<span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.badge}`}>
																{meta.label}
															</span>
															{!trigger.enabled && (
																<span className="px-1.5 py-0.5 rounded text-[10px] text-[#525252] bg-[#1c1c1c] border border-[#262626]">
																	Disabled
																</span>
															)}
														</div>

														{/* Description */}
														{trigger.description && (
															<p className="text-[11px] text-[#525252] mt-0.5 truncate max-w-md">{trigger.description}</p>
														)}

														{/* Config summary */}
														<p className="text-xs text-[#a3a3a3] mt-1 truncate max-w-lg">{configSummary(trigger.type as TriggerType, trigger.config)}</p>

														{/* Action summary */}
														<p className="text-[11px] text-[#525252] mt-0.5">
															Action: <span className="text-[#a3a3a3]">{actionSummary(trigger.action)}</span>
														</p>

														{/* Stats row */}
														<div className="flex items-center gap-4 mt-1.5 text-[11px] text-[#525252]">
															<span className="flex items-center gap-1">
																<Zap className="w-3 h-3" />
																{trigger.fire_count} fires
															</span>
															{trigger.last_fired_at && (
																<span className="flex items-center gap-1">
																	<Clock className="w-3 h-3" />
																	Last: {timeAgo(trigger.last_fired_at)}
																</span>
															)}
														</div>
													</div>

													{/* Actions */}
													<div className="flex items-center gap-1 flex-shrink-0">
														{/* Toggle */}
														<button
															onClick={() => void toggleTrigger(trigger.id)}
															title={trigger.enabled ? 'Disable' : 'Enable'}
															className="p-1.5 rounded-md hover:bg-[#1c1c1c] transition-colors"
														>
															{trigger.enabled
																? <ToggleRight className="w-4 h-4 text-[#22c55e]" />
																: <ToggleLeft className="w-4 h-4 text-[#525252]" />}
														</button>
														{/* Edit */}
														<button
															onClick={() => formModal.open(trigger)}
															title="Edit"
															className="p-1.5 rounded-md hover:bg-[#1c1c1c] text-[#525252] hover:text-[#a3a3a3] transition-colors"
														>
															<Edit3 className="w-3.5 h-3.5" />
														</button>
														{/* Test fire */}
														<button
															onClick={() => void testFire(trigger.id)}
															title="Test Fire"
															className="p-1.5 rounded-md hover:bg-[#1c1c1c] text-[#525252] hover:text-[#22c55e] transition-colors"
														>
															<TestTube2 className="w-3.5 h-3.5" />
														</button>
														{/* Delete */}
														<button
															onClick={() => void deleteTrigger(trigger.id)}
															title="Delete"
															className="p-1.5 rounded-md hover:bg-[#450a0a] text-[#525252] hover:text-[#ef4444] transition-colors"
														>
															<Trash2 className="w-3.5 h-3.5" />
														</button>
													</div>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>
					</div>
				)}

				{/* ================================================================
				    TAB: Logs
				================================================================ */}
				{activeTab === 'logs' && (
					<div className="flex flex-col h-full">
						{/* Log filters */}
						<div className="flex-shrink-0 flex items-center gap-2 px-6 py-3 border-b border-[#262626]">
							<select
								value={logsTriggerFilter}
								onChange={(e) => { setLogsPage(0); setLogsTriggerFilter(e.target.value); }}
								className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
							>
								<option value="ALL">All Triggers</option>
								{triggers.map((t) => (
									<option key={t.id} value={t.id}>{t.name}</option>
								))}
							</select>

							<select
								value={logsStatusFilter}
								onChange={(e) => { setLogsPage(0); setLogsStatusFilter(e.target.value as LogStatus | 'ALL'); }}
								className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
							>
								<option value="ALL">All Status</option>
								<option value="success">Success</option>
								<option value="failed">Failed</option>
								<option value="skipped">Skipped</option>
							</select>

							<span className="text-xs text-[#525252] ml-auto">{logsTotal} entries</span>

							<button
								onClick={() => void loadLogs()}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] hover:border-[#3f3f46] transition-colors"
							>
								<RefreshCw className="w-3 h-3" />
								Refresh
							</button>
						</div>

						{/* Log list */}
						<div className="flex-1 overflow-y-auto p-4">
							{logsLoading ? (
								<div className="flex items-center justify-center h-32">
									<RefreshCw className="w-4 h-4 text-[#525252] animate-spin" />
								</div>
							) : logs.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-48 gap-3">
									<Activity className="w-10 h-10 text-[#262626]" />
									<p className="text-sm text-[#525252]">No trigger logs yet</p>
									<p className="text-xs text-[#525252]">Use "Test Fire" on a trigger to generate a log entry</p>
								</div>
							) : (
								<div className="max-w-4xl">
									{/* Timeline */}
									<div className="relative">
										<div className="absolute left-[7px] top-0 bottom-0 w-px bg-[#262626]" />
										<div className="space-y-2">
											{logs.map((log) => {
												const statusMeta = LOG_STATUS_META[log.status as LogStatus] ?? LOG_STATUS_META.skipped;
												const expanded = expandedLogs.has(log.id);
												return (
													<div key={log.id} className="relative pl-6">
														{/* Timeline dot */}
														<div className={`absolute left-0 top-3 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0a] ${
															log.status === 'success' ? 'bg-[#22c55e]' :
															log.status === 'failed'  ? 'bg-[#ef4444]' : 'bg-[#525252]'
														}`} />

														<div className="rounded-lg border border-[#262626] bg-[#111111] overflow-hidden">
															<div className="px-3 py-2.5">
																<div className="flex items-start justify-between gap-2">
																	<div className="flex-1 min-w-0">
																		<div className="flex items-center gap-2 flex-wrap">
																			<span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusMeta.badge}`}>
																				{statusMeta.icon}
																				{statusMeta.label}
																			</span>
																			{log.trigger_name && (
																				<span className="text-xs text-[#a3a3a3]">{log.trigger_name}</span>
																			)}
																			{log.duration_ms !== null && (
																				<span className="text-[10px] text-[#525252]">{log.duration_ms}ms</span>
																			)}
																		</div>
																		<div className="flex items-center gap-3 mt-1.5 text-[11px] text-[#525252]">
																			<span className="flex items-center gap-1">
																				<Clock className="w-3 h-3" />
																				{fmtTime(log.fired_at)}
																			</span>
																			<span>{timeAgo(log.fired_at)}</span>
																		</div>
																	</div>
																	<button
																		onClick={() => toggleExpandLog(log.id)}
																		className="flex-shrink-0 text-[#525252] hover:text-[#a3a3a3] transition-colors"
																	>
																		{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
																	</button>
																</div>
															</div>

															{expanded && (
																<div className="border-t border-[#262626] bg-[#0a0a0a] px-3 py-2 space-y-2">
																	{log.input !== null && (
																		<div>
																			<p className="text-[10px] text-[#525252] font-mono uppercase tracking-wider mb-1">Input</p>
																			<pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
																				{JSON.stringify(log.input, null, 2)}
																			</pre>
																		</div>
																	)}
																	{log.output !== null && (
																		<div>
																			<p className="text-[10px] text-[#525252] font-mono uppercase tracking-wider mb-1">Output</p>
																			<pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
																				{JSON.stringify(log.output, null, 2)}
																			</pre>
																		</div>
																	)}
																</div>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>

									{/* Pagination */}
									{totalLogsPages > 1 && (
										<div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-[#262626]">
											<button
												disabled={logsPage === 0}
												onClick={() => setLogsPage((p) => p - 1)}
												className="px-3 py-1 text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] rounded-md disabled:opacity-30 hover:border-[#3f3f46] transition-colors"
											>
												Previous
											</button>
											<span className="text-xs text-[#525252]">
												{logsPage + 1} / {totalLogsPages}
											</span>
											<button
												disabled={logsPage >= totalLogsPages - 1}
												onClick={() => setLogsPage((p) => p + 1)}
												className="px-3 py-1 text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] rounded-md disabled:opacity-30 hover:border-[#3f3f46] transition-colors"
											>
												Next
											</button>
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Form Modal */}
			{formModal.isOpen && (
				<TriggerFormModal
					editing={formModal.selectedItem}
					onClose={formModal.close}
					onSaved={() => { void loadAll(); }}
				/>
			)}
		</div>
	);
}
