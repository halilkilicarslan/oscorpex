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
  getProjectAgentsWithSkills,
} from './db.js';
import { eventBus } from './event-bus.js';
import type { TaskComplexity } from './types.js';
import { gitManager } from './git-manager.js';

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

## Special Task Types
In addition to normal AI coding tasks (taskType: "ai"), you can use these special task types:
- **integration-test**: Automated smoke test that starts the backend/frontend, runs HTTP health checks and API tests, then shuts down. Use this as a final verification phase after all coding is done. Assign to role "qa" with branch "test/integration".
- **run-app**: Starts the application (backend + frontend) and keeps it running so the user can interact with it. Use this as the very last phase. Assign to role "devops" with branch "main".

**Recommended plan structure:**
1. Foundation phase (setup, config)
2. Core feature phases (coding tasks)
3. Integration Test phase (taskType: "integration-test") — depends on all coding phases
4. Run Application phase (taskType: "run-app") — depends on integration test phase

## Your Team & Agent Skills
You have a team of AI developer agents. Each agent has specific skills and specializations:

| Role       | Core Skills & Specializations |
|------------|-------------------------------|
| pm         | project management, planning, coordination, team leadership |
| designer   | UI/UX design, wireframes, prototypes, design systems, user research |
| architect  | system design, API design, database schema, infrastructure planning |
| frontend   | React, TypeScript, CSS, UI components, responsive design, accessibility |
| backend    | API development, database queries, server logic, authentication, REST |
| coder      | general coding, implementation, algorithms, full-stack tasks |
| qa         | testing, test automation, e2e tests, quality assurance, bug reporting |
| reviewer   | code review, best practices, security review, standards enforcement |
| devops     | CI/CD, deployment, Docker, Kubernetes, infrastructure, monitoring |

When assigning tasks:
- Use **smartAssignTask** to get skill-match recommendations before assigning to a specific role
- Match task requirements to agent skills for best results
- Prefer specialists for domain-specific work (e.g., "build a React form" → frontend, not coder)
- Use coder only when no specialist role fits or for small utility tasks

## Your Team Context
Their names, roles, and capabilities are provided in the [Your Team] section of the context. When the user asks about the team:
- Introduce each team member by name, role, and specialties
- Explain what each agent does and what kind of tasks they handle
- You (Kerem) are the PM — you plan and coordinate, the others implement
- When creating plans, assign tasks using the exact role names from the team (e.g., "frontend", "backend", "architect", "qa", "reviewer")

## Smart Assignment
When the user asks "who should handle X?" or you need to assign a task:
1. Use the **smartAssignTask** tool with the task description
2. Present the recommendation with confidence score and reasoning
3. Explain which skills matched and why that agent is the best fit
4. The recommendation is advisory — the user can override your choice

## Communication Style
- Be friendly and professional
- Ask one set of questions at a time, don't overwhelm the user
- Summarize decisions before creating the plan
- Use Turkish if the user communicates in Turkish
- Be concise but thorough
- When showing skill match results, format them clearly: agent name, confidence %, key matching skills

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
      taskType: z.enum(['ai', 'integration-test', 'run-app']).default('ai').describe('Task type: "ai" for normal AI coding, "integration-test" for automated smoke tests, "run-app" to start the application'),
    }),
  ),
});

type PhaseInput = z.infer<typeof phaseSchema>;

// ---------------------------------------------------------------------------
// Helper: build plan from phases
// ---------------------------------------------------------------------------

