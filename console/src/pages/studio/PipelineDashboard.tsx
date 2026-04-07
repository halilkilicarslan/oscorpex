// Pipeline Dashboard — AI Dev Studio projesinin pipeline görselleştirme ve yönetim bileşeni
import { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Eye,
  GitBranch,
  SkipForward,
} from 'lucide-react';
import {
  startPipeline,
  getPipelineStatus,
  pausePipeline,
  resumePipeline,
  advancePipeline,
  retryTask,
  type PipelineState,
  type PipelineStage,
  type ProjectAgent,
  type Task,
} from '../../lib/studio-api';

// ---- Sabit değerler --------------------------------------------------------

// Ajan rollerine göre renk eşleştirmesi (rol adı küçük harfe çevrilip karşılaştırılır)
const ROLE_COLORS: Record<string, string> = {
  pm: '#f59e0b',
  designer: '#f472b6',
  architect: '#3b82f6',
  frontend: '#ec4899',
  backend: '#22c55e',
  coder: '#06b6d4',
  qa: '#a855f7',
  reviewer: '#ef4444',
  devops: '#0ea5e9',
};

// Pipeline durum renkleri
const PIPELINE_STATUS_COLORS: Record<string, string> = {
  idle: '#525252',
  running: '#22c55e',
  paused: '#f59e0b',
  completed: '#3b82f6',
  failed: '#ef4444',
};

// Pipeline durum etiketleri (Türkçe)
const PIPELINE_STATUS_LABELS: Record<string, string> = {
  idle: 'Beklemede',
  running: 'Çalışıyor',
  paused: 'Duraklatıldı',
  completed: 'Tamamlandı',
  failed: 'Hata',
};

// Aşama durum etiketleri
const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  running: 'Aktif',
  completed: 'Tamamlandı',
  failed: 'Hata',
};

// Görev durum simgeleri
const TASK_STATUS_ICONS: Record<Task['status'], React.ReactNode> = {
  queued: <Clock size={11} className="text-[#525252]" />,
  assigned: <AlertCircle size={11} className="text-[#3b82f6]" />,
  running: <Loader2 size={11} className="text-[#f59e0b] animate-spin" />,
  review: <Eye size={11} className="text-[#a855f7]" />,
  done: <CheckCircle2 size={11} className="text-[#22c55e]" />,
  failed: <XCircle size={11} className="text-[#ef4444]" />,
};

// Görev karmaşıklık renkleri
const COMPLEXITY_COLORS: Record<string, string> = {
  S: 'bg-[#22c55e]/10 text-[#22c55e]',
  M: 'bg-[#f59e0b]/10 text-[#f59e0b]',
  L: 'bg-[#ef4444]/10 text-[#ef4444]',
};

// ---- Yardımcı fonksiyonlar -------------------------------------------------

// Ajan rengini role göre döndür, yoksa varsayılan gri
function getAgentColor(agent: ProjectAgent): string {
  if (agent.color) return agent.color;
  const roleKey = agent.role.toLowerCase();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (roleKey.includes(key)) return color;
  }
  return '#525252';
}

// Geçen süreyi okunabilir formata çevir
function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (elapsed < 60) return `${elapsed}s önce`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}d önce`;
  return `${Math.floor(elapsed / 3600)}s önce`;
}

// Aşamadaki tamamlanan görev sayısını hesapla
function countDoneTasks(tasks: Task[]): number {
  return tasks.filter((t) => t.status === 'done').length;
}

// ---- Alt bileşenler --------------------------------------------------------

// Ajan avatar dairesi
function AgentAvatar({ agent, size = 'sm' }: { agent: ProjectAgent; size?: 'sm' | 'lg' }) {
  const color = getAgentColor(agent);
  const dim = size === 'lg' ? 'w-8 h-8 text-[14px]' : 'w-6 h-6 text-[11px]';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold shrink-0`}
      style={{ backgroundColor: `${color}20`, color, border: `1.5px solid ${color}40` }}
      title={`${agent.name} (${agent.role})`}
    >
      {agent.avatar || agent.name.charAt(0).toUpperCase()}
    </div>
  );
}

