import { useState, useEffect, useCallback } from 'react';
import { Loader2, Users, Plus, LayoutGrid, Network, ArrowRight, Workflow } from 'lucide-react';
import {
  fetchProjectAgents,
  deleteProjectAgent,
  fetchTeamTemplates,
  copyTeamFromTemplate,
  getAgentRuntimes,
  startAgentProcess,
  stopAgentProcess,
  type ProjectAgent,
  type TeamTemplate,
} from '../../lib/studio-api';
import AgentCard from './AgentCard';
import AgentDetailModal from './AgentDetailModal';
import AgentFormModal from './AgentFormModal';
import OrgChart from './OrgChart';
import TeamBuilder from './TeamBuilder';

type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

function EmptyTeamState({ projectId, onTeamCreated, onAddAgent }: { projectId: string; onTeamCreated: () => void; onAddAgent: () => void }) {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    fetchTeamTemplates().then(setTemplates).catch(() => {});
  }, []);

  const applyTemplate = async (templateId: string) => {
    setApplying(true);
    try {
      await copyTeamFromTemplate(projectId, templateId);
      onTeamCreated();
    } catch (err) {
      console.error('Failed to apply template:', err);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Users size={32} className="text-[#333] mb-3" />
      <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Team Members</h3>
      <p className="text-[12px] text-[#525252] mb-5 max-w-md">
        This project has no agents yet. Pick a team template to get started or add agents manually.
      </p>

      {templates.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 justify-center">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => applyTemplate(t.id)}
              disabled={applying}
              className="flex flex-col items-start px-4 py-3 rounded-lg border border-[#262626] bg-[#111111] hover:border-[#22c55e]/40 transition-colors text-left disabled:opacity-50 max-w-[200px]"
            >
              <span className="text-[12px] font-semibold text-[#fafafa]">{t.name}</span>
              <span className="text-[10px] text-[#525252] mt-0.5">{t.roles.length} agents — {t.roles.join(', ')}</span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onAddAgent}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
      >
        <Plus size={13} />
        Add Agent Manually
      </button>
    </div>
  );
}

