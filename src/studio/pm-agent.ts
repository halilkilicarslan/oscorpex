// ---------------------------------------------------------------------------
// AI Dev Studio — AI Planner — AI SDK tool definitions + system prompt
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
  getProjectAgentsWithSkills,
  getDefaultProvider,
  listProjectAgents,
  updateTask,
} from './db.js';
import { execute, queryOne } from './pg.js';
import { eventBus } from './event-bus.js';
import type { TaskComplexity } from './types.js';
import { gitManager } from './git-manager.js';

// ---------------------------------------------------------------------------
// Maliyet Tahmini — Model fiyat tablosu (USD / 1M token)
// ---------------------------------------------------------------------------

/** Model ismine göre input/output fiyatlarını döndürür (USD per 1M token). */
function getModelPricing(modelName: string): { inputPer1M: number; outputPer1M: number } {
  const m = modelName.toLowerCase();

  // Claude Sonnet ailesi
  if (m.includes('claude') && m.includes('sonnet')) {
    return { inputPer1M: 3.0, outputPer1M: 15.0 };
  }
  // Claude Opus ailesi
  if (m.includes('claude') && m.includes('opus')) {
    return { inputPer1M: 15.0, outputPer1M: 75.0 };
  }
  // Claude Haiku ailesi
  if (m.includes('claude') && m.includes('haiku')) {
    return { inputPer1M: 0.25, outputPer1M: 1.25 };
  }
  // GPT-4o
  if (m.includes('gpt-4o')) {
    return { inputPer1M: 2.5, outputPer1M: 10.0 };
  }
  // GPT-4 Turbo
  if (m.includes('gpt-4-turbo') || m.includes('gpt-4-1106') || m.includes('gpt-4-0125')) {
    return { inputPer1M: 10.0, outputPer1M: 30.0 };
  }
  // GPT-3.5 Turbo
  if (m.includes('gpt-3.5')) {
    return { inputPer1M: 0.5, outputPer1M: 1.5 };
  }
  // Gemini Pro / Flash
  if (m.includes('gemini-1.5-pro')) {
    return { inputPer1M: 1.25, outputPer1M: 5.0 };
  }
  if (m.includes('gemini')) {
    return { inputPer1M: 0.075, outputPer1M: 0.3 };
  }

  // Varsayılan: claude-sonnet fiyatı
  return { inputPer1M: 3.0, outputPer1M: 15.0 };
}

/** Her task için varsayılan token tahminleri. */
const AVG_INPUT_TOKENS_PER_TASK = 2000;
const AVG_OUTPUT_TOKENS_PER_TASK = 1000;

export interface PlanCostEstimate {
  estimatedTokens: number;
  estimatedCost: number;
  currency: 'USD';
  taskCount: number;
  avgTokensPerTask: number;
  model: string;
  breakdown: { inputTokens: number; outputTokens: number; inputCost: number; outputCost: number };
}

/**
 * Bir plan için tahmini maliyet hesaplar.
 * Task başına ortalama 2000 input + 1000 output token varsayar.
 * Model fiyatı: default provider'ın model ayarından alınır.
 */
