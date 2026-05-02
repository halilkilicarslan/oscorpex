import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
	X,
	Loader2,
	ThumbsUp,
	ThumbsDown,
	RefreshCw,
	Target,
	Layers,
	CornerDownRight,
	FileText,
	FilePenLine,
	GitBranch,
	FlaskConical,
	ChevronRight,
	Eye,
	ShieldAlert,
	Search,
} from 'lucide-react';
import { roleLabel, approveTask, rejectTask, retryTask, type Task, type ProjectAgent } from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';
import { TaskDiffViewer } from './TaskDiffViewer';
import ModalOverlay from './ModalOverlay';
import { Section, STATUS_ICON, STATUS_LABEL, STATUS_COLOR, COMPLEXITY_COLORS, formatDate, formatDuration } from './task-detail/index.js';

interface TaskDetailModalProps {
	task: Task;
	agents?: ProjectAgent[];
	projectId: string;
	allTasks?: Task[];
	onNavigateTask?: (task: Task) => void;
	onClose: () => void;
	onRefresh?: () => void;
}

export default function TaskDetailModal({
	task,
	agents = [],
	projectId,
	allTasks = [],
	onNavigateTask,
	onClose,
	onRefresh,
}: TaskDetailModalProps) {
	const [actionLoading, setActionLoading] = useState(false);

	const handleApprove = async () => {
		setActionLoading(true);
		try {
			await approveTask(projectId, task.id);
			onRefresh?.();
			onClose();
		} finally {
			setActionLoading(false);
		}
	};

	const handleReject = async () => {
		setActionLoading(true);
		try {
			await rejectTask(projectId, task.id, 'Modal uzerinden reddedildi');
			onRefresh?.();
			onClose();
		} finally {
			setActionLoading(false);
		}
	};

	const handleRetry = async () => {
		setActionLoading(true);
		try {
			await retryTask(projectId, task.id);
			onRefresh?.();
			onClose();
		} finally {
			setActionLoading(false);
		}
	};

	const assigned = task.assignedAgent;
	const aLower = assigned?.toLowerCase() ?? '';
	const agent = agents.find((a) => a.id === assigned || a.role.toLowerCase() === aLower || a.name.toLowerCase() === aLower);
	const reviewerAgent = task.reviewerAgentId ? agents.find((a) => a.id === task.reviewerAgentId) : null;
	const subTasks = allTasks.filter((t) => t.parentTaskId === task.id);
	const parentTask = task.parentTaskId ? allTasks.find((t) => t.id === task.parentTaskId) : undefined;
	const doneSubTasks = subTasks.filter((st) => st.status === 'done').length;

	return (
		<ModalOverlay onClose={onClose} className="backdrop-blur-sm">
			<div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
				{/* Header */}
				<div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#1f1f1f] shrink-0">
					<div className="flex items-start gap-3 flex-1 min-w-0">
						<div className="mt-0.5">{STATUS_ICON[task.status]}</div>
						<div className="flex-1 min-w-0">
							<h2 className="text-[15px] font-semibold text-[#fafafa] leading-snug">{task.title}</h2>
							<div className="flex items-center gap-2 mt-1.5 flex-wrap">
								<span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_COLOR[task.status]}`}>
									{STATUS_LABEL[task.status]}
								</span>
								<span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${COMPLEXITY_COLORS[task.complexity] ?? ''}`}>
									{task.complexity}
								</span>
								{task.retryCount > 0 && (
									<span className="text-[9px] text-[#737373] bg-[#1a1a1a] border border-[#262626] px-1.5 py-0.5 rounded-full">
										{task.retryCount}x retry
									</span>
								)}
								{task.revisionCount != null && task.revisionCount > 0 && (
									<span className="text-[9px] text-[#f97316] bg-[#f97316]/10 border border-[#f97316]/20 px-1.5 py-0.5 rounded-full">
										{task.revisionCount}x revizyon
									</span>
								)}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-1 shrink-0 ml-3">
						<Link
							to={`/studio/${projectId}/tasks/${task.id}/inspector`}
							className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#22c55e] transition-colors"
							title="Inspector"
						>
							<Search size={16} />
						</Link>
						<button
							onClick={onClose}
							className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
						>
							<X size={18} />
						</button>
					</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
					{task.description && (
						<Section title="Aciklama">
							<p className="text-[12px] text-[#a3a3a3] leading-relaxed whitespace-pre-wrap">{task.description}</p>
						</Section>
					)}

					{parentTask && (
						<Section title="Parent Task">
							<button
								type="button"
								onClick={() => onNavigateTask?.(parentTask)}
								disabled={!onNavigateTask}
								className="flex items-center gap-2 w-full text-left p-2.5 rounded-lg bg-[#3b82f6]/5 border border-[#3b82f6]/20 hover:bg-[#3b82f6]/10 transition-colors disabled:cursor-default disabled:hover:bg-[#3b82f6]/5"
							>
								<CornerDownRight size={12} className="text-[#3b82f6] shrink-0" />
								<span className="flex-1 min-w-0 text-[12px] text-[#e5e5e5] font-medium truncate">{parentTask.title}</span>
								<span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLOR[parentTask.status]}`}>
									{STATUS_LABEL[parentTask.status]}
								</span>
								<span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${COMPLEXITY_COLORS[parentTask.complexity] ?? ''}`}>
									{parentTask.complexity}
								</span>
							</button>
						</Section>
					)}

					{subTasks.length > 0 && (
						<Section
							title={
								<span className="flex items-center gap-1.5">
									<Layers size={11} className="text-[#3b82f6]" />
									Sub-tasks ({doneSubTasks}/{subTasks.length})
								</span>
							}
						>
							<div className="flex flex-col gap-1.5">
								{subTasks.map((st) => (
									<button
										key={st.id}
										type="button"
										onClick={() => onNavigateTask?.(st)}
										disabled={!onNavigateTask}
										className="flex items-center gap-2 text-left p-2 rounded-lg bg-[#1a1a1a] border border-[#262626] hover:bg-[#222] transition-colors disabled:cursor-default disabled:hover:bg-[#1a1a1a]"
									>
										<span className="shrink-0">{STATUS_ICON[st.status]}</span>
										<span className="flex-1 min-w-0 text-[11px] text-[#e5e5e5] truncate">{st.title}</span>
										<span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${COMPLEXITY_COLORS[st.complexity] ?? ''}`}>
											{st.complexity}
										</span>
										{st.estimatedLines != null && (
											<span className="text-[9px] text-[#525252] font-mono shrink-0">~{st.estimatedLines}L</span>
										)}
									</button>
								))}
								</div>
							</Section>
						)}

						{((task.targetFiles && task.targetFiles.length > 0) || task.estimatedLines != null) && (
							<div className="grid grid-cols-1 gap-4">
								{task.targetFiles && task.targetFiles.length > 0 && (
									<Section
										title={
											<span className="flex items-center gap-1.5">
												<Target size={11} className="text-[#a855f7]" />
												Hedef Dosyalar
											</span>
										}
									>
										<div className="flex flex-col gap-1">
											{task.targetFiles.map((f) => (
												<div key={f} className="flex items-center gap-1.5">
													<FileText size={10} className="text-[#a855f7] shrink-0" />
													<span className="text-[11px] text-[#a3a3a3] font-mono truncate">{f}</span>
												</div>
											))}
										</div>
									</Section>
								)}
								{task.estimatedLines != null && (
									<Section title="Tahmini Satır">
										<span className="text-[11px] text-[#a3a3a3] font-mono">~{task.estimatedLines} satır</span>
									</Section>
								)}
							</div>
						)}

						<div className="grid grid-cols-2 gap-4">
							<Section title="Assigned Agent">
								{agent ? (
									<div className="flex items-center gap-2">
										<AgentAvatarImg avatar={agent.avatar} name={agent.name} size="sm" />
										<div>
											<span className="text-[12px] text-[#e5e5e5] font-medium">{agent.name}</span>
											<span className="text-[10px] text-[#525252] ml-1.5">{roleLabel(agent.role)}</span>
										</div>
									</div>
								) : (
									<span className="text-[11px] text-[#525252]">{roleLabel(task.assignedAgent)}</span>
								)}
							</Section>

							{reviewerAgent && (
								<Section title="Reviewer">
									<div className="flex items-center gap-2">
										<AgentAvatarImg avatar={reviewerAgent.avatar} name={reviewerAgent.name} size="sm" />
										<div>
											<span className="text-[12px] text-[#e5e5e5] font-medium">{reviewerAgent.name}</span>
											<span className="text-[10px] text-[#525252] ml-1.5">{roleLabel(reviewerAgent.role)}</span>
										</div>
									</div>
									{task.reviewStatus && (
										<span className={`mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${task.reviewStatus === 'approved' ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-[#ef4444]/10 text-[#ef4444]'}`}>
											{task.reviewStatus === 'approved' ? 'Onaylandi' : 'Reddedildi'}
										</span>
									)}
								</Section>
							)}
						</div>

						<div className="grid grid-cols-3 gap-4">
							<Section title="Baslangic">
								<span className="text-[11px] text-[#a3a3a3] font-mono">{formatDate(task.startedAt)}</span>
							</Section>
							<Section title="Bitis">
								<span className="text-[11px] text-[#a3a3a3] font-mono">{formatDate(task.completedAt)}</span>
							</Section>
							<Section title="Sure">
								<span className="text-[11px] text-[#a3a3a3] font-mono">{formatDuration(task.startedAt, task.completedAt)}</span>
							</Section>
						</div>

						<div className="grid grid-cols-2 gap-4">
							{task.branch && (
								<Section title="Branch">
									<div className="flex items-center gap-1.5">
										<GitBranch size={11} className="text-[#525252]" />
										<span className="text-[11px] text-[#a3a3a3] font-mono">{task.branch}</span>
									</div>
								</Section>
							)}
							{task.dependsOn.length > 0 && (
								<Section title="Bagimliliklar">
									<div className="flex flex-wrap gap-1">
										{task.dependsOn.map((depId) => (
											<span key={depId} className="text-[9px] font-mono bg-[#1a1a1a] border border-[#262626] text-[#737373] px-1.5 py-0.5 rounded">
												{depId.slice(0, 8)}...
											</span>
										))}
									</div>
								</Section>
							)}
						</div>

						{task.requiresApproval && (
							<Section title="Onay Durumu">
								<div className="flex items-center gap-2">
									<ShieldAlert size={12} className="text-[#f59e0b]" />
									<span className={`text-[11px] font-medium ${task.approvalStatus === 'approved' ? 'text-[#22c55e]' : task.approvalStatus === 'rejected' ? 'text-[#ef4444]' : 'text-[#f59e0b]'}`}>
										{task.approvalStatus === 'approved' ? 'Onaylandi' : task.approvalStatus === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
									</span>
								</div>
								{task.approvalRejectionReason && (
									<p className="text-[10px] text-[#ef4444]/80 mt-1 pl-5">{task.approvalRejectionReason}</p>
								)}
							</Section>
						)}

						{task.error && (task.status === 'revision' || task.status === 'review') && (
							<Section title="Review Geri Bildirimi">
								<div className="bg-[#f97316]/5 border border-[#f97316]/20 rounded-lg p-3">
									<div className="flex items-center gap-1.5 mb-2">
										<Eye size={11} className="text-[#f97316]" />
										<span className="text-[10px] font-semibold text-[#f97316]">Reviewer duzeltme istedi</span>
									</div>
									<p className="text-[11px] text-[#f97316]/80 font-mono leading-relaxed whitespace-pre-wrap break-words">
										{task.error.replace(/^Review red:\s*/i, '')}
									</p>
								</div>
							</Section>
						)}

						{task.error && task.status !== 'revision' && task.status !== 'review' && (
							<Section title="Hata">
								<div className="bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-lg p-3">
									<p className="text-[11px] text-[#ef4444]/90 font-mono leading-relaxed whitespace-pre-wrap break-words">{task.error}</p>
								</div>
							</Section>
						)}

						{task.output && (
							<>
								{task.output.filesCreated.length > 0 && (
									<Section title="Olusturulan Dosyalar">
										<div className="flex flex-col gap-1">
											{task.output.filesCreated.map((f) => (
												<div key={f} className="flex items-center gap-1.5">
													<FileText size={10} className="text-[#22c55e] shrink-0" />
													<span className="text-[11px] text-[#a3a3a3] font-mono truncate">{f}</span>
												</div>
											))}
										</div>
									</Section>
								)}
								{task.output.filesModified.length > 0 && (
									<Section title="Degistirilen Dosyalar">
										<div className="flex flex-col gap-1">
											{task.output.filesModified.map((f) => (
												<div key={f} className="flex items-center gap-1.5">
													<FilePenLine size={10} className="text-[#f59e0b] shrink-0" />
													<span className="text-[11px] text-[#a3a3a3] font-mono truncate">{f}</span>
												</div>
											))}
										</div>
									</Section>
								)}
								{task.output.testResults && (
									<Section title="Test Sonuclari">
										<div className="flex items-center gap-3">
											<FlaskConical size={12} className="text-[#525252]" />
											<span className="text-[11px] text-[#22c55e] font-medium">{task.output.testResults.passed} passed</span>
											{task.output.testResults.failed > 0 && (
												<span className="text-[11px] text-[#ef4444] font-medium">{task.output.testResults.failed} failed</span>
											)}
											<span className="text-[10px] text-[#525252]">/ {task.output.testResults.total} total</span>
										</div>
									</Section>
								)}
								{task.output.logs.length > 0 && (
									<Section title="Loglar">
										<div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg p-3 max-h-[200px] overflow-y-auto">
											{task.output.logs.map((log, i) => (
												<div key={i} className="flex items-start gap-2">
													<ChevronRight size={9} className="text-[#333] shrink-0 mt-1" />
													<span className="text-[10px] text-[#737373] font-mono leading-relaxed break-words">{log}</span>
												</div>
											))}
										</div>
									</Section>
								)}
								{task.status === 'done' && (task.output.filesCreated.length > 0 || task.output.filesModified.length > 0) && (
									<Section title="Dosya Degisiklikleri">
										<TaskDiffViewer projectId={projectId} taskId={task.id} />
									</Section>
								)}
							</>
						)}
					</div>

				{/* Footer */}
				<div className="px-6 py-3 border-t border-[#1f1f1f] shrink-0 flex items-center justify-between">
					<span className="text-[9px] text-[#333] font-mono">{task.id}</span>
					<div className="flex items-center gap-2">
						{task.status === 'waiting_approval' && (
							<>
								<button
									onClick={handleApprove}
									disabled={actionLoading}
									className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
								>
									{actionLoading ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
									Onayla
								</button>
								<button
									onClick={handleReject}
									disabled={actionLoading}
									className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors disabled:opacity-50"
								>
									{actionLoading ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
									Reddet
								</button>
							</>
						)}
						{(task.status === 'failed' || task.status === 'done') && (
							<button
								onClick={handleRetry}
								disabled={actionLoading}
								className={
									task.status === 'done'
										? 'flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50'
										: 'flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-colors disabled:opacity-50'
								}
							>
								{actionLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
								{task.status === 'done' ? 'Tekrar agente gonder' : 'Yeniden Dene'}
							</button>
						)}
						<button
							onClick={onClose}
							className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-[#1f1f1f] text-[#a3a3a3] hover:bg-[#262626] hover:text-[#e5e5e5] transition-colors"
						>
							Close
						</button>
					</div>
				</div>
			</div>
		</ModalOverlay>
	);
}
