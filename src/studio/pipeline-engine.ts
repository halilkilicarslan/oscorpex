// ---------------------------------------------------------------------------
// AI Dev Studio — Pipeline Execution Engine
// Agent'ları pipeline_order sırasına göre aşamalı olarak çalıştırır.
// Her aşamadaki tüm görevler tamamlanmadan bir sonraki aşamaya geçilmez.
// Paralel çalışma: Aynı aşamadaki agent'lar eş zamanlı yürütülür.
//
// Stage → Phase Mapping:
//   Pipeline stage'leri agent.pipelineOrder değerine göre oluşturulur.
//   Her stage, aynı sıra numarasına sahip plan phase'iyle eşleştirilir.
//   Böylece phase order = stage order; task'lar phase bazlı bulunur.
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
} from './db.js';
import { eventBus } from './event-bus.js';
import { taskEngine } from './task-engine.js';
import type { PipelineStage, PipelineState, PipelineStatus, ProjectAgent, Task, Phase } from './types.js';

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
   * Projedeki agent'ları ve plan phase'lerini okuyarak pipeline aşamalarını oluşturur.
   *
   * Stage → Phase Mapping stratejisi:
   *   1. Agent'lar pipelineOrder değerine göre gruplanır (stage oluşturur).
   *   2. Plan phase'leri sıra numarasına göre sıralanır.
   *   3. Her stage, aynı index'teki phase ile eşleştirilir
   *      (stage[0] → phase[0], stage[1] → phase[1], ...).
   *   4. Eşleşen phase'in task'ları stage'e atanır.
   *   5. Eşleşen phase yoksa (daha fazla stage var), task listesi boş kalır
   *      ve stage anında tamamlanmış sayılır.
   *
   * Bu yaklaşım circular dependency yaratmaz: sadece db.ts fonksiyonları kullanılır.
   */
  buildPipeline(projectId: string): PipelineState {
    const project = getProject(projectId);
    if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

    // Tüm proje agent'larını getir
    const agents = listProjectAgents(projectId);

    // Plan phase'lerini getir (task assignment için)
    const plan = getLatestPlan(projectId);
    const phases: Phase[] = plan ? listPhases(plan.id) : [];

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

    // Phase'leri order'a göre sırala (phase.order küçükten büyüğe)
    const sortedPhases = [...phases].sort((a, b) => a.order - b.order);

    const stages: PipelineStage[] = sortedOrders.map((order, stageIndex) => {
      const stageAgents = orderGroups.get(order)!;

      // Stage index ile aynı index'teki phase'i eşleştir
      // Bu sayede phase 0 → stage 0, phase 1 → stage 1 olur
      const matchedPhase: Phase | undefined = sortedPhases[stageIndex];

      // Stage task listesi: eşleşen phase'in task'ları
      // Fallback: agent ID/role bazlı matching (phase yoksa)
      let stageTasks: Task[] = [];

      if (matchedPhase) {
        // Phase bazlı mapping: en güvenilir yöntem
        stageTasks = matchedPhase.tasks ?? [];
      } else {
        // Phase eşleşmesi yoksa agent ID/role bazlı fallback
        const agentIds = new Set(stageAgents.map((a) => a.id));
        const agentNames = new Set(stageAgents.map((a) => a.name.toLowerCase()));
        const agentRoles = new Set(stageAgents.map((a) => a.role.toLowerCase()));

        // Tüm phase'lerin task'larını tara
        for (const phase of phases) {
          for (const task of phase.tasks ?? []) {
            const assigned = task.assignedAgent?.toLowerCase() ?? '';
            if (agentIds.has(task.assignedAgent) || agentRoles.has(assigned) || agentNames.has(assigned)) {
              stageTasks.push(task);
            }
          }
        }
      }

      return {
        order,
        agents: stageAgents,
        tasks: stageTasks,
        status: 'pending' as const,
        phaseId: matchedPhase?.id,
      } satisfies PipelineStage;
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
   * Aşamada görev yoksa:
   *   - Execution engine üzerinden aktif task'ları kontrol et
   *   - Hâlâ yoksa otomatik olarak tamamlanmış say
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
    // Görev varsa: taskEngine callback'i üzerinden advanceStage tetiklenecek
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
   *
   * Senkronizasyon mantığı:
   *   1. Stage'deki task listesi boşsa, plan phase task'larını taze olarak sorgula
   *   2. Task'ların güncel durumunu DB'den oku (getTask)
   *   3. Hepsi done ise → completeStage
   *   4. Herhangi biri failed ise → markFailed
   *   5. Hâlâ running/queued olanlar varsa → bekle
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

    // Stage'deki görev listesini taze verilerle güncelle
    // (buildPipeline sırasında snapshot alınmıştı; şimdi DB'den güncel halleri çek)
    const freshTaskIds = this.resolveStageTaskIds(projectId, currentIndex, state);

    if (freshTaskIds.length === 0) {
      // Bu stage'de hiç task yok — anında tamamla
      this.completeStage(projectId, currentIndex);
      return _states.get(projectId)!;
    }

    // Her task'ın güncel durumunu DB'den sorgula
    const statuses = freshTaskIds.map((id) => this.getTaskStatus(id));

    const anyFailed = statuses.some((s) => s === 'failed');
    const allDone = statuses.every((s) => s === 'done');

    if (anyFailed) {
      this.markFailed(projectId, `Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`);
    } else if (allDone) {
      // Bellekteki görev listesini güncel statüslerle senkronize et
      for (const t of currentStage.tasks) {
        t.status = 'done';
      }
      this.completeStage(projectId, currentIndex);
    }
    // Aksi hâlde (running/queued): bir sonraki task tamamlandığında tekrar tetiklenecek

    return _states.get(projectId)!;
  }

  /**
   * Verilen stage index için görev ID listesini döner.
   * Önce stage'in kendi tasks listesini kullanır.
   * Eğer boşsa plan phase'inden taze olarak yükler.
   *
   * Bu metot circular import yaratmaz çünkü yalnızca db.js kullanır.
   */
  private resolveStageTaskIds(projectId: string, stageIndex: number, state: PipelineState): string[] {
    const stage = state.stages[stageIndex];
    if (!stage) return [];

    // Stage'in kendi task listesi varsa kullan
    if (stage.tasks.length > 0) {
      return stage.tasks.map((t) => t.id);
    }

    // Task listesi boşsa plan phase'inden taze yükle
    const plan = getLatestPlan(projectId);
    if (!plan) return [];

    const phases = listPhases(plan.id).sort((a, b) => a.order - b.order);
    const matchedPhase = phases[stageIndex];
    if (!matchedPhase) return [];

    // Stage'in task listesini güncelle (sonraki advanceStage çağrılarında kullanmak için)
    stage.tasks = matchedPhase.tasks ?? [];

    return stage.tasks.map((t) => t.id);
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

  /**
   * Pipeline durumunu task execution durumlarıyla zenginleştirerek döner.
   * Execution engine çalışıyor ama pipeline kayıt yoksa sentetik bir durum üretir.
   *
   * Kullanım: GET /projects/:id/pipeline/status endpoint'i tarafından çağrılır.
   */
  getEnrichedPipelineStatus(projectId: string): {
    pipelineState: PipelineState | null;
    taskProgress: ReturnType<typeof taskEngine.getProgress>;
    derivedStatus: PipelineStatus;
    warning?: string;
  } {
    const pipelineState = this.getPipelineState(projectId);
    const taskProgress = taskEngine.getProgress(projectId);

    const overall = taskProgress.overall;

    // Task durumlarına göre pipeline durumunu türet
    // Bu sayede pipeline kaydı "idle" olsa bile task'lar çalışıyorsa "running" gösterilir
    let derivedStatus: PipelineStatus = pipelineState?.status ?? 'idle';

    if (derivedStatus === 'idle' || derivedStatus === 'failed') {
      // Pipeline kaydı henüz oluşmamış veya hatalı durumda;
      // task durumlarına bakarak daha doğru bir bilgi sun
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
   *
   * Kayıt mantığı:
   *   1. Pipeline DB kaydı var ve "running" ise → advanceStage çağır
   *   2. Pipeline kaydı yoksa ama task'lar çalışıyorsa →
   *      Pipeline'ı otomatik başlat (plan onaylıysa)
   *   3. Hata durumunda pipeline durdurulmamalı → sadece logla
   *
   * Bu metot uygulama başlangıcında bir kez çağrılmalıdır.
   */
  registerTaskHook(): void {
    taskEngine.onTaskCompleted((taskId, projectId) => {
      const run = getPipelineRun(projectId);

      if (run && run.status === 'running') {
        // Pipeline aktif: normal akış
        try {
          this.advanceStage(projectId);
        } catch (err) {
          console.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):`, err);
        }
        return;
      }

      if (!run || run.status === 'idle' || run.status === 'failed') {
        // Pipeline kaydı yok veya başlatılmamış;
        // task'lar çalışıyorsa pipeline'ı otomatik başlat
        try {
          const agents = listProjectAgents(projectId);
          if (agents.length > 0) {
            console.log(`[pipeline-engine] Task tamamlandı ama pipeline başlatılmamış; otomatik başlatılıyor (proje=${projectId})`);
            this.startPipeline(projectId);
            // startPipeline sonrası advanceStage çağırarak mevcut durumu değerlendir
            this.advanceStage(projectId);
          }
        } catch (err) {
          console.error(`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):`, err);
        }
      }
      // run.status === 'paused' | 'completed' → hiçbir şey yapma
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton dışa aktarımı
// ---------------------------------------------------------------------------
export const pipelineEngine = new PipelineEngine();

// Uygulama başladığında TaskEngine hook'unu kaydet
pipelineEngine.registerTaskHook();
