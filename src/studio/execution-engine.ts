// ---------------------------------------------------------------------------
// AI Dev Studio — Execution Engine
// Orchestrates task execution: dispatches tasks to agents running in Docker
// containers (or falls back to local AI SDK execution when Docker unavailable).
// ---------------------------------------------------------------------------

import { generateText, stepCountIs } from 'ai';
import { taskEngine } from './task-engine.js';
import { containerManager } from './container-manager.js';
import { containerPool, type TaskResult as PoolTaskResult } from './container-pool.js';
import { eventBus } from './event-bus.js';
import { getAIModelInfo, calculateCost, getAIModelWithFallback } from './ai-provider-factory.js';
import {
  getProject,
  listAgentConfigs,
  getAgentConfig,
  getLatestPlan,
  listPhases,
  updateTask,
  updatePhaseStatus,
  listProjects,
  recordTokenUsage,
  listProjectTasks,
  getTask,
  listProjectAgents,
  getProjectSetting,
} from './db.js';
import { createAgentTools } from './agent-tools.js';
import { agentRuntime } from './agent-runtime.js';
import type { Task, Project, AgentConfig, TaskOutput } from './types.js';
import { runIntegrationTest } from './task-runners.js';
import { startApp } from './app-runner.js';
import { isClaudeCliAvailable, executeWithCLI, resolveFilePaths } from './cli-runtime.js';
import { runLintFix } from './lint-runner.js';
import { updateDocsAfterTask } from './docs-generator.js';
import { buildRAGContext, formatRAGContext } from './context-builder.js';

// ---------------------------------------------------------------------------
// Timeout configuration
// ---------------------------------------------------------------------------

/**
 * Complexity'ye göre temel timeout değerleri (milisaniye):
 *   S  → 5 dakika
 *   M  → 15 dakika
 *   L  → 30 dakika
 *   XL → 60 dakika
 */
const COMPLEXITY_TIMEOUT_MS: Record<string, number> = {
  S: 5 * 60 * 1000,
  M: 15 * 60 * 1000,
  L: 30 * 60 * 1000,
  XL: 60 * 60 * 1000,
};

/** Bilinmeyen complexity için varsayılan: 5 dakika */
const DEFAULT_TASK_TIMEOUT_MS = COMPLEXITY_TIMEOUT_MS.S;

/**
 * Timeout'a yaklaşıldığında uyarı vermek için eşik: son %20.
 * Örneğin 30 dk'lık timeout'ta 24. dakikada warning emit edilir.
 */
const TIMEOUT_WARNING_THRESHOLD = 0.8; // Timeout'un %80'i geçince warning

/**
 * Task complexity ve proje timeout_multiplier ayarına göre efektif timeout hesaplar.
 * Öncelik sırası: agent.taskTimeout > complexity tabanlı değer × multiplier
 */
function resolveTaskTimeoutMs(
  projectId: string,
  complexity: string | undefined,
  agentTimeout: number | undefined,
): number {
  // Agent seviyesinde açıkça belirlenmiş timeout önceliklidir
  if (agentTimeout != null && agentTimeout > 0) return agentTimeout;

  // Complexity bazlı temel timeout
  const baseMs = COMPLEXITY_TIMEOUT_MS[complexity ?? 'S'] ?? DEFAULT_TASK_TIMEOUT_MS;

  // Proje ayarlarından kullanıcının belirlediği çarpan (varsayılan 1.0)
  const multiplierStr = getProjectSetting(projectId, 'execution', 'task_timeout_multiplier');
  const multiplier = multiplierStr ? parseFloat(multiplierStr) : 1.0;
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1.0;

  return Math.round(baseMs * safeMultiplier);
}

/**
 * Wraps a promise with a timeout using AbortController.
 * If the promise does not resolve within `timeoutMs`, the AbortController is
 * aborted and a TaskTimeoutError is thrown.
 *
 * @param operation   - Factory that receives an AbortSignal and returns the promise to race.
 * @param timeoutMs   - Maximum allowed duration in milliseconds.
 * @param onWarning   - Timeout'un %80'i dolduğunda çağrılır (opsiyonel).
 * @returns The resolved value of the operation promise.
 */
function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onWarning?: () => void,
): Promise<T> {
  const controller = new AbortController();

  const timeoutPromise = new Promise<never>((_, reject) => {
    // Timeout'un %80'inde warning tetikle (son %20'ye girildiğinde)
    const warningMs = Math.round(timeoutMs * TIMEOUT_WARNING_THRESHOLD);
    const warningTimer = onWarning
      ? setTimeout(() => { onWarning(); }, warningMs)
      : null;

    const timer = setTimeout(() => {
      if (warningTimer) clearTimeout(warningTimer);
      controller.abort();
      reject(new TaskTimeoutError(timeoutMs));
    }, timeoutMs);

    // İşlem erken biterse timer'ları temizle
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      if (warningTimer) clearTimeout(warningTimer);
    });
  });

  return Promise.race([operation(controller.signal), timeoutPromise]);
}

/** Thrown when a task exceeds its configured timeout */
class TaskTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    const minutes = (timeoutMs / 60_000).toFixed(1);
    super(`Task timed out after ${minutes} minute(s) (${timeoutMs}ms). The task was aborted.`);
    this.name = 'TaskTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// Execution Engine
// ---------------------------------------------------------------------------

