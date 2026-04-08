// ---------------------------------------------------------------------------
// AI Dev Studio — Pipeline Execution Engine v2
// DAG tabanlı paralel execution: agent_dependencies'den dependency graph
// oluşturur, bağımlılıkları karşılanan agent'ları paralel çalıştırır.
//
// Backward compat: Eğer agent_dependencies tablosu boşsa, eski
// pipeline_order tabanlı lineer stage mantığına geri döner.
//
// Review Loop: Reviewer dependency'si olan agent'lar tamamlandığında
// task 'review' durumuna geçer. Reviewer onay/ret verir.
// Max 3 revizyon döngüsü sonrası tech-lead'e eskalasyon.
//
// Gate: Tüm predecessor'lar tamamlanmalı (ör: DevOps deploy).
// ---------------------------------------------------------------------------

import {
  getProject,
  listProjectAgents,
  getTask,
  createPipelineRun,
  getPipelineRun,
  updatePipelineRun,
  getLatestPlan,
  listPhases,
  listAgentDependencies,
} from './db.js';
import { eventBus } from './event-bus.js';
import { taskEngine } from './task-engine.js';
import type {
  PipelineStage,
  PipelineState,
  PipelineStatus,
  ProjectAgent,
  Task,
  Phase,
  AgentDependency,
} from './types.js';

// ---------------------------------------------------------------------------
// Bellek içi durum haritası (projectId → PipelineState)
// ---------------------------------------------------------------------------
const _states = new Map<string, PipelineState>();

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function persistState(state: PipelineState): void {
  updatePipelineRun(state.projectId, {
    currentStage: state.currentStage,
    status: state.status,
    stagesJson: JSON.stringify(state.stages),
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  });
}

function hydrateState(projectId: string): PipelineState | null {
  const run = getPipelineRun(projectId);
  if (!run) return null;
  return {
    projectId,
    stages: JSON.parse(run.stagesJson) as PipelineStage[],
    currentStage: run.currentStage,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

// ---------------------------------------------------------------------------
// DAG Helper: Agent dependency graph'ından paralel wave'ler oluştur
// ---------------------------------------------------------------------------

interface DAGNode {
  agentId: string;
  agent: ProjectAgent;
  predecessors: Set<string>;  // agent IDs that must complete before this
  successors: Set<string>;    // agent IDs that depend on this
}

/**
 * Agent dependency'lerinden DAG wave'leri oluşturur.
 * Her wave, tüm predecessor'ları önceki wave'lerde bulunan agent'ları içerir.
 * Aynı wave'deki agent'lar birbirinden bağımsız → paralel çalışabilir.
 *
 * Returns: agent ID grupları (wave[0] = root agents, wave[1] = next, ...)
 */
function buildDAGWaves(
  agents: ProjectAgent[],
  deps: AgentDependency[],
): string[][] {
  // DAG node'larını oluştur
  const nodes = new Map<string, DAGNode>();
  for (const agent of agents) {
    nodes.set(agent.id, {
      agentId: agent.id,
      agent,
      predecessors: new Set(),
      successors: new Set(),
    });
  }

  // Dependency edge'lerini ekle (workflow, review, gate tipleri pipeline'ı etkiler)
  // hierarchy tipi sadece org chart için, pipeline'da etkisiz
  for (const dep of deps) {
    if (dep.type === 'hierarchy') continue;
    const from = nodes.get(dep.fromAgentId);
    const to = nodes.get(dep.toAgentId);
    if (from && to) {
      // from → to: "to" depends on "from"
      // yani from tamamlanmadan to başlayamaz
      to.predecessors.add(from.agentId);
      from.successors.add(to.agentId);
    }
  }

  // Topological sort — Kahn's algorithm ile wave'lere ayır
  const inDegree = new Map<string, number>();
  for (const [id, node] of nodes) {
    inDegree.set(id, node.predecessors.size);
  }

  const waves: string[][] = [];
  const remaining = new Set(nodes.keys());

  while (remaining.size > 0) {
    // Bu wave'de: in-degree'si 0 olan node'lar
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        wave.push(id);
      }
    }

    if (wave.length === 0) {
      // Döngüsel bağımlılık — kalan agent'ları son wave'e at (graceful)
      console.warn('[pipeline-engine] Döngüsel bağımlılık tespit edildi, kalan agent\'lar zorla ekleniyor');
      waves.push([...remaining]);
      break;
    }

    waves.push(wave);

    // Bu wave'deki node'ları remaining'den çıkar ve successor'ların in-degree'sini azalt
    for (const id of wave) {
      remaining.delete(id);
      const node = nodes.get(id)!;
      for (const succId of node.successors) {
        inDegree.set(succId, (inDegree.get(succId) ?? 1) - 1);
      }
    }
  }

  return waves;
}