// Tek bir pipeline aşama kartı
function StageCard({
  stage,
  isSelected,
  isCurrent,
  onClick,
}: {
  stage: PipelineStage;
  isSelected: boolean;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const doneTasks = countDoneTasks(stage.tasks);
  const totalTasks = stage.tasks.length;

  // Aşama durumuna göre border ve arkaplan rengi belirle
  const borderStyle = (() => {
    if (stage.status === 'failed') return 'border-[#ef4444]';
    if (stage.status === 'completed') return 'border-[#22c55e]/40';
    if (stage.status === 'running') return 'border-[#22c55e]';
    return isSelected ? 'border-[#333]' : 'border-[#262626]';
  })();

  const glowStyle =
    stage.status === 'running'
      ? { boxShadow: '0 0 12px rgba(34, 197, 94, 0.15)' }
      : {};

  const bgStyle =
    stage.status === 'completed'
      ? 'bg-[#0e1a12]'
      : stage.status === 'failed'
      ? 'bg-[#1a0e0e]'
      : isSelected
      ? 'bg-[#141414]'
      : 'bg-[#111111]';

  // Durum simgesi
  const statusIcon = (() => {
    if (stage.status === 'completed')
      return <CheckCircle2 size={12} className="text-[#22c55e]" />;
    if (stage.status === 'failed')
      return <XCircle size={12} className="text-[#ef4444]" />;
    if (stage.status === 'running')
      return <Loader2 size={12} className="text-[#22c55e] animate-spin" />;
    return <Clock size={12} className="text-[#525252]" />;
  })();

  return (
    <button
      onClick={onClick}
      className={`w-[160px] shrink-0 rounded-xl border p-3 text-left transition-all ${borderStyle} ${bgStyle} hover:border-[#444] cursor-pointer`}
      style={glowStyle}
    >
      {/* Aşama başlığı ve durum simgesi */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[#525252] font-mono">#{stage.order}</span>
        <div className="flex items-center gap-1">
          {isCurrent && stage.status === 'running' && (
            <span className="text-[9px] text-[#22c55e] font-semibold">AKTİF</span>
          )}
          {statusIcon}
        </div>
      </div>

      {/* Ajanlarin listesi */}
      <div className="flex flex-col gap-1.5 mb-2.5">
        {stage.agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-1.5">
            <AgentAvatar agent={agent} size="sm" />
            <span
              className="text-[11px] font-medium truncate"
              style={{ color: getAgentColor(agent) }}
            >
              {agent.name}
            </span>
          </div>
        ))}
        {stage.agents.length === 0 && (
          <span className="text-[10px] text-[#525252] italic">Ajan yok</span>
        )}
      </div>

      {/* Görev sayacı ve ilerleme */}
      <div className="mt-auto">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[#525252]">
            {totalTasks > 0 ? `${doneTasks}/${totalTasks} görev` : 'Görev yok'}
          </span>
          <span className="text-[10px] text-[#525252]">
            {STAGE_STATUS_LABELS[stage.status]}
          </span>
        </div>
        {/* İlerleme çubuğu — sadece görev varsa göster */}
        {totalTasks > 0 && (
          <div className="h-1 rounded-full bg-[#1f1f1f] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(doneTasks / totalTasks) * 100}%`,
                backgroundColor:
                  stage.status === 'failed' ? '#ef4444' : '#22c55e',
              }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

// Tek bir görev satırı — ağaç dalı sembolü, durum, retry butonu ile
function TaskRow({
  task,
  isLast,
  retryingTaskId,
  onRetryTask,
}: {
  task: Task;
  isLast: boolean;
  retryingTaskId: string | null;
  onRetryTask: (taskId: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 text-[11px] text-[#a3a3a3]">
        <span className="text-[#333] shrink-0 mt-0.5 font-mono">
          {isLast ? '└──' : '├──'}
        </span>
        <div className="flex items-start gap-1.5 flex-1 min-w-0">
          <div className="mt-0.5 shrink-0">{TASK_STATUS_ICONS[task.status]}</div>
          <span className="truncate flex-1">{task.title}</span>
          {task.status === 'failed' && (
            <button
              onClick={() => onRetryTask(task.id)}
              disabled={retryingTaskId === task.id}
              className="flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-colors shrink-0 disabled:opacity-50"
              title="Görevi yeniden dene"
            >
              <RotateCcw size={9} className={retryingTaskId === task.id ? 'animate-spin' : ''} />
              Retry
            </button>
          )}
          <span
            className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${
              COMPLEXITY_COLORS[task.complexity] ?? ''
            }`}
          >
            {task.complexity}
          </span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 font-medium ${
              task.status === 'done'
                ? 'bg-[#22c55e]/10 text-[#22c55e]'
                : task.status === 'running'
                ? 'bg-[#f59e0b]/10 text-[#f59e0b]'
                : task.status === 'failed'
                ? 'bg-[#ef4444]/10 text-[#ef4444]'
                : task.status === 'review'
                ? 'bg-[#a855f7]/10 text-[#a855f7]'
                : 'bg-[#262626] text-[#525252]'
            }`}
          >
            {task.status}
          </span>
        </div>
      </div>
      {task.status === 'failed' && task.error && (
        <div className="ml-14 mt-1 text-[10px] text-[#ef4444] bg-[#ef4444]/5 border border-[#ef4444]/20 rounded px-2 py-1 max-w-md truncate" title={task.error}>
          {task.error}
        </div>
      )}
    </div>
  );
}

// Aşama detay paneli — seçili aşamadaki ajan ve görevleri gösterir
function StageDetailPanel({
  stage,
  retryingTaskId,
  onRetryTask,
}: {
  stage: PipelineStage;
  retryingTaskId: string | null;
  onRetryTask: (taskId: string) => void;
}) {
  return (
    <div className="border border-[#262626] rounded-xl bg-[#111111] p-4">
      {/* Panel başlığı */}
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[#1f1f1f]">
        <GitBranch size={14} className="text-[#525252]" />
        <span className="text-[12px] font-semibold text-[#a3a3a3]">
          Aşama {stage.order} Detayı
        </span>
        <span className="text-[10px] text-[#525252] ml-auto">
          {stage.agents.length} ajan — {stage.tasks.length} görev
        </span>
      </div>

      {/* Her ajan için görev listesi */}
      {stage.agents.length === 0 ? (
        <p className="text-[12px] text-[#525252] italic">Bu aşamada ajan atanmamış.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {stage.agents.map((agent) => {
            // Ajana ait görevleri filtrele
            const agentTasks = stage.tasks.filter(
              (t) =>
                t.assignedAgent === agent.id ||
                t.assignedAgent === agent.name ||
                t.assignedAgent === agent.role,
            );
            const agentColor = getAgentColor(agent);

            return (
              <div key={agent.id} className="flex flex-col gap-2">
                {/* Ajan başlığı */}
                <div className="flex items-center gap-2">
                  <AgentAvatar agent={agent} size="lg" />
                  <div>
                    <span className="text-[12px] font-semibold" style={{ color: agentColor }}>
                      {agent.name}
                    </span>
                    <span className="text-[10px] text-[#525252] ml-1.5">{agent.role}</span>
                  </div>
                </div>

                {/* Ajana ait görevler */}
                {agentTasks.length > 0 ? (
                  <div className="ml-10 flex flex-col gap-1.5">
                    {agentTasks.map((task, idx) => (
                      <TaskRow key={task.id} task={task} isLast={idx === agentTasks.length - 1} retryingTaskId={retryingTaskId} onRetryTask={onRetryTask} />
                    ))}
                  </div>
                ) : (
                  <p className="ml-10 text-[10px] text-[#525252] italic">Atanmış görev yok</p>
                )}
              </div>
            );
          })}

          {/* Hiçbir ajana eşleşmeyen görevleri göster */}
          {(() => {
            const matchedIds = new Set(
              stage.agents.flatMap((agent) =>
                stage.tasks
                  .filter(
                    (t) =>
                      t.assignedAgent === agent.id ||
                      t.assignedAgent === agent.name ||
                      t.assignedAgent === agent.role,
                  )
                  .map((t) => t.id),
              ),
            );
            const unmatched = stage.tasks.filter((t) => !matchedIds.has(t.id));
            if (unmatched.length === 0) return null;
            return (
              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-[#1f1f1f]">
                <span className="text-[10px] text-[#525252] font-medium">Diğer Görevler</span>
                <div className="ml-2 flex flex-col gap-1.5">
                  {unmatched.map((task, idx) => (
                    <TaskRow key={task.id} task={task} isLast={idx === unmatched.length - 1} retryingTaskId={retryingTaskId} onRetryTask={onRetryTask} />
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

// ---- Ana bileşen -----------------------------------------------------------

export default function PipelineDashboard({ projectId }: { projectId: string }) {
  // Pipeline durumu
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
  // Yükleniyor durumu
  const [loading, setLoading] = useState(true);
  // İşlem yükleniyor (start/pause/resume/advance)
  const [actionLoading, setActionLoading] = useState(false);
  // Hata mesajı
  const [error, setError] = useState<string | null>(null);
  // Seçili aşama indeksi (detay paneli için)
  const [selectedStageIdx, setSelectedStageIdx] = useState<number | null>(null);
  // Retry edilmekte olan task ID'si
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);

  // Başarısız görevi yeniden dene
  const handleRetryTask = async (taskId: string) => {
    setRetryingTaskId(taskId);
    try {
      await retryTask(projectId, taskId);
      await fetchStatus();
    } catch {
      // sessizce geç — fetchStatus zaten güncel durumu yansıtır
    } finally {
      setRetryingTaskId(null);
    }
  };

  // Pipeline durumunu sunucudan getir
  const fetchStatus = useCallback(async () => {
    try {
      const state = await getPipelineStatus(projectId);
      setPipelineState(state);
      setError(null);
      // Aktif aşama varsa ve henüz seçili değilse otomatik seç
      setSelectedStageIdx((prev) => {
        if (prev === null) return state.currentStage ?? 0;
        return prev;
      });
    } catch (err) {
      // 404 = pipeline henüz yok, idle kabul et
      if (err instanceof Error && err.message.includes('404')) {
        setPipelineState(null);
      } else {
        setError(err instanceof Error ? err.message : 'Durum alınamadı');
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // İlk yüklemede ve proje değiştiğinde durumu getir
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Pipeline çalışırken her 3 saniyede bir otomatik yenile
  useEffect(() => {
    if (pipelineState?.status !== 'running') return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [pipelineState?.status, fetchStatus]);

  // Pipeline başlatma işlemi
  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const state = await startPipeline(projectId);
      setPipelineState(state);
      setSelectedStageIdx(state.currentStage ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline başlatılamadı');
    } finally {
      setActionLoading(false);
    }
  };

  // Pipeline duraklatma işlemi
  const handlePause = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await pausePipeline(projectId);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline durdurulamadı');
    } finally {
      setActionLoading(false);
    }
  };

  // Pipeline devam ettirme işlemi
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

  // Pipeline manuel ilerleme (test amaçlı)
  const handleAdvance = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const state = await advancePipeline(projectId);
      setPipelineState(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İlerleme sağlanamadı');
    } finally {
      setActionLoading(false);
    }
  };

  // ---- Yükleniyor ekranı ---------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  // ---- Boş durum: Pipeline henüz başlatılmamış ----------------------------
  if (!pipelineState) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-14 h-14 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-4">
          <GitBranch size={24} className="text-[#525252]" />
        </div>
        <h3 className="text-[15px] font-semibold text-[#a3a3a3] mb-1">Pipeline Başlatılmamış</h3>
        <p className="text-[12px] text-[#525252] max-w-xs mb-6">
          Pipeline'ı başlatarak ajan ekibinizi otomatik çalıştırabilir ve aşamaları takip edebilirsiniz.
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
          {actionLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Pipeline Başlat
        </button>
      </div>
    );
  }

  // Seçili aşama nesnesi
  const stages = pipelineState.stages ?? [];
  const selectedStage =
    selectedStageIdx !== null ? stages[selectedStageIdx] ?? null : null;

  const statusColor = PIPELINE_STATUS_COLORS[pipelineState.status] ?? '#525252';
  const statusLabel = PIPELINE_STATUS_LABELS[pipelineState.status] ?? pipelineState.status;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ---- Üst başlık çubuğu ------------------------------------------- */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#262626] bg-[#0a0a0a] shrink-0">
        {/* Durum göstergesi */}
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

        {/* Geçen süre */}
        {pipelineState.startedAt && (
          <span className="text-[11px] text-[#525252]">
            {formatElapsed(pipelineState.startedAt)}
          </span>
        )}

        {/* Hata mesajı */}
        {error && (
          <span className="text-[11px] text-[#ef4444] bg-[#ef4444]/10 px-2 py-0.5 rounded-md">
            {error}
          </span>
        )}

        {/* Kontrol düğmeleri */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Pipeline başlatılmamışsa veya tamamlandıysa "Başlat" göster */}
          {(pipelineState.status === 'idle' || pipelineState.status === 'completed' || pipelineState.status === 'failed') && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[#0a0a0a] text-[11px] font-semibold transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Başlat
            </button>
          )}

          {/* Çalışırken "Duraklat" göster */}
          {pipelineState.status === 'running' && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#262626] text-[#f59e0b] text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
              Duraklat
            </button>
          )}

          {/* Duraklatıldıysa "Devam Et" göster */}
          {pipelineState.status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#262626] text-[#22c55e] text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Devam Et
            </button>
          )}

          {/* Çalışırken "İlerle" (test) göster */}
          {(pipelineState.status === 'running' || pipelineState.status === 'paused') && (
            <button
              onClick={handleAdvance}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#262626] text-[#525252] hover:text-[#a3a3a3] text-[11px] font-medium transition-colors disabled:opacity-50"
              title="Sonraki aşamaya geç (test)"
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <SkipForward size={12} />}
              İlerle
            </button>
          )}
        </div>
      </div>

      {/* ---- Ana içerik ------------------------------------------------------ */}
      <div className="flex-1 overflow-auto p-5 flex flex-col gap-5">

        {/* ---- Yatay pipeline akışı ---------------------------------------- */}
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {stages.map((stage, idx) => (
            <div key={stage.order} className="flex items-center shrink-0">
              {/* Aşama kartı */}
              <StageCard
                stage={stage}
                isSelected={selectedStageIdx === idx}
                isCurrent={pipelineState.currentStage === stage.order}
                onClick={() => setSelectedStageIdx(idx === selectedStageIdx ? null : idx)}
              />

              {/* Aşamalar arası ok — son aşamada yok */}
              {idx < stages.length - 1 && (
                <div className="flex items-center px-1.5 shrink-0">
                  <ChevronRight
                    size={18}
                    className={
                      stage.status === 'completed'
                        ? 'text-[#22c55e]/50'
                        : 'text-[#333]'
                    }
                  />
                </div>
              )}
            </div>
          ))}

          {/* Aşama yoksa bilgi mesajı */}
          {stages.length === 0 && (
            <p className="text-[12px] text-[#525252] italic">
              Aşama bilgisi henüz yüklenmedi.
            </p>
          )}
        </div>

        {/* ---- Seçili aşama detay paneli ----------------------------------- */}
        {selectedStage && (
          <StageDetailPanel stage={selectedStage} retryingTaskId={retryingTaskId} onRetryTask={handleRetryTask} />
        )}

        {/* ---- Tamamlanma mesajı ------------------------------------------- */}
        {pipelineState.status === 'completed' && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0e1a12] border border-[#22c55e]/30">
            <CheckCircle2 size={16} className="text-[#22c55e] shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#22c55e]">Pipeline Tamamlandı</p>
              {pipelineState.completedAt && (
                <p className="text-[11px] text-[#525252]">
                  {new Date(pipelineState.completedAt).toLocaleString('tr-TR')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ---- Hata mesajı ------------------------------------------------- */}
        {pipelineState.status === 'failed' && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1a0e0e] border border-[#ef4444]/30">
            <XCircle size={16} className="text-[#ef4444] shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#ef4444]">Pipeline Başarısız</p>
              <p className="text-[11px] text-[#525252]">
                Hata veren aşamayı inceleyip pipeline'ı yeniden başlatın.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
