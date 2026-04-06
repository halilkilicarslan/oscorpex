import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MessageSquare,
  Users,
  Kanban,
  FolderTree,
  Loader2,
} from 'lucide-react';
import { fetchProject, type Project } from '../../lib/studio-api';
import PMChat from './PMChat';
import AgentGrid from './AgentGrid';
import KanbanBoard from './KanbanBoard';
import FileExplorer from './FileExplorer';

type Tab = 'chat' | 'team' | 'board' | 'files';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'PM Chat', icon: <MessageSquare size={16} /> },
  { id: 'team', label: 'Team', icon: <Users size={16} /> },
  { id: 'board', label: 'Board', icon: <Kanban size={16} /> },
  { id: 'files', label: 'Files', icon: <FolderTree size={16} /> },
];

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId)
      .then(setProject)
      .catch(() => navigate('/studio'))
      .finally(() => setLoading(false));
  }, [projectId, navigate]);

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

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-[#262626] bg-[#0a0a0a]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[#1f1f1f] text-[#22c55e]'
                : 'text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'chat' && <PMChat projectId={projectId!} />}
        {activeTab === 'team' && <AgentGrid projectId={projectId!} />}
        {activeTab === 'board' && <KanbanBoard projectId={projectId!} />}
        {activeTab === 'files' && <FileExplorer projectId={projectId!} />}
      </div>
    </div>
  );
}