class ExecutionEngine {
  constructor() {
    // Register completion callback: when a task completes and a new phase starts,
    // dispatch the newly ready tasks automatically
    taskEngine.onTaskCompleted((_taskId, projectId) => {
      // After checkAndAdvancePhase runs, check all phases for ready tasks
      const plan = getLatestPlan(projectId);
      if (!plan) return;
      const phases = listPhases(plan.id);
      for (const phase of phases) {
        if (phase.status === 'running') {
          const ready = taskEngine.getReadyTasks(phase.id);
          if (ready.length > 0) {
            Promise.allSettled(
              ready.map((task: any) => this.executeTask(projectId, task)),
            ).catch(() => {});
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Startup recovery — restart sonrası "running" kalan task'ları kurtarır
  // -------------------------------------------------------------------------

  /**
   * Backend restart sonrası çalışır. Tüm projelerdeki "running" durumundaki
   * task'ları "queued" durumuna geri alır ve ilgili projelerin execution'ını
   * yeniden başlatır. Bu sayede yarıda kalmış görevler yeniden çalıştırılır.
   */
  async recoverStuckTasks(): Promise<void> {
    const projects = listProjects();
    for (const project of projects) {
      if (project.status !== 'running') continue;

      const plan = getLatestPlan(project.id);
      if (!plan || plan.status !== 'approved') continue;

      const phases = listPhases(plan.id);
      let hasRecovered = false;

      for (const phase of phases) {
        if (phase.status !== 'running' && phase.status !== 'failed') continue;
        let phaseRecovered = false;
        for (const task of phase.tasks ?? []) {
          if (task.status === 'running' || task.status === 'assigned') {
            updateTask(task.id, { status: 'queued', startedAt: undefined });
            console.log(`[execution-engine] Recovery: "${task.title}" → queued (was ${task.status})`);
            phaseRecovered = true;
          }
        }
        if (phaseRecovered && phase.status === 'failed') {
          updatePhaseStatus(phase.id, 'running');
          console.log(`[execution-engine] Recovery: phase "${phase.name}" → running (was failed)`);
        }
        hasRecovered = hasRecovered || phaseRecovered;
      }

      if (hasRecovered) {
        console.log(`[execution-engine] Recovering project "${project.name}" — restarting execution`);
        this.startProjectExecution(project.id).catch((err) => {
          console.error(`[execution-engine] Recovery failed for "${project.name}":`, err);
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Main entry point — called after plan approval
  // -------------------------------------------------------------------------

  /**
   * Begin execution for a project. Retrieves the initial ready tasks from the
   * task engine (which also starts the first phase) and dispatches them in
   * parallel. Subsequent phases are advanced automatically by the task engine's
   * completeTask → checkAndAdvancePhase logic; this engine reacts to newly
   * ready tasks after each task completion.
   */
  async startProjectExecution(projectId: string): Promise<void> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    let readyTasks: Task[] = [];

    // First check if there are already running phases with queued tasks
    const plan = getLatestPlan(projectId);
    if (plan) {
      const phases = listPhases(plan.id);
      for (const phase of phases) {
        if (phase.status === 'running') {
          readyTasks.push(...taskEngine.getReadyTasks(phase.id));
        }
      }
    }

    // If no running phases have ready tasks, start a new phase
    if (readyTasks.length === 0) {
      try {
        readyTasks = taskEngine.beginExecution(projectId);
      } catch {
        // No pending phase or no approved plan — nothing to do
      }
    }

    eventBus.emit({
      projectId,
      type: 'execution:started',
      payload: { readyTaskCount: readyTasks.length },
    });

    // Dispatch tasks sequentially to avoid AI provider rate limits
    for (const task of readyTasks) {
      await this.executeTask(projectId, task);
    }
  }

  // -------------------------------------------------------------------------
  // Single task execution
  // -------------------------------------------------------------------------

  /**
   * Execute a single task end-to-end:
   *  1. Resolve the assigned agent configuration
   *  2. Ensure a container is running (or prepare local fallback)
   *  3. Mark the task as assigned then running
   *  4. Build a prompt and run Claude Code (or local AI SDK)
   *  5. Complete or fail the task
   *  6. Dispatch any newly unblocked tasks
   */
  async executeTask(projectId: string, task: Task): Promise<void> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // --- Non-AI task types: integration-test & run-app ---
    if (task.taskType === 'integration-test' || task.taskType === 'run-app') {
      await this.executeSpecialTask(projectId, project, task);
      return;
    }

    // Resolve agent config — prefer the task's assignedAgent value, which may
    // be an agent ID or a role name. Try both.
    const agent = this.resolveAgent(projectId, task.assignedAgent);
    if (!agent) {
      taskEngine.assignTask(task.id, task.assignedAgent);
      taskEngine.startTask(task.id);
      taskEngine.failTask(
        task.id,
        `No agent found for assignment "${task.assignedAgent}" in project ${projectId}`,
      );
      await this.dispatchReadyTasks(projectId, task.phaseId);
      return;
    }

    // Track which task this agent is working on
    containerManager.setCurrentTask(projectId, agent.id, task.id);

    // Mark task as assigned then running
    taskEngine.assignTask(task.id, agent.id);
    taskEngine.startTask(task.id);

    const prompt = await this.buildTaskPrompt(task, project);

    // Complexity ve proje timeout_multiplier ayarına göre efektif timeout hesapla
    const timeoutMs = resolveTaskTimeoutMs(projectId, task.complexity, agent.taskTimeout);

    // Timeout'un %80'ine girildiğinde warning event emit edecek callback
    const onTimeoutWarning = () => {
      const remainingMs = Math.round(timeoutMs * (1 - TIMEOUT_WARNING_THRESHOLD));
      const remainingSec = Math.round(remainingMs / 1000);
      console.warn(`[execution-engine] Timeout uyarısı: "${task.title}" — ${remainingSec}sn kaldı`);
      eventBus.emit({
        projectId,
        type: 'task:timeout_warning',
        agentId: agent.id,
        taskId: task.id,
        payload: {
          timeoutMs,
          remainingMs,
          taskTitle: task.title,
          message: `Görev timeout'a ${remainingSec} saniye kaldı (toplam ${(timeoutMs / 60_000).toFixed(0)} dk).`,
        },
      });
    };

    try {
      let output: TaskOutput | undefined;
      let executionMode: 'cli' | 'pool' | 'docker' | 'local' = 'local';

      // Execution priority: 1) Claude CLI  2) Container Pool  3) Docker Container  4) Local AI SDK

      // --- Level 1: Claude CLI (full visibility, sandbox) ---
      if (!output && project.repoPath) {
        const cliReady = await isClaudeCliAvailable();
        if (cliReady) {
          try {
            const cliResult = await executeWithCLI({
              projectId,
              agentId: agent.id,
              agentName: agent.name,
              repoPath: project.repoPath,
              prompt,
              systemPrompt: agent.systemPrompt || this.defaultSystemPrompt(agent),
              timeoutMs,
              model: 'sonnet',
              signal: undefined, // timeout CLI'nın kendi mekanizmasıyla yönetiliyor
            });

            output = {
              filesCreated: resolveFilePaths(cliResult.filesCreated, project.repoPath),
              filesModified: resolveFilePaths(cliResult.filesModified, project.repoPath),
              logs: cliResult.logs,
            };
            executionMode = 'cli';

            // Record token usage from CLI result
            if (cliResult.inputTokens || cliResult.outputTokens) {
              const totalTokens = cliResult.inputTokens + cliResult.outputTokens;
              recordTokenUsage({
                projectId,
                taskId: task.id,
                agentId: agent.id,
                model: cliResult.model || 'claude-sonnet-4-6',
                provider: 'anthropic',
                inputTokens: cliResult.inputTokens,
                outputTokens: cliResult.outputTokens,
                totalTokens,
                costUsd: cliResult.totalCostUsd,
              });
            }
          } catch (cliErr) {
            const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr);
            eventBus.emit({
              projectId,
              type: 'agent:output',
              agentId: agent.id,
              taskId: task.id,
              payload: { output: `[cli fallback] CLI failed: ${cliMsg.slice(0, 200)}. Trying pool/local...` },
            });
            output = undefined;
          }
        }
      }

      // --- Level 2: Container Pool (isolated, pre-warmed) ---
      if (!output) {
        const poolReady = containerPool.isReady();
        if (poolReady && project.repoPath) {
          try {
            const poolResult = await containerPool.executeTask(
              projectId,
              agent.id,
              agent.name,
              agent.role,
              project.repoPath,
              {
                taskId: task.id,
                prompt,
                systemPrompt: agent.systemPrompt || this.defaultSystemPrompt(agent),
                timeout: timeoutMs,
              },
            );
            output = {
              filesCreated: poolResult.filesCreated,
              filesModified: poolResult.filesModified,
              logs: [...poolResult.logs, `[pool-output] ${poolResult.output.slice(0, 500)}`],
            };
            executionMode = 'pool';
          } catch (poolErr) {
            const poolMsg = poolErr instanceof Error ? poolErr.message : String(poolErr);
            eventBus.emit({
              projectId,
              type: 'agent:output',
              agentId: agent.id,
              taskId: task.id,
              payload: { output: `[pool fallback] Pool failed: ${poolMsg.slice(0, 200)}. Trying Docker/local...` },
            });
            output = undefined;
          }
        }
      }

      // --- Level 3: Docker Container / Level 4: Local AI SDK ---
      if (!output) {
        const dockerAvailable = await containerManager.isDockerAvailable();

        if (dockerAvailable && agent.cliTool === 'claude-code') {
          try {
            output = await withTimeout(
              (signal) => this.executeInContainer(projectId, agent, project, task, prompt, signal),
              timeoutMs,
              onTimeoutWarning,
            );
            executionMode = 'docker';
          } catch (dockerErr) {
            if (dockerErr instanceof TaskTimeoutError) throw dockerErr;

            const dockerMsg = dockerErr instanceof Error ? dockerErr.message : String(dockerErr);
            eventBus.emit({
              projectId,
              type: 'agent:output',
              agentId: agent.id,
              taskId: task.id,
              payload: { output: `[docker fallback] Container failed: ${dockerMsg.slice(0, 200)}. Falling back to local execution.` },
            });
            output = await withTimeout(
              (signal) => this.executeLocally(projectId, agent, task, prompt, signal),
              timeoutMs,
              onTimeoutWarning,
            );
          }
        } else {
          output = await withTimeout(
            (signal) => this.executeLocally(projectId, agent, task, prompt, signal),
            timeoutMs,
            onTimeoutWarning,
          );
        }
      }

      // Log execution mode for telemetry
      eventBus.emit({
        projectId,
        type: 'agent:output',
        agentId: agent.id,
        taskId: task.id,
        payload: { output: `[execution] Mode: ${executionMode}` },
      });

      // --- ESLint/Prettier enforcement: auto-fix generated files ---
      const allFiles = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
      if (allFiles.length > 0 && project.repoPath) {
        try {
          const termLog = (msg: string) => {
            agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
            agentRuntime.appendVirtualOutput(projectId, agent.id, msg);
          };
          const lintResult = await runLintFix(project.repoPath, allFiles, termLog);
          if (lintResult.eslint.errors.length > 0 || lintResult.prettier.errors.length > 0) {
            eventBus.emit({
              projectId,
              type: 'agent:output',
              agentId: agent.id,
              taskId: task.id,
              payload: { output: `[lint] Uyarılar: eslint(${lintResult.eslint.errors.length}), prettier(${lintResult.prettier.errors.length})` },
            });
          }
        } catch (lintErr) {
          // Lint failure should never block task completion
          console.warn('[execution-engine] Lint/format failed (non-blocking):', lintErr);
        }
      }

      // --- Auto-documentation: update docs based on agent role ---
      try {
        await updateDocsAfterTask(project, { ...task, output }, agent, (msg) => {
          agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
          agentRuntime.appendVirtualOutput(projectId, agent.id, msg);
        });
      } catch (docErr) {
        console.warn('[execution-engine] Docs update failed (non-blocking):', docErr);
      }

      taskEngine.completeTask(task.id, output);

      // --- Review loop: auto-review coding tasks ---
      const CODER_ROLES = new Set(['frontend', 'backend', 'coder']);
      if (CODER_ROLES.has(agent.role) && output.filesCreated.length + output.filesModified.length > 0) {
        try {
          await this.runReviewLoop(projectId, project, task, agent, output);
        } catch (reviewErr) {
          console.warn('[execution-engine] Review loop failed (non-blocking):', reviewErr);
        }
      }
    } catch (err) {
      const isTimeout = err instanceof TaskTimeoutError;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[execution-engine] Task failed: "${task.title}" — ${errorMsg}`);

      if (isTimeout) {
        // Emit a dedicated timeout event before the generic error event
        eventBus.emit({
          projectId,
          type: 'task:timeout',
          agentId: agent.id,
          taskId: task.id,
          payload: {
            timeoutMs,
            taskTitle: task.title,
            message: errorMsg,
          },
        });
      }

      eventBus.emit({
        projectId,
        type: 'agent:error',
        agentId: agent.id,
        taskId: task.id,
        payload: { error: errorMsg },
      });

      taskEngine.failTask(task.id, errorMsg);

      // --- Self-healing: auto-retry with error context ---
      const MAX_AUTO_RETRIES = 2;
      const failedTask = getTask(task.id);
      if (!isTimeout && failedTask && failedTask.retryCount < MAX_AUTO_RETRIES) {
        console.log(`[execution-engine] Self-healing: auto-retry #${failedTask.retryCount + 1} for "${task.title}"`);
        eventBus.emit({
          projectId,
          type: 'agent:output',
          agentId: agent.id,
          taskId: task.id,
          payload: { output: `[self-heal] Otomatik yeniden deneme #${failedTask.retryCount + 1}: ${errorMsg.slice(0, 200)}` },
        });
        const retried = taskEngine.retryTask(task.id);
        // Re-execute with error context injected into the task
        await this.executeTask(projectId, { ...retried, error: errorMsg });
        return; // skip dispatchReadyTasks — executeTask will handle it
      }
    } finally {
      containerManager.setCurrentTask(projectId, agent.id, undefined);
    }

    // After this task is settled (done or failed), check if new tasks are ready
    // First check the current phase, then check if a new phase was started
    await this.dispatchReadyTasks(projectId, task.phaseId);

    // If the phase was completed and a new phase started, dispatch its tasks too
    const plan = getLatestPlan(projectId);
    if (plan) {
      const phases = listPhases(plan.id);
      for (const phase of phases) {
        if (phase.status === 'running' && phase.id !== task.phaseId) {
          await this.dispatchReadyTasks(projectId, phase.id);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Docker container execution
  // -------------------------------------------------------------------------

  private async executeInContainer(
    projectId: string,
    agent: AgentConfig,
    project: Project,
    task: Task,
    prompt: string,
    signal: AbortSignal,
  ): Promise<TaskOutput> {
    // Abort early if the timeout already fired before we even started
    if (signal.aborted) {
      throw new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS);
    }

    // Ensure a container is alive for this agent; create one if needed
    const existing = containerManager.getRuntime(projectId, agent.id);
    if (!existing?.containerId) {
      await containerManager.createContainer(agent, project);
    }

    const claudeCodePromise = containerManager.runClaudeCode(projectId, agent.id, prompt);

    // Race the container execution against the abort signal
    const { exitCode, output } = await new Promise<{ exitCode: number; output: string }>(
      (resolve, reject) => {
        const onAbort = () => reject(new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS));
        signal.addEventListener('abort', onAbort, { once: true });
        claudeCodePromise
          .then((result) => {
            signal.removeEventListener('abort', onAbort);
            resolve(result);
          })
          .catch((err) => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
          });
      },
    );

    const taskOutput = this.parseTaskOutput(output);

    if (exitCode !== 0) {
      // Non-zero exit is still captured as output; mark it in logs
      taskOutput.logs.push(`Process exited with code ${exitCode}`);
    }

    return taskOutput;
  }

  // -------------------------------------------------------------------------
  // Local (no-Docker) execution via AI SDK generateText
  // -------------------------------------------------------------------------

  private async executeLocally(
    projectId: string,
    agent: AgentConfig,
    task: Task,
    prompt: string,
    signal: AbortSignal,
  ): Promise<TaskOutput> {
    // Abort early if the timeout already fired before we even started
    if (signal.aborted) {
      throw new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS);
    }

    const project = getProject(projectId);
    const repoPath = project?.repoPath;

    if (!repoPath) {
      throw new Error(`Project ${projectId} has no repoPath configured`);
    }

    // Terminal için sanal süreç kaydı oluştur — SSE stream bu buffer'dan okur
    agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);

    const termLog = (msg: string) => {
      agentRuntime.appendVirtualOutput(projectId, agent.id, msg);
      eventBus.emit({
        projectId,
        type: 'agent:output',
        agentId: agent.id,
        taskId: task.id,
        payload: { output: msg },
      });
    };

    termLog(`[${agent.name}] Task başlatılıyor: ${task.title}`);

    const tracker = { filesCreated: [] as string[], filesModified: [] as string[], logs: [] as string[] };
    const tools = createAgentTools(
      { projectId, agentId: agent.id, taskId: task.id, repoPath },
      tracker,
    );

    // Maliyet takibi için model bilgilerini dışarı taşıyacak değişkenler.
    // getAIModelWithFallback başarıyla seçtiği provider'ın bilgilerini buraya yazar.
    let _resolvedModelName = 'unknown';
    let _resolvedProviderType = 'unknown';

    /**
     * generateText çağrısını fallback zinciri + exponential backoff ile yeniden dener.
     * Birincil provider başarısız olursa sıradaki aktif provider'a geçilir.
     * AbortError veya TaskTimeoutError alınırsa retry/fallback yapılmaz.
     * Maksimum 2 retry (aynı provider): 1. denemede 1sn, 2. denemede 3sn beklenir.
     */
    const MAX_GENERATE_RETRIES = 2;
    const RETRY_DELAYS_MS = [1_000, 3_000];

    const callGenerateText = async (): Promise<Awaited<ReturnType<typeof generateText>>> => {
      // Fallback zinciri: birincil provider başarısız olursa sıradakine geç
      return getAIModelWithFallback(async (model, { modelName, providerType }) => {
        // Başarıyla seçilen model bilgilerini maliyet takibi için kaydet
        _resolvedModelName = modelName;
        _resolvedProviderType = providerType;

        let lastError: unknown;

        for (let attempt = 0; attempt <= MAX_GENERATE_RETRIES; attempt++) {
          // Sinyal zaten iptal edildiyse hemen TaskTimeoutError fırlat
          if (signal.aborted) {
            throw new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS);
          }

          try {
            // generateText'e AbortSignal'ı ilet; SDK iptali destekliyor
            const generatePromise = generateText({
              model,
              stopWhen: stepCountIs(20),
              system: agent.systemPrompt || this.defaultSystemPrompt(agent),
              prompt,
              tools,
              abortSignal: signal,
              maxRetries: 0, // Retry'ı kendimiz yönetiyoruz
            });

            // SDK'nın sinyal yayılımı yetersiz kaldığı durumlarda da abort race yapalım
            const abortTimeoutMs = agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS;
            const abortPromise = new Promise<never>((_, reject) => {
              const onAbort = () => reject(new TaskTimeoutError(abortTimeoutMs));
              signal.addEventListener('abort', onAbort, { once: true });
              // generatePromise sonuçlanınca listener'ı temizle (memory leak önlemi)
              generatePromise.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => {});
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await Promise.race([generatePromise, abortPromise]) as any;
            return result;
          } catch (err) {
            // Timeout veya iptal hatalarını anında yukarı ilet — retry yok
            if (err instanceof TaskTimeoutError) throw err;
            if (
              err instanceof Error &&
              (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
            ) {
              throw new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS);
            }

            lastError = err;
            const errMsg = err instanceof Error ? err.message : String(err);

            if (attempt < MAX_GENERATE_RETRIES) {
              const delayMs = RETRY_DELAYS_MS[attempt] ?? 3_000;
              termLog(
                `[${agent.name}] Provider hatası (deneme ${attempt + 1}/${MAX_GENERATE_RETRIES + 1}): ${errMsg.slice(0, 200)}. ${delayMs / 1000}sn sonra yeniden denenecek...`,
              );
              console.warn(
                `[execution-engine] generateText hatası (attempt ${attempt + 1}), ${delayMs}ms sonra retry:`,
                errMsg,
              );
              // Bekleme sırasında sinyal iptal edilirse erken çık
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, delayMs);
                const onAbort = () => { clearTimeout(timer); reject(new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS)); };
                signal.addEventListener('abort', onAbort, { once: true });
              });
            } else {
              // Tüm denemeler tükendi — fallback zinciri bu hatayı yakalayıp sıradaki provider'ı dener
              eventBus.emit({
                projectId,
                type: 'execution:error',
                agentId: agent.id,
                taskId: task.id,
                payload: {
                  error: errMsg,
                  attempts: attempt + 1,
                  taskTitle: task.title,
                },
              });
              throw lastError;
            }
          }
        }

        // TypeScript için — buraya asla ulaşılmamalı
        throw lastError ?? new Error('generateText başarısız oldu');
      });
    };

    const { text, usage } = await callGenerateText();

    termLog(text.slice(0, 2000));
    termLog(`[${agent.name}] Task tamamlandı: ${task.title}`);
    agentRuntime.markVirtualStopped(projectId, agent.id);

    // Maliyet takibi — fallback zinciri tarafından seçilen model bilgilerini kullan
    if (usage) {
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const totalTokens = inputTokens + outputTokens;
      const costUsd = calculateCost(_resolvedModelName, inputTokens, outputTokens);
      recordTokenUsage({
        projectId,
        taskId: task.id,
        agentId: agent.id,
        model: _resolvedModelName,
        provider: _resolvedProviderType,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
      });
      termLog(`[cost] ${_resolvedModelName}: ${totalTokens} tokens ($${costUsd.toFixed(4)})`);
    }

    // Merge tool-tracked files with any mentioned in the AI's final text
    const parsed = this.parseTaskOutput(text);
    const filesCreated = [...new Set([...tracker.filesCreated, ...parsed.filesCreated])];
    const filesModified = [...new Set([...tracker.filesModified, ...parsed.filesModified])];
    const logs = [...tracker.logs, ...parsed.logs].slice(-100);

    return {
      filesCreated,
      filesModified,
      testResults: parsed.testResults,
      logs,
    };
  }

  // -------------------------------------------------------------------------
  // Prompt builder
  // -------------------------------------------------------------------------

  /**
   * Build the execution prompt that is sent to the AI tool (Claude Code or
   * the local AI SDK model). Includes full task context so the agent knows
   * exactly what to implement.
   */
  async buildTaskPrompt(task: Task, project: Project): Promise<string> {
    const techStack =
      project.techStack.length > 0 ? project.techStack.join(', ') : 'Not specified';

    // --- Code Context: gather files from completed tasks in this project ---
    const completedTasks = listProjectTasks(project.id).filter(
      (t) => t.status === 'done' && t.output && t.id !== task.id,
    );

    const contextFiles = new Map<string, { agent: string; task: string }>();
    for (const ct of completedTasks) {
      const allFiles = [
        ...(ct.output?.filesCreated ?? []),
        ...(ct.output?.filesModified ?? []),
      ];
      for (const f of allFiles) {
        contextFiles.set(f, { agent: ct.assignedAgent, task: ct.title });
      }
    }

    const lines: string[] = [
      `# Task: ${task.title}`,
      '',
      `## Project`,
      `- Name: ${project.name}`,
      `- Tech Stack: ${techStack}`,
      `- Description: ${project.description || 'No description provided'}`,
      '',
    ];

    // Add code context section if there are completed tasks
    if (contextFiles.size > 0) {
      lines.push(
        `## Code Context (files created/modified by other agents)`,
        '',
        'The following files already exist in the project. Read them with readFile before making changes to ensure consistency:',
        '',
      );
      const sorted = [...contextFiles.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [filePath, info] of sorted.slice(0, 50)) {
        lines.push(`- \`${filePath}\` (by ${info.agent}: ${info.task})`);
      }
      if (contextFiles.size > 50) {
        lines.push(`- ... and ${contextFiles.size - 50} more files`);
      }
      lines.push('');
    }

    // RAG Context: retrieve relevant code snippets from the project's vector store
    try {
      const ragContext = await buildRAGContext(project.id, task.title, task.description);
      if (ragContext && ragContext.relevantChunks.length > 0) {
        lines.push(formatRAGContext(ragContext));
      }
    } catch (err) {
      // RAG failure must never block task execution
      console.warn('[execution-engine] RAG context fetch failed (non-blocking):', err);
    }

    // Add completed task summaries for cross-agent awareness
    if (completedTasks.length > 0) {
      lines.push(
        `## Completed Tasks (${completedTasks.length})`,
        '',
      );
      for (const ct of completedTasks.slice(-10)) {
        const fileCount = (ct.output?.filesCreated?.length ?? 0) + (ct.output?.filesModified?.length ?? 0);
        lines.push(`- **${ct.title}** (${ct.assignedAgent}) — ${fileCount} files`);
      }
      lines.push('');
    }

    // Self-healing: inject previous error so agent can fix it
    if (task.error) {
      lines.push(
        `## Previous Attempt Failed`,
        '',
        'This task was attempted before but failed with the following error. Please fix the issue and try again:',
        '',
        '```',
        task.error.slice(0, 1000),
        '```',
        '',
        'Common fixes: check import paths, install missing dependencies, fix syntax errors, ensure files exist before reading.',
        '',
      );
    }

    lines.push(
      `## Task Details`,
      `- ID: ${task.id}`,
      `- Complexity: ${task.complexity}`,
      `- Branch: ${task.branch || 'main'}`,
      `- Retry: ${task.retryCount > 0 ? `#${task.retryCount}` : 'first attempt'}`,
      '',
      `## Instructions`,
      task.description,
      '',
      `## Available Tools`,
      'You have the following tools to complete this task:',
      '- **listFiles**: List files in a directory',
      '- **readFile**: Read file contents',
      '- **writeFile**: Create or update files',
      '- **runCommand**: Run shell commands (npm/pnpm install, tests, builds, etc.)',
      '- **commitChanges**: Git commit your changes',
      '',
      `## Workflow`,
      '1. First, use listFiles to understand the current project structure',
      '2. Read any relevant existing files to understand the codebase',
      '3. Create or modify the necessary files using writeFile',
      '4. Run any relevant commands (install deps, run tests, etc.)',
      '5. Commit your changes with a descriptive message',
      '',
      `## Important`,
      '- Read existing files before modifying them to maintain consistency',
      '- Follow the same patterns and conventions used in existing code',
      '- Do not overwrite files created by other agents unless necessary for your task',
      '',
      `## Output`,
      'After completing all tool calls, provide a brief summary of what you did.',
    );

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Special (non-AI) task execution: integration-test, run-app
  // -------------------------------------------------------------------------

  private async executeSpecialTask(projectId: string, project: Project, task: Task): Promise<void> {
    taskEngine.assignTask(task.id, task.taskType ?? 'system');
    taskEngine.startTask(task.id);

    const termLog = (msg: string) => {
      eventBus.emit({
        projectId,
        type: 'agent:output',
        taskId: task.id,
        payload: { output: msg },
      });
    };

    try {
      let output: TaskOutput;

      if (task.taskType === 'integration-test') {
        termLog('[execution-engine] Running integration tests...');
        output = await runIntegrationTest(project.repoPath, termLog);
      } else {
        // run-app
        termLog('[execution-engine] Starting application...');
        const result = await startApp(projectId, project.repoPath, termLog);
        output = {
          filesCreated: [],
          filesModified: [],
          logs: [`Started ${result.services.length} service(s). Preview: ${result.previewUrl}`],
        };
      }

      taskEngine.completeTask(task.id, output);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[execution-engine] Special task failed: "${task.title}" — ${errorMsg}`);
      eventBus.emit({
        projectId,
        type: 'agent:error',
        taskId: task.id,
        payload: { error: errorMsg },
      });
      taskEngine.failTask(task.id, errorMsg);
    }

    // Dispatch next tasks
    await this.dispatchReadyTasks(projectId, task.phaseId);
    const plan = getLatestPlan(projectId);
    if (plan) {
      const phases = listPhases(plan.id);
      for (const phase of phases) {
        if (phase.status === 'running' && phase.id !== task.phaseId) {
          await this.dispatchReadyTasks(projectId, phase.id);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch newly ready tasks
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Review Loop: reviewer agent auto-reviews coding task output
  // -------------------------------------------------------------------------

  private async runReviewLoop(
    projectId: string,
    project: Project,
    task: Task,
    coderAgent: AgentConfig,
    output: TaskOutput,
  ): Promise<void> {
    // Find reviewer agent in project team (project-scoped)
    const agents = listProjectAgents(projectId);
    const reviewer = agents.find((a) => a.role === 'reviewer');
    if (!reviewer) return; // No reviewer in team — skip

    const allFiles = [...output.filesCreated, ...output.filesModified];
    if (allFiles.length === 0) return;

    const termLog = (msg: string) => {
      agentRuntime.ensureVirtualProcess(projectId, reviewer.id, reviewer.name);
      agentRuntime.appendVirtualOutput(projectId, reviewer.id, msg);
      eventBus.emit({
        projectId,
        type: 'agent:output',
        agentId: reviewer.id,
        taskId: task.id,
        payload: { output: msg },
      });
    };

    termLog(`[review] ${coderAgent.name} tarafindan yazilan "${task.title}" inceleniyor...`);

    const reviewPrompt = [
      `# Code Review: ${task.title}`,
      '',
      `## Context`,
      `- Original task by: ${coderAgent.name} (${coderAgent.role})`,
      `- Project: ${project.name}`,
      '',
      `## Files to Review`,
      ...allFiles.map((f) => `- \`${f}\``),
      '',
      `## Instructions`,
      'Review the code written by the other agent. For each file:',
      '1. Use readFile to read the file contents',
      '2. Check for bugs, security issues, code style problems, and missing edge cases',
      '3. If you find issues, use writeFile to fix them directly',
      '4. If the code is good, just note it as approved',
      '',
      '## Output Format',
      'Provide a brief review summary. Start with either:',
      '- "APPROVED" if the code is good',
      '- "FIXED" if you made corrections',
      '',
      'Then list what you found and any changes you made.',
    ].join('\n');

    // Kod inceleme için araçlar
    const tracker = { filesCreated: [] as string[], filesModified: [] as string[], logs: [] as string[] };
    const tools = createAgentTools(
      { projectId, agentId: reviewer.id, taskId: task.id, repoPath: project.repoPath },
      tracker,
    );

    try {
      // Fallback zinciriyle model seç; birincil model başarısız olursa sıradakine geç
      const { text, usage } = await getAIModelWithFallback(async (model, { modelName, providerType }) => {
        const result = await generateText({
          model,
          stopWhen: stepCountIs(15),
          system: reviewer.systemPrompt || this.defaultSystemPrompt(reviewer),
          prompt: reviewPrompt,
          tools,
          maxRetries: 4,
        });

        termLog(result.text.slice(0, 1500));

        // Maliyet takibi — fallback zinciri tarafından seçilen model
        if (result.usage) {
          const inputTokens = result.usage.inputTokens ?? 0;
          const outputTokens = result.usage.outputTokens ?? 0;
          const costUsd = calculateCost(modelName, inputTokens, outputTokens);
          recordTokenUsage({
            projectId,
            taskId: task.id,
            agentId: reviewer.id,
            model: modelName,
            provider: providerType,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd,
          });
          termLog(`[review-cost] ${modelName}: ${inputTokens + outputTokens} tokens ($${costUsd.toFixed(4)})`);
        }

        return result;
      });

      const status = text.toUpperCase().includes('APPROVED') ? 'APPROVED' : 'FIXED';
      termLog(`[review] Sonuc: ${status}`);
      agentRuntime.markVirtualStopped(projectId, reviewer.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      termLog(`[review] Hata: ${msg.slice(0, 200)}`);
      agentRuntime.markVirtualStopped(projectId, reviewer.id);
    }
  }

  /**
   * After a task in `phaseId` has been settled, check for tasks whose
   * dependencies are now satisfied and dispatch them in parallel.
   */
  private async dispatchReadyTasks(projectId: string, phaseId: string): Promise<void> {
    const ready = taskEngine.getReadyTasks(phaseId);
    if (ready.length === 0) return;

    // Execute tasks sequentially to avoid rate-limit issues with AI providers
    for (const task of ready) {
      await this.executeTask(projectId, task);
    }
  }

  // -------------------------------------------------------------------------
  // Output parsing
  // -------------------------------------------------------------------------

  /**
   * Parse the raw text output from Claude Code (or local AI) and extract
   * structured information about files created/modified and test results.
   */
  private parseTaskOutput(output: string): TaskOutput {
    const filesCreated: string[] = [];
    const filesModified: string[] = [];
    const logs: string[] = [];
    let testResults: TaskOutput['testResults'];

    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Files created: lines starting with "+ " or "Created: "
      if (trimmed.startsWith('+ ') || /^created:\s+/i.test(trimmed)) {
        const filePath = trimmed.replace(/^\+\s+|^created:\s+/i, '').trim();
        if (filePath) filesCreated.push(filePath);
        continue;
      }

      // Files modified: lines starting with "~ " or "Modified: "
      if (trimmed.startsWith('~ ') || /^modified:\s+/i.test(trimmed)) {
        const filePath = trimmed.replace(/^~\s+|^modified:\s+/i, '').trim();
        if (filePath) filesModified.push(filePath);
        continue;
      }

      // Test results: "TESTS: passed=N failed=N total=N"
      const testMatch = trimmed.match(
        /TESTS?:\s*passed=(\d+)\s+failed=(\d+)\s+total=(\d+)/i,
      );
      if (testMatch) {
        testResults = {
          passed: parseInt(testMatch[1], 10),
          failed: parseInt(testMatch[2], 10),
          total: parseInt(testMatch[3], 10),
        };
        continue;
      }

      // Capture meaningful log lines (skip blank lines)
      if (trimmed.length > 0) {
        logs.push(trimmed);
      }
    }

    // Limit logs to last 100 lines to avoid bloat
    const trimmedLogs = logs.slice(-100);

    return { filesCreated, filesModified, testResults, logs: trimmedLogs };
  }

  // -------------------------------------------------------------------------
  // Agent resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve an agent config from an assignment string that may be:
   *   - An exact agent UUID (from listAgentConfigs)
   *   - A role name (e.g. "backend", "frontend")
   *
   * For a project, we first look at project-scoped agents; then we look at
   * all agent configs globally.
   */
  private resolveAgent(projectId: string, assignment: string): AgentConfig | undefined {
    if (!assignment) return undefined;

    // 1. Try project-scoped agents first (by ID, role, or name)
    const projectAgents = listProjectAgents(projectId);
    const pById = projectAgents.find((a) => a.id === assignment);
    if (pById) return pById as unknown as AgentConfig;

    const pByRole = projectAgents.find(
      (a) => a.role.toLowerCase() === assignment.toLowerCase(),
    );
    if (pByRole) return pByRole as unknown as AgentConfig;

    const pByName = projectAgents.find(
      (a) => a.name.toLowerCase() === assignment.toLowerCase(),
    );
    if (pByName) return pByName as unknown as AgentConfig;

    // 2. Fallback to global agent configs
    const byId = getAgentConfig(assignment);
    if (byId) return byId;

    const all = listAgentConfigs();
    const byRole = all.find(
      (a) => a.role.toLowerCase() === assignment.toLowerCase(),
    );
    if (byRole) return byRole;

    const byName = all.find(
      (a) => a.name.toLowerCase() === assignment.toLowerCase(),
    );
    return byName;
  }

  // -------------------------------------------------------------------------
  // Default system prompt fallback
  // -------------------------------------------------------------------------

  private defaultSystemPrompt(agent: { name: string; role: string; skills: string[] }): string {
    return `You are ${agent.name}, a ${agent.role} agent in an AI Dev Studio.
Your skills include: ${agent.skills.join(', ') || 'general software development'}.
Complete the task described in the user message. Be precise and produce working code.`;
  }

  // -------------------------------------------------------------------------
  // Execution status
  // -------------------------------------------------------------------------

  /**
   * Return a snapshot of currently running tasks and active containers for a
   * project. Used by the GET /projects/:id/execution/status endpoint.
   */
  getExecutionStatus(projectId: string) {
    const runtimes = containerManager.getAllRuntimes(projectId);
    const progress = taskEngine.getProgress(projectId);

    return {
      projectId,
      runtimes: runtimes.map((r) => ({
        agentId: r.agentId,
        status: r.status,
        currentTaskId: r.currentTaskId,
        containerId: r.containerId?.slice(0, 12),
        branch: r.branch,
        startedAt: r.startedAt,
      })),
      progress,
    };
  }
}

export const executionEngine = new ExecutionEngine();

// Uygulama başlangıcında yarıda kalmış görevleri kurtart
executionEngine.recoverStuckTasks().catch((err) => {
  console.error('[execution-engine] Startup recovery failed:', err);
});
