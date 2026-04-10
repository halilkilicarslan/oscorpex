// ---------------------------------------------------------------------------
// Orenda — Pipeline Execution Engine v2
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
  updateTask,
} from './db.js';
import { eventBus } from './event-bus.js';
import { taskEngine } from './task-engine.js';
import { gitManager } from './git-manager.js';
import { generateReadme } from './docs-generator.js';
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

async function persistState(state: PipelineState): Promise<void> {
  await updatePipelineRun(state.projectId, {
    currentStage: state.currentStage,
    status: state.status,
    stagesJson: JSON.stringify(state.stages),
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  });
}

async function hydrateState(projectId: string): Promise<PipelineState | null> {
  const run = await getPipelineRun(projectId);
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
  async buildPipeline(projectId: string): Promise<PipelineState> {
    const project = await getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    const agents = await listProjectAgents(projectId);
    const plan = await getLatestPlan(projectId);
    const phases: Phase[] = plan ? await listPhases(plan.id) : [];

    // Dependency graph'ı oku
    const deps = await listAgentDependencies(projectId);
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

    // Collect all tasks and separate review tasks for second pass
    const allTasks: Task[] = [];
    const reviewTasks: Task[] = [];
    for (const phase of sortedPhases) {
      for (const task of phase.tasks ?? []) {
        if (task.title.startsWith('Code Review: ') && task.dependsOn.length > 0) {
          reviewTasks.push(task);
        } else {
          allTasks.push(task);
        }
      }
    }

    const stages = waves.map((waveAgentIds, index) => {
      const waveAgents = waveAgentIds.map((id) => agentMap.get(id)!).filter(Boolean);
      const { ids, roles } = this.buildAgentMatchSet(waveAgents);

      // Bu wave'in agent'larına eşleşen task'ları topla (review task'lar hariç)
      const stageTasks: Task[] = [];
      let firstMatchedPhaseId: string | undefined;

      for (const task of allTasks) {
        if (usedTaskIds.has(task.id)) continue;
        const assigned = task.assignedAgent ?? '';
        if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
          stageTasks.push(task);
          usedTaskIds.add(task.id);
          if (!firstMatchedPhaseId) firstMatchedPhaseId = task.phaseId;
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

    // Second pass: place review tasks in the same stage as their dependency
    for (const reviewTask of reviewTasks) {
      if (usedTaskIds.has(reviewTask.id)) continue;
      const depId = reviewTask.dependsOn[0];
      const targetStage = stages.find((s) => s.tasks.some((t) => t.id === depId));
      if (targetStage) {
        targetStage.tasks.push(reviewTask);
        usedTaskIds.add(reviewTask.id);
      } else {
        // Fallback: put in last stage
        const last = stages[stages.length - 1];
        if (last) {
          last.tasks.push(reviewTask);
          usedTaskIds.add(reviewTask.id);
        }
      }
    }

    return stages;
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

    // Reverse category map: "backend-dev" → also match "backend"
    const reverseCategoryMap: Record<string, string[]> = {
      'backend-dev': ['backend', 'backend-developer', 'coder'],
      'backend-developer': ['backend', 'backend-dev', 'coder'],
      'frontend-dev': ['frontend', 'frontend-developer'],
      'frontend-developer': ['frontend', 'frontend-dev'],
      'backend-qa': ['qa'],
      'frontend-qa': ['qa'],
      'qa-engineer': ['qa'],
      'design-lead': ['design', 'designer', 'ui-designer'],
      'tech-lead': ['architect', 'tech-lead'],
      'scrum-master': ['pm'],
      'product-owner': ['pm'],
      'business-analyst': ['analyst'],
    };

    for (const a of stageAgents) {
      ids.add(a.id);
      if (a.sourceAgentId) ids.add(a.sourceAgentId);
      const roleLower = a.role.toLowerCase();
      roles.add(roleLower);
      roles.add(a.name.toLowerCase());

      // Add reverse category aliases so "backend" tasks match "backend-dev" agents
      const aliases = reverseCategoryMap[roleLower];
      if (aliases) {
        for (const alias of aliases) roles.add(alias);
      }
      // Also match partial: "backend-dev" → add "backend" prefix
      const dashIdx = roleLower.indexOf('-');
      if (dashIdx > 0) {
        roles.add(roleLower.slice(0, dashIdx)); // "backend-dev" → "backend"
      }
    }
    return { ids, roles };
  }

  // -------------------------------------------------------------------------
  // Pipeline başlatma
  // -------------------------------------------------------------------------

  async startPipeline(projectId: string): Promise<PipelineState> {
    const project = await getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    const state = await this.buildPipeline(projectId);
    state.status = 'running';
    state.startedAt = now();

    await createPipelineRun({
      projectId,
      status: 'running',
      stagesJson: JSON.stringify(state.stages),
    });
    await updatePipelineRun(projectId, {
      currentStage: 0,
      status: 'running',
      startedAt: state.startedAt,
    });

    _states.set(projectId, state);

    if (state.stages.length > 0) {
      await this.startStage(projectId, 0);
    } else {
      await this.markCompleted(projectId);
    }

    return _states.get(projectId)!;
  }

  // -------------------------------------------------------------------------
  // Aşama yönetimi
  // -------------------------------------------------------------------------

  private async startStage(projectId: string, stageIndex: number): Promise<void> {
    const state = _states.get(projectId);
    if (!state) return;
    if (stageIndex >= state.stages.length) {
      await this.markCompleted(projectId);
      return;
    }

    const stage = state.stages[stageIndex];
    stage.status = 'running';
    state.currentStage = stageIndex;

    await persistState(state);

    // Phase başlarken otomatik git branch oluştur — pipeline'ı bloklamaz
    this.createPhaseBranch(projectId, stageIndex, stage).catch((err) =>
      console.warn(`[pipeline-engine] Phase branch oluşturulamadı (stage ${stageIndex}):`, err),
    );

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
      await this.completeStage(projectId, stageIndex);
    }
  }

  /**
   * Phase başlangıcında `phase/{stageIndex}-{agentRoles}` formatında
   * git branch oluşturur. Başarısızlık pipeline'ı durdurmaz.
   */
  private async createPhaseBranch(
    projectId: string,
    stageIndex: number,
    stage: PipelineStage,
  ): Promise<void> {
    const project = await getProject(projectId);
    if (!project?.repoPath) return;

    // Branch adı: phase/0-backend, phase/1-frontend vb.
    const roleSlug = stage.agents
      .map((a) => a.role.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .join('-')
      .slice(0, 30); // Git branch adı sınırı
    const branchName = `phase/${stageIndex}-${roleSlug || 'stage'}`;

    try {
      const branches = await gitManager.listBranches(project.repoPath);
      if (branches.includes(branchName)) {
        // Branch zaten varsa geçiş yap
        await gitManager.checkout(project.repoPath, branchName);
      } else {
        // Yeni branch oluştur
        await gitManager.createBranch(project.repoPath, branchName);
      }

      eventBus.emit({
        projectId,
        type: 'pipeline:branch_created' as any,
        payload: { branch: branchName, stageIndex },
      });
    } catch (err) {
      console.warn(`[pipeline-engine] Branch oluşturulamadı: ${branchName}`, err);
    }
  }

  private async completeStage(projectId: string, stageIndex: number): Promise<void> {
    const state = _states.get(projectId);
    if (!state) return;

    const stage = state.stages[stageIndex];
    if (!stage) return;

    stage.status = 'completed';
    await persistState(state);

    // Phase tamamlanınca branch'i main'e merge et — pipeline'ı bloklamaz
    this.mergePhaseBranchToMain(projectId, stageIndex, stage).catch((err) =>
      console.warn(`[pipeline-engine] Phase branch merge edilemedi (stage ${stageIndex}):`, err),
    );

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
      await this.startStage(projectId, nextIndex);
    } else {
      await this.markCompleted(projectId);
    }
  }

  /**
   * Tamamlanan phase branch'ini main'e merge eder.
   * Commit'lenecek değişiklik varsa önce commit atar.
   * Conflict durumunda uyarı log'u bırakır ama pipeline devam eder.
   */
  private async mergePhaseBranchToMain(
    projectId: string,
    stageIndex: number,
    stage: PipelineStage,
  ): Promise<void> {
    const project = await getProject(projectId);
    if (!project?.repoPath) return;

    const roleSlug = stage.agents
      .map((a) => a.role.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .join('-')
      .slice(0, 30);
    const branchName = `phase/${stageIndex}-${roleSlug || 'stage'}`;

    try {
      // Aktif branch bu phase branch'i mi kontrol et
      const currentBranch = await gitManager.getCurrentBranch(project.repoPath);
      if (currentBranch !== branchName) return; // Farklı branch'teyiz, işlem yapma

      // Uncommitted değişiklik varsa commit at
      const status = await gitManager.getStatus(project.repoPath);
      const hasChanges =
        status.modified.length > 0 ||
        status.untracked.length > 0 ||
        status.staged.length > 0;

      if (hasChanges) {
        await gitManager.commit(
          project.repoPath,
          `feat: phase ${stageIndex} tamamlandı (${roleSlug || 'stage'})`,
        );
      }

      // main branch'e merge et
      const result = await gitManager.mergeBranch(project.repoPath, branchName, 'main');

      if (result.success) {
        eventBus.emit({
          projectId,
          type: 'pipeline:branch_merged' as any,
          payload: { branch: branchName, target: 'main', stageIndex },
        });
      } else {
        // Conflict varsa main'e geri dön
        console.warn(
          `[pipeline-engine] Merge conflict tespit edildi: ${branchName} → main`,
          result.conflicts,
        );
        await gitManager.checkout(project.repoPath, 'main').catch(() => {});
      }
    } catch (err) {
      console.warn(`[pipeline-engine] Branch merge atlandı: ${branchName}`, err);
    }
  }

  private async markCompleted(projectId: string): Promise<void> {
    const state = _states.get(projectId);
    if (!state) return;

    state.status = 'completed';
    state.completedAt = now();
    await persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:completed' as any,
      payload: { completedAt: state.completedAt },
    });

    // Pipeline tamamlandığında README.md otomatik oluştur — non-blocking
    generateReadme(projectId, (msg) => {
      console.log(`[pipeline-engine] ${msg}`);
    }).catch((err) => {
      console.error('[pipeline-engine] README oluşturma hatası:', err);
    });
  }

  private async markFailed(projectId: string, reason: string): Promise<void> {
    const state = _states.get(projectId);
    if (!state) return;

    const currentStage = state.stages[state.currentStage];
    if (currentStage) currentStage.status = 'failed';

    state.status = 'failed';
    state.completedAt = now();
    await persistState(state);

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
  async advanceStage(projectId: string): Promise<PipelineState> {
    let state: PipelineState | null | undefined = _states.get(projectId);
    if (!state) {
      state = await hydrateState(projectId);
      if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);
      _states.set(projectId, state);
    }

    if (state.status === 'paused' || state.status === 'completed' || state.status === 'failed') {
      return state;
    }

    const currentIndex = state.currentStage;
    const currentStage = state.stages[currentIndex];
    if (!currentStage) return state;

    const freshTaskIds = await this.resolveStageTaskIds(projectId, currentIndex, state);

    if (freshTaskIds.length === 0) {
      await this.completeStage(projectId, currentIndex);
      return _states.get(projectId)!;
    }

    const statuses = await Promise.all(freshTaskIds.map((id) => this.getTaskStatus(id)));

    const anyFailed = statuses.some((s) => s === 'failed');
    // v2: review durumundaki task'lar stage ilerlemesini bloklamaz —
    // review task ayrı stage'de çalışır, orijinal task review bitince done olur
    const allDone = statuses.every((s) => s === 'done' || s === 'review');

    if (anyFailed) {
      await this.markFailed(projectId, `Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`);
    } else if (allDone) {
      for (const t of currentStage.tasks) {
        t.status = 'done';
      }
      await this.completeStage(projectId, currentIndex);
    }

    return _states.get(projectId)!;
  }

  private async resolveStageTaskIds(projectId: string, stageIndex: number, state: PipelineState): Promise<string[]> {
    const stage = state.stages[stageIndex];
    if (!stage) return [];

    if (stage.tasks.length > 0) {
      return stage.tasks.map((t) => t.id);
    }

    const plan = await getLatestPlan(projectId);
    if (!plan) return [];

    const phases = (await listPhases(plan.id)).sort((a, b) => a.order - b.order);
    const matchedPhase = phases[stageIndex];
    if (!matchedPhase) return [];

    stage.tasks = matchedPhase.tasks ?? [];
    return stage.tasks.map((t) => t.id);
  }

  private async getTaskStatus(taskId: string): Promise<string> {
    const task = await getTask(taskId);
    return task?.status ?? 'queued';
  }

  // -------------------------------------------------------------------------
  // Durum sorgulama
  // -------------------------------------------------------------------------

  async getPipelineState(projectId: string): Promise<PipelineState | null> {
    const cached = _states.get(projectId);
    if (cached) return cached;

    const hydrated = await hydrateState(projectId);
    if (hydrated) {
      _states.set(projectId, hydrated);
      return hydrated;
    }

    return null;
  }

  async getEnrichedPipelineStatus(projectId: string): Promise<{
    pipelineState: PipelineState | null;
    taskProgress: Awaited<ReturnType<typeof taskEngine.getProgress>>;
    derivedStatus: PipelineStatus;
    warning?: string;
  }> {
    let pipelineState = await this.getPipelineState(projectId);

    if (pipelineState?.status === 'running') {
      try {
        await this.advanceStage(projectId);
        pipelineState = await this.getPipelineState(projectId);
      } catch {
        // status sorgusu sırasında hata olursa sessizce devam et
      }
    }

    const taskProgress = await taskEngine.getProgress(projectId);
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

  async pausePipeline(projectId: string): Promise<void> {
    const state = _states.get(projectId) ?? await hydrateState(projectId);
    if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

    if (state.status !== 'running') {
      throw new Error(`Pipeline duraklatılamaz — mevcut durum: ${state.status}`);
    }

    state.status = 'paused';
    _states.set(projectId, state);
    await persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:paused' as any,
      payload: { pausedAt: now(), currentStage: state.currentStage },
    });
  }

  async resumePipeline(projectId: string): Promise<void> {
    const state = _states.get(projectId) ?? await hydrateState(projectId);
    if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

    if (state.status !== 'paused') {
      throw new Error(`Pipeline devam ettirilemiyor — mevcut durum: ${state.status}`);
    }

    state.status = 'running';
    _states.set(projectId, state);
    await persistState(state);

    eventBus.emit({
      projectId,
      type: 'pipeline:resumed' as any,
      payload: { resumedAt: now(), currentStage: state.currentStage },
    });

    await this.advanceStage(projectId);
  }

  /**
   * Failed pipeline'ı kurtarır: failed task'ları queued'e çevirir,
   * pipeline stage'i running'e döndürür ve advanceStage ile devam eder.
   */
  async retryFailedPipeline(projectId: string): Promise<void> {
    let state = _states.get(projectId) ?? await hydrateState(projectId);
    if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

    if (state.status !== 'failed') {
      throw new Error(`Pipeline retry edilemiyor — mevcut durum: ${state.status}`);
    }

    // Failed stage'i running'e çevir
    const currentStage = state.stages[state.currentStage];
    if (currentStage) currentStage.status = 'running';

    state.status = 'running';
    state.completedAt = undefined;
    _states.set(projectId, state);
    await persistState(state);

    // Failed task'ları queued'e çevir
    const taskIds = await this.resolveStageTaskIds(projectId, state.currentStage, state);
    for (const taskId of taskIds) {
      const status = await this.getTaskStatus(taskId);
      if (status === 'failed') {
        await updateTask(taskId, { status: 'queued', error: null, retryCount: 0 } as any);
      }
    }

    eventBus.emit({
      projectId,
      type: 'pipeline:resumed' as any,
      payload: { resumedAt: now(), currentStage: state.currentStage, reason: 'retry_failed' },
    });

    await this.advanceStage(projectId);
  }

  // -------------------------------------------------------------------------
  // Review loop helper: Bir agent'ın reviewer'ını bul
  // -------------------------------------------------------------------------

  /**
   * Verilen agent'ın review dependency'si olan reviewer agent'ı döner.
   * agent_dependencies tablosunda type='review' olan edge'i arar.
   * fromAgentId = dev agent, toAgentId = reviewer agent
   */
  async findReviewerForAgent(projectId: string, agentId: string): Promise<ProjectAgent | null> {
    const deps = await listAgentDependencies(projectId, 'review');
    // from → to ilişkisinde: "to" review'ı yapan
    // Ama review dependency mantığı: dev (from) → reviewer (to) şeklinde
    // "dev'in çıktısı reviewer'a gider" anlamında
    const reviewDep = deps.find((d) => d.fromAgentId === agentId);
    if (!reviewDep) return null;

    const agents = await listProjectAgents(projectId);
    return agents.find((a) => a.id === reviewDep.toAgentId) ?? null;
  }

  /**
   * Bir reviewer'ın dev agent'ını bul (review ret durumunda revision için).
   */
  async findDevForReviewer(projectId: string, reviewerAgentId: string): Promise<ProjectAgent | null> {
    const deps = await listAgentDependencies(projectId, 'review');
    const reviewDep = deps.find((d) => d.toAgentId === reviewerAgentId);
    if (!reviewDep) return null;

    const agents = await listProjectAgents(projectId);
    return agents.find((a) => a.id === reviewDep.fromAgentId) ?? null;
  }

  // -------------------------------------------------------------------------
  // TaskEngine entegrasyonu — görev tamamlama hook'u
  // -------------------------------------------------------------------------

  registerTaskHook(): void {
    taskEngine.onTaskCompleted((taskId, projectId) => {
      getPipelineRun(projectId).then(async (run) => {
        if (run && run.status === 'running') {
          try {
            await this.advanceStage(projectId);
          } catch (err) {
            console.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):`, err);
          }
          return;
        }

        if (!run || run.status === 'idle' || run.status === 'failed') {
          try {
            const agents = await listProjectAgents(projectId);
            if (agents.length > 0) {
              console.log(`[pipeline-engine] Task tamamlandı ama pipeline başlatılmamış; otomatik başlatılıyor (proje=${projectId})`);
              await this.startPipeline(projectId);
              await this.advanceStage(projectId);
            }
          } catch (err) {
            console.error(`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):`, err);
          }
        }
      }).catch((err) => {
        console.error(`[pipeline-engine] getPipelineRun hatası (proje=${projectId}):`, err);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton dışa aktarımı
// ---------------------------------------------------------------------------
export const pipelineEngine = new PipelineEngine();

// Uygulama başladığında TaskEngine hook'unu kaydet
pipelineEngine.registerTaskHook();
