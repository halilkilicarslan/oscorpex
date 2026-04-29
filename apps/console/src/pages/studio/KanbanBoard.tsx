import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Kanban } from 'lucide-react';
import {
	fetchTasksPaginated,
	retryTask,
	fetchAutoStartStatus,
	fetchProjectAgents,
	approveTask,
	rejectTask,
	type Task,
	type AutoStartStatus,
	type ProjectAgent,
} from '../../lib/studio-api';
import TaskDetailModal from './TaskDetailModal';
import TerminalSheet from './TerminalSheet';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
	PipelineAutoStartBadge,
	ErrorToast,
	RejectModal,
	ApprovalBanner,
	KanbanColumn,
	PAGE_SIZE,
	KANBAN_WS_EVENTS,
	COLUMNS,
	type ToastMessage,
} from './kanban-board';

let toastCounter = 0;

export default function KanbanBoard({ projectId }: { projectId: string }) {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [agents, setAgents] = useState<ProjectAgent[]>([]);
	const [loading, setLoading] = useState(true);
	const [autoStartStatus, setAutoStartStatus] = useState<AutoStartStatus | null>(null);
	const [toasts, setToasts] = useState<ToastMessage[]>([]);
	const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
	const [terminalTask, setTerminalTask] = useState<Task | null>(null);
	const [detailTask, setDetailTask] = useState<Task | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [loadingMore, setLoadingMore] = useState(false);

	const dismissToast = useCallback((id: number) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const showToast = useCallback(
		(message: string, type: 'error' | 'success' = 'error') => {
			const id = ++toastCounter;
			setToasts((prev) => [...prev, { id, message, type }]);
			setTimeout(() => dismissToast(id), 5000);
		},
		[dismissToast],
	);

	const load = useCallback(() => {
		Promise.all([fetchTasksPaginated(projectId, PAGE_SIZE, 0), fetchProjectAgents(projectId)])
			.then(([result, a]) => {
				setTasks(result.data);
				setAgents(a);
				setTotal(result.total);
				setOffset(PAGE_SIZE);
				setHasMore(result.data.length < result.total);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [projectId]);

	const handleLoadMore = useCallback(async () => {
		if (loadingMore || !hasMore) return;
		setLoadingMore(true);
		try {
			const result = await fetchTasksPaginated(projectId, PAGE_SIZE, offset);
			setTasks((prev) => [...prev, ...result.data]);
			setOffset((prev) => prev + PAGE_SIZE);
			setHasMore(tasks.length + result.data.length < result.total);
		} catch {
			// sessizce geç
		} finally {
			setLoadingMore(false);
		}
	}, [projectId, offset, hasMore, loadingMore, tasks.length]);

	const loadAutoStartStatus = useCallback(() => {
		fetchAutoStartStatus(projectId)
			.then(setAutoStartStatus)
			.catch(() => {});
	}, [projectId]);

	const { isWsActive } = useWsEventRefresh(
		projectId,
		KANBAN_WS_EVENTS,
		() => {
			load();
			loadAutoStartStatus();
		},
		{ debounceMs: 500 },
	);

	useEffect(() => {
		load();
		loadAutoStartStatus();
	}, [load, loadAutoStartStatus]);

	useEffect(() => {
		if (isWsActive) return;
		const interval = setInterval(() => {
			load();
			loadAutoStartStatus();
		}, 15000);
		return () => clearInterval(interval);
	}, [isWsActive, load, loadAutoStartStatus]);

	const handleRetry = async (taskId: string): Promise<void> => {
		setTasks((prev) =>
			prev.map((t) => (t.id === taskId ? { ...t, status: 'queued' as const } : t)),
		);
		try {
			await retryTask(projectId, taskId);
			load();
		} catch (err) {
			load();
			const message =
				err instanceof Error
					? `Retry basarisiz: ${err.message}`
					: 'Retry sirasinda beklenmeyen bir hata olustu.';
			showToast(message);
		}
	};

	const handleApprove = async (taskId: string): Promise<void> => {
		setTasks((prev) =>
			prev.map((t) =>
				t.id === taskId ? { ...t, status: 'queued' as const, approvalStatus: 'approved' } : t,
			),
		);
		try {
			await approveTask(projectId, taskId);
			load();
			showToast('Task onaylandi — execution basliyor.', 'success');
		} catch (err) {
			load();
			const message = err instanceof Error ? `Onay basarisiz: ${err.message}` : 'Onay sirasinda hata olustu.';
			showToast(message);
		}
	};

	const handleOpenReject = (task: Task) => {
		setRejectingTask(task);
	};

	const handleConfirmReject = async (reason: string) => {
		if (!rejectingTask) return;
		const taskId = rejectingTask.id;
		const taskTitle = rejectingTask.title;
		setRejectingTask(null);

		setTasks((prev) =>
			prev.map((t) =>
				t.id === taskId ? { ...t, status: 'failed' as const, approvalStatus: 'rejected' } : t,
			),
		);
		try {
			await rejectTask(projectId, taskId, reason || undefined);
			load();
			showToast(`"${taskTitle}" reddedildi.`, 'error');
		} catch (err) {
			load();
			const message = err instanceof Error ? `Red basarisiz: ${err.message}` : 'Red sirasinda hata olustu.';
			showToast(message);
		}
	};

	const subTaskMap = useMemo(() => {
		const map = new Map<string, Task[]>();
		for (const task of tasks) {
			if (task.parentTaskId) {
				if (!map.has(task.parentTaskId)) map.set(task.parentTaskId, []);
				map.get(task.parentTaskId)!.push(task);
			}
		}
		return map;
	}, [tasks]);

	const grouped = useMemo(() => {
		const map = new Map<Task['status'], Task[]>();
		for (const col of COLUMNS) map.set(col.key, []);
		for (const task of tasks) {
			const list = map.get(task.status);
			if (list) list.push(task);
		}
		return map;
	}, [tasks]);

	const activeColumns = useMemo(
		() =>
			COLUMNS.filter(
				(col) =>
					(grouped.get(col.key)?.length ?? 0) > 0 || ['queued', 'running', 'done'].includes(col.key),
			),
		[grouped],
	);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 size={20} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	if (tasks.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center p-6">
				<Kanban size={32} className="text-[#333] mb-3" />
				<h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Tasks Yet</h3>
				<p className="text-[12px] text-[#525252] max-w-sm">
					Tasks will appear here after you create and approve a project plan in the Planner.
				</p>
			</div>
		);
	}

	return (
		<>
			{rejectingTask && (
				<RejectModal
					taskTitle={rejectingTask.title}
					onConfirm={handleConfirmReject}
					onCancel={() => setRejectingTask(null)}
				/>
			)}

			{terminalTask && (() => {
				const assigned = terminalTask.assignedAgent ?? terminalTask.assignedAgentId;
				const aLower = (assigned ?? '').toLowerCase();
				const agent =
					agents.find(
						(a) =>
							a.id === assigned ||
							a.role.toLowerCase() === aLower ||
							a.name.toLowerCase() === aLower ||
							a.role.toLowerCase().startsWith(aLower + '-') ||
							a.role.toLowerCase().endsWith('-' + aLower),
					) ?? null;
				return (
					<TerminalSheet
						projectId={projectId}
						taskId={terminalTask.id}
						taskTitle={terminalTask.title}
						agent={agent}
						isRunning={terminalTask.status === 'running'}
						onClose={() => setTerminalTask(null)}
					/>
				);
			})()}

			<ErrorToast toasts={toasts} onDismiss={dismissToast} />
			<div className="p-6 h-full overflow-x-auto flex flex-col">
				{autoStartStatus && <PipelineAutoStartBadge status={autoStartStatus} />}
				<ApprovalBanner tasks={tasks} />

				<div className="flex flex-col gap-3 flex-1">
					{hasMore && (
						<button
							onClick={handleLoadMore}
							disabled={loadingMore}
							className="w-full py-2 text-sm text-gray-400 hover:text-white bg-[#1a1a1a] border border-[#262626] rounded-lg hover:bg-[#222] transition-colors"
						>
							{loadingMore ? 'Loading...' : `Load more (${tasks.length} of ${total})`}
						</button>
					)}
					<div className="flex gap-4 min-w-min flex-1">
						{activeColumns.map((col) => (
							<KanbanColumn
								key={col.key}
								col={col}
								tasks={grouped.get(col.key) ?? []}
								agents={agents}
								subTaskMap={subTaskMap}
								onRetry={col.key === 'failed' ? handleRetry : undefined}
								onApprove={col.key === 'waiting_approval' ? handleApprove : undefined}
								onReject={col.key === 'waiting_approval' ? handleOpenReject : undefined}
								onTerminal={setTerminalTask}
								onDetail={setDetailTask}
							/>
						))}
					</div>
				</div>
			</div>

			{detailTask && (
				<TaskDetailModal
					task={detailTask}
					agents={agents}
					projectId={projectId}
					allTasks={tasks}
					onNavigateTask={(t) => setDetailTask(t)}
					onClose={() => setDetailTask(null)}
					onRefresh={load}
				/>
			)}
		</>
	);
}