export async function estimatePlanCost(projectId: string, planId: string): Promise<PlanCostEstimate> {
  // Plan'a ait task sayısını hesapla
  const taskCountRow = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
     FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id
     JOIN project_plans pp ON pp.id = ph.plan_id
     WHERE pp.id = $1 AND pp.project_id = $2`,
    [planId, projectId],
  );

  const taskCount = taskCountRow ? parseInt(taskCountRow.cnt, 10) : 0;

  // Default provider'dan model bilgisi al
  const defaultProvider = await getDefaultProvider();
  const model = defaultProvider?.model || 'claude-sonnet-4-6';
  const pricing = getModelPricing(model);

  const totalInputTokens = taskCount * AVG_INPUT_TOKENS_PER_TASK;
  const totalOutputTokens = taskCount * AVG_OUTPUT_TOKENS_PER_TASK;
  const totalTokens = totalInputTokens + totalOutputTokens;

  const inputCost = (totalInputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (totalOutputTokens / 1_000_000) * pricing.outputPer1M;
  const totalCost = inputCost + outputCost;

  return {
    estimatedTokens: totalTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000, // 4 ondalık basamak
    currency: 'USD',
    taskCount,
    avgTokensPerTask: AVG_INPUT_TOKENS_PER_TASK + AVG_OUTPUT_TOKENS_PER_TASK,
    model,
    breakdown: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
    },
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const PM_SYSTEM_PROMPT = `You are the AI Planner, a senior Project Manager for AI Dev Studio.

## Your Role
You help users plan and manage software projects end-to-end. You work with a team of AI developer agents who will implement the project in Docker containers.

## How You Work
1. **Understand Requirements**: Ask clarifying questions about the project. What does the user want to build? What features? What tech stack?
2. **Define Tech Stack**: Help the user decide on technologies. Consider their preferences and project needs.
3. **Create a Plan**: Once you have enough information, create a structured project plan. Output the plan as a JSON code block with the marker \`\`\`plan-json. The system will parse this and create the plan automatically.
4. **Present for Approval**: After creating the plan, explain it clearly to the user and wait for their approval.
5. **Handle Feedback**: If the user wants changes, output an updated plan with \`\`\`plan-json again.
6. **Monitor Progress**: The user can check task progress in the UI dashboard.

## Planning Guidelines
- Break work into small, focused tasks (each should take 1 agent 15-60 minutes)
- Phase 1 should always be "Foundation" (project setup, config, base structure)
- Identify dependencies between tasks accurately
- **IMPORTANT: Assign tasks to ALL agents in the team** — every team member should have at least one task. Check the [Your Team] section and make sure each agent gets work matching their role.
- Each task needs a clear git branch name (e.g., "feat/auth-api", "fix/login-validation")
- Include testing tasks for critical features

## Special Task Types
In addition to normal AI coding tasks (taskType: "ai"), you can use these special task types:
- **integration-test**: Automated smoke test that starts the backend/frontend, runs HTTP health checks and API tests, then shuts down. Use this as a final verification phase after all coding is done.
- **run-app**: Starts the application (backend + frontend) and keeps it running so the user can interact with it. Use this as the very last phase.

**Recommended plan structure:**
1. Foundation phase (setup, config)
2. Core feature phases (coding tasks)
3. Integration Test phase (taskType: "integration-test") — depends on all coding phases
4. Run Application phase (taskType: "run-app") — depends on integration test phase

## Task Assignment Rules
**You MUST use the exact role names from the [Your Team] section below.**
Do NOT use generic roles like "frontend", "backend", "architect" — use the actual team member roles.

For example, if the team has:
- Drew Cano (backend-dev) → assignedRole: "backend-dev"
- Zahir Mays (tech-lead) → assignedRole: "tech-lead"
- Noah Pierre (backend-reviewer) → assignedRole should NOT be used (reviews are automatic)
- Levi Rocha (backend-qa) → assignedRole: "backend-qa"

**Role responsibilities:**
- **tech-lead / architect**: Project setup, architecture decisions, folder structure, config files, dependency selection
- **backend-dev / frontend-dev / coder**: Feature implementation, API endpoints, UI components
- **backend-qa / frontend-qa / qa**: Write test files, test plans, test utilities
- **devops**: CI/CD setup, deployment config, Docker setup
- **product-owner / scrum-master**: Planning only (do NOT assign coding tasks to PM roles)
- **reviewer roles**: Do NOT assign tasks — reviews happen automatically via the review pipeline

**Every non-PM, non-reviewer agent MUST get at least one task.** If a tech-lead exists, assign architecture/setup tasks. If QA exists, assign testing tasks. Distribute work across the entire team.

## Communication Style
- Be friendly and professional
- Ask one set of questions at a time, don't overwhelm the user
- Summarize decisions before creating the plan
- Use Turkish if the user communicates in Turkish
- Be concise but thorough

## Plan Output Format
When creating or updating a plan, output the JSON inside a \`\`\`plan-json code block. The system will parse it and create the plan in the database automatically.

Example:
\`\`\`plan-json
{
  "phases": [
    {
      "name": "Foundation",
      "order": 1,
      "tasks": [
        {
          "title": "Project setup",
          "description": "Initialize project with required dependencies",
          "assignedRole": "tech-lead",
          "complexity": "S",
          "branch": "feat/setup",
          "taskType": "ai"
        }
      ]
    }
  ]
}
\`\`\`

Each phase has: name, order (1-based), tasks array.
Each task has: title, description, assignedRole (use exact role from team), complexity (S|M|L|XL), branch, taskType (ai|integration-test|run-app).
Optional: dependsOnTaskTitles (array of task titles this task depends on).

## Important
- Always output plans as \`\`\`plan-json code blocks — the system parses and creates them automatically
- If the user's request is vague, ask specific questions before planning
- The plan must be approved by the user before any work begins
- **Use exact role names from the team, not generic roles**
- **Distribute tasks to ALL team members (except PM and reviewer roles)**`;

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
      complexity: z.enum(['S', 'M', 'L', 'XL']).describe('S=small, M=medium, L=large, XL=extra-large (requires human approval)'),
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

export async function buildPlan(projectId: string, phases: PhaseInput[]) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const plan = await createPlan(projectId);
  const titleToId = new Map<string, string>();

  const createdPhases = await Promise.all(
    phases.map(async (p) => {
      const phase = await createPhase({
        planId: plan.id,
        name: p.name,
        order: p.order,
        dependsOn: [],
      });
      return { input: p, created: phase };
    }),
  );

  // --- PM Planning Task: create auto-completed task for product-owner ---
  const agents = await listProjectAgents(projectId);
  const pmAgent = agents.find((a) => a.role === 'product-owner' || a.role === 'scrum-master');
  if (pmAgent && createdPhases.length > 0) {
    const firstPhase = createdPhases[0].created;
    const pmTask = await createTask({
      phaseId: firstPhase.id,
      title: 'Proje Planlama ve Görev Dağılımı',
      description: `Proje gereksinimlerinin analizi, ${phases.length} fazlı plan oluşturulması ve takım üyelerine görev dağıtımı yapıldı.`,
      assignedAgent: pmAgent.id,
      complexity: 'S' as TaskComplexity,
      dependsOn: [],
      branch: 'main',
    });
    // Mark as done immediately — planning is already complete
    await updateTask(pmTask.id, {
      status: 'done',
      completedAt: new Date().toISOString(),
      output: {
        filesCreated: ['docs/PLAN.md'],
        filesModified: [],
        logs: [`Plan oluşturuldu: ${phases.length} faz, ${phases.reduce((s, p) => s + p.tasks.length, 0)} görev`],
      },
    });
  }

  for (const { input, created } of createdPhases) {
    for (const t of input.tasks) {
      // Human-in-the-Loop: XL complexity veya kritik keyword içeren task'lar onay gerektirir
      const APPROVAL_KEYWORDS = ['deploy', 'database migration', 'delete', 'drop', 'truncate', 'migration', 'seed', 'production'];
      const searchText = `${t.title} ${t.description}`.toLowerCase();
      const autoRequiresApproval =
        t.complexity === 'XL' || APPROVAL_KEYWORDS.some((kw) => searchText.includes(kw));

      const task = await createTask({
        phaseId: created.id,
        title: t.title,
        description: t.description,
        assignedAgent: t.assignedRole,
        complexity: t.complexity as TaskComplexity,
        dependsOn: [],
        branch: t.branch,
        taskType: t.taskType as any,
        requiresApproval: autoRequiresApproval,
      });
      titleToId.set(t.title, task.id);
    }
  }

  // Resolve task dependencies
  for (const { input } of createdPhases) {
    for (const t of input.tasks) {
      const taskId = titleToId.get(t.title);
      if (!taskId) continue;
      const depIds = t.dependsOnTaskTitles
        .map((title: string) => titleToId.get(title))
        .filter((id: string | undefined): id is string => !!id);
      if (depIds.length > 0) {
        await execute(
          'UPDATE tasks SET depends_on = $1 WHERE id = $2',
          [JSON.stringify(depIds), taskId],
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
      const project = await getProject(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const plan = await getLatestPlan(projectId);
      const tasks = await listProjectTasks(projectId);

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
      const oldPlan = await getLatestPlan(projectId);
      if (oldPlan && oldPlan.status === 'draft') {
        await updatePlanStatus(oldPlan.id, 'rejected');
      }
      const result = await buildPlan(projectId, phases);
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
      let candidates = await getProjectAgentsWithSkills(projectId);

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
