// ---------------------------------------------------------------------------
// Stage Detail Panel
// ---------------------------------------------------------------------------

import { GitBranch, Terminal } from 'lucide-react';
import type { PipelineStage, ProjectAgent, Task } from '../../../lib/studio-api';
import { roleLabel } from '../../../lib/studio-api';
import AgentAvatarImg from '../../../components/AgentAvatar';
import TaskRow from './TaskRow.js';
import { getAgentColor } from './helpers.js';

interface StageDetailPanelProps {
  stage: PipelineStage;
  projectId: string;
  retryingTaskId: string | null;
  onRetryTask: (taskId: string) => void;
  onRefresh: () => void;
  onClickTask: (task: Task) => void;
  onOpenTerminal: (agent: ProjectAgent) => void;
}

export default function StageDetailPanel({
  stage,
  projectId,
  retryingTaskId,
  onRetryTask,
  onRefresh,
  onClickTask,
  onOpenTerminal,
}: StageDetailPanelProps) {
  return (
    <div className="border border-[#262626] rounded-xl bg-[#111111] p-4">
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[#1f1f1f]">
        <GitBranch size={14} className="text-[#525252]" />
        <span className="text-[12px] font-semibold text-[#a3a3a3]">
          Stage {stage.order} Details
        </span>
        <span className="text-[10px] text-[#525252] ml-auto">
          {stage.agents.length} agents — {stage.tasks.length} tasks
        </span>
      </div>

      {stage.agents.length === 0 ? (
        <p className="text-[12px] text-[#525252] italic">No agents assigned to this stage.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {stage.agents.map((agent) => {
            const agentTasks = stage.tasks.filter((t) => {
              const assigned = t.assignedAgent ?? '';
              const assignedLower = assigned.toLowerCase();
              return (
                assigned === agent.id ||
                assigned === agent.sourceAgentId ||
                assignedLower === agent.name.toLowerCase() ||
                assignedLower === agent.role.toLowerCase()
              );
            });
            const agentColor = getAgentColor(agent);

            return (
              <div key={agent.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="md" />
                  <div>
                    <span className="text-[12px] font-semibold" style={{ color: agentColor }}>
                      {agent.name}
                    </span>
                    <span className="text-[10px] text-[#525252] ml-1.5">{roleLabel(agent.role)}</span>
                  </div>
                  <button
                    onClick={() => onOpenTerminal(agent)}
                    className="flex items-center gap-1 ml-auto px-2 py-1 rounded-md text-[10px] font-medium transition-colors text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] border border-transparent"
                    title="Open terminal"
                  >
                    <Terminal size={11} />
                    Terminal
                  </button>
                </div>

                {agentTasks.length > 0 ? (
                  <div className="ml-10 flex flex-col gap-1.5">
                    {agentTasks.map((task, idx) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        isLast={idx === agentTasks.length - 1}
                        retryingTaskId={retryingTaskId}
                        onRetryTask={onRetryTask}
                        projectId={projectId}
                        onRefresh={onRefresh}
                        onClickTask={onClickTask}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="ml-10 text-[10px] text-[#525252] italic">No assigned tasks</p>
                )}
              </div>
            );
          })}

          {(() => {
            const matchedIds = new Set(
              stage.agents.flatMap((agent) =>
                stage.tasks
                  .filter((t) => {
                    const assigned = t.assignedAgent ?? '';
                    const assignedLower = assigned.toLowerCase();
                    return (
                      assigned === agent.id ||
                      assigned === agent.sourceAgentId ||
                      assignedLower === agent.name.toLowerCase() ||
                      assignedLower === agent.role.toLowerCase()
                    );
                  })
                  .map((t) => t.id),
              ),
            );
            const unmatched = stage.tasks.filter((t) => !matchedIds.has(t.id));
            if (unmatched.length === 0) return null;
            return (
              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-[#1f1f1f]">
                <span className="text-[10px] text-[#525252] font-medium">Other Tasks</span>
                <div className="ml-2 flex flex-col gap-1.5">
                  {unmatched.map((task, idx) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isLast={idx === unmatched.length - 1}
                      retryingTaskId={retryingTaskId}
                      onRetryTask={onRetryTask}
                      projectId={projectId}
                      onRefresh={onRefresh}
                      onClickTask={onClickTask}
                    />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
