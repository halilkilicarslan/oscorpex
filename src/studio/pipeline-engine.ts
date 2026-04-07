// ---------------------------------------------------------------------------
// AI Dev Studio — Pipeline Execution Engine
// Agent'ları pipeline_order sırasına göre aşamalı olarak çalıştırır.
// Her aşamadaki tüm görevler tamamlanmadan bir sonraki aşamaya geçilmez.
// Paralel çalışma: Aynı aşamadaki agent'lar eş zamanlı yürütülür.
// ---------------------------------------------------------------------------

import {
  getProject,
  listProjectAgents,
  listProjectTasks,
  getTask,
  createPipelineRun,
  getPipelineRun,
  updatePipelineRun,
} from './db.js';
import { eventBus } from './event-bus.js';
import { taskEngine } from './task-engine.js';
import type { PipelineStage, PipelineState, PipelineStatus, ProjectAgent, Task } from './types.js';

// ---------------------------------------------------------------------------
// Bellek içi durum haritası (projectId → PipelineState)
// DB ile senkronize tutulur; sunucu yeniden başladığında DB'den yüklenir
// ---------------------------------------------------------------------------
const _states = new Map<string, PipelineState>();

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

/** ISO-8601 zaman damgası üretir */
function now(): string {
  return new Date().toISOString();
}

/** PipelineState'i DB'ye yazar */
function persistState(state: PipelineState): void {
  updatePipelineRun(state.projectId, {
    currentStage: state.currentStage,
    status: state.status,
    stagesJson: JSON.stringify(state.stages),
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  });
}

/** DB kaydından PipelineState oluşturur */
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
// Pipeline Engine ana sınıfı
// ---------------------------------------------------------------------------

class PipelineEngine {
  // -------------------------------------------------------------------------
  // Pipeline inşası
  // -------------------------------------------------------------------------

  /**
   * Projedeki agent'ları ve görevleri okuyarak pipeline aşamalarını oluşturur.
   * Agent'lar pipelineOrder'a göre gruplanır; pipeline_order=0 olan agent'lar
   * kendi aşamalarında yürütülür (sırasız kademesi olarak değerlendirilir).
   */
  buildPipeline(projectId: string): PipelineState {
    const project = getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    // Tüm proje agent'larını ve görevlerini getir
    const agents = listProjectAgents(projectId);
    const tasks = listProjectTasks(projectId);

    // Agent'ları pipelineOrder değerine göre grupla
    // pipelineOrder=0 olanlar "sırasız" kabul edilir ve stage 0 olarak atanır
    const orderGroups = new Map<number, ProjectAgent[]>();
    for (const agent of agents) {
      const order = agent.pipelineOrder ?? 0;
      if (!orderGroups.has(order)) orderGroups.set(order, []);
      orderGroups.get(order)!.push(agent);
    }

    // Sıralı aşamaları oluştur
    const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);
    const stages: PipelineStage[] = sortedOrders.map((order) => {
      const stageAgents = orderGroups.get(order)!;

      // Bu aşamadaki agent'lara atanmış görevleri bul
      const agentIds = new Set(stageAgents.map((a) => a.id));
      const agentRoles = new Set(stageAgents.map((a) => a.role.toLowerCase()));

      const stageTasks = tasks.filter((t) => {
        const assigned = t.assignedAgent?.toLowerCase() ?? '';
        // Görev, agent ID'si veya rol adıyla atanmış olabilir
        return agentIds.has(assigned) || agentRoles.has(assigned);
      });

      return {
        order,
        agents: stageAgents,
        tasks: stageTasks,
        status: 'pending' as const,
      };
    });

    const state: PipelineState = {
      projectId,
      stages,
      currentStage: 0,
      status: 'idle',
    };

