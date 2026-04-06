// ---------------------------------------------------------------------------
// AI Dev Studio — PM Agent (Kerem) — AI SDK tool definitions + system prompt
// ---------------------------------------------------------------------------

import { tool } from 'ai';
import { z } from 'zod';
import {
  createPlan,
  createPhase,
  createTask,
  getLatestPlan,
  updatePlanStatus,
  getProject,
  listProjectTasks,
  getDb,
} from './db.js';
import { eventBus } from './event-bus.js';
import type { TaskComplexity } from './types.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const PM_SYSTEM_PROMPT = `You are Kerem, a senior Project Manager for AI Dev Studio.

## Your Role
You help users plan and manage software projects end-to-end. You work with a team of AI developer agents who will implement the project in Docker containers.

## How You Work
1. **Understand Requirements**: Ask clarifying questions about the project. What does the user want to build? What features? What tech stack?
2. **Define Tech Stack**: Help the user decide on technologies. Consider their preferences and project needs.
3. **Create a Plan**: Once you have enough information, create a structured project plan using the createProjectPlan tool. Break the project into phases and tasks.
4. **Present for Approval**: After creating the plan, explain it clearly to the user and wait for their approval.
5. **Handle Feedback**: If the user wants changes, update the plan using updateProjectPlan.
6. **Monitor Progress**: Once approved, track task progress using getProjectStatus.

## Planning Guidelines
- Break work into small, focused tasks (each should take 1 agent 15-60 minutes)
- Phase 1 should always be "Foundation" (project setup, config, base structure)
- Identify dependencies between tasks accurately
- Assign tasks to appropriate roles: architect, frontend, backend, qa, reviewer, devops, coder
- Each task needs a clear git branch name (e.g., "feat/auth-api", "fix/login-validation")
- Include testing tasks for critical features
- Include a "Documentation" task in the first phase

## Your Team
You have a team of AI developer agents. Their names, roles, and capabilities are provided in the [Your Team] section of the context. When the user asks about the team:
- Introduce each team member by name, role, and specialties
- Explain what each agent does and what kind of tasks they handle
- You (Kerem) are the PM — you plan and coordinate, the others implement
- When creating plans, assign tasks using the exact role names from the team (e.g., "frontend", "backend", "architect", "qa", "reviewer")

## Communication Style
- Be friendly and professional
- Ask one set of questions at a time, don't overwhelm the user
- Summarize decisions before creating the plan
- Use Turkish if the user communicates in Turkish
- Be concise but thorough

