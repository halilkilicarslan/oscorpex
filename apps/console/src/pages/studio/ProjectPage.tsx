import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
	fetchProject,
	fetchProjectAgents,
	fetchAllUnreadCounts,
	startApp,
	stopApp,
	fetchAppStatus,
	generateReadme,
	fetchConfigStatus,
	fetchPlannerProviders,
	fetchProjectSettings,
	type Project,
	type AppStatus,
	type PlannerCLIProvider,
	type PlannerCLIProviderInfo,
	type PlannerChatModel,
	type PlannerReasoningEffort,
	type ProjectAgent,
} from '../../lib/studio-api';
// Core tabs — always eagerly loaded (user lands on these immediately)
import PMChat from './PMChat';
import AgentGrid from './AgentGrid';
import KanbanBoard from './KanbanBoard';
import PipelineDashboard from './PipelineDashboard';
import PlannerSettingsModal from './PlannerSettingsModal';
import { useStudioWebSocket } from '../../hooks/useStudioWebSocket';
import { useNotifications } from '../../hooks/useNotifications';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
	ProjectHeader,
	TabBar,
	BoardViewSwitcher,
	TeamNotInitializedState,
	TabLoader,
	STATIC_TABS,
	APP_STATUS_WS_EVENTS,
	UNREAD_COUNT_WS_EVENTS,
	type Tab,
	type BoardView,
} from './project-page';

// Secondary tabs — lazy loaded to reduce initial bundle size.
// These chunks download on first navigation to each tab.
const FileExplorer = lazy(() => import('./FileExplorer'));
const EventFeed = lazy(() => import('./EventFeed'));
const MessageCenter = lazy(() => import('./MessageCenter'));
const AgentDashboard = lazy(() => import('./AgentDashboard'));
const ProjectSettings = lazy(() => import('./ProjectSettings'));
const DiffViewer = lazy(() => import('./DiffViewer'));
const AgentLogViewer = lazy(() => import('./AgentLogViewer'));
const LivePreview = lazy(() => import('./LivePreview'));
const BacklogBoard = lazy(() => import('./BacklogBoard'));
const SprintBoard = lazy(() => import('./SprintBoard'));
const CeremonyPanel = lazy(() => import('./CeremonyPanel'));
const ProjectReport = lazy(() => import('./ProjectReport'));
const AgenticPanel = lazy(() => import('./AgenticPanel'));

