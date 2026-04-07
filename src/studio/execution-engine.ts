// ---------------------------------------------------------------------------
// AI Dev Studio — Execution Engine
// Orchestrates task execution: dispatches tasks to agents running in Docker
// containers (or falls back to local AI SDK execution when Docker unavailable).
// ---------------------------------------------------------------------------

import { generateText, stepCountIs } from 'ai';
import { taskEngine } from './task-engine.js';
import { containerManager } from './container-manager.js';
import { eventBus } from './event-bus.js';
import { getAIModelInfo, calculateCost } from './ai-provider-factory.js';
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
} from './db.js';
import { createAgentTools } from './agent-tools.js';
import { agentRuntime } from './agent-runtime.js';
import type { Task, Project, AgentConfig, TaskOutput } from './types.js';
import { runIntegrationTest, runApp } from './task-runners.js';

// ---------------------------------------------------------------------------
// Timeout configuration
// ---------------------------------------------------------------------------

/** Default task timeout: 5 minutes (in milliseconds) */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Wraps a promise with a timeout using AbortController.
 * If the promise does not resolve within `timeoutMs`, the AbortController is
 * aborted and a TaskTimeoutError is thrown.
 *
 * @param operation - Factory that receives an AbortSignal and returns the promise to race.
 * @param timeoutMs - Maximum allowed duration in milliseconds.
 * @returns The resolved value of the operation promise.
 */
function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new TaskTimeoutError(timeoutMs));
    }, timeoutMs);

    // If the operation resolves/rejects first, clear the timer to avoid leaks
    controller.signal.addEventListener('abort', () => clearTimeout(timer));
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

    const prompt = this.buildTaskPrompt(task, project);

    // Resolve the effective timeout: agent-level config takes priority over the default
    const timeoutMs = agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS;

    try {
      let output: TaskOutput;

      // Try Docker first, fallback to local if unavailable or fails
      let usedDocker = false;
      const dockerAvailable = await containerManager.isDockerAvailable();

      if (dockerAvailable && agent.cliTool === 'claude-code') {
        try {
          output = await withTimeout(
            (signal) => this.executeInContainer(projectId, agent, project, task, prompt, signal),
            timeoutMs,
          );
          usedDocker = true;
        } catch (dockerErr) {
          // If it is a timeout error, propagate it directly — do not fall back to local
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
          );
        }
      } else {
        output = await withTimeout(
          (signal) => this.executeLocally(projectId, agent, task, prompt, signal),
          timeoutMs,
        );
      }

      // Suppress unused variable warning — usedDocker reserved for future telemetry
      void usedDocker;

      taskEngine.completeTask(task.id, output);
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

    const { model, modelName, providerType } = getAIModelInfo();

    // Pass the AbortSignal to generateText so the AI SDK can honour cancellation
    const generatePromise = generateText({
      model,
      stopWhen: stepCountIs(20),
      system: agent.systemPrompt || this.defaultSystemPrompt(agent),
      prompt,
      tools,
      abortSignal: signal,
      maxRetries: 8,
    });

    // Additionally race against the signal in case the SDK does not propagate it
    const { text, usage } = await new Promise<Awaited<typeof generatePromise>>((resolve, reject) => {
      const onAbort = () => reject(new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS));
      signal.addEventListener('abort', onAbort, { once: true });
      generatePromise
        .then((result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((err) => {
          signal.removeEventListener('abort', onAbort);
          // If the SDK itself throws an abort error, translate it to TaskTimeoutError
          if (
            err instanceof Error &&
            (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
          ) {
            reject(new TaskTimeoutError(agent.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS));
          } else {
            reject(err);
          }
        });
    });

    termLog(text.slice(0, 2000));
    termLog(`[${agent.name}] Task tamamlandı: ${task.title}`);
    agentRuntime.markVirtualStopped(projectId, agent.id);

    // Record token usage for cost tracking
    if (usage) {
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const totalTokens = inputTokens + outputTokens;
      const costUsd = calculateCost(modelName, inputTokens, outputTokens);
      recordTokenUsage({
        projectId,
        taskId: task.id,
        agentId: agent.id,
        model: modelName,
        provider: providerType,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
      });
      termLog(`[cost] ${modelName}: ${totalTokens} tokens ($${costUsd.toFixed(4)})`);
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
  buildTaskPrompt(task: Task, project: Project): string {
    const techStack =
      project.techStack.length > 0 ? project.techStack.join(', ') : 'Not specified';

    const lines: string[] = [
      `# Task: ${task.title}`,
      '',
      `## Project`,
      `- Name: ${project.name}`,
      `- Tech Stack: ${techStack}`,
      `- Description: ${project.description || 'No description provided'}`,
      '',
      `## Task Details`,
      `- ID: ${task.id}`,
      `- Complexity: ${task.complexity}`,
      `- Branch: ${task.branch || 'main'}`,
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
      `## Output`,
      'After completing all tool calls, provide a brief summary of what you did.',
    ];

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
        output = await runApp(projectId, project.repoPath, termLog);
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

    // Try direct ID lookup first
    const byId = getAgentConfig(assignment);
    if (byId) return byId;

    // Try matching by role across all agents
    const all = listAgentConfigs();
    const byRole = all.find(
      (a) => a.role.toLowerCase() === assignment.toLowerCase(),
    );
    if (byRole) return byRole;

    // Try matching by name (case-insensitive)
    const byName = all.find(
      (a) => a.name.toLowerCase() === assignment.toLowerCase(),
    );
    return byName;
  }

  // -------------------------------------------------------------------------
  // Default system prompt fallback
  // -------------------------------------------------------------------------

  private defaultSystemPrompt(agent: AgentConfig): string {
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
