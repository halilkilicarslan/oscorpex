import { useState, useEffect } from 'react';
import {
	Trash2,
	Play,
	FolderOpen,
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	Code2,
	Pause,
	ListTodo,
	CheckCircle,
	Wrench,
	Archive,
} from 'lucide-react';
import {
	fetchProjectAgents,
	fetchProjectAnalytics,
	type Project,
	type ProjectAgent,
	type ProjectAnalytics,
} from '../../../lib/studio-api';
import AgentAvatarImg from '../../../components/AgentAvatar';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

export const STATUS_STYLES: Record<Project['status'], { color: string; icon: React.ReactNode; label: string }> = {
	planning: { color: 'text-[#f59e0b]', icon: <Clock size={12} />, label: 'Planning' },
	approved: { color: 'text-[#3b82f6]', icon: <CheckCircle2 size={12} />, label: 'Approved' },
	running: { color: 'text-[#22c55e]', icon: <Loader2 size={12} className="animate-spin" />, label: 'Running' },
	paused: { color: 'text-[#a855f7]', icon: <Pause size={12} />, label: 'Paused' },
	completed: { color: 'text-[#22c55e]', icon: <CheckCircle2 size={12} />, label: 'Completed' },
	failed: { color: 'text-[#ef4444]', icon: <XCircle size={12} />, label: 'Failed' },
	maintenance: { color: 'text-[#f97316]', icon: <Wrench size={12} />, label: 'Maintenance' },
	archived: { color: 'text-[#6b7280]', icon: <Archive size={12} />, label: 'Archived' },
};

export function StatusBadge({ status }: { status: Project['status'] }) {
	const s = STATUS_STYLES[status];
	return (
		<span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.color}`}>
			{s.icon}
			{s.label}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

export function ProjectCard({
	project,
	onOpen,
	onDelete,
}: {
	project: Project;
	onOpen: () => void;
	onDelete: () => void;
}) {
	const [agents, setAgents] = useState<ProjectAgent[]>([]);
	const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);

	useEffect(() => {
		fetchProjectAgents(project.id).then(setAgents).catch(() => {});
		fetchProjectAnalytics(project.id).then(setAnalytics).catch(() => {});
	}, [project.id]);

	const completionPct =
		analytics && analytics.totalTasks > 0
			? Math.round((analytics.completedTasks / analytics.totalTasks) * 100)
			: 0;

	return (
		<div
			onClick={onOpen}
			className="bg-[#111111] border border-[#262626] rounded-xl p-5 hover:border-[#333] transition-colors group cursor-pointer"
		>
			{/* Header */}
			<div className="flex items-start justify-between mb-3">
				<div className="flex items-center gap-2.5">
					<div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center">
						<Code2 size={18} className="text-[#22c55e]" />
					</div>
					<div>
						<h3 className="text-[14px] font-semibold text-[#fafafa]">{project.name}</h3>
						<StatusBadge status={project.status} />
					</div>
				</div>
				<button
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
					className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#ef4444] transition-all"
					title="Delete project"
				>
					<Trash2 size={14} />
				</button>
			</div>

			{/* Description */}
			{project.description && <p className="text-[12px] text-[#737373] mb-3 line-clamp-2">{project.description}</p>}

			{/* Tech stack */}
			{project.techStack.length > 0 && (
				<div className="flex flex-wrap gap-1 mb-3">
					{project.techStack.map((tech) => (
						<span key={tech} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]">
							{tech}
						</span>
					))}
				</div>
			)}

			{/* Team avatars */}
			{agents.length > 0 && (
				<div className="flex items-center gap-2 mb-3">
					<div className="flex -space-x-1.5">
						{agents.slice(0, 6).map((agent) => (
							<AgentAvatarImg
								key={agent.id}
								avatar={agent.avatar}
								name={agent.name}
								size="xs"
								className="ring-2 ring-[#111111]"
							/>
						))}
					</div>
					<span className="text-[10px] text-[#525252]">
						{agents.length} {agents.length === 1 ? 'agent' : 'agents'}
					</span>
				</div>
			)}

			{/* Mini metrics */}
			{analytics && analytics.totalTasks > 0 && (
				<div className="flex items-center gap-3 mb-3">
					<div className="flex items-center gap-1">
						<ListTodo size={11} className="text-[#525252]" />
						<span className="text-[10px] text-[#a3a3a3]">{analytics.totalTasks}</span>
					</div>
					<div className="flex items-center gap-1">
						<CheckCircle size={11} className="text-[#22c55e]" />
						<span className="text-[10px] text-[#22c55e]">{analytics.completedTasks}</span>
					</div>
					{analytics.inProgressTasks > 0 && (
						<div className="flex items-center gap-1">
							<Loader2 size={11} className="text-[#3b82f6]" />
							<span className="text-[10px] text-[#3b82f6]">{analytics.inProgressTasks}</span>
						</div>
					)}
					{/* Progress bar */}
					<div className="flex-1 h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
						<div
							className="h-full bg-[#22c55e] rounded-full transition-all"
							style={{ width: `${completionPct}%` }}
						/>
					</div>
					<span className="text-[10px] text-[#525252]">{completionPct}%</span>
				</div>
			)}

			{/* Footer */}
			<div className="flex items-center justify-between pt-3 border-t border-[#1f1f1f]">
				<span className="text-[10px] text-[#525252]">{new Date(project.createdAt).toLocaleDateString()}</span>
				<button
					onClick={(e) => {
						e.stopPropagation();
						onOpen();
					}}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
				>
					{project.status === 'planning' ? (
						<>
							<Play size={12} />
							Start Planning
						</>
					) : (
						<>
							<FolderOpen size={12} />
							Open
						</>
					)}
				</button>
			</div>
		</div>
	);
}
