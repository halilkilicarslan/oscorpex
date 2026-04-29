import { ArrowLeft, Loader2, Play, Square, FileText, CheckCircle2, Brain, Bell, BellOff } from 'lucide-react';
import type { Project, AppStatus } from "../../../lib/studio-api";

interface ProjectHeaderProps {
	project: Project;
	appStatus: AppStatus;
	appLoading: boolean;
	previewEnabled: boolean;
	readmeLoading: boolean;
	readmeDone: boolean;
	notifyEnabled: boolean;
	onNavigateBack: () => void;
	onToggleApp: () => void;
	onGenerateReadme: () => void;
	onOpenPlannerSettings: () => void;
	onRequestNotificationPermission: () => void;
}

export default function ProjectHeader({
	project,
	appStatus,
	appLoading,
	previewEnabled,
	readmeLoading,
	readmeDone,
	notifyEnabled,
	onNavigateBack,
	onToggleApp,
	onGenerateReadme,
	onOpenPlannerSettings,
	onRequestNotificationPermission,
}: ProjectHeaderProps) {
	return (
		<div className="flex items-center gap-3 px-6 py-4 border-b border-[#262626]">
			<button
				onClick={onNavigateBack}
				className="p-1.5 rounded-lg hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
			>
				<ArrowLeft size={18} />
			</button>
			<div className="flex-1">
				<h1 className="text-[15px] font-semibold text-[#fafafa]">{project.name}</h1>
				<div className="flex items-center gap-2 mt-0.5">
					<span className="text-[11px] text-[#525252] capitalize">{project.status}</span>
					{project.techStack.length > 0 && (
						<>
							<span className="text-[#262626]">|</span>
							<span className="text-[11px] text-[#525252]">{project.techStack.join(', ')}</span>
						</>
					)}
					{appStatus.running && appStatus.services?.length > 0 && (
						<>
							<span className="text-[#262626]">|</span>
							{appStatus.services.map((s) => (
								<a
									key={s.name}
									href={s.url}
									target="_blank"
									rel="noreferrer"
									className="text-[11px] text-[#22c55e] hover:underline"
								>
									{s.name}
								</a>
							))}
						</>
					)}
					{appStatus.running && (!appStatus.services || appStatus.services.length === 0) && (
						<>
							<span className="text-[#262626]">|</span>
							{appStatus.backendUrl && (
								<a
									href={appStatus.backendUrl}
									target="_blank"
									rel="noreferrer"
									className="text-[11px] text-[#22c55e] hover:underline"
								>
									Backend
								</a>
							)}
							{appStatus.frontendUrl && (
								<a
									href={appStatus.frontendUrl}
									target="_blank"
									rel="noreferrer"
									className="text-[11px] text-[#22c55e] hover:underline"
								>
									Frontend
								</a>
							)}
						</>
					)}
				</div>
			</div>
			{previewEnabled && (
				<button
					onClick={onToggleApp}
					disabled={appLoading}
					className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
						appStatus.running
							? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
							: 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20'
					} disabled:opacity-50`}
				>
					{appLoading ? (
						<Loader2 size={14} className="animate-spin" />
					) : appStatus.running ? (
						<Square size={14} />
					) : (
						<Play size={14} />
					)}
					{appStatus.running ? 'Stop App' : 'Run App'}
				</button>
			)}
			<button
				onClick={onGenerateReadme}
				disabled={readmeLoading || !project.repoPath}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors bg-[#1f1f1f] text-[#a3a3a3] hover:bg-[#262626] hover:text-[#fafafa] disabled:opacity-40"
				title="Generate README.md and commit to git repo"
			>
				{readmeLoading ? (
					<Loader2 size={14} className="animate-spin" />
				) : readmeDone ? (
					<CheckCircle2 size={14} className="text-[#22c55e]" />
				) : (
					<FileText size={14} />
				)}
				{readmeDone ? 'README Ready' : 'Gen README'}
			</button>
			<button
				onClick={onOpenPlannerSettings}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors bg-[#1f1f1f] text-[#a3a3a3] hover:bg-[#262626] hover:text-[#fafafa]"
				title="Planner ayarlarını aç"
			>
				<Brain size={14} />
				Planner Settings
			</button>
			<button
				onClick={() => {
					if (!notifyEnabled) onRequestNotificationPermission();
				}}
				className={`p-1.5 rounded-lg transition-colors ${
					notifyEnabled
						? 'text-[#22c55e] bg-[#22c55e]/10'
						: 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f]'
				}`}
				title={notifyEnabled ? 'Notifications on' : 'Enable notifications'}
			>
				{notifyEnabled ? <Bell size={16} /> : <BellOff size={16} />}
			</button>
		</div>
	);
}
