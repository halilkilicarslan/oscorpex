import { useState, useEffect, useCallback } from 'react';
import { Loader2, Users, Plus } from 'lucide-react';
import {
  fetchAgentConfigs,
  deleteAgent,
  type AgentConfig,
} from '../../lib/studio-api';
import AgentCard from './AgentCard';
import AgentDetailModal from './AgentDetailModal';
import AgentFormModal from './AgentFormModal';

type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export default function AgentGrid({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatus>>({});
  const [loading, setLoading] = useState(true);

  // Modal state
  const [detailAgent, setDetailAgent] = useState<AgentConfig | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<AgentConfig | undefined>(undefined);

  const loadAgents = useCallback(() => {
    fetchAgentConfigs()
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
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // Poll runtimes for status
  useEffect(() => {
    if (agents.length === 0) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/studio/projects/${projectId}/runtimes`);
        if (!res.ok) return;
        const runtimes = await res.json();
        setStatuses((prev) => {
          const next = { ...prev };
          // Reset non-transitional statuses to idle
          agents.forEach((a) => {
            if (next[a.id] !== 'starting' && next[a.id] !== 'stopping') {
              next[a.id] = 'idle';
            }
          });
          // Mark running ones
          for (const rt of runtimes) {
            if (rt.agentId && rt.status === 'running') {
              next[rt.agentId] = 'running';
            }
          }
          return next;
        });
      } catch {
        // ignore polling errors
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [projectId, agents]);

  const handleStart = useCallback(async (agentId: string) => {
    setStatuses((prev) => ({ ...prev, [agentId]: 'starting' }));
    try {
      const res = await fetch(`/api/studio/projects/${projectId}/agents/${agentId}/start`, {
        method: 'POST',
      });
      if (res.ok) {
        setStatuses((prev) => ({ ...prev, [agentId]: 'running' }));
      } else {
        setStatuses((prev) => ({ ...prev, [agentId]: 'error' }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [agentId]: 'error' }));
    }
  }, [projectId]);

  const handleStop = useCallback(async (agentId: string) => {
    setStatuses((prev) => ({ ...prev, [agentId]: 'stopping' }));
    try {
      await fetch(`/api/studio/projects/${projectId}/agents/${agentId}/stop`, {
        method: 'POST',
      });
      setStatuses((prev) => ({ ...prev, [agentId]: 'idle' }));
    } catch {
      setStatuses((prev) => ({ ...prev, [agentId]: 'error' }));
    }
  }, [projectId]);

  const handleDelete = useCallback(async (agent: AgentConfig) => {
    if (!confirm(`Delete agent "${agent.name}"? This action cannot be undone.`)) return;
    try {
      await deleteAgent(agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  }, []);

  const handleOpenEdit = useCallback((agent: AgentConfig) => {
    setDetailAgent(null);
    setEditTarget(agent);
    setFormMode('edit');
  }, []);

  const handleFormSave = useCallback((saved: AgentConfig) => {
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
        <div className="flex items-center gap-2">
          <Users size={15} className="text-[#525252]" />
          <span className="text-[13px] font-medium text-[#737373]">
            {agents.length} {agents.length === 1 ? 'Agent' : 'Agents'}
          </span>
        </div>
        <button
          onClick={() => { setEditTarget(undefined); setFormMode('create'); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
        >
          <Plus size={14} />
          Add Agent
        </button>
      </div>

      {/* Grid */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users size={32} className="text-[#333] mb-3" />
          <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Agents</h3>
          <p className="text-[12px] text-[#525252] mb-4">No agent configurations found.</p>
          <button
            onClick={() => { setEditTarget(undefined); setFormMode('create'); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
          >
            <Plus size={13} />
            Add Agent
          </button>
        </div>
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
              onEdit={!agent.isPreset ? () => handleOpenEdit(agent) : undefined}
              onDelete={!agent.isPreset ? () => handleDelete(agent) : undefined}
            />
          ))}
        </div>
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
          onClose={() => { setFormMode(null); setEditTarget(undefined); }}
          onSave={handleFormSave}
        />
      )}
    </div>
  );
}