    return state;
  }

  // -------------------------------------------------------------------------
  // Pipeline başlatma
  // -------------------------------------------------------------------------

  /**
   * Pipeline'ı başlatır:
   * 1. Pipeline aşamalarını inşa eder
   * 2. DB'ye kaydeder (createPipelineRun / upsert)
   * 3. Belleğe alır
   * 4. İlk aşamayı (stage 0) başlatır
   */
  startPipeline(projectId: string): PipelineState {
    const project = getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    // Pipeline aşamalarını oluştur
    const state = this.buildPipeline(projectId);
    state.status = 'running';
    state.startedAt = now();

    // DB'ye kaydet (upsert)
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

    // Belleğe al
    _states.set(projectId, state);

    // İlk aşamayı başlat
    if (state.stages.length > 0) {
      this.startStage(projectId, 0);
    } else {
      // Hiç aşama yoksa pipeline'ı tamamla
      this.markCompleted(projectId);
    }

    return _states.get(projectId)!;
  }

  // -------------------------------------------------------------------------
  // Aşama yönetimi
  // -------------------------------------------------------------------------

  /**
   * Belirtilen aşamayı "running" durumuna getirir ve event yayar.
   * Aşamada görev yoksa otomatik olarak tamamlanmış sayılır.
   */
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

    // stage:started eventi yayınla
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

    // Bu aşamada görev yoksa anında tamamla
    if (stage.tasks.length === 0) {
      this.completeStage(projectId, stageIndex);
    }
  }

  /**
   * Mevcut aşamayı tamamlar ve bir sonraki aşamaya geçer.
   * Tüm aşamalar bittiyse pipeline'ı completed olarak işaretler.
   */
  private completeStage(projectId: string, stageIndex: number): void {
    const state = _states.get(projectId);
    if (!state) return;

    const stage = state.stages[stageIndex];
    if (!stage) return;

    stage.status = 'completed';
    persistState(state);

    // stage:completed eventi yayınla
    eventBus.emit({
      projectId,
      type: 'pipeline:stage_completed' as any,
      payload: {
        stageIndex,
        stageOrder: stage.order,
      },
    });

    // Bir sonraki aşama var mı?
    const nextIndex = stageIndex + 1;
    if (nextIndex < state.stages.length) {
      this.startStage(projectId, nextIndex);
    } else {
      this.markCompleted(projectId);
    }
  }

  /**
   * Pipeline'ı "completed" olarak işaretler.
   */
  private markCompleted(projectId: string): void {
    const state = _states.get(projectId);
    if (!state) return;

    state.status = 'completed';
    state.completedAt = now();
    persistState(state);

    // pipeline:completed eventi yayınla
    eventBus.emit({
      projectId,
      type: 'pipeline:completed' as any,
      payload: { completedAt: state.completedAt },
    });
  }

  /**
   * Pipeline'ı "failed" olarak işaretler.
   */
  private markFailed(projectId: string, reason: string): void {
    const state = _states.get(projectId);
    if (!state) return;

    // Mevcut aşamayı da failed yap
    const currentStage = state.stages[state.currentStage];
    if (currentStage) currentStage.status = 'failed';

    state.status = 'failed';
    state.completedAt = now();
    persistState(state);

    // pipeline:failed eventi yayınla
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
   * Tamamlandıysa bir sonraki aşamaya geçer.
   * Bu metot, taskEngine'in onTaskCompleted callback'inden tetiklenir.
   */
  advanceStage(projectId: string): PipelineState {
    // Durumu DB'den veya bellekten getir
    let state: PipelineState | null | undefined = _states.get(projectId);
    if (!state) {
      state = hydrateState(projectId);
      if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);
      _states.set(projectId, state);
    }

    // Duraklatılmış veya terminal durumda ise ilerletme
    if (state.status === 'paused' || state.status === 'completed' || state.status === 'failed') {
      return state;
    }

    const currentIndex = state.currentStage;
    const currentStage = state.stages[currentIndex];
    if (!currentStage) return state;

    // Mevcut aşamanın tüm görevleri done mu?
    const allDone = currentStage.tasks.every((t) => {
      // Görev durumunu task-engine üzerinden taze olarak oku
      const fresh = this.getTaskStatus(t.id);
      return fresh === 'done';
    });

    // Herhangi bir görev failed mi?
    const anyFailed = currentStage.tasks.some((t) => {
      const fresh = this.getTaskStatus(t.id);
      return fresh === 'failed';
    });

    if (anyFailed) {
      // Bir sonraki aşamaya geçmeden önce failed olarak işaretle
      // (Görev bazında hata varsa pipeline durur; tasarım kararı)
      this.markFailed(projectId, `Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`);
    } else if (allDone) {
      // Bellekteki görev listesini güncel statüslerle senkronize et
      for (const t of currentStage.tasks) {
        t.status = 'done';
      }
      this.completeStage(projectId, currentIndex);
    }

    return _states.get(projectId)!;
  }

  /**
   * DB'den bir görevin güncel durumunu okur.
   * better-sqlite3 senkron API kullandığından senkron erişim yapılır.
   */
  private getTaskStatus(taskId: string): string {
    const task = getTask(taskId);
    return task?.status ?? 'queued';
  }

  // -------------------------------------------------------------------------
  // Durum sorgulama
  // -------------------------------------------------------------------------

  /**
   * Projenin anlık pipeline durumunu döner.
   * Bellek boşsa DB'den yüklemeye çalışır.
   */
  getPipelineState(projectId: string): PipelineState | null {
    const cached = _states.get(projectId);
    if (cached) return cached;

    // Bellekte yoksa DB'den yükle
    const hydrated = hydrateState(projectId);
    if (hydrated) {
      _states.set(projectId, hydrated);
      return hydrated;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Durdurma / Devam ettirme
  // -------------------------------------------------------------------------

  /** Pipeline'ı duraklatır; mevcut aşamayı tamamlamaz */
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

  /** Duraklatılmış pipeline'ı devam ettirir */
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

    // Mevcut aşamanın durumunu yeniden kontrol et; tamamlandıysa ilerlet
    this.advanceStage(projectId);
  }

  // -------------------------------------------------------------------------
  // TaskEngine entegrasyonu — görev tamamlama hook'u
  // -------------------------------------------------------------------------

  /**
   * TaskEngine'e callback kaydeder.
   * Herhangi bir görev tamamlandığında, ilgili projenin pipeline'ını kontrol eder.
   * Bu metot uygulama başlangıcında bir kez çağrılmalıdır.
   */
  registerTaskHook(): void {
    taskEngine.onTaskCompleted((taskId, projectId) => {
      // Pipeline kaydı yoksa görmezden gel (execution-engine bağımsız çalışabilir)
      const run = getPipelineRun(projectId);
      if (!run || run.status !== 'running') return;

      try {
        this.advanceStage(projectId);
      } catch (err) {
        // Pipeline ilerleme hatası uygulamayı durdurmamalı
        console.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):`, err);
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
