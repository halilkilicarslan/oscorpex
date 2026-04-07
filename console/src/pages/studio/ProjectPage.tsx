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
} from 'lucide-react';
import {
  fetchProject,
  fetchProjectAgents,
  fetchUnreadCount,
  type Project,
} from '../../lib/studio-api';
import PMChat from './PMChat';
import AgentGrid from './AgentGrid';
import KanbanBoard from './KanbanBoard';
import PipelineDashboard from './PipelineDashboard';
import FileExplorer from './FileExplorer';
import EventFeed from './EventFeed';
import MessageCenter from './MessageCenter';
import AgentDashboard from './AgentDashboard';

// Board sekmesi içindeki görünüm modu — kanban veya pipeline
type BoardView = 'kanban' | 'pipeline';

// Sekme türü tanımı — dashboard sekmesi eklendi
type Tab = 'chat' | 'team' | 'board' | 'files' | 'events' | 'messages' | 'dashboard';

// Sabit sekme listesi (messages badge'i dinamik olarak eklenir)
const STATIC_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'PM Chat', icon: <MessageSquare size={16} /> },
  { id: 'team', label: 'Team', icon: <Users size={16} /> },
  { id: 'board', label: 'Board', icon: <Kanban size={16} /> },
  { id: 'files', label: 'Files', icon: <FolderTree size={16} /> },
  { id: 'events', label: 'Events', icon: <Activity size={16} /> },
  { id: 'messages', label: 'Messages', icon: <Inbox size={16} /> },
  { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={16} /> },
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
  // Polling referansı — bellek sızıntısını önlemek için
  const unreadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId)
      .then(setProject)
      .catch(() => navigate('/studio'))
      .finally(() => setLoading(false));
  }, [projectId, navigate]);

  // Tüm ajanların okunmamış mesaj sayısını topla
  const refreshUnreadTotal = useCallback(async () => {
    if (!projectId) return;
    try {
      const agents = await fetchProjectAgents(projectId);
      if (agents.length === 0) return;
      const counts = await Promise.all(
        agents.map((a) =>
          fetchUnreadCount(projectId, a.id)
            .then((r) => r.unreadCount)
            .catch(() => 0),
        ),
      );
      setTotalUnread(counts.reduce((s, c) => s + c, 0));
    } catch {
      // sessizce geç
    }
  }, [projectId]);

  // Proje yüklendikten sonra okunmamış sayıları çek ve polling başlat
  useEffect(() => {
    if (!project) return;
    refreshUnreadTotal();
    unreadPollRef.current = setInterval(refreshUnreadTotal, 10000);
    return () => {
      if (unreadPollRef.current) clearInterval(unreadPollRef.current);
    };
  }, [project, refreshUnreadTotal]);

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
          </div>
        </div>
      </div>

      {/* Sekme çubuğu */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-[#262626] bg-[#0a0a0a]">
        {STATIC_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              // Messages sekmesine geçince sayacı sıfırla
              if (tab.id === 'messages') setTotalUnread(0);
            }}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
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
      <div className="flex-1 overflow-auto flex flex-col">
        {activeTab === 'chat' && <PMChat projectId={projectId!} />}
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
        {activeTab === 'files' && <FileExplorer projectId={projectId!} />}
        {activeTab === 'events' && <EventFeed projectId={projectId!} />}
        {/* Mesaj merkezi sekmesi */}
        {activeTab === 'messages' && <MessageCenter projectId={projectId!} />}
        {/* Ajan dashboard sekmesi */}
        {activeTab === 'dashboard' && <AgentDashboard projectId={projectId!} />}
      </div>
    </div>
  );
}