async function buildPlan(projectId: string, phases: PhaseInput[]) {
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
        taskType: t.taskType as any,
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

  // Export plan as markdown to docs/PLAN.md
  if (project.repoPath) {
    try {
      const lines: string[] = [`# Project Plan — ${project.name}`, '', `**Version:** ${plan.version}`, ''];
      for (const { input } of createdPhases) {
        lines.push(`## Phase ${input.order}: ${input.name}`, '');
        for (const t of input.tasks) {
          const deps = t.dependsOnTaskTitles.length > 0 ? ` (depends on: ${t.dependsOnTaskTitles.join(', ')})` : '';
          lines.push(`- **[${t.complexity}] ${t.title}** — ${t.assignedRole}${deps}`);
          if (t.description) lines.push(`  ${t.description}`);
        }
        lines.push('');
      }
      await gitManager.writeFileContent(project.repoPath, 'docs/PLAN.md', lines.join('\n'));
    } catch {
      // Non-critical: don't fail plan creation if docs export fails
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
      const result = await buildPlan(projectId, phases);
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

  smartAssignTask: tool({
    description: `Analyze a task description and recommend the best agent(s) based on skill matching.
Returns ranked candidates with confidence scores and reasoning so you can explain the assignment decision to the user.
Use this whenever the user asks "who should do X?" or before assigning tasks in a plan.`,
    inputSchema: z.object({
      projectId: z.string().describe('The project ID to look up team members'),
      taskTitle: z.string().describe('Short title of the task'),
      taskDescription: z.string().describe('Detailed description of what needs to be done'),
      requiredSkills: z
        .array(z.string())
        .optional()
        .describe('Specific skills or technologies needed (e.g. ["react", "typescript", "testing"])'),
    }),
    execute: async ({ projectId, taskTitle, taskDescription, requiredSkills }) => {
      // Proje agentlarını beceri listesiyle birlikte al; yoksa varsayılan rol becerilerini kullan
      let candidates = getProjectAgentsWithSkills(projectId);

      // Proje agentı yoksa varsayılan rol→beceri haritasını kullan
      const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
        pm:        ['project management', 'planning', 'coordination', 'team leadership'],
        designer:  ['ui design', 'ux design', 'wireframes', 'prototypes', 'design systems', 'user research', 'figma', 'accessibility'],
        architect: ['system design', 'api design', 'database schema', 'infrastructure', 'architecture', 'documentation'],
        frontend:  ['react', 'typescript', 'css', 'ui components', 'responsive design', 'accessibility', 'tailwindcss', 'javascript'],
        backend:   ['api development', 'database', 'server logic', 'authentication', 'rest api', 'node.js', 'postgresql', 'sql'],
        coder:     ['general coding', 'implementation', 'algorithms', 'full-stack', 'typescript', 'javascript', 'python'],
        qa:        ['testing', 'test automation', 'e2e tests', 'quality assurance', 'bug reporting', 'unit tests', 'integration tests'],
        reviewer:  ['code review', 'best practices', 'security review', 'standards', 'performance', 'refactoring'],
        devops:    ['ci/cd', 'deployment', 'docker', 'kubernetes', 'infrastructure', 'monitoring', 'aws', 'automation'],
      };

      if (candidates.length === 0) {
        // Proje henüz agent atanmamış — genel rol önerileri yap
        candidates = Object.entries(DEFAULT_ROLE_SKILLS).map(([role, skills]) => ({
          id: role,
          name: role.charAt(0).toUpperCase() + role.slice(1),
          role,
          skills,
        }));
      }

      // PM rolünü atamadan çıkar (PM koordinatör, uygulayıcı değil)
      const assignableCandidates = candidates.filter((c) => c.role !== 'pm');

      // Görev metni ve gereken becerilerden anahtar kelimeler çıkar
      const taskText = `${taskTitle} ${taskDescription}`.toLowerCase();
      const explicitSkills = (requiredSkills ?? []).map((s) => s.toLowerCase());

      // Her aday için puanlama: beceri eşleşmesi + rol uyumu
      const scored = assignableCandidates.map((agent) => {
        const agentSkills = agent.skills.map((s: string) => s.toLowerCase());

        // Kümülatif eşleşme skoru
        let score = 0;
        const matchedSkills: string[] = [];
        const matchedReasons: string[] = [];

        // 1. Açıkça belirtilen gereken becerilerle eşleşme (yüksek ağırlık)
        for (const skill of explicitSkills) {
          for (const agentSkill of agentSkills) {
            if (agentSkill.includes(skill) || skill.includes(agentSkill)) {
              score += 25;
              if (!matchedSkills.includes(agentSkill)) {
                matchedSkills.push(agentSkill);
                matchedReasons.push(`Explicit skill match: "${skill}" ↔ "${agentSkill}"`);
              }
              break;
            }
          }
        }

        // 2. Görev metni ile beceri eşleşmesi (orta ağırlık)
        for (const agentSkill of agentSkills) {
          if (taskText.includes(agentSkill)) {
            score += 15;
            if (!matchedSkills.includes(agentSkill)) {
              matchedSkills.push(agentSkill);
              matchedReasons.push(`Task mentions "${agentSkill}"`);
            }
          }
        }

        // 3. Rol anahtar kelimesi görev metninde geçiyor mu (düşük ağırlık)
        if (taskText.includes(agent.role)) {
          score += 10;
          matchedReasons.push(`Task references role "${agent.role}"`);
        }

        // 4. Yaygın görev kategorisi → rol uyumu kural tabanlı bonus
        const ROLE_KEYWORD_BONUS: Record<string, string[]> = {
          frontend:  ['ui', 'component', 'page', 'view', 'form', 'modal', 'button', 'layout', 'css', 'style', 'react', 'frontend', 'client'],
          backend:   ['api', 'endpoint', 'route', 'controller', 'service', 'model', 'database', 'migration', 'auth', 'server', 'backend'],
          architect: ['design', 'schema', 'architecture', 'structure', 'diagram', 'contract', 'spec', 'interface'],
          qa:        ['test', 'testing', 'spec', 'coverage', 'qa', 'quality', 'e2e', 'unit', 'integration', 'bug'],
          reviewer:  ['review', 'audit', 'check', 'lint', 'refactor', 'standard', 'best practice'],
          devops:    ['deploy', 'pipeline', 'ci', 'cd', 'docker', 'container', 'infra', 'monitor', 'build'],
          designer:  ['design', 'wireframe', 'mockup', 'ux', 'prototype', 'figma', 'style guide', 'color', 'font'],
          coder:     ['algorithm', 'utility', 'helper', 'script', 'general', 'implement'],
        };

        const bonusKeywords = ROLE_KEYWORD_BONUS[agent.role] ?? [];
        for (const kw of bonusKeywords) {
          if (taskText.includes(kw)) {
            score += 8;
            matchedReasons.push(`Keyword "${kw}" suggests ${agent.role} role`);
            break; // Rol başına en fazla bir keyword bonusu
          }
        }

        // Güven skoru 0-100 aralığına normalize et
        const maxPossibleScore = (explicitSkills.length * 25) + (agentSkills.length * 15) + 10 + 8;
        const confidence = Math.min(100, Math.round((score / Math.max(maxPossibleScore, 30)) * 100));

        return {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          confidence,
          matchedSkills,
          reasoning: matchedReasons.slice(0, 4), // En önemli 4 nedeni göster
          score,
        };
      });

      // Puana göre sırala, en iyi 3 adayı döndür
      const topCandidates = scored
        .filter((c) => c.score > 0 || assignableCandidates.length <= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      // Skor sıfır olan ve alternatif yoksa en azından bir öneri sun
      if (topCandidates.length === 0 && assignableCandidates.length > 0) {
        const fallback = scored.sort((a, b) => b.score - a.score)[0];
        topCandidates.push(fallback);
      }

      const best = topCandidates[0];

      return {
        taskTitle,
        recommendation: best
          ? {
              agentId: best.agentId,
              agentName: best.agentName,
              role: best.role,
              confidence: best.confidence,
              matchedSkills: best.matchedSkills,
              reasoning: best.reasoning,
            }
          : null,
        alternatives: topCandidates.slice(1).map((c) => ({
          agentId: c.agentId,
          agentName: c.agentName,
          role: c.role,
          confidence: c.confidence,
          matchedSkills: c.matchedSkills,
        })),
        note: best
          ? `Best match: ${best.agentName} (${best.role}) with ${best.confidence}% confidence.`
          : 'No strong skill match found. Consider assigning to a coder or architect.',
      };
    },
  }),
};