export default function ProjectPage() {
	const { projectId } = useParams<{ projectId: string }>();
	const navigate = useNavigate();
	const [project, setProject] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);
	const [activeTab, setActiveTab] = useState<Tab>('chat');
	const [boardView, setBoardView] = useState<BoardView>('kanban');
	const [totalUnread, setTotalUnread] = useState(0);
	const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([]);
	const unreadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const [appStatus, setAppStatus] = useState<AppStatus>({
		running: false,
		services: [],
		previewUrl: null,
		backendUrl: null,
		frontendUrl: null,
	});
	const [appLoading, setAppLoading] = useState(false);
	const { lastEvent } = useStudioWebSocket(projectId ?? '');
	const { enabled: notifyEnabled, requestPermission } = useNotifications(lastEvent);

	const [readmeLoading, setReadmeLoading] = useState(false);
	const [readmeDone, setReadmeDone] = useState(false);
	const [plannerSettingsOpen, setPlannerSettingsOpen] = useState(false);
	const [plannerAvailable, setPlannerAvailable] = useState<boolean | null>(null);
	const [plannerProviders, setPlannerProviders] = useState<PlannerCLIProviderInfo[]>([]);
	const [plannerProvider, setPlannerProvider] = useState<PlannerCLIProvider>('claude-code');
	const [plannerModel, setPlannerModel] = useState<PlannerChatModel>('sonnet');
	const [plannerEffort, setPlannerEffort] = useState<PlannerReasoningEffort | null>('high');
	const [previewEnabled, setPreviewEnabled] = useState(true);

	useEffect(() => {
		if (!projectId) return;
		fetchProject(projectId)
			.then(setProject)
			.catch(() => navigate('/studio'))
			.finally(() => setLoading(false));
	}, [projectId, navigate]);

	useEffect(() => {
		if (!projectId) return;
		fetchProjectSettings(projectId)
			.then((settings) => setPreviewEnabled(settings.runtime?.previewEnabled !== 'false'))
			.catch(() => setPreviewEnabled(true));
	}, [projectId]);

	const refreshUnreadTotal = useCallback(async () => {
		if (!projectId) return;
		try {
			const agents = await fetchProjectAgents(projectId);
			setProjectAgents(agents);
			if (agents.length === 0) return;
			const counts = await fetchAllUnreadCounts(projectId).catch(() => ({} as Record<string, number>));
			setTotalUnread(Object.values(counts).reduce((s, c) => s + c, 0));
		} catch {
			// sessizce geç
		}
	}, [projectId]);

	useEffect(() => {
		if (typeof window === 'undefined' || !projectId) return;
		const savedProvider = window.localStorage.getItem(`planner-provider:${projectId}`) as PlannerCLIProvider | null;
		const savedModel = window.localStorage.getItem(`planner-model:${projectId}`) as PlannerChatModel | null;
		const savedEffort = window.localStorage.getItem(`planner-effort:${projectId}`) as PlannerReasoningEffort | null;
		if (savedProvider === 'claude-code' || savedProvider === 'codex' || savedProvider === 'gemini') {
			setPlannerProvider(savedProvider);
		}
		if (savedModel) {
			setPlannerModel(savedModel);
		}
		if (
			savedEffort === 'low' ||
			savedEffort === 'medium' ||
			savedEffort === 'high' ||
			savedEffort === 'max' ||
			savedEffort === 'xhigh'
		) {
			setPlannerEffort(savedEffort);
		}
	}, [projectId]);

	useEffect(() => {
		if (!projectId) return;
		Promise.allSettled([fetchConfigStatus(), fetchPlannerProviders()])
			.then(([configResult, providersResult]) => {
				if (configResult.status === 'fulfilled') {
					setPlannerAvailable(configResult.value.plannerAvailable);
				}
				if (providersResult.status === 'fulfilled') {
					setPlannerProviders(providersResult.value);
				}
			})
			.catch((err) => console.error("[ProjectPage] Failed to load config/providers:", err));
	}, [projectId]);

	useEffect(() => {
		if (plannerProviders.length === 0) return;
		const available = plannerProviders.filter((provider) => provider.available);
		if (available.length === 0) return;
		const provider = available.find((item) => item.id === plannerProvider) ?? available[0];
		if (provider.id !== plannerProvider) {
			setPlannerProvider(provider.id);
		}
		if (!provider.models.includes(plannerModel)) {
			setPlannerModel(provider.defaultModel);
		}
		if (provider.efforts.length === 0) {
			setPlannerEffort(null);
		} else if (!plannerEffort || !provider.efforts.includes(plannerEffort)) {
			setPlannerEffort(provider.defaultEffort ?? provider.efforts[0] ?? null);
		}
	}, [plannerProviders, plannerProvider, plannerModel, plannerEffort]);

	useEffect(() => {
		if (!previewEnabled && activeTab === 'preview') {
			setActiveTab('chat');
		}
	}, [previewEnabled, activeTab]);

	const refreshAppStatus = useCallback(() => {
		if (!projectId) return;
		fetchAppStatus(projectId).then(setAppStatus).catch((err) => console.error("[ProjectPage] Failed to load app status:", err));
	}, [projectId]);

	const { isWsActive: isAppStatusWsActive } = useWsEventRefresh(
		projectId ?? '',
		APP_STATUS_WS_EVENTS,
		refreshAppStatus,
		{ debounceMs: 500, enabled: !!projectId },
	);

	const { isWsActive: isUnreadWsActive } = useWsEventRefresh(
		projectId ?? '',
		UNREAD_COUNT_WS_EVENTS,
		refreshUnreadTotal,
		{ debounceMs: 500, enabled: !!projectId },
	);

	useEffect(() => {
		if (!project) return;
		refreshUnreadTotal();
	}, [project, refreshUnreadTotal]);

	useEffect(() => {
		if (!project || isUnreadWsActive) return;
		unreadPollRef.current = setInterval(refreshUnreadTotal, 10000);
		return () => {
			if (unreadPollRef.current) clearInterval(unreadPollRef.current);
		};
	}, [project, isUnreadWsActive, refreshUnreadTotal]);

	useEffect(() => {
		refreshAppStatus();
	}, [refreshAppStatus]);

	useEffect(() => {
		if (isAppStatusWsActive) return;
		const interval = setInterval(refreshAppStatus, 5000);
		return () => clearInterval(interval);
	}, [isAppStatusWsActive, refreshAppStatus]);

	const handleToggleApp = async () => {
		if (!projectId) return;
		setAppLoading(true);
		try {
			if (appStatus.running) {
				await stopApp(projectId);
			} else {
				await startApp(projectId);
			}
			const status = await fetchAppStatus(projectId);
			setAppStatus(status);
		} catch {
			/* ignore */
		}
		setAppLoading(false);
	};

	const handleGenerateReadme = async () => {
		if (!projectId || readmeLoading) return;
		setReadmeLoading(true);
		setReadmeDone(false);
		try {
			await generateReadme(projectId);
			setReadmeDone(true);
			setTimeout(() => setReadmeDone(false), 3000);
		} catch {
			/* ignore */
		}
		setReadmeLoading(false);
	};

	const plannerAgent = useMemo(
		() => projectAgents.find((agent) => agent.role === 'product-owner' || agent.role === 'pm') ?? null,
		[projectAgents],
	);
	const teamInitialized = projectAgents.length > 0;
	const TEAM_REQUIRED_TABS = new Set<Tab>(['chat', 'board', 'preview', 'dashboard', 'logs', 'backlog', 'sprint', 'ceremonies', 'report', 'agentic']);
	const requiresTeamSetup = TEAM_REQUIRED_TABS.has(activeTab) && !teamInitialized;
	const visibleTabs = useMemo(
		() => (previewEnabled ? STATIC_TABS : STATIC_TABS.filter((tab) => tab.id !== 'preview')),
		[previewEnabled],
	);

	const handleTabChange = (tab: Tab) => {
		setActiveTab(tab);
		if (tab === 'messages') setTotalUnread(0);
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 size={24} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	if (!project) return null;

	return (
		<div className="flex flex-col h-full">
			<ProjectHeader
				project={project}
				appStatus={appStatus}
				appLoading={appLoading}
				previewEnabled={previewEnabled}
				readmeLoading={readmeLoading}
				readmeDone={readmeDone}
				notifyEnabled={notifyEnabled}
				onNavigateBack={() => navigate('/studio')}
				onToggleApp={handleToggleApp}
				onGenerateReadme={handleGenerateReadme}
				onOpenPlannerSettings={() => setPlannerSettingsOpen(true)}
				onRequestNotificationPermission={requestPermission}
			/>

			<TabBar tabs={visibleTabs} activeTab={activeTab} totalUnread={totalUnread} onTabChange={handleTabChange} />

			<div
				className="flex-1 overflow-y-auto flex flex-col min-h-0"
				style={{ maxHeight: 'calc(100vh - 140px)' }}
			>
				{requiresTeamSetup ? (
					<TeamNotInitializedState onSetupTeam={() => setActiveTab('team')} />
				) : null}
				{activeTab === 'chat' && !requiresTeamSetup && (
					<PMChat
						projectId={projectId!}
						plannerAvailable={plannerAvailable}
						selectedProvider={plannerProvider}
						selectedModel={plannerModel}
						selectedEffort={plannerEffort}
					/>
				)}
				{activeTab === 'team' && <AgentGrid projectId={projectId!} />}
				{activeTab === 'board' && !requiresTeamSetup && (
					<div className="flex flex-col h-full">
						<BoardViewSwitcher boardView={boardView} onChange={setBoardView} />
						<div className="flex-1 overflow-auto">
							{boardView === 'kanban' && <KanbanBoard projectId={projectId!} />}
							{boardView === 'pipeline' && <PipelineDashboard projectId={projectId!} />}
						</div>
					</div>
				)}
				{activeTab === 'preview' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<LivePreview projectId={projectId!} appStatus={appStatus} onStatusChange={setAppStatus} />
					</Suspense>
				)}
				{activeTab === 'files' && (
					<Suspense fallback={<TabLoader />}>
						<FileExplorer projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'events' && (
					<Suspense fallback={<TabLoader />}>
						<EventFeed projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'messages' && (
					<Suspense fallback={<TabLoader />}>
						<MessageCenter projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'dashboard' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<AgentDashboard projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'logs' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<AgentLogViewer projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'diff' && (
					<Suspense fallback={<TabLoader />}>
						<DiffViewer projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'settings' && (
					<Suspense fallback={<TabLoader />}>
						<ProjectSettings projectId={projectId!} />
					</Suspense>
				)}
				{activeTab === 'backlog' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<BacklogBoard projectId={project.id} />
					</Suspense>
				)}
				{activeTab === 'sprint' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<SprintBoard projectId={project.id} />
					</Suspense>
				)}
				{activeTab === 'ceremonies' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<CeremonyPanel projectId={project.id} />
					</Suspense>
				)}
				{activeTab === 'report' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<ProjectReport projectId={project.id} />
					</Suspense>
				)}
				{activeTab === 'agentic' && !requiresTeamSetup && (
					<Suspense fallback={<TabLoader />}>
						<AgenticPanel projectId={project.id} />
					</Suspense>
				)}
			</div>
			{plannerSettingsOpen && (
				<PlannerSettingsModal
					projectId={projectId!}
					plannerAgent={plannerAgent}
					plannerProviders={plannerProviders}
					plannerAvailable={plannerAvailable}
					selectedProvider={plannerProvider}
					selectedModel={plannerModel}
					selectedEffort={plannerEffort}
					onClose={() => setPlannerSettingsOpen(false)}
					onSavePlanner={(provider, model, effort) => {
						setPlannerProvider(provider);
						setPlannerModel(model);
						setPlannerEffort(effort);
						if (typeof window !== 'undefined') {
							window.localStorage.setItem(`planner-provider:${projectId!}`, provider);
							window.localStorage.setItem(`planner-model:${projectId!}`, model);
							if (effort) {
								window.localStorage.setItem(`planner-effort:${projectId!}`, effort);
							} else {
								window.localStorage.removeItem(`planner-effort:${projectId!}`);
							}
						}
					}}
					onAgentSaved={(agent) => {
						setProjectAgents((prev) => prev.map((item) => (item.id === agent.id ? agent : item)));
					}}
				/>
			)}
		</div>
	);
}
