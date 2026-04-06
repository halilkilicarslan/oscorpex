// ---------------------------------------------------------------------------
// AI Dev Studio — Execution Engine
// Orchestrates task execution: dispatches tasks to agents running in Docker
// containers (or falls back to local AI SDK execution when Docker unavailable).
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { taskEngine } from './task-engine.js';
import { containerManager } from './container-manager.js';
import { eventBus } from './event-bus.js';
import { getAIModel } from './ai-provider-factory.js';
import {
  getProject,
  listAgentConfigs,
  getAgentConfig,
} from './db.js';
import type { Task, Project, AgentConfig, TaskOutput } from './types.js';

// ---------------------------------------------------------------------------
// Execution Engine
// ---------------------------------------------------------------------------

class ExecutionEngine {
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

    // beginExecution starts the first phase and returns the initial ready tasks
    const readyTasks = taskEngine.beginExecution(projectId);

    eventBus.emit({
      projectId,
      type: 'execution:started',
      payload: { readyTaskCount: readyTasks.length },
    });

    // Dispatch all initially ready tasks in parallel
    await Promise.allSettled(
      readyTasks.map((task) => this.executeTask(projectId, task)),
    );
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

    try {
      const dockerAvailable = await containerManager.isDockerAvailable();

      let output: TaskOutput;

      if (dockerAvailable && agent.cliTool === 'claude-code') {
        output = await this.executeInContainer(projectId, agent, project, task, prompt);
      } else {
        output = await this.executeLocally(projectId, agent, task, prompt);
      }

      taskEngine.completeTask(task.id, output);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

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
    await this.dispatchReadyTasks(projectId, task.phaseId);
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
  ): Promise<TaskOutput> {
    // Ensure a container is alive for this agent; create one if needed
    const existing = containerManager.getRuntime(projectId, agent.id);
    if (!existing?.containerId) {
      await containerManager.createContainer(agent, project);
    }

    const { exitCode, output } = await containerManager.runClaudeCode(
      projectId,
      agent.id,
      prompt,
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
  ): Promise<TaskOutput> {
    eventBus.emit({
      projectId,
      type: 'agent:output',
      agentId: agent.id,
      taskId: task.id,
      payload: { output: '[local execution] Docker not available — using AI SDK directly' },
    });

    const model = getAIModel();

    const { text } = await generateText({
      model,
      system: agent.systemPrompt || this.defaultSystemPrompt(agent),
      prompt,
    });

    eventBus.emit({
      projectId,
      type: 'agent:output',
      agentId: agent.id,
      taskId: task.id,
      payload: { output: text.slice(0, 2000) },
    });

    return this.parseTaskOutput(text);
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
      `## Git Branch`,
      `Work on branch \`${task.branch || 'main'}\`. If the branch does not exist, create it from main/master.`,
      `Run: git checkout -b ${task.branch || 'main'} 2>/dev/null || git checkout ${task.branch || 'main'}`,
      '',
      `## Deliverables`,
      '- Create or modify the necessary files to complete this task',
      '- Run any relevant tests to verify your implementation',
      '- Report which files you created or modified',
      '',
      `## Output Format`,
      'After completing the task, output a summary that includes:',
      '- FILES CREATED: list each file path on a separate line prefixed with "  + "',
      '- FILES MODIFIED: list each file path on a separate line prefixed with "  ~ "',
      '- TEST RESULTS: if tests were run, output "TESTS: passed=N failed=N total=N"',
    ];

    return lines.join('\n');
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

    await Promise.allSettled(
      ready.map((task) => this.executeTask(projectId, task)),
    );
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