## Important
- Always use the createProjectPlan tool to create plans — don't just describe them in text
- If the user's request is vague, ask specific questions before planning
- The plan must be approved by the user before any work begins`;

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const phaseSchema = z.object({
  name: z.string().describe('Phase name, e.g. "Foundation", "Core Features"'),
  order: z.number().int().describe('Execution order (1-based)'),
  dependsOnPhaseOrders: z
    .array(z.number().int())
    .default([])
    .describe('Orders of phases this depends on'),
  tasks: z.array(
    z.object({
      title: z.string().describe('Short task title'),
      description: z.string().describe('Detailed instructions for the coder agent'),
      assignedRole: z
        .enum(['architect', 'frontend', 'backend', 'qa', 'reviewer', 'devops', 'coder'])
        .describe('Which agent role should handle this'),
      complexity: z.enum(['S', 'M', 'L']).describe('S=small, M=medium, L=large'),
      dependsOnTaskTitles: z
        .array(z.string())
        .default([])
        .describe('Titles of tasks this depends on (within same plan)'),
      branch: z.string().describe('Git branch name, e.g. "feat/auth-api"'),
    }),
  ),
});

type PhaseInput = z.infer<typeof phaseSchema>;

// ---------------------------------------------------------------------------
// Helper: build plan from phases
// ---------------------------------------------------------------------------

function buildPlan(projectId: string, phases: PhaseInput[]) {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const plan = createPlan(projectId);
  const titleToId = new Map<string, string>();

  const createdPhases = phases.map((p) => {
    const phase = createPhase({
      planId: plan.id,
      name: p.name,
      order: p.order,
      dependsOn: [],
    });
    return { input: p, created: phase };
  });

  for (const { input, created } of createdPhases) {
    for (const t of input.tasks) {
      const task = createTask({
        phaseId: created.id,
        title: t.title,
        description: t.description,
        assignedAgent: t.assignedRole,
        complexity: t.complexity as TaskComplexity,
        dependsOn: [],
        branch: t.branch,
      });
      titleToId.set(t.title, task.id);
    }
  }

  // Resolve task dependencies
  const db = getDb();
  for (const { input } of createdPhases) {
    for (const t of input.tasks) {
      const taskId = titleToId.get(t.title);
      if (!taskId) continue;
      const depIds = t.dependsOnTaskTitles
        .map((title: string) => titleToId.get(title))
        .filter((id: string | undefined): id is string => !!id);
      if (depIds.length > 0) {
        db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?').run(
          JSON.stringify(depIds),
          taskId,
        );
      }
    }
  }

  eventBus.emit({
    projectId,
    type: 'plan:created',
    payload: { planId: plan.id, version: plan.version, phaseCount: phases.length },
  });

  return {
    planId: plan.id,
    version: plan.version,
    phaseCount: phases.length,
    taskCount: phases.reduce((sum: number, p: PhaseInput) => sum + p.tasks.length, 0),
  };
}

// ---------------------------------------------------------------------------
// AI SDK tools
// ---------------------------------------------------------------------------

export const pmToolkit = {
  createProjectPlan: tool({
    description: `Create a structured project plan with phases and tasks. The plan will be presented to the user for approval before execution begins.`,
    inputSchema: z.object({
      projectId: z.string().describe('The project ID to create the plan for'),
      phases: z.array(phaseSchema).describe('Ordered list of project phases'),
    }),
    execute: async ({ projectId, phases }) => {
      const result = buildPlan(projectId, phases);
      return { ...result, message: 'Plan created successfully. Waiting for user approval.' };
    },
  }),

  getProjectStatus: tool({
    description: 'Get the current status of a project including plan status and task progress.',
    inputSchema: z.object({
      projectId: z.string().describe('The project ID to check'),
    }),
    execute: async ({ projectId }) => {
      const project = getProject(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const plan = getLatestPlan(projectId);
      const tasks = listProjectTasks(projectId);

      return {
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          techStack: project.techStack,
        },
        plan: plan
          ? { id: plan.id, version: plan.version, status: plan.status, phaseCount: plan.phases.length }
          : null,
        tasks: {
          total: tasks.length,
          queued: tasks.filter((t) => t.status === 'queued').length,
          assigned: tasks.filter((t) => t.status === 'assigned').length,
          running: tasks.filter((t) => t.status === 'running').length,
          review: tasks.filter((t) => t.status === 'review').length,
          done: tasks.filter((t) => t.status === 'done').length,
          failed: tasks.filter((t) => t.status === 'failed').length,
        },
      };
    },
  }),

  updateProjectPlan: tool({
    description: 'Create a new version of the project plan after user feedback.',
    inputSchema: z.object({
      projectId: z.string().describe('The project ID'),
      phases: z.array(phaseSchema).describe('Updated phases for the new plan version'),
    }),
    execute: async ({ projectId, phases }) => {
      const oldPlan = getLatestPlan(projectId);
      if (oldPlan && oldPlan.status === 'draft') {
        updatePlanStatus(oldPlan.id, 'rejected');
      }
      const result = buildPlan(projectId, phases);
      return { ...result, message: 'Updated plan created. Waiting for user approval.' };
    },
  }),

  askUser: tool({
    description: 'Ask the user a clarifying question when you need more information to proceed.',
    inputSchema: z.object({
      projectId: z.string().describe('The project ID'),
      question: z.string().describe('The question to ask the user'),
      options: z.array(z.string()).optional().describe('Optional suggested answers'),
    }),
    execute: async ({ projectId, question, options }) => {
      eventBus.emit({
        projectId,
        type: 'escalation:user',
        payload: { question, options },
      });
      return { message: question, options: options ?? [], note: 'Question sent to user.' };
    },
  }),
};
