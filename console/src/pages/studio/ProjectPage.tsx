import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MessageSquare,
  Users,
  Kanban,
  FolderTree,
  Loader2,
  Activity,
  GitBranch,
  Inbox,
  BarChart3,
  Play,
  Square,
  Settings,
  Bell,
  BellOff,
  Terminal,
  Eye,
  FileText,
  CheckCircle2,
  Brain,
  Package,
  CalendarDays,
  Users2,
  FileBarChart,
} from 'lucide-react';
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
import PMChat from './PMChat';
import AgentGrid from './AgentGrid';
import KanbanBoard from './KanbanBoard';
import PipelineDashboard from './PipelineDashboard';
import FileExplorer from './FileExplorer';
import EventFeed from './EventFeed';
import MessageCenter from './MessageCenter';
import AgentDashboard from './AgentDashboard';
import ProjectSettings from './ProjectSettings';
import DiffViewer from './DiffViewer';
import AgentLogViewer from './AgentLogViewer';
import LivePreview from './LivePreview';
import PlannerSettingsModal from './PlannerSettingsModal';
import BacklogBoard from './BacklogBoard';
import SprintBoard from './SprintBoard';
import CeremonyPanel from './CeremonyPanel';
import ProjectReport from './ProjectReport';
import { useStudioWebSocket } from '../../hooks/useStudioWebSocket';
import { useNotifications } from '../../hooks/useNotifications';

// Board sekmesi içindeki görünüm modu — kanban veya pipeline
type BoardView = 'kanban' | 'pipeline';

// Sekme türü tanımı — settings sekmesi eklendi
type Tab = 'chat' | 'team' | 'board' | 'preview' | 'files' | 'events' | 'messages' | 'dashboard' | 'logs' | 'diff' | 'settings' | 'backlog' | 'sprint' | 'ceremonies' | 'report';