// ---------------------------------------------------------------------------
// Pipeline Engine ana sınıfı
// ---------------------------------------------------------------------------

class PipelineEngine {
  // -------------------------------------------------------------------------
  // Pipeline inşası
  // -------------------------------------------------------------------------

  /**
   * Projedeki agent'ları ve plan phase'lerini okuyarak pipeline aşamalarını oluşturur.
   *
   * v2 stratejisi:
   *   1. agent_dependencies tablosundan dependency graph'ı oku
   *   2. Dependency varsa → DAG wave'leri oluştur (paralel execution)
   *   3. Dependency yoksa → eski pipeline_order tabanlı lineer stage (backward compat)
   *   4. Her wave bir PipelineStage olur
   *   5. Wave'deki agent'ların task'ları plan phase'lerinden eşleştirilir
   */
  buildPipeline(projectId: string): PipelineState {
    const project = getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    const agents = listProjectAgents(projectId);
    const plan = getLatestPlan(projectId);
    const phases: Phase[] = plan ? listPhases(plan.id) : [];

    // Dependency graph'ı oku
    const deps = listAgentDependencies(projectId);
    const hasDeps = deps.some((d) => d.type !== 'hierarchy');

    let stages: PipelineStage[];

    if (hasDeps) {
      // v2: DAG tabanlı wave'ler
      stages = this.buildDAGStages(agents, deps, phases);
    } else {
      // Fallback: eski pipeline_order tabanlı lineer stage'ler
      stages = this.buildLinearStages(agents, phases);
    }

    return {
      projectId,
      stages,
      currentStage: 0,
      status: 'idle',
    };
  }

