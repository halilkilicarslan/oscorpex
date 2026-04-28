// Pipeline Dashboard — Oscorpex projesinin pipeline görselleştirme ve yönetim bileşeni
import { useState, useEffect, useCallback } from 'react';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  GitBranch,
  SkipForward,
} from 'lucide-react';
import TerminalSheet from './TerminalSheet';
import TaskDetailModal from './TaskDetailModal';
import TeamGraphView from './TeamGraphView';
import {
  startPipeline,
  getPipelineStatus,
  pausePipeline,
  resumePipeline,
  advancePipeline,
  retryTask,
  type PipelineState,
  type ProjectAgent,
  type Task,
} from '../../lib/studio-api';
import {
  StageCard,
  StageDetailPanel,
  PIPELINE_STATUS_COLORS,
  PIPELINE_STATUS_LABELS,
  PIPELINE_WS_EVENTS,
  formatElapsed,
} from './pipeline/index.js';

export default function PipelineDashboard({ projectId }: { projectId: string }) {
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStageIdx, setSelectedStageIdx] = useState<number | null>(null);
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [terminalAgent, setTerminalAgent] = useState<ProjectAgent | null>(null);

  const handleRetryTask = async (taskId: string) => {
    setRetryingTaskId(taskId);
    try {
      await retryTask(projectId, taskId);
      await fetchStatus();
    } catch {
      // ignore
    } finally {
      setRetryingTaskId(null);
    }
  };

  const fetchStatus = useCallback(async () => {
    try {
      const state = await getPipelineStatus(projectId);
      setPipelineState(state);
      setError(null);
      setSelectedStageIdx((prev) => {
        if (prev === null) return state.currentStage ?? 0;
        return prev;
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        setPipelineState(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch status');
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const { isWsActive } = useWsEventRefresh(projectId, PIPELINE_WS_EVENTS, fetchStatus, {
    debounceMs: 300,
  });

  useEffect(() => {
    if (isWsActive) return;
    if (!pipelineState) return;
    if (pipelineState.status === 'completed') return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [isWsActive, pipelineState?.status, fetchStatus]);

  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const state = await startPipeline(projectId);
      setPipelineState(state);
      setSelectedStageIdx(state.currentStage ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pipeline');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await pausePipeline(projectId);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause pipeline');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await resumePipeline(projectId);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline devam ettirilemedi');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdvance = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const state = await advancePipeline(projectId);
      setPipelineState(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (!pipelineState) {
    return (
      <div className="flex flex-col h-full">
        <TeamGraphView projectId={projectId} />
        <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
          <div className="w-14 h-14 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-4">
            <GitBranch size={24} className="text-[#525252]" />
          </div>
          <h3 className="text-[15px] font-semibold text-[#a3a3a3] mb-1">Pipeline Not Started</h3>
          <p className="text-[12px] text-[#525252] max-w-xs mb-6">
            Start the pipeline to automatically run your agent team and track stages.
          </p>
          {error && (
            <p className="text-[11px] text-[#ef4444] mb-4 bg-[#ef4444]/10 px-3 py-1.5 rounded-lg">
              {error}
            </p>
          )}
          <button
            onClick={handleStart}
            disabled={actionLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-[#0a0a0a] text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Start Pipeline
          </button>
        </div>
      </div>
    );
  }

  const stages = (pipelineState.stages ?? []).filter(
    (s) => s.tasks.length > 0 || s.status === 'running' || s.status === 'completed',
  );
  const selectedStage =
    selectedStageIdx !== null ? stages[selectedStageIdx] ?? null : null;

  const statusColor = PIPELINE_STATUS_COLORS[pipelineState.status] ?? '#525252';
  const statusLabel = PIPELINE_STATUS_LABELS[pipelineState.status] ?? pipelineState.status;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#262626] bg-[#0a0a0a] shrink-0">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: statusColor,
              boxShadow:
                pipelineState.status === 'running'
                  ? `0 0 6px ${statusColor}`
                  : 'none',
            }}
          />
          <span className="text-[12px] font-medium" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        </div>

        {pipelineState.startedAt && (
          <span className="text-[11px] text-[#525252]">{formatElapsed(pipelineState.startedAt)}</span>
        )}

        {error && (
          <span className="text-[11px] text-[#ef4444] bg-[#ef4444]/10 px-2 py-0.5 rounded-md">
            {error}
          </span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {(pipelineState.status === 'idle' || pipelineState.status === 'completed' || pipelineState.status === 'failed') && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[#0a0a0a] text-[11px] font-semibold transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Start
            </button>
          )}

          {pipelineState.status === 'running' && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#262626] text-[#f59e0b] text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
              Pause
            </button>
          )}

          {pipelineState.status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#262626] text-[#22c55e] text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Resume
            </button>
          )}

          {(pipelineState.status === 'running' || pipelineState.status === 'paused') && (
            <button
              onClick={handleAdvance}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#262626] text-[#525252] hover:text-[#a3a3a3] text-[11px] font-medium transition-colors disabled:opacity-50"
              title="Advance to next stage (test)"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <SkipForward size={12} />}
              Advance
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-5 flex flex-col gap-5">
        <TeamGraphView projectId={projectId} />

        {/* Horizontal pipeline flow */}
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {stages.map((stage, idx) => (
            <div key={stage.order} className="flex items-center shrink-0">
              <StageCard
                stage={stage}
                isSelected={selectedStageIdx === idx}
                isCurrent={pipelineState.currentStage === stage.order}
                onClick={() => setSelectedStageIdx(idx === selectedStageIdx ? null : idx)}
              />
              {idx < stages.length - 1 && (
                <div className="flex items-center px-1.5 shrink-0">
                  <ChevronRight
                    size={18}
                    className={stage.status === 'completed' ? 'text-[#22c55e]/50' : 'text-[#333]'}
                  />
                </div>
              )}
            </div>
          ))}
          {stages.length === 0 && (
            <p className="text-[12px] text-[#525252] italic">No stage data loaded yet.</p>
          )}
        </div>

        {/* Selected stage detail */}
        {selectedStage && (
          <StageDetailPanel
            stage={selectedStage}
            projectId={projectId}
            retryingTaskId={retryingTaskId}
            onRetryTask={handleRetryTask}
            onRefresh={fetchStatus}
            onClickTask={setDetailTask}
            onOpenTerminal={setTerminalAgent}
          />
        )}

        {/* Completion banner */}
        {pipelineState.status === 'completed' && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0e1a12] border border-[#22c55e]/30">
            <CheckCircle2 size={16} className="text-[#22c55e] shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#22c55e]">Pipeline Completed</p>
              {pipelineState.completedAt && (
                <p className="text-[11px] text-[#525252]">
                  {new Date(pipelineState.completedAt).toLocaleString('en-US')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Failed banner */}
        {pipelineState.status === 'failed' && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1a0e0e] border border-[#ef4444]/30">
            <XCircle size={16} className="text-[#ef4444] shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#ef4444]">Pipeline Failed</p>
              <p className="text-[11px] text-[#525252]">Inspect the failing stage and restart the pipeline.</p>
            </div>
          </div>
        )}
      </div>

      {/* Task Detail Modal */}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          agents={pipelineState?.stages.flatMap((s) => s.agents) ?? []}
          projectId={projectId}
          allTasks={pipelineState?.stages.flatMap((s) => s.tasks) ?? []}
          onNavigateTask={(t) => setDetailTask(t)}
          onClose={() => setDetailTask(null)}
          onRefresh={fetchStatus}
        />
      )}

      {/* Terminal Sheet */}
      {terminalAgent && (
        <TerminalSheet
          projectId={projectId}
          taskId=""
          taskTitle={terminalAgent.name}
          agent={terminalAgent}
          isRunning={pipelineState?.status === 'running'}
          onClose={() => setTerminalAgent(null)}
        />
      )}
    </div>
  );
}