// Sabit sekme listesi (messages badge'i dinamik olarak eklenir)
const STATIC_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Planner', icon: <MessageSquare size={16} /> },
  { id: 'team', label: 'Team', icon: <Users size={16} /> },
  { id: 'board', label: 'Board', icon: <Kanban size={16} /> },
  { id: 'preview', label: 'Preview', icon: <Eye size={16} /> },
  { id: 'files', label: 'Files', icon: <FolderTree size={16} /> },
  { id: 'events', label: 'Events', icon: <Activity size={16} /> },
  { id: 'messages', label: 'Messages', icon: <Inbox size={16} /> },
  { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={16} /> },
  { id: 'logs', label: 'Logs', icon: <Terminal size={16} /> },
  { id: 'diff', label: 'Diff', icon: <GitBranch size={16} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
  { id: 'backlog', label: 'Backlog', icon: <Package size={16} /> },
  { id: 'sprint', label: 'Sprint', icon: <CalendarDays size={16} /> },
  { id: 'ceremonies', label: 'Ceremonies', icon: <Users2 size={16} /> },
  { id: 'report', label: 'Report', icon: <FileBarChart size={16} /> },
];

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  // Board sekmesindeki görünüm modu durumu
  const [boardView, setBoardView] = useState<BoardView>('kanban');
  // Messages sekmesi için toplam okunmamış mesaj sayısı
  const [totalUnread, setTotalUnread] = useState(0);
  const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([]);
  // Polling referansı — bellek sızıntısını önlemek için
  const unreadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // App runner state
  const [appStatus, setAppStatus] = useState<AppStatus>({ running: false, services: [], previewUrl: null, backendUrl: null, frontendUrl: null });
  const [appLoading, setAppLoading] = useState(false);
  // WebSocket + browser notifications
  const { lastEvent } = useStudioWebSocket(projectId ?? '');
  const { enabled: notifyEnabled, requestPermission } = useNotifications(lastEvent);

  // README oluşturma durumu
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

  // Tüm ajanların okunmamış mesaj sayısını topla
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
    if (savedEffort === 'low' || savedEffort === 'medium' || savedEffort === 'high' || savedEffort === 'max' || savedEffort === 'xhigh') {
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
      .catch(() => {});
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

  // Proje yüklendikten sonra okunmamış sayıları çek ve polling başlat
  useEffect(() => {
    if (!project) return;
    refreshUnreadTotal();
    unreadPollRef.current = setInterval(refreshUnreadTotal, 10000);
    return () => {
      if (unreadPollRef.current) clearInterval(unreadPollRef.current);
    };
  }, [project, refreshUnreadTotal]);

  // App status polling
  useEffect(() => {
    if (!projectId) return;
    fetchAppStatus(projectId).then(setAppStatus).catch(() => {});
    const interval = setInterval(() => {
      fetchAppStatus(projectId).then(setAppStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

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
    } catch { /* ignore */ }
    setAppLoading(false);
  };

  // README oluşturma handler — backend'e istek atar, dosyayı git'e commit eder
  const handleGenerateReadme = async () => {
    if (!projectId || readmeLoading) return;
    setReadmeLoading(true);
    setReadmeDone(false);
    try {
      await generateReadme(projectId);
      setReadmeDone(true);
      // 3 saniye sonra checkmark ikonunu sıfırla
      setTimeout(() => setReadmeDone(false), 3000);
    } catch {
      // Hata durumunda sessizce geç; gelecekte toast gösterilebilir
    }
    setReadmeLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (!project) return null;

  const plannerAgent =
    projectAgents.find((agent) => agent.role === 'product-owner' || agent.role === 'pm') ?? null;
  const visibleTabs = previewEnabled ? STATIC_TABS : STATIC_TABS.filter((tab) => tab.id !== 'preview');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#262626]">
        <button
          onClick={() => navigate('/studio')}
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
                {appStatus.services.map(s => (
                  <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#22c55e] hover:underline">
                    {s.name}
                  </a>
                ))}
              </>
            )}
            {appStatus.running && (!appStatus.services || appStatus.services.length === 0) && (
              <>
                <span className="text-[#262626]">|</span>
                {appStatus.backendUrl && (
                  <a href={appStatus.backendUrl} target="_blank" rel="noreferrer" className="text-[11px] text-[#22c55e] hover:underline">
                    Backend
                  </a>
                )}
                {appStatus.frontendUrl && (
                  <a href={appStatus.frontendUrl} target="_blank" rel="noreferrer" className="text-[11px] text-[#22c55e] hover:underline">
                    Frontend
                  </a>
                )}
              </>
            )}
          </div>
        </div>
        {previewEnabled && (
          <button
            onClick={handleToggleApp}
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
        {/* README oluşturma butonu — küçük, secondary stil */}
        <button
          onClick={handleGenerateReadme}
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
          onClick={() => setPlannerSettingsOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors bg-[#1f1f1f] text-[#a3a3a3] hover:bg-[#262626] hover:text-[#fafafa]"
          title="Planner ayarlarını aç"
        >
          <Brain size={14} />
          Planner Settings
        </button>
        <button
          onClick={() => { if (!notifyEnabled) requestPermission(); }}
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

      {/* Sekme çubuğu */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-[#262626] bg-[#0a0a0a] overflow-x-auto scrollbar-none">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              // Messages sekmesine geçince sayacı sıfırla
              if (tab.id === 'messages') setTotalUnread(0);
            }}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#1f1f1f] text-[#22c55e]'
                : 'text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414]'
            }`}
          >
            {tab.icon}
            {tab.label}
            {/* Messages sekmesinde okunmamış mesaj rozeti */}
            {tab.id === 'messages' && totalUnread > 0 && (
              <span className="ml-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e] text-[#0a0a0a] leading-none">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Sekme içerikleri */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0" style={{ maxHeight: 'calc(100vh - 140px)' }}>
        {activeTab === 'chat' && (
          <PMChat
            projectId={projectId!}
            plannerAvailable={plannerAvailable}
            selectedProvider={plannerProvider}
            selectedModel={plannerModel}
            selectedEffort={plannerEffort}
          />
        )}
        {activeTab === 'team' && <AgentGrid projectId={projectId!} />}
        {activeTab === 'board' && (
          <div className="flex flex-col h-full">
            {/* Board sekmesi içi görünüm geçiş çubuğu — Kanban / Pipeline */}
            <div className="flex items-center gap-1 px-5 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a] shrink-0">
              <button
                onClick={() => setBoardView('kanban')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  boardView === 'kanban'
                    ? 'bg-[#1f1f1f] text-[#fafafa]'
                    : 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]'
                }`}
              >
                <Kanban size={12} />
                Kanban
              </button>
              <button
                onClick={() => setBoardView('pipeline')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  boardView === 'pipeline'
                    ? 'bg-[#1f1f1f] text-[#fafafa]'
                    : 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]'
                }`}
              >
                <GitBranch size={12} />
                Pipeline
              </button>
            </div>

            {/* Seçili görünümü render et */}
            <div className="flex-1 overflow-auto">
              {boardView === 'kanban' && <KanbanBoard projectId={projectId!} />}
              {boardView === 'pipeline' && <PipelineDashboard projectId={projectId!} />}
            </div>
          </div>
        )}
        {activeTab === 'preview' && (
          <LivePreview
            projectId={projectId!}
            appStatus={appStatus}
            onStatusChange={setAppStatus}
          />
        )}
        {activeTab === 'files' && <FileExplorer projectId={projectId!} />}
        {activeTab === 'events' && <EventFeed projectId={projectId!} />}
        {/* Mesaj merkezi sekmesi */}
        {activeTab === 'messages' && <MessageCenter projectId={projectId!} />}
        {/* Ajan dashboard sekmesi */}
        {activeTab === 'dashboard' && <AgentDashboard projectId={projectId!} />}
        {activeTab === 'logs' && <AgentLogViewer projectId={projectId!} />}
        {activeTab === 'diff' && <DiffViewer projectId={projectId!} />}
        {activeTab === 'settings' && <ProjectSettings projectId={projectId!} />}
        {activeTab === 'backlog' && <BacklogBoard projectId={project.id} />}
        {activeTab === 'sprint' && <SprintBoard projectId={project.id} />}
        {activeTab === 'ceremonies' && <CeremonyPanel projectId={project.id} />}
        {activeTab === 'report' && <ProjectReport projectId={project.id} />}
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
