import { useState, useEffect, useCallback } from 'react';
import { Loader2, Users } from 'lucide-react';
import {
  fetchPresetAgents,
  type AgentConfig,
} from '../../lib/studio-api';
import AgentCard from './AgentCard';

type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export default function AgentGrid({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPresetAgents()
      .then((data) => {
        setAgents(data);
        // Initialize all as idle
        const initial: Record<string, RuntimeStatus> = {};
        data.forEach((a) => { initial[a.id] = 'idle'; });
        setStatuses(initial);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
          // Reset all to idle first
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <Users size={32} className="text-[#333] mb-3" />
        <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Agents</h3>
        <p className="text-[12px] text-[#525252]">No agent configurations found.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            projectId={projectId}
            status={statuses[agent.id] ?? 'idle'}
            onStart={() => handleStart(agent.id)}
            onStop={() => handleStop(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