  /**
   * DAG dependency graph'ından pipeline stage'leri oluşturur.
   * Her wave bir stage olur; wave'deki agent'lar paralel çalışır.
   */
  private buildDAGStages(
    agents: ProjectAgent[],
    deps: AgentDependency[],
    phases: Phase[],
  ): PipelineStage[] {
    const waves = buildDAGWaves(agents, deps);
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
    const usedTaskIds = new Set<string>();

    return waves.map((waveAgentIds, index) => {
      const waveAgents = waveAgentIds.map((id) => agentMap.get(id)!).filter(Boolean);
      const { ids, roles } = this.buildAgentMatchSet(waveAgents);

      // Bu wave'in agent'larına eşleşen task'ları topla
      const stageTasks: Task[] = [];
      let firstMatchedPhaseId: string | undefined;

      for (const phase of sortedPhases) {
        for (const task of phase.tasks ?? []) {
          if (usedTaskIds.has(task.id)) continue;
          const assigned = task.assignedAgent ?? '';
          if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
            stageTasks.push(task);
            usedTaskIds.add(task.id);
            if (!firstMatchedPhaseId) firstMatchedPhaseId = phase.id;
          }
        }
      }

      return {
        order: index,
        agents: waveAgents,
        tasks: stageTasks,
        status: 'pending' as const,
        phaseId: firstMatchedPhaseId,
      } satisfies PipelineStage;
    });
  }

  /**
   * Eski pipeline_order tabanlı lineer stage'ler (backward compat).
   */
  private buildLinearStages(
    agents: ProjectAgent[],
    phases: Phase[],
  ): PipelineStage[] {
    const orderGroups = new Map<number, ProjectAgent[]>();
    for (const agent of agents) {
      const order = agent.pipelineOrder ?? 0;
      if (!orderGroups.has(order)) orderGroups.set(order, []);
      orderGroups.get(order)!.push(agent);
    }

    const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);
    const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
    const usedTaskIds = new Set<string>();

    return sortedOrders.map((order) => {
      const stageAgents = orderGroups.get(order)!;
      const { ids, roles } = this.buildAgentMatchSet(stageAgents);

      const stageTasks: Task[] = [];
      let firstMatchedPhaseId: string | undefined;

      for (const phase of sortedPhases) {
        for (const task of phase.tasks ?? []) {
          if (usedTaskIds.has(task.id)) continue;
          const assigned = task.assignedAgent ?? '';
          if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
            stageTasks.push(task);
            usedTaskIds.add(task.id);
            if (!firstMatchedPhaseId) firstMatchedPhaseId = phase.id;
          }
        }
      }

      return {
        order,
        agents: stageAgents,
        tasks: stageTasks,
        status: 'pending' as const,
        phaseId: firstMatchedPhaseId,
      } satisfies PipelineStage;
    });
  }

  /** Agent eşleştirme için id ve role/name setleri oluşturur */
  private buildAgentMatchSet(stageAgents: ProjectAgent[]): {
    ids: Set<string>;
    roles: Set<string>;
  } {
    const ids = new Set<string>();
    const roles = new Set<string>();
    for (const a of stageAgents) {
      ids.add(a.id);
      if (a.sourceAgentId) ids.add(a.sourceAgentId);
      roles.add(a.role.toLowerCase());
      roles.add(a.name.toLowerCase());
    }
    return { ids, roles };
  }

  // -------------------------------------------------------------------------
  // Pipeline başlatma
  // -------------------------------------------------------------------------

  startPipeline(projectId: string): PipelineState {
    const project = getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    const state = this.buildPipeline(projectId);
    state.status = 'running';
    state.startedAt = now();

    createPipelineRun({
      projectId,
      status: 'running',
      stagesJson: JSON.stringify(state.stages),
    });
    updatePipelineRun(projectId, {
      currentStage: 0,
      status: 'running',
      startedAt: state.startedAt,
    });

    _states.set(projectId, state);

    if (state.stages.length > 0) {
      this.startStage(projectId, 0);
    } else {
      this.markCompleted(projectId);
    }

    return _states.get(projectId)!;
  }

  // -------------------------------------------------------------------------
  // Aşama yönetimi
  // -------------------------------------------------------------------------

  private startStage(projectId: string, stageIndex: number): void {
    const state = _states.get(projectId);
    if (!state) return;
    if (stageIndex >= state.stages.length) {
      this.markCompleted(projectId);
      return;
    }

    const stage = state.stages[stageIndex];
    stage.status = 'running';
    state.currentStage = stageIndex;

    persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:stage_started' as any,
      payload: {
        stageIndex,
        stageOrder: stage.order,
        agentCount: stage.agents.length,
        taskCount: stage.tasks.length,
      },
    });

    if (stage.tasks.length === 0) {
      this.completeStage(projectId, stageIndex);
    }
  }

  private completeStage(projectId: string, stageIndex: number): void {
    const state = _states.get(projectId);
    if (!state) return;

    const stage = state.stages[stageIndex];
    if (!stage) return;

    stage.status = 'completed';
    persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:stage_completed' as any,
      payload: {
        stageIndex,
        stageOrder: stage.order,
      },
    });

    const nextIndex = stageIndex + 1;
    if (nextIndex < state.stages.length) {
      this.startStage(projectId, nextIndex);
    } else {
      this.markCompleted(projectId);
    }
  }

  private markCompleted(projectId: string): void {
    const state = _states.get(projectId);
    if (!state) return;

    state.status = 'completed';
    state.completedAt = now();
    persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:completed' as any,
      payload: { completedAt: state.completedAt },
    });
  }

  private markFailed(projectId: string, reason: string): void {
    const state = _states.get(projectId);
    if (!state) return;

    const currentStage = state.stages[state.currentStage];
    if (currentStage) currentStage.status = 'failed';

    state.status = 'failed';
    state.completedAt = now();
    persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:failed' as any,
      payload: { reason, failedAt: state.completedAt },
    });
  }

  // -------------------------------------------------------------------------
  // Aşama ilerleme kontrolü (task tamamlandığında çağrılır)
  // -------------------------------------------------------------------------

  /**
   * Mevcut aşamanın tüm görevlerinin tamamlanıp tamamlanmadığını kontrol eder.
   *
   * v2 ek kontroller:
   *   - 'review' durumundaki task'lar henüz tamamlanmamış sayılır
   *   - 'revision' durumundaki task'lar henüz tamamlanmamış sayılır
   *   - Sadece 'done' durumundakiler tamamlanmış sayılır
   */
  advanceStage(projectId: string): PipelineState {
    let state: PipelineState | null | undefined = _states.get(projectId);
    if (!state) {
      state = hydrateState(projectId);
      if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);
      _states.set(projectId, state);
    }

    if (state.status === 'paused' || state.status === 'completed' || state.status === 'failed') {
      return state;
    }

    const currentIndex = state.currentStage;
    const currentStage = state.stages[currentIndex];
    if (!currentStage) return state;

    const freshTaskIds = this.resolveStageTaskIds(projectId, currentIndex, state);

    if (freshTaskIds.length === 0) {
      this.completeStage(projectId, currentIndex);
      return _states.get(projectId)!;
    }

    const statuses = freshTaskIds.map((id) => this.getTaskStatus(id));

    const anyFailed = statuses.some((s) => s === 'failed');
    // v2: review ve revision durumundaki task'lar henüz tamamlanmadı
    const allDone = statuses.every((s) => s === 'done' || s === 'completed');

    if (anyFailed) {
      this.markFailed(projectId, `Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`);
    } else if (allDone) {
      for (const t of currentStage.tasks) {
        t.status = 'done';
      }
      this.completeStage(projectId, currentIndex);
    }

    return _states.get(projectId)!;
  }

  private resolveStageTaskIds(projectId: string, stageIndex: number, state: PipelineState): string[] {
    const stage = state.stages[stageIndex];
    if (!stage) return [];

    if (stage.tasks.length > 0) {
      return stage.tasks.map((t) => t.id);
    }

    const plan = getLatestPlan(projectId);
    if (!plan) return [];

    const phases = listPhases(plan.id).sort((a, b) => a.order - b.order);
    const matchedPhase = phases[stageIndex];
    if (!matchedPhase) return [];

    stage.tasks = matchedPhase.tasks ?? [];
    return stage.tasks.map((t) => t.id);
  }

  private getTaskStatus(taskId: string): string {
    const task = getTask(taskId);
    const raw = task?.status ?? 'queued';
    return raw === 'completed' ? 'done' : raw;
  }

  // -------------------------------------------------------------------------
  // Durum sorgulama
  // -------------------------------------------------------------------------

  getPipelineState(projectId: string): PipelineState | null {
    const cached = _states.get(projectId);
    if (cached) return cached;

    const hydrated = hydrateState(projectId);
    if (hydrated) {
      _states.set(projectId, hydrated);
      return hydrated;
    }

    return null;
  }

  getEnrichedPipelineStatus(projectId: string): {
    pipelineState: PipelineState | null;
    taskProgress: ReturnType<typeof taskEngine.getProgress>;
    derivedStatus: PipelineStatus;
    warning?: string;
  } {
    let pipelineState = this.getPipelineState(projectId);

    if (pipelineState?.status === 'running') {
      try {
        this.advanceStage(projectId);
        pipelineState = this.getPipelineState(projectId);
      } catch {
        // status sorgusu sırasında hata olursa sessizce devam et
      }
    }

    const taskProgress = taskEngine.getProgress(projectId);
    const overall = taskProgress.overall;

    let derivedStatus: PipelineStatus = pipelineState?.status ?? 'idle';

    if (derivedStatus === 'idle' || derivedStatus === 'failed') {
      if (overall.running > 0) {
        derivedStatus = 'running';
      } else if (overall.done > 0 && overall.running === 0 && overall.queued === 0 && overall.failed === 0) {
        derivedStatus = 'completed';
      } else if (overall.failed > 0 && overall.running === 0 && overall.queued === 0) {
        derivedStatus = 'failed';
      }
    }

    let warning: string | undefined;
    if (pipelineState?.status === 'failed' && overall.running > 0) {
      warning = 'Pipeline kaydı "failed" gösterse de task\'lar hâlâ çalışıyor. Durum task verilerinden türetildi.';
    }

    return { pipelineState, taskProgress, derivedStatus, warning };
  }

  // -------------------------------------------------------------------------
  // Durdurma / Devam ettirme
  // -------------------------------------------------------------------------

  pausePipeline(projectId: string): void {
    const state = _states.get(projectId) ?? hydrateState(projectId);
    if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

    if (state.status !== 'running') {
      throw new Error(`Pipeline duraklatılamaz — mevcut durum: ${state.status}`);
    }

    state.status = 'paused';
    _states.set(projectId, state);
    persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:paused' as any,
      payload: { pausedAt: now(), currentStage: state.currentStage },
    });
  }

  resumePipeline(projectId: string): void {
    const state = _states.get(projectId) ?? hydrateState(projectId);
    if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

    if (state.status !== 'paused') {
      throw new Error(`Pipeline devam ettirilemiyor — mevcut durum: ${state.status}`);
    }

    state.status = 'running';
    _states.set(projectId, state);
    persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:resumed' as any,
      payload: { resumedAt: now(), currentStage: state.currentStage },
    });

    this.advanceStage(projectId);
  }

  // -------------------------------------------------------------------------
  // Review loop helper: Bir agent'ın reviewer'ını bul
  // -------------------------------------------------------------------------

  /**
   * Verilen agent'ın review dependency'si olan reviewer agent'ı döner.
   * agent_dependencies tablosunda type='review' olan edge'i arar.
   * fromAgentId = dev agent, toAgentId = reviewer agent
   */
  findReviewerForAgent(projectId: string, agentId: string): ProjectAgent | null {
    const deps = listAgentDependencies(projectId, 'review');
    // from → to ilişkisinde: "to" review'ı yapan
    // Ama review dependency mantığı: dev (from) → reviewer (to) şeklinde
    // "dev'in çıktısı reviewer'a gider" anlamında
    const reviewDep = deps.find((d) => d.fromAgentId === agentId);
    if (!reviewDep) return null;

    const agents = listProjectAgents(projectId);
    return agents.find((a) => a.id === reviewDep.toAgentId) ?? null;
  }

  /**
   * Bir reviewer'ın dev agent'ını bul (review ret durumunda revision için).
   */
  findDevForReviewer(projectId: string, reviewerAgentId: string): ProjectAgent | null {
    const deps = listAgentDependencies(projectId, 'review');
    const reviewDep = deps.find((d) => d.toAgentId === reviewerAgentId);
    if (!reviewDep) return null;

    const agents = listProjectAgents(projectId);
    return agents.find((a) => a.id === reviewDep.fromAgentId) ?? null;
  }

  // -------------------------------------------------------------------------
  // TaskEngine entegrasyonu — görev tamamlama hook'u
  // -------------------------------------------------------------------------

  registerTaskHook(): void {
    taskEngine.onTaskCompleted((taskId, projectId) => {
      const run = getPipelineRun(projectId);

      if (run && run.status === 'running') {
        try {
          this.advanceStage(projectId);
        } catch (err) {
          console.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):`, err);
        }
        return;
      }

      if (!run || run.status === 'idle' || run.status === 'failed') {
        try {
          const agents = listProjectAgents(projectId);
          if (agents.length > 0) {
            console.log(`[pipeline-engine] Task tamamlandı ama pipeline başlatılmamış; otomatik başlatılıyor (proje=${projectId})`);
            this.startPipeline(projectId);
            this.advanceStage(projectId);
          }
        } catch (err) {
          console.error(`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):`, err);
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton dışa aktarımı
// ---------------------------------------------------------------------------
export const pipelineEngine = new PipelineEngine();

// Uygulama başladığında TaskEngine hook'unu kaydet
pipelineEngine.registerTaskHook();