export default function AgentGrid({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatus>>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'org' | 'pipeline' | 'builder'>('grid');

  // Modal state
  const [detailAgent, setDetailAgent] = useState<ProjectAgent | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<ProjectAgent | undefined>(undefined);

  const loadAgents = useCallback(() => {
    fetchProjectAgents(projectId)
      .then((data) => {
        setAgents(data);
        setStatuses((prev) => {
          const next: Record<string, RuntimeStatus> = {};
          data.forEach((a) => {
            next[a.id] = prev[a.id] ?? 'idle';
          });
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // Çalışma zamanı durumlarını 5 saniyede bir sorgula (getAgentRuntimes kullanır)
  useEffect(() => {
    if (agents.length === 0) return;

    const poll = async () => {
      try {
        // Yeni API fonksiyonu — AgentProcessInfo[] döner, mode alanını da içerir
        const runtimes = await getAgentRuntimes(projectId);
        setStatuses((prev) => {
          const next = { ...prev };
          // Geçiş durumunda olmayan ajanları idle'a sıfırla
          agents.forEach((a) => {
            if (next[a.id] !== 'starting' && next[a.id] !== 'stopping') {
              next[a.id] = 'idle';
            }
          });
          // Çalışan ajanları AgentProcessInfo.status alanına göre güncelle
          for (const rt of runtimes) {
            if (!rt.agentId) continue;
            // Yeni şekil: status 'running' | 'stopped' | 'error' | 'starting' | 'stopping' | 'idle' olabilir
            const mappedStatus: RuntimeStatus =
              rt.status === 'running'  ? 'running'  :
              rt.status === 'starting' ? 'starting' :
              rt.status === 'stopping' ? 'stopping' :
              rt.status === 'error'    ? 'error'    :
              'idle';
            // Geçiş durumundaki ajanları koruma: yalnızca kesinleşmiş durumları yaz
            if (next[rt.agentId] !== 'starting' && next[rt.agentId] !== 'stopping') {
              next[rt.agentId] = mappedStatus;
            } else if (rt.status === 'running' || rt.status === 'error') {
              // Başlatma/durdurma tamamlandıysa durumu güncelle
              next[rt.agentId] = mappedStatus;
            }
          }
          return next;
        });
      } catch {
        // Polling hatalarını sessizce atla
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [projectId, agents]);

  // Ajan sürecini başlat — yeni API fonksiyonu kullanılır
  const handleStart = useCallback(async (agentId: string) => {
    setStatuses((prev) => ({ ...prev, [agentId]: 'starting' }));
    try {
      const info = await startAgentProcess(projectId, agentId);
      // Yanıttaki status alanına göre güncelle
      const mappedStatus: RuntimeStatus =
        info.status === 'running' ? 'running' : info.status === 'error' ? 'error' : 'running';
      setStatuses((prev) => ({ ...prev, [agentId]: mappedStatus }));
    } catch {
      setStatuses((prev) => ({ ...prev, [agentId]: 'error' }));
    }
  }, [projectId]);

  // Ajan sürecini durdur — yeni API fonksiyonu kullanılır
  const handleStop = useCallback(async (agentId: string) => {
    setStatuses((prev) => ({ ...prev, [agentId]: 'stopping' }));
    try {
      await stopAgentProcess(projectId, agentId);
      setStatuses((prev) => ({ ...prev, [agentId]: 'idle' }));
    } catch {
      setStatuses((prev) => ({ ...prev, [agentId]: 'error' }));
    }
  }, [projectId]);

  const handleDelete = useCallback(async (agent: ProjectAgent) => {
    if (!confirm(`Delete agent "${agent.name}"? This action cannot be undone.`)) return;
    try {
      await deleteProjectAgent(projectId, agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  }, [projectId]);

  const handleOpenEdit = useCallback((agent: ProjectAgent) => {
    setDetailAgent(null);
    setEditTarget(agent);
    setFormMode('edit');
  }, []);

  const handleFormSave = useCallback((saved: ProjectAgent) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === saved.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    setStatuses((prev) => ({ ...prev, [saved.id]: prev[saved.id] ?? 'idle' }));
    setFormMode(null);
    setEditTarget(undefined);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-[#525252]" />
            <span className="text-[13px] font-medium text-[#737373]">
              {agents.length} {agents.length === 1 ? 'Agent' : 'Agents'}
            </span>
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-[#0a0a0a] border border-[#262626] rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <LayoutGrid size={13} className="inline mr-1" />
              Grid
            </button>
            <button
              onClick={() => setViewMode('org')}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'org'
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <Network size={13} className="inline mr-1" />
              Org Chart
            </button>
            <button
              onClick={() => setViewMode('pipeline')}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'pipeline'
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <ArrowRight size={13} className="inline mr-1" />
              Pipeline
            </button>
            <button
              onClick={() => setViewMode('builder')}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'builder'
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <Workflow size={13} className="inline mr-1" />
              Builder
            </button>
          </div>
        </div>

        <button
          onClick={() => { setEditTarget(undefined); setFormMode('create'); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
        >
          <Plus size={14} />
          Add Agent
        </button>
      </div>

      {/* Org Chart / Pipeline views */}
      {(viewMode === 'org' || viewMode === 'pipeline') && (
        <OrgChart
          projectId={projectId}
          initialView={viewMode === 'pipeline' ? 'pipeline' : 'hierarchy'}
        />
      )}

      {/* Team Builder (React Flow) */}
      {viewMode === 'builder' && (
        <div className="flex-1 min-h-[500px]">
          <TeamBuilder projectId={projectId} />
        </div>
      )}

      {/* Grid */}
      {viewMode === 'grid' && (
        agents.length === 0 ? (
          <EmptyTeamState projectId={projectId} onTeamCreated={loadAgents} onAddAgent={() => { setEditTarget(undefined); setFormMode('create'); }} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                projectId={projectId}
                status={statuses[agent.id] ?? 'idle'}
                onStart={() => handleStart(agent.id)}
                onStop={() => handleStop(agent.id)}
                onClick={() => setDetailAgent(agent)}
                onEdit={() => handleOpenEdit(agent)}
                onDelete={() => handleDelete(agent)}
              />
            ))}
          </div>
        )
      )}

      {/* Detail Modal */}
      {detailAgent && (
        <AgentDetailModal
          agent={detailAgent}
          onClose={() => setDetailAgent(null)}
          onEdit={() => handleOpenEdit(detailAgent)}
        />
      )}

      {/* Form Modal */}
      {formMode && (
        <AgentFormModal
          mode={formMode}
          agent={editTarget}
          projectId={projectId}
          onClose={() => { setFormMode(null); setEditTarget(undefined); }}
          onSave={handleFormSave}
        />
      )}
    </div>
  );
}
