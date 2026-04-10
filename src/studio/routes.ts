// ---------------------------------------------------------------------------
// AI Dev Studio — Hono API Routes
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { isAnyProviderConfigured } from './ai-provider-factory.js';
import { isClaudeCliAvailable, streamWithCLI } from './cli-runtime.js';
import { mkdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initLintConfig } from './lint-runner.js';
import { checkDocsFreshness, generateReadme, regenerateAllDocs } from './docs-generator.js';
import { AVATARS, FEMALE_AVATARS, MALE_AVATARS } from './avatars.js';
import {
  isSonarEnabled,
  runSonarScan,
  fetchQualityGate,
  initSonarConfig,
  recordSonarScan,
  getLatestSonarScan,
} from './sonar-runner.js';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  getLatestPlan,
  updatePlanStatus,
  listProjectTasks,
  getTask,
  updateTask,
  appendTaskLogs,
  listAgentConfigs,
  listPresetAgents,
  createAgentConfig,
  getAgentConfig,
  updateAgentConfig,
  deleteAgentConfig,
  listEvents,
  insertChatMessage,
  listChatMessages,
  seedPresetAgents,
  seedTeamTemplates,
  listTeamTemplates,
  getTeamTemplate,
  listCustomTeamTemplates,
  getCustomTeamTemplate,
  createCustomTeamTemplate,
  updateCustomTeamTemplate,
  deleteCustomTeamTemplate,
  createProjectAgent,
  getProjectAgent,
  listProjectAgents,
  updateProjectAgent,
  deleteProjectAgent,
  copyAgentsToProject,
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  getRawProviderApiKey,
  getDefaultProvider,
  getFallbackChain,
  updateFallbackOrder,
  listAgentRuns,
  getProjectAnalytics,
  getAgentAnalytics,
  getActivityTimeline,
  getProjectCostSummary,
  getProjectCostBreakdown,
  listTokenUsage,
  getProjectSettingsMap,
  setProjectSettings,
  recordTokenUsage,
  createAgentDependency,
  listAgentDependencies,
  deleteAgentDependency,
  deleteAllDependencies,
  bulkCreateDependencies,
  createAgentCapability,
  listAgentCapabilities,
  deleteAgentCapability,
  deleteAllCapabilities,
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  type Webhook,
  listPendingApprovals,
} from './db.js';
import { sendWebhookNotification } from './webhook-sender.js';
import { eventBus } from './event-bus.js';
import { PM_SYSTEM_PROMPT, buildPlan, estimatePlanCost } from './pm-agent.js';
import { taskEngine } from './task-engine.js';
import { containerManager } from './container-manager.js';
import { agentRuntime } from './agent-runtime.js';
import { executionEngine } from './execution-engine.js';
import { pipelineEngine } from './pipeline-engine.js';
import { gitManager } from './git-manager.js';
import {
  createAgentFiles,
  updateAgentFiles,
  readAgentFile,
  listAgentFiles,
  writeAgentFile,
  deleteAgentFiles,
} from './agent-files.js';
import type { ProjectAgent, DependencyType, CapabilityScopeType, CapabilityPermission } from './types.js';
import {
  sendMessage,
  getMessage,
  getInbox,
  getThread,
  markAsRead,
  archiveMessage,
  getUnreadCount,
  listProjectMessages,
  broadcastToTeam,
  notifyNextInPipeline,
} from './agent-messaging.js';

// Preset agentları ve takım şablonlarını başlat
seedPresetAgents();
seedTeamTemplates();

// ---------------------------------------------------------------------------
// Webhook Event Entegrasyonu — global event listener
// Önemli event'lerde proje webhook'larına bildirim gönderir.
// ---------------------------------------------------------------------------
eventBus.on('task:completed', (event) => {
  const payload = event.payload as Record<string, unknown>;
  // Webhook gönderimi arka planda çalışır — event akışını bloklamamak için
  sendWebhookNotification(event.projectId, 'task_completed', {
    taskId: event.taskId ?? '',
    taskTitle: payload.title ?? payload.taskTitle ?? '',
    agentId: event.agentId ?? '',
    ...payload,
  }).catch((err) => console.warn('[webhook] task_completed gonderilemedi:', err));
});

eventBus.on('task:failed', (event) => {
  const payload = event.payload as Record<string, unknown>;
  sendWebhookNotification(event.projectId, 'execution_error', {
    taskId: event.taskId ?? '',
    taskTitle: payload.title ?? payload.taskTitle ?? '',
    error: payload.error ?? 'Bilinmeyen hata',
    agentId: event.agentId ?? '',
    ...payload,
  }).catch((err) => console.warn('[webhook] task_failed gonderilemedi:', err));
});

eventBus.on('pipeline:completed', (event) => {
  sendWebhookNotification(event.projectId, 'pipeline_finished', {
    ...(event.payload as Record<string, unknown>),
  }).catch((err) => console.warn('[webhook] pipeline_finished gonderilemedi:', err));
});

eventBus.on('budget:warning', (event) => {
  const payload = event.payload as Record<string, unknown>;
  sendWebhookNotification(event.projectId, 'budget_warning', {
    currentCost: payload.currentCostUsd ?? payload.currentCost ?? 0,
    limitCost: payload.maxCostUsd ?? payload.limitCost ?? 0,
    ...payload,
  }).catch((err) => console.warn('[webhook] budget_warning gonderilemedi:', err));
});

const studio = new Hono();

// ---- Projects CRUD --------------------------------------------------------

studio.get('/projects', async (c) => {
  return c.json(await listProjects());
});

studio.post('/projects', async (c) => {
  const body = (await c.req.json()) as {
    name: string;
    description?: string;
    techStack?: string[];
    // İsteğe bağlı takım şablonu — belirtilmezse Full Stack Team varsayılan olarak seçilir
    teamTemplateId?: string;
  };
  const project = await createProject({
    name: body.name,
    description: body.description ?? '',
    techStack: body.techStack ?? [],
    repoPath: '',
  });

  // Proje oluşturulduktan sonra takım şablonundan agentları kopyala
  const templateId = body.teamTemplateId;
  if (templateId) {
    // Önce preset template'lerde ara, yoksa custom team template'lerde ara
    const presetTemplate = await getTeamTemplate(templateId);
    const customTemplate = !presetTemplate ? await getCustomTeamTemplate(templateId) : undefined;
    const roles = presetTemplate?.roles ?? customTemplate?.roles;
    if (roles) {
      const copiedAgents = await copyAgentsToProject(project.id, roles);
      for (const agent of copiedAgents) {
        createAgentFiles(project.id, agent.name, {
          skills: agent.skills,
          systemPrompt: agent.systemPrompt,
          personality: agent.personality,
          role: agent.role,
          model: agent.model,
        }).catch((err) => console.error('Failed to create agent files:', err));
      }
    }
  } else {
    // Varsayılan: Full Stack Team
    const templates = await listTeamTemplates();
    const fullStack = templates.find((t) => t.name === 'Full Stack Team');
    if (fullStack) {
      const copiedAgents = await copyAgentsToProject(project.id, fullStack.roles);
      for (const agent of copiedAgents) {
        createAgentFiles(project.id, agent.name, {
          skills: agent.skills,
          systemPrompt: agent.systemPrompt,
          personality: agent.personality,
          role: agent.role,
          model: agent.model,
        }).catch((err) => console.error('Failed to create agent files:', err));
      }
    }
  }

  // Initialize git repo and docs structure — optional, failure does not block project creation
  try {
    const repoPath = join(resolve('.voltagent/repos'), project.id);
    await mkdir(repoPath, { recursive: true });
    await gitManager.initRepo(repoPath);
    await gitManager.initDocs(repoPath);
    await initLintConfig(repoPath);
    if (await isSonarEnabled()) {
      await initSonarConfig(repoPath, `studio-${project.id}`, project.name);
    }
    await updateProject(project.id, { repoPath });
    return c.json({ ...project, repoPath }, 201);
  } catch {
    // Repo init failed — return the project without a repoPath
    return c.json(project, 201);
  }
});

// POST /projects/import — import an existing local repository as a project
studio.post('/projects/import', async (c) => {
  const body = (await c.req.json()) as {
    name: string;
    repoPath: string;
    description?: string;
    techStack?: string[];
    teamTemplateId?: string;
  };

  if (!body.repoPath) return c.json({ error: 'repoPath is required' }, 400);

  // Validate the path exists
  try {
    await access(body.repoPath);
  } catch {
    return c.json({ error: 'Path does not exist: ' + body.repoPath }, 400);
  }

  // Auto-detect tech stack and description from package.json if not provided
  let description = body.description ?? '';
  let techStack = body.techStack ?? [];
  try {
    const pkgRaw = await readFile(join(body.repoPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    if (!description && pkg.description) description = pkg.description;
    if (techStack.length === 0) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const known = ['react', 'vue', 'angular', 'next', 'express', 'hono', 'fastify', 'nestjs', 'typescript', 'tailwindcss', 'prisma', 'drizzle'];
      techStack = known.filter((k) => deps[k] || deps['@' + k + '/core']);
    }
  } catch {
    // No package.json or parse error — fine
  }

  const project = await createProject({
    name: body.name,
    description,
    techStack,
    repoPath: body.repoPath,
  });

  // Copy team template agents (same logic as POST /projects)
  const templateId = body.teamTemplateId;
  if (templateId) {
    const template = await getTeamTemplate(templateId);
    if (template) {
      const copiedAgents = await copyAgentsToProject(project.id, template.roles);
      for (const agent of copiedAgents) {
        createAgentFiles(project.id, agent.name, {
          skills: agent.skills,
          systemPrompt: agent.systemPrompt,
          personality: agent.personality,
          role: agent.role,
          model: agent.model,
        }).catch((err) => console.error('Failed to create agent files:', err));
      }
    }
  } else {
    const templates = await listTeamTemplates();
    const fullStack = templates.find((t) => t.name === 'Full Stack Team');
    if (fullStack) {
      const copiedAgents = await copyAgentsToProject(project.id, fullStack.roles);
      for (const agent of copiedAgents) {
        createAgentFiles(project.id, agent.name, {
          skills: agent.skills,
          systemPrompt: agent.systemPrompt,
          personality: agent.personality,
          role: agent.role,
          model: agent.model,
        }).catch((err) => console.error('Failed to create agent files:', err));
      }
    }
  }

  // Initialize lint config + sonar if enabled (for imported repos too)
  try {
    await initLintConfig(body.repoPath);
    if (await isSonarEnabled()) {
      await initSonarConfig(body.repoPath, `studio-${project.id}`, project.name);
    }
  } catch {
    // Non-blocking
  }

  return c.json(project, 201);
});

studio.get('/projects/:id', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(project);
});

studio.patch('/projects/:id', async (c) => {
  const body = await c.req.json();
  const project = await updateProject(c.req.param('id'), body);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(project);
});

studio.delete('/projects/:id', async (c) => {
  const ok = await deleteProject(c.req.param('id'));
  if (!ok) return c.json({ error: 'Project not found' }, 404);
  return c.json({ success: true });
});

// ---- Planner Chat (SSE streaming) -----------------------------------------

studio.post('/projects/:id/chat', async (c) => {
  // Claude CLI gerekli
  const cliReady = await isClaudeCliAvailable();
  if (!cliReady) {
    return c.json(
      { error: 'Claude CLI is not available. Install Claude Code CLI to use the Planner.' },
      503,
    );
  }

  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  if (!project.repoPath) {
    return c.json({ error: 'Project has no repoPath configured.' }, 400);
  }

  const body = (await c.req.json()) as { message: string };
  const userMessage = body.message;

  // Persist user message
  await insertChatMessage({ projectId, role: 'user', content: userMessage });

  // Build conversation history for context
  const history = await listChatMessages(projectId);

  // Projeye özel takım bilgisini al (project_agents tablosundan)
  const agents = await listProjectAgents(projectId);
  // Determine reviewer and PM agents dynamically from dependencies and pipelineOrder
  const deps = await listAgentDependencies(projectId);
  const reviewTargetIds = new Set(deps.filter((d) => d.type === 'review').map((d) => d.toAgentId));
  const pmOrder = Math.min(...agents.map((a) => a.pipelineOrder ?? 99));
  const pmAgentIds = new Set(agents.filter((a) => (a.pipelineOrder ?? 99) === pmOrder).map((a) => a.id));

  const teamInfo = agents
    .map((a) => {
      const isReviewer = reviewTargetIds.has(a.id);
      const isPM = pmAgentIds.has(a.id);
      const tag = isReviewer ? ' [AUTO-REVIEW — do not assign tasks]' : isPM ? ' [PM — planning only]' : ' [ASSIGNABLE]';
      return `- **${a.name}** (role: "${a.role}")${tag} — ${a.personality}. Skills: ${a.skills.join(', ')}`;
    })
    .join('\n');

  const assignableRoles = agents
    .filter((a) => !reviewTargetIds.has(a.id) && !pmAgentIds.has(a.id))
    .map((a) => `"${a.role}"`)
    .join(', ');

  // Build system prompt with project context + team info
  const systemPrompt = `${PM_SYSTEM_PROMPT}

[Current Project Context]
Project ID: ${projectId}
Project Name: ${project.name}
Status: ${project.status}
Tech Stack: ${project.techStack.join(', ') || 'Not decided yet'}
Description: ${project.description || 'No description yet'}

[Your Team — ${agents.length} agents]
${teamInfo}

[Assignable Roles for Tasks]
Use ONLY these exact values for assignedRole: ${assignableRoles}
Every assignable agent MUST get at least one task.`;

  // Build prompt with conversation history
  const conversationContext = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const prompt = conversationContext
    ? `Previous conversation:\n${conversationContext}\n\nUser: ${userMessage}`
    : userMessage;

  // Stream response via SSE using Claude CLI
  return streamSSE(c, async (stream) => {
    try {
      await new Promise<void>((resolveStream, rejectStream) => {
        const cancel = streamWithCLI(
          {
            repoPath: project.repoPath!,
            prompt,
            systemPrompt,
            model: 'sonnet',
            timeoutMs: 120_000,
          },
          {
            onTextDelta: (text) => {
              stream.writeSSE({
                event: 'text-delta',
                data: JSON.stringify({ text }),
              }).catch(() => { /* stream closed */ });
            },
            onDone: async (fullText) => {
              try {
                // Parse plan-json blocks from response and create plans
                const planMatch = fullText.match(/```plan-json\s*\n([\s\S]*?)\n```/);
                if (planMatch) {
                  try {
                    const planData = JSON.parse(planMatch[1]);
                    if (planData.phases && Array.isArray(planData.phases)) {
                      // Reject old draft if exists
                      const oldPlan = await getLatestPlan(projectId);
                      if (oldPlan && oldPlan.status === 'draft') {
                        await updatePlanStatus(oldPlan.id, 'rejected');
                      }
                      await buildPlan(projectId, planData.phases);
                      console.log(`[Planner] Plan created for project ${projectId} (${planData.phases.length} phases)`);
                    }
                  } catch (parseErr) {
                    console.error('[Planner] Failed to parse plan-json:', parseErr);
                  }
                }

                // Persist assistant response (without the plan-json block for clean display)
                if (fullText) {
                  await insertChatMessage({ projectId, role: 'assistant', content: fullText });
                }

                await stream.writeSSE({
                  event: 'done',
                  data: JSON.stringify({ message: 'Stream completed' }),
                });
                resolveStream();
              } catch (err) {
                rejectStream(err);
              }
            },
            onError: (error) => {
              rejectStream(error);
            },
          },
        );

        // Clean up on stream abort
        stream.onAbort(() => {
          cancel();
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Planner Error]', errorMsg);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: errorMsg }),
      });
    }
  });
});

studio.get('/projects/:id/chat/history', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await listChatMessages(projectId));
});

// ---- Plans ----------------------------------------------------------------

studio.get('/projects/:id/plan', async (c) => {
  const plan = await getLatestPlan(c.req.param('id'));
  if (!plan) return c.json({ error: 'No plan found' }, 404);
  return c.json(plan);
});

studio.post('/projects/:id/plan/approve', async (c) => {
  const projectId = c.req.param('id');
  const plan = await getLatestPlan(projectId);
  if (!plan) return c.json({ error: 'No plan found' }, 404);
  if (plan.status !== 'draft') return c.json({ error: 'Plan is not in draft status' }, 400);

  await updatePlanStatus(plan.id, 'approved');

  eventBus.emit({
    projectId,
    type: 'plan:approved',
    payload: { planId: plan.id },
  });

  // Execution engine: görev bazlı yürütme
  executionEngine.startProjectExecution(projectId).catch((err) => {
    console.error('[execution-engine] startProjectExecution failed:', err);
  });

  // Pipeline auto-start: agent pipeline_order'a göre aşamalı yürütme
  // Execution engine zaten görevleri başlattı; pipeline engine aşama koordinasyonunu üstlenir.
  // İkisi birbirinden bağımsız değil: pipeline engine, taskEngine.onTaskCompleted
  // callback'i üzerinden execution engine'in ilerlemesini takip eder.
  let pipelineStarted = false;
  let pipelineWarning: string | undefined;

  try {
    const agents = await listProjectAgents(projectId);
    if (agents.length === 0) {
      // Agent yoksa pipeline başlatılamaz ama execution devam edebilir
      pipelineWarning = 'Projeye atanmış agent bulunamadı; pipeline stage koordinasyonu devre dışı.';
      console.warn(`[pipeline-engine] ${pipelineWarning} (proje=${projectId})`);
    } else {
      pipelineEngine.startPipeline(projectId);
      pipelineStarted = true;
      console.log(`[pipeline-engine] Plan onayı ile pipeline otomatik başlatıldı (proje=${projectId})`);
    }
  } catch (err) {
    // Pipeline başlatma hatası execution engine'i durdurmamalı
    // Hata mesajını kaydet ama "Hata" olarak gösterme — execution devam ediyor
    pipelineWarning = err instanceof Error ? err.message : String(err);
    console.error('[pipeline-engine] auto-start hatası (execution devam ediyor):', err);
  }

  return c.json({
    success: true,
    planId: plan.id,
    execution: { started: true },
    pipeline: {
      started: pipelineStarted,
      // warning yalnızca gerçek bir sorun varsa dolu; aksi hâlde undefined
      warning: pipelineWarning,
    },
  });
});

// Pipeline auto-start durumunu sorgula
// Task durumlarıyla zenginleştirilmiş yanıt döner; "Hata" göstermek yerine
// task'lar çalışıyorsa "running" statüsü türetilir.
studio.get('/projects/:id/pipeline/auto-start-status', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const plan = await getLatestPlan(projectId);
  const planApproved = plan?.status === 'approved';

  // Zenginleştirilmiş durum: pipeline + task progress + derived status
  const enriched = await pipelineEngine.getEnrichedPipelineStatus(projectId);
  const pipelineState = enriched.pipelineState;

  return c.json({
    projectId,
    planApproved,
    autoStartEnabled: true,
    // Gerçek pipeline kaydı (null olabilir)
    pipeline: pipelineState
      ? {
          status: pipelineState.status,
          currentStage: pipelineState.currentStage,
          totalStages: pipelineState.stages.length,
          startedAt: pipelineState.startedAt,
        }
      : null,
    // Task durumlarından türetilen gerçek durum
    // Board bu alanı kullanmalı; pipeline.status yerine effectiveStatus tercih edilir
    effectiveStatus: enriched.derivedStatus,
    // Anlık task ilerleme özeti
    taskProgress: enriched.taskProgress.overall,
    // Varsa uyarı mesajı
    warning: enriched.warning,
  });
});

studio.post('/projects/:id/plan/reject', async (c) => {
  const plan = await getLatestPlan(c.req.param('id'));
  if (!plan) return c.json({ error: 'No plan found' }, 404);
  if (plan.status !== 'draft') return c.json({ error: 'Plan is not in draft status' }, 400);

  const body = (await c.req.json()) as { feedback?: string };
  await updatePlanStatus(plan.id, 'rejected');

  return c.json({ success: true, planId: plan.id, feedback: body.feedback });
});

// GET /projects/:id/plans/:planId/cost-estimate
// Plan onaylanmadan önce tahmini maliyet hesaplar.
// Response: { estimatedTokens, estimatedCost, currency, taskCount, avgTokensPerTask, model, breakdown }
studio.get('/projects/:id/plans/:planId/cost-estimate', async (c) => {
  const projectId = c.req.param('id');
  const planId = c.req.param('planId');

  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const estimate = estimatePlanCost(projectId, planId);
    return c.json(estimate);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Maliyet tahmini hesaplanamadı';
    return c.json({ error: message }, 500);
  }
});

// ---- Execution ------------------------------------------------------------

// Manual trigger to start or resume execution for a project.
studio.post('/projects/:id/execute', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // Fire and forget — progress is observable via SSE events and /progress
  executionEngine.startProjectExecution(projectId).catch((err) => {
    console.error('[execution-engine] manual execute failed:', err);
  });

  return c.json({ success: true, message: 'Execution started' });
});

// Execution status snapshot: running containers + task progress.
studio.get('/projects/:id/execution/status', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(executionEngine.getExecutionStatus(projectId));
});

studio.get('/projects/:id/progress', (c) => {
  return c.json(taskEngine.getProgress(c.req.param('id')));
});

// ---- Tasks ----------------------------------------------------------------

studio.get('/projects/:id/tasks', async (c) => {
  const tasks = await listProjectTasks(c.req.param('id'));

  // Attach a lightweight output summary so task cards can show badges
  // without requiring a separate fetch of the full output payload.
  const tasksWithSummary = tasks.map((task) => ({
    ...task,
    outputSummary: task.output
      ? {
          filesCreatedCount: task.output.filesCreated.length,
          filesModifiedCount: task.output.filesModified.length,
          logLineCount: task.output.logs.length,
          hasTestResults: task.output.testResults !== undefined,
        }
      : null,
  }));

  return c.json(tasksWithSummary);
});

studio.get('/projects/:id/tasks/:taskId', async (c) => {
  const task = await getTask(c.req.param('taskId'));
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

studio.patch('/projects/:id/tasks/:taskId', async (c) => {
  const body = await c.req.json();
  // Status değişimlerinde timestamp'leri otomatik set et
  if (body.status === 'running' && !body.startedAt) {
    body.startedAt = new Date().toISOString();
  }
  if (body.status === 'done' && !body.completedAt) {
    body.completedAt = new Date().toISOString();
  }
  const task = await updateTask(c.req.param('taskId'), body);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

studio.post('/projects/:id/tasks/:taskId/retry', async (c) => {
  try {
    const updated = await taskEngine.retryTask(c.req.param('taskId'));
    // Re-trigger execution for the retried task
    executionEngine.executeTask(c.req.param('id'), updated).catch(() => {});
    return c.json({ success: true, task: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Retry failed';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/tasks/:taskId/review — Reviewer onay veya ret verir
studio.post('/projects/:id/tasks/:taskId/review', async (c) => {
  try {
    const body = await c.req.json<{ approved: boolean; feedback?: string }>();
    const updated = await taskEngine.submitReview(c.req.param('taskId'), body.approved, body.feedback);
    return c.json({ success: true, task: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Review failed';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/tasks/:taskId/restart-revision — Revision durumundaki task'ı tekrar çalıştır
studio.post('/projects/:id/tasks/:taskId/restart-revision', async (c) => {
  try {
    const updated = await taskEngine.restartRevision(c.req.param('taskId'));
    return c.json({ success: true, task: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Restart revision failed';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/tasks/:taskId/approve — Human-in-the-Loop onay ver
studio.post('/projects/:id/tasks/:taskId/approve', async (c) => {
  try {
    const projectId = c.req.param('id');
    const taskId = c.req.param('taskId');
    const updated = await taskEngine.approveTask(taskId);
    // Onaylanan task'ı execution engine'e gönder
    executionEngine.executeTask(projectId, updated).catch(() => {});
    return c.json({ success: true, task: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Onay işlemi başarısız';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/tasks/:taskId/reject — Human-in-the-Loop reddet
studio.post('/projects/:id/tasks/:taskId/reject', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
    const updated = await taskEngine.rejectTask(taskId, body.reason);
    return c.json({ success: true, task: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Red işlemi başarısız';
    return c.json({ error: msg }, 400);
  }
});

// GET /projects/:id/approvals — Bekleyen onayları listele
studio.get('/projects/:id/approvals', async (c) => {
  const pendingTasks = await listPendingApprovals(c.req.param('id'));
  return c.json(pendingTasks);
});

// GET /projects/:id/tasks/:taskId/logs
// Returns stored logs from task.output.logs as JSON.
// For still-running tasks also appends the agent's live terminal buffer.
studio.get('/projects/:id/tasks/:taskId/logs', async (c) => {
  const task = await getTask(c.req.param('taskId'));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const storedLogs: string[] = task.output?.logs ?? [];

  const isRunning = task.status !== 'done' && task.status !== 'failed';
  let liveLogs: string[] = [];

  if (isRunning && task.assignedAgent) {
    const runtime = containerManager.getRuntime(c.req.param('id'), task.assignedAgent);
    if (runtime) {
      // Include terminal buffer lines that are not already persisted
      liveLogs = runtime.terminalBuffer.slice(storedLogs.length);
    }
  }

  return c.json({
    taskId: task.id,
    status: task.status,
    logs: storedLogs,
    liveLogs,
    total: storedLogs.length + liveLogs.length,
  });
});

// GET /projects/:id/tasks/:taskId/output
// Returns the full TaskOutput for a task (files, test results, logs).
studio.get('/projects/:id/tasks/:taskId/output', async (c) => {
  const task = await getTask(c.req.param('taskId'));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  if (!task.output) {
    return c.json({
      taskId: task.id,
      status: task.status,
      output: null,
    });
  }

  return c.json({
    taskId: task.id,
    status: task.status,
    output: task.output,
  });
});

// GET /projects/:id/tasks/:taskId/stream
// SSE endpoint — streams task logs in real-time.
// Sends stored logs immediately, then subscribes to live agent:output events
// until the task reaches a terminal state.
studio.get('/projects/:id/tasks/:taskId/stream', async (c) => {
  const projectId = c.req.param('id');
  const taskId = c.req.param('taskId');

  const task = await getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  return streamSSE(c, async (stream) => {
    // For terminal tasks: replay stored logs and close immediately.
    if (task.status === 'done' || task.status === 'failed') {
      for (const line of task.output?.logs ?? []) {
        await stream.writeSSE({ event: 'log', data: JSON.stringify({ text: line }) });
      }
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ status: task.status }) });
      return;
    }

    // For running/queued tasks: first flush any logs already persisted…
    for (const line of task.output?.logs ?? []) {
      await stream.writeSSE({ event: 'log', data: JSON.stringify({ text: line }) });
    }

    // …then subscribe to live project events and forward matching output.
    let closed = false;

    const unsubscribe = eventBus.onProject(projectId, async (event) => {
      if (closed) return;

      try {
        if (event.type === 'agent:output' && event.agentId === task.assignedAgent) {
          const text = typeof event.payload.output === 'string' ? event.payload.output : '';
          await stream.writeSSE({ event: 'log', data: JSON.stringify({ text }) });
          // Persist the incoming log line(s) to the task record.
          if (text) await appendTaskLogs(taskId, [text]);
        }

        if (
          (event.type === 'task:completed' || event.type === 'task:failed') &&
          event.taskId === taskId
        ) {
          await stream.writeSSE({ event: 'done', data: JSON.stringify({ status: event.type === 'task:completed' ? 'done' : 'failed' }) });
          closed = true;
          unsubscribe();
        }
      } catch {
        // Client disconnected — stop forwarding.
        closed = true;
        unsubscribe();
      }
    });

    stream.onAbort(() => {
      closed = true;
      unsubscribe();
    });
  });
});

// ---- Agent Configs --------------------------------------------------------

studio.get('/agents', async (c) => {
  return c.json(await listAgentConfigs());
});

studio.get('/agents/presets', async (c) => {
  return c.json(await listPresetAgents());
});

// Avatar listesi — gender'a göre filtrelenebilir
studio.get('/avatars', (c) => {
  const gender = c.req.query('gender');
  if (gender === 'female') return c.json(FEMALE_AVATARS);
  if (gender === 'male') return c.json(MALE_AVATARS);
  return c.json(AVATARS);
});

studio.post('/agents', async (c) => {
  const body = await c.req.json();
  const agent = await createAgentConfig({ ...body, isPreset: false });
  return c.json(agent, 201);
});

studio.get('/agents/:id', async (c) => {
  const agent = await getAgentConfig(c.req.param('id'));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

studio.put('/agents/:id', async (c) => {
  const body = await c.req.json();
  const agent = await updateAgentConfig(c.req.param('id'), body);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

studio.delete('/agents/:id', async (c) => {
  const ok = await deleteAgentConfig(c.req.param('id'));
  if (!ok) return c.json({ error: 'Agent not found or is a preset' }, 404);
  return c.json({ success: true });
});

// ---- Team Templates -------------------------------------------------------

// Tüm takım şablonlarını listele
studio.get('/team-templates', async (c) => {
  return c.json(await listTeamTemplates());
});

// ---- Custom Team Templates (user-created) ---------------------------------

studio.get('/custom-teams', async (c) => {
  return c.json(await listCustomTeamTemplates());
});

studio.get('/custom-teams/:id', async (c) => {
  const template = await getCustomTeamTemplate(c.req.param('id'));
  if (!template) return c.json({ error: 'Not found' }, 404);
  return c.json(template);
});

studio.post('/custom-teams', async (c) => {
  const body = await c.req.json();
  const template = await createCustomTeamTemplate(body);
  return c.json(template, 201);
});

studio.put('/custom-teams/:id', async (c) => {
  const body = await c.req.json();
  const template = await updateCustomTeamTemplate(c.req.param('id'), body);
  if (!template) return c.json({ error: 'Not found' }, 404);
  return c.json(template);
});

studio.delete('/custom-teams/:id', async (c) => {
  const ok = await deleteCustomTeamTemplate(c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ---- Project Templates (scaffold) ----------------------------------------

import { listProjectTemplates, getProjectTemplate, scaffoldFromTemplate } from './project-templates.js';

studio.get('/project-templates', (c) => {
  return c.json(listProjectTemplates());
});

studio.get('/project-templates/:id', (c) => {
  const template = getProjectTemplate(c.req.param('id'));
  if (!template) return c.json({ error: 'Template not found' }, 404);
  // Return without file contents for listing
  const { files: _f, ...rest } = template;
  return c.json({ ...rest, fileCount: Object.keys(template.files).length });
});

// POST /projects/from-template — create project + scaffold files
studio.post('/projects/from-template', async (c) => {
  const body = (await c.req.json()) as {
    name: string;
    templateId: string;
    description?: string;
  };

  const template = getProjectTemplate(body.templateId);
  if (!template) return c.json({ error: 'Template not found' }, 400);

  // Create project with template's tech stack
  const project = await createProject({
    name: body.name,
    description: body.description ?? template.description,
    techStack: template.techStack,
    repoPath: '',
  });

  // Copy team agents from matching team template
  const templates = await listTeamTemplates();
  const teamTpl = templates.find((t) => t.name === template.teamTemplate) ?? templates[0];
  if (teamTpl) {
    const copiedAgents = await copyAgentsToProject(project.id, teamTpl.roles);
    for (const agent of copiedAgents) {
      createAgentFiles(project.id, agent.name, {
        skills: agent.skills,
        systemPrompt: agent.systemPrompt,
        personality: agent.personality,
        role: agent.role,
        model: agent.model,
      }).catch((err) => console.error('Failed to create agent files:', err));
    }
  }

  // Init git repo + scaffold template files
  try {
    const repoPath = join(resolve('.voltagent/repos'), project.id);
    await mkdir(repoPath, { recursive: true });
    await gitManager.initRepo(repoPath);

    const { filesCreated } = await scaffoldFromTemplate(repoPath, body.templateId);

    await gitManager.initDocs(repoPath);
    await initLintConfig(repoPath);

    // Initial commit with scaffolded files
    if (filesCreated.length > 0) {
      try {
        await gitManager.commitFiles(repoPath, filesCreated, `chore: scaffold from ${template.name} template`);
      } catch { /* commit might fail if no changes */ }
    }

    await updateProject(project.id, { repoPath });
    return c.json({ ...project, repoPath, filesCreated }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scaffold failed';
    return c.json({ ...project, error: msg }, 201);
  }
});

// ---- Project Team (project_agents) ----------------------------------------

// Projenin takım üyelerini listele
studio.get('/projects/:id/team', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await listProjectAgents(projectId));
});

// Projeye yeni takım üyesi ekle (manuel veya preset'ten kopyalama)
studio.post('/projects/:id/team', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as {
    sourceAgentId?: string;
    name?: string;
    role?: string;
    avatar?: string;
    personality?: string;
    model?: string;
    cliTool?: string;
    skills?: string[];
    systemPrompt?: string;
  };

  // sourceAgentId verilmişse preset'ten kopyala
  if (body.sourceAgentId) {
    const preset = await getAgentConfig(body.sourceAgentId);
    if (!preset) return c.json({ error: 'Source agent not found' }, 404);
    const agent = await createProjectAgent({
      projectId,
      sourceAgentId: preset.id,
      name: body.name ?? preset.name,
      role: body.role ?? preset.role,
      avatar: body.avatar ?? preset.avatar,
      personality: body.personality ?? preset.personality,
      model: body.model ?? preset.model,
      cliTool: body.cliTool ?? preset.cliTool,
      skills: body.skills ?? preset.skills,
      systemPrompt: body.systemPrompt ?? preset.systemPrompt,
    });
    // Create agent .md files (non-blocking)
    createAgentFiles(projectId, agent.name, {
      skills: agent.skills,
      systemPrompt: agent.systemPrompt,
      personality: agent.personality,
      role: agent.role,
      model: agent.model,
    }).catch((err) => console.error('Failed to create agent files:', err));
    return c.json(agent, 201);
  }

  // Manuel oluşturma — zorunlu alanlar kontrol edilir
  if (!body.name || !body.role) {
    return c.json({ error: 'name and role are required' }, 400);
  }

  const agent = await createProjectAgent({
    projectId,
    sourceAgentId: body.sourceAgentId,
    name: body.name,
    role: body.role,
    avatar: body.avatar ?? '',
    personality: body.personality ?? '',
    model: body.model ?? 'claude-sonnet-4-6',
    cliTool: body.cliTool ?? 'claude-code',
    skills: body.skills ?? [],
    systemPrompt: body.systemPrompt ?? '',
  });
  // Create agent .md files (non-blocking)
  createAgentFiles(projectId, agent.name, {
    skills: agent.skills,
    systemPrompt: agent.systemPrompt,
    personality: agent.personality,
    role: agent.role,
    model: agent.model,
  }).catch((err) => console.error('Failed to create agent files:', err));
  return c.json(agent, 201);
});

// Get org structure for a project (tree format + pipeline order)
// NOTE: Must be defined BEFORE /team/:agentId to prevent "org" matching as agentId
studio.get('/projects/:id/team/org', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const agents = await listProjectAgents(projectId);

  const tree = buildOrgTree(agents);

  const pipeline = agents
    .filter((a) => a.pipelineOrder > 0)
    .sort((a, b) => a.pipelineOrder - b.pipelineOrder)
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      avatar: a.avatar,
      color: a.color,
      pipelineOrder: a.pipelineOrder,
    }));

  return c.json({ tree, pipeline });
});

// Tekil proje agentını getir
studio.get('/projects/:id/team/:agentId', async (c) => {
  const agent = await getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  return c.json(agent);
});

// Proje agentını güncelle
studio.put('/projects/:id/team/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const existing = await getProjectAgent(agentId);
  if (!existing || existing.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json();
  const updated = await updateProjectAgent(agentId, body);
  if (!updated) return c.json({ error: 'Agent not found' }, 404);
  updateAgentFiles(c.req.param('id'), updated.name, {
    skills: updated.skills,
    systemPrompt: updated.systemPrompt,
    personality: updated.personality,
    role: updated.role,
    model: updated.model,
  }).catch((err) => console.error('Failed to update agent files:', err));
  return c.json(updated);
});

// Proje agentını takımdan çıkar
studio.delete('/projects/:id/team/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const existing = await getProjectAgent(agentId);
  if (!existing || existing.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const ok = await deleteProjectAgent(agentId);
  if (!ok) return c.json({ error: 'Agent not found' }, 404);
  deleteAgentFiles(c.req.param('id'), existing.name).catch(() => {});
  return c.json({ success: true });
});

// Şablondan agentları projeye toplu kopyala
studio.post('/projects/:id/team/from-template', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as { templateId: string };
  if (!body.templateId) return c.json({ error: 'templateId is required' }, 400);

  const template = await getTeamTemplate(body.templateId);
  if (!template) return c.json({ error: 'Template not found' }, 404);

  const agents = await copyAgentsToProject(projectId, template.roles);
  for (const agent of agents) {
    createAgentFiles(projectId, agent.name, {
      skills: agent.skills,
      systemPrompt: agent.systemPrompt,
      personality: agent.personality,
      role: agent.role,
      model: agent.model,
    }).catch((err) => console.error('Failed to create agent files:', err));
  }
  return c.json(agents, 201);
});

// ---- Agent .md Files ------------------------------------------------------

// List .md files for a project agent
studio.get('/projects/:id/team/:agentId/files', async (c) => {
  const agent = await getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const files = await listAgentFiles(c.req.param('id'), agent.name);
  return c.json({ agentId: agent.id, agentName: agent.name, files });
});

// Read a specific .md file
studio.get('/projects/:id/team/:agentId/files/:fileName', async (c) => {
  const agent = await getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const content = await readAgentFile(c.req.param('id'), agent.name, c.req.param('fileName'));
  if (content === null) return c.json({ error: 'File not found' }, 404);
  return c.json({ fileName: c.req.param('fileName'), content });
});

// Write/update a .md file
studio.put('/projects/:id/team/:agentId/files/:fileName', async (c) => {
  const agent = await getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const body = (await c.req.json()) as { content: string };
  await writeAgentFile(c.req.param('id'), agent.name, c.req.param('fileName'), body.content);
  return c.json({ success: true });
});

// ---- Agent Messaging -------------------------------------------------------
// NOT: /projects/:id/messages/broadcast ve /pipeline-notify gibi sabit segmentler
// dinamik :messageId ve :agentId rotalarından ÖNCE tanımlanmalıdır.

// Projeye yeni mesaj gönder
studio.post('/projects/:id/messages', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as {
    fromAgentId: string;
    toAgentId: string;
    type: string;
    subject: string;
    content: string;
    metadata?: Record<string, any>;
    parentMessageId?: string;
  };

  // Zorunlu alan kontrolü
  if (!body.fromAgentId || !body.toAgentId || !body.type || !body.subject || !body.content) {
    return c.json({ error: 'fromAgentId, toAgentId, type, subject and content are required' }, 400);
  }

  const msg = sendMessage(
    projectId,
    body.fromAgentId,
    body.toAgentId,
    body.type as any,
    body.subject,
    body.content,
    body.metadata,
    body.parentMessageId,
  );

  return c.json(msg, 201);
});

// Projedeki tüm mesajları listele — isteğe bağlı ?agentId= ve ?status= filtreleri
studio.get('/projects/:id/messages', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const agentId = c.req.query('agentId');
  const status = c.req.query('status') as any;

  return c.json(await listProjectMessages(projectId, agentId, status));
});

// Takıma toplu yayın mesajı gönder
studio.post('/projects/:id/messages/broadcast', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as {
    fromAgentId: string;
    subject: string;
    content: string;
    metadata?: Record<string, any>;
  };

  if (!body.fromAgentId || !body.subject || !body.content) {
    return c.json({ error: 'fromAgentId, subject and content are required' }, 400);
  }

  const sent = await broadcastToTeam(projectId, body.fromAgentId, body.subject, body.content, body.metadata);
  return c.json({ sent: sent.length, messages: sent }, 201);
});

// Pipeline'daki bir sonraki aşamayı bilgilendir
studio.post('/projects/:id/messages/pipeline-notify', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as {
    fromAgentId: string;
    taskId: string;
    message: string;
  };

  if (!body.fromAgentId || !body.taskId || !body.message) {
    return c.json({ error: 'fromAgentId, taskId and message are required' }, 400);
  }

  const sent = await notifyNextInPipeline(projectId, body.fromAgentId, body.taskId, body.message);

  if (sent.length === 0) {
    return c.json({ error: 'No next pipeline stage found or agent not found' }, 404);
  }

  return c.json({ sent: sent.length, messages: sent }, 201);
});

// Belirli bir mesajın thread zincirini getir
studio.get('/projects/:id/messages/:messageId/thread', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const thread = await getThread(c.req.param('messageId'));
  if (thread.length === 0) return c.json({ error: 'Message not found' }, 404);

  return c.json(thread);
});

// Mesajı okundu olarak işaretle
studio.put('/projects/:id/messages/:messageId/read', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const msg = markAsRead(c.req.param('messageId'));
  if (!msg) return c.json({ error: 'Message not found' }, 404);

  return c.json(msg);
});

// Mesajı arşivle
studio.put('/projects/:id/messages/:messageId/archive', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const msg = archiveMessage(c.req.param('messageId'));
  if (!msg) return c.json({ error: 'Message not found' }, 404);

  return c.json(msg);
});

// Ajanın gelen kutusunu getir
studio.get('/projects/:id/agents/:agentId/inbox', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const status = c.req.query('status') as any;
  const messages = getInbox(c.req.param('id'), c.req.param('agentId'), status);

  return c.json(messages);
});

// Ajanın okunmamış mesaj sayısını getir
studio.get('/projects/:id/agents/:agentId/inbox/count', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const count = getUnreadCount(c.req.param('id'), c.req.param('agentId'));
  return c.json({ agentId: c.req.param('agentId'), unreadCount: count });
});

// ---- Container / Runtime --------------------------------------------------
// Önce yerel agent-runtime denenir; Docker mevcut değilse fallback olarak kullanılır.

/**
 * Agent başlatma — önce yerel süreç, hata/Docker yoksa Docker fallback.
 * project_agents tablosundaki agentId ile çalışır.
 */
studio.post('/projects/:id/agents/:agentId/start', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');

  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Proje bulunamadı' }, 404);

  // Önce project_agents tablosunda ara (yerel süreç için birincil kaynak)
  const projectAgent = await getProjectAgent(agentId);
  if (!projectAgent || projectAgent.projectId !== projectId) {
    return c.json({ error: 'Agent bulunamadı' }, 404);
  }

  const body = await c.req.json().catch(() => ({})) as { taskPrompt?: string };

  // cliTool == 'none' ise yerel süreç başlatma
  if (projectAgent.cliTool && projectAgent.cliTool !== 'none') {
    try {
      const record = await agentRuntime.startAgent(
        projectId,
        {
          id: projectAgent.id,
          name: projectAgent.name,
          cliTool: projectAgent.cliTool,
          systemPrompt: projectAgent.systemPrompt,
        },
        body.taskPrompt,
      );
      return c.json({
        success: true,
        mode: 'local',
        agentId: record.agentId,
        pid: record.pid,
        status: record.status,
        cliTool: record.cliTool,
      });
    } catch (localErr) {
      // Yerel başlatma başarısız — Docker'a düş
      console.warn('[routes] Yerel süreç başlatılamadı, Docker deneniyor:', localErr);
    }
  }

  // Docker fallback — agent_configs'ten al
  const agentConfig = await getAgentConfig(agentId);
  if (agentConfig) {
    try {
      const containerId = await containerManager.createContainer(agentConfig, project);
      return c.json({ success: true, mode: 'docker', containerId: containerId.slice(0, 12) });
    } catch (dockerErr) {
      const msg = dockerErr instanceof Error ? dockerErr.message : 'Container başlatılamadı';
      return c.json({ error: msg }, 500);
    }
  }

  return c.json({ error: 'Agent başlatılamadı: CLI aracı yapılandırılmamış ve Docker da mevcut değil' }, 500);
});

/** Agent durdurma — yerel süreç önce, sonra Docker */
studio.post('/projects/:id/agents/:agentId/stop', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');

  // Yerel süreç varsa onu durdur
  const record = agentRuntime.getAgentProcess(projectId, agentId);
  if (record && record.process) {
    agentRuntime.stopAgent(projectId, agentId);
    return c.json({ success: true, mode: 'local' });
  }

  // Docker fallback
  try {
    await containerManager.stopContainer(projectId, agentId);
    return c.json({ success: true, mode: 'docker' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Durdurulamadı';
    return c.json({ error: msg }, 500);
  }
});

/**
 * Agent durum bilgisi — yerel süreç veya Docker runtime'ını döndürür.
 */
studio.get('/projects/:id/agents/:agentId/status', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');

  // Önce yerel süreç kaydına bak
  const localRecord = agentRuntime.getAgentProcess(projectId, agentId);
  if (localRecord) {
    // ChildProcess nesnesi JSON'a serileştirilemez — çıkar
    const { process: _proc, ...safeRecord } = localRecord;
    return c.json({ mode: 'local', ...safeRecord });
  }

  // Docker runtime'ına bak
  const dockerRuntime = containerManager.getRuntime(projectId, agentId);
  if (dockerRuntime) {
    return c.json({ mode: 'docker', ...dockerRuntime });
  }

  // Sanal kayıt yoksa agent bilgisinden idle durumlu kayıt döndür
  const agent = (await listProjectAgents(projectId)).find((a) => a.id === agentId);
  if (agent) {
    return c.json({ mode: 'virtual', status: 'idle', agentId, agentName: agent.name });
  }

  return c.json({ error: 'Çalışan süreç bulunamadı' }, 404);
});

/**
 * Agent çıktı tamponu — son N satırı döndürür.
 * Sorgu parametresi: ?since=<satır_indeksi>
 */
studio.get('/projects/:id/agents/:agentId/output', (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');
  const sinceParam = c.req.query('since');
  const since = sinceParam !== undefined ? parseInt(sinceParam, 10) : undefined;

  const lines = agentRuntime.getAgentOutput(projectId, agentId, since);
  return c.json({ projectId, agentId, lines, total: lines.length });
});

/**
 * Agent çıktı SSE akışı — yeni satırlar geldiğinde server-sent event olarak iletir.
 */
studio.get('/projects/:id/agents/:agentId/stream', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');

  // Kayıt yoksa sanal kayıt oluştur — terminal bağlanabilsin ve yeni çıktıları beklesin
  let readable = agentRuntime.streamAgentOutput(projectId, agentId);
  if (!readable) {
    const agent = (await listProjectAgents(projectId)).find((a) => a.id === agentId);
    if (agent) {
      agentRuntime.ensureVirtualProcess(projectId, agentId, agent.name);
      readable = agentRuntime.streamAgentOutput(projectId, agentId);
    }
  }

  if (!readable) {
    return c.json({ error: 'Agent bulunamadı' }, 404);
  }

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * Proje kapsamındaki tüm çalışan agent'ları listeler.
 * Hem yerel süreçleri hem Docker runtime'larını içerir.
 */
studio.get('/projects/:id/runtimes', (c) => {
  const projectId = c.req.param('id');

  // Yerel süreçler
  const localProcesses = agentRuntime.listProjectProcesses(projectId).map((r) => {
    const { process: _proc, ...safe } = r;
    return { mode: 'local', ...safe };
  });

  // Docker runtime'ları
  const dockerRuntimes = containerManager.getAllRuntimes(projectId).map((r) => ({
    mode: 'docker',
    ...r,
  }));

  return c.json([...localProcesses, ...dockerRuntimes]);
});

/**
 * Agent çalışma geçmişi — agent_runs tablosundan.
 * Sorgu parametresi: ?limit=<sayı> (varsayılan 50)
 */
studio.get('/projects/:id/agents/:agentId/runs', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');
  const limit = Number(c.req.query('limit') ?? 50);
  const runs = await listAgentRuns(projectId, agentId, limit);
  return c.json(runs);
});

studio.post('/projects/:id/agents/:agentId/exec', async (c) => {
  const body = (await c.req.json()) as { command: string[] };
  try {
    const result = await containerManager.execCommand(
      c.req.param('id'),
      c.req.param('agentId'),
      body.command,
    );
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Exec failed';
    return c.json({ error: msg }, 500);
  }
});

studio.get('/docker/status', async (c) => {
  const available = await containerManager.isDockerAvailable();
  const hasImage = available ? await containerManager.hasCoderImage() : false;
  return c.json({ docker: available, coderImage: hasImage });
});

// ---- Files & Git ----------------------------------------------------------

studio.get('/projects/:id/files', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  try {
    const tree = await gitManager.getFileTree(project.repoPath);
    return c.json(tree);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to read files';
    return c.json({ error: msg }, 500);
  }
});

studio.get('/projects/:id/files/*', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  // Extract file path from wildcard — req.path includes the mount prefix (/api/studio)
  const prefix = `/api/studio/projects/${c.req.param('id')}/files/`;
  const filePath = c.req.path.startsWith(prefix)
    ? c.req.path.slice(prefix.length)
    : c.req.path.replace(/^.*\/files\//, '');
  if (!filePath) return c.json({ error: 'File path required' }, 400);

  try {
    const content = await gitManager.getFileContent(project.repoPath, filePath);
    return c.json({ path: filePath, content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to read file';
    return c.json({ error: msg }, 404);
  }
});

studio.put('/projects/:id/files/*', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const prefix = `/api/studio/projects/${c.req.param('id')}/files/`;
  const filePath = c.req.path.startsWith(prefix)
    ? c.req.path.slice(prefix.length)
    : c.req.path.replace(/^.*\/files\//, '');
  if (!filePath) return c.json({ error: 'File path required' }, 400);

  const body = (await c.req.json()) as { content: string };
  if (typeof body.content !== 'string') return c.json({ error: 'Content required' }, 400);

  try {
    await gitManager.writeFileContent(project.repoPath, filePath, body.content);
    return c.json({ path: filePath, saved: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to save file';
    return c.json({ error: msg }, 500);
  }
});

studio.get('/projects/:id/git/log', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const limit = Number(c.req.query('limit') ?? 50);
  try {
    const log = await gitManager.getLog(project.repoPath, limit);
    return c.json(log);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to get log';
    return c.json({ error: msg }, 500);
  }
});

studio.get('/projects/:id/git/diff', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const ref = c.req.query('ref');
  try {
    const diff = await gitManager.getDiff(project.repoPath, ref);
    return c.json({ diff });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to get diff';
    return c.json({ error: msg }, 500);
  }
});

studio.get('/projects/:id/git/branches', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  try {
    const branches = await gitManager.listBranches(project.repoPath);
    const current = await gitManager.getCurrentBranch(project.repoPath);
    return c.json({ branches, current });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to list branches';
    return c.json({ error: msg }, 500);
  }
});

// ---- File Create / Delete / Git Status & Commit ----------------------------

studio.post('/projects/:id/files', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const body = (await c.req.json()) as { path?: string; content?: string };
  if (!body.path || typeof body.path !== 'string') return c.json({ error: 'File path is required' }, 400);
  if (body.path.includes('..')) return c.json({ error: 'Invalid file path: directory traversal not allowed' }, 400);

  try {
    await gitManager.createFile(project.repoPath, body.path, body.content ?? '');
    return c.json({ path: body.path, created: true }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to create file';
    return c.json({ error: msg }, msg.includes('already exists') ? 409 : 500);
  }
});

studio.delete('/projects/:id/files', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const body = (await c.req.json()) as { path?: string };
  if (!body.path || typeof body.path !== 'string') return c.json({ error: 'File path is required' }, 400);
  if (body.path.includes('..')) return c.json({ error: 'Invalid file path: directory traversal not allowed' }, 400);

  try {
    await gitManager.deleteFile(project.repoPath, body.path);
    return c.json({ path: body.path, deleted: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to delete file';
    return c.json({ error: msg }, msg.includes('ENOENT') ? 404 : 500);
  }
});

studio.get('/projects/:id/git/status', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  try {
    const gitStatus = await gitManager.getStatus(project.repoPath);
    return c.json(gitStatus);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to get git status';
    return c.json({ error: msg }, 500);
  }
});

// POST /projects/:id/git/revert — Belirli bir commit'i geri al
studio.post('/projects/:id/git/revert', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const body = (await c.req.json()) as { commitHash?: string };
  if (!body.commitHash || typeof body.commitHash !== 'string') {
    return c.json({ error: 'commitHash is required' }, 400);
  }

  try {
    const revertHash = await gitManager.revertCommit(project.repoPath, body.commitHash);
    return c.json({ success: true, revertCommit: revertHash, originalCommit: body.commitHash });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Revert başarısız oldu';
    return c.json({ error: msg }, 500);
  }
});

// POST /projects/:id/git/merge — Kaynak branch'i hedef branch'e merge et
studio.post('/projects/:id/git/merge', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const body = (await c.req.json()) as { source?: string; target?: string };
  if (!body.source || typeof body.source !== 'string') {
    return c.json({ error: 'source branch is required' }, 400);
  }
  if (!body.target || typeof body.target !== 'string') {
    return c.json({ error: 'target branch is required' }, 400);
  }

  try {
    const result = await gitManager.mergeBranch(project.repoPath, body.source, body.target);
    if (!result.success) {
      return c.json({ success: false, conflicts: result.conflicts ?? [] }, 409);
    }
    return c.json({ success: true, source: body.source, target: body.target });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Merge başarısız oldu';
    return c.json({ error: msg }, 500);
  }
});

studio.post('/projects/:id/git/commit', async (c) => {
  const project = await getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const body = (await c.req.json()) as { message?: string; files?: string[] };
  if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
    return c.json({ error: 'Commit message is required' }, 400);
  }
  if (Array.isArray(body.files)) {
    for (const f of body.files) {
      if (typeof f !== 'string' || f.includes('..')) return c.json({ error: `Invalid file path: ${f}` }, 400);
    }
  }

  try {
    const commitHash = await gitManager.commitChanges(
      project.repoPath, body.message.trim(),
      body.files && body.files.length > 0 ? body.files : undefined,
    );
    return c.json({ commit: commitHash, message: body.message.trim() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to commit changes';
    return c.json({ error: msg }, msg.includes('Nothing to commit') ? 422 : 500);
  }
});

// ---- Event Stream (SSE) ---------------------------------------------------

studio.get('/projects/:id/events', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  return streamSSE(c, async (stream) => {
    // Send recent events first
    const recent = await listEvents(projectId, 20);
    for (const event of recent.reverse()) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
        id: event.id,
      });
    }

    // Subscribe to new events
    const unsubscribe = eventBus.onProject(projectId, async (event) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: event.id,
        });
      } catch {
        unsubscribe();
      }
    });

    stream.onAbort(() => {
      unsubscribe();
    });
  });
});

// ---- Recent events (REST) -------------------------------------------------

studio.get('/projects/:id/events/recent', async (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  return c.json(await listEvents(c.req.param('id'), limit));
});

// ---- Config status --------------------------------------------------------

studio.get('/config/status', async (c) => {
  // Veritabanındaki varsayılan provider bilgisini de döndür
  const defaultProvider = await getDefaultProvider();

  return c.json({
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    providerConfigured: isAnyProviderConfigured(),
    providerName: defaultProvider?.name,
  });
});

// ---- AI Providers ---------------------------------------------------------

studio.get('/providers', async (c) => {
  return c.json(await listProviders());
});

studio.post('/providers', async (c) => {
  const body = (await c.req.json()) as {
    name: string;
    type?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    isActive?: boolean;
  };

  if (!body.name?.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  const provider = await createProvider({
    name: body.name.trim(),
    type: (body.type ?? 'openai') as any,
    apiKey: body.apiKey ?? '',
    baseUrl: body.baseUrl ?? '',
    model: body.model ?? '',
    isActive: body.isActive !== false,
  });

  return c.json(provider, 201);
});

// ---- Fallback Chain — parametreli /:id rotasından ÖNCE tanımlanmalı -------

/**
 * GET /providers/fallback-chain
 * Aktif provider'ları fallback_order'a göre sıralı döndürür.
 * Default provider her zaman başta gelir.
 * NOT: Bu route /:id rotasından önce tanımlanmalıdır; aksi takdirde
 * Hono "fallback-chain" string'ini ID parametresi olarak yakalar.
 */
studio.get('/providers/fallback-chain', async (c) => {
  return c.json(await getFallbackChain());
});

/**
 * PUT /providers/fallback-chain
 * Body: { orderedIds: string[] }
 * Provider'ların fallback sıralamasını toplu olarak günceller.
 * orderedIds dizisinin sırası fallback önceliğini belirler (0-indexed).
 */
studio.put('/providers/fallback-chain', async (c) => {
  const body = (await c.req.json()) as { orderedIds?: string[] };

  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return c.json({ error: 'orderedIds array is required' }, 400);
  }

  await updateFallbackOrder(body.orderedIds);
  return c.json(await getFallbackChain());
});

// ---------------------------------------------------------------------------

studio.get('/providers/:id', async (c) => {
  const provider = await getProvider(c.req.param('id'));
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json(provider);
});

studio.put('/providers/:id', async (c) => {
  const body = (await c.req.json()) as {
    name?: string;
    type?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    isActive?: boolean;
  };

  const provider = await updateProvider(c.req.param('id'), {
    name: body.name,
    type: body.type as any,
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
    model: body.model,
    isActive: body.isActive,
  });

  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json(provider);
});

studio.delete('/providers/:id', async (c) => {
  const result = await deleteProvider(c.req.param('id'));
  if (!result.success) {
    return c.json({ error: result.error }, result.error === 'Provider not found' ? 404 : 400);
  }
  return c.json({ success: true });
});

studio.post('/providers/:id/default', async (c) => {
  const provider = await setDefaultProvider(c.req.param('id'));
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json(provider);
});

studio.post('/providers/:id/test', async (c) => {
  const provider = await getProvider(c.req.param('id'));
  if (!provider) return c.json({ error: 'Provider not found' }, 404);

  if (provider.type !== 'openai') {
    return c.json({ valid: true, message: 'Validation not available for this provider type' });
  }

  try {
    const apiKey = await getRawProviderApiKey(provider.id);
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      return c.json({ valid: true, message: 'Connection successful' });
    }

    const errorBody = await res.json().catch(() => ({}));
    return c.json({
      valid: false,
      message: (errorBody as any)?.error?.message ?? `HTTP ${res.status}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return c.json({ valid: false, message: msg });
  }
});

// ---- Org Structure helpers ------------------------------------------------

interface OrgNode {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  pipelineOrder: number;
  children: OrgNode[];
}

function buildOrgTree(agents: ProjectAgent[]): OrgNode[] {
  const nodeMap = new Map<string, OrgNode>();

  for (const a of agents) {
    nodeMap.set(a.id, {
      id: a.id,
      name: a.name,
      role: a.role,
      avatar: a.avatar,
      color: a.color,
      pipelineOrder: a.pipelineOrder,
      children: [],
    });
  }

  const roots: OrgNode[] = [];

  for (const a of agents) {
    const node = nodeMap.get(a.id)!;
    if (a.reportsTo && nodeMap.has(a.reportsTo)) {
      nodeMap.get(a.reportsTo)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---- Org Structure endpoints ----------------------------------------------
// NOTE: The GET /team/org route is defined above (before /team/:agentId) to prevent route conflict.

// Update agent hierarchy (set reports_to and optional pipeline_order)
studio.put('/projects/:id/team/:agentId/hierarchy', async (c) => {
  const agentId = c.req.param('agentId');
  const existing = await getProjectAgent(agentId);
  if (!existing || existing.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const body = (await c.req.json()) as { reportsTo: string | null; pipelineOrder?: number };
  const updated = await updateProjectAgent(agentId, {
    reportsTo: body.reportsTo ?? undefined,
    pipelineOrder: body.pipelineOrder,
  });
  return c.json(updated);
});

// ---- Pipeline Engine Routes -----------------------------------------------
// Pipeline'ı başlatma, durum sorgulama, durdurma ve devam ettirme endpoint'leri

// POST /projects/:id/pipeline/start — pipeline'ı başlatır
studio.post('/projects/:id/pipeline/start', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const state = pipelineEngine.startPipeline(projectId);
    return c.json({ success: true, pipeline: state }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipeline başlatılamadı';
    return c.json({ error: msg }, 500);
  }
});

// GET /projects/:id/pipeline/status — mevcut pipeline durumunu task durumlarıyla birlikte döner
studio.get('/projects/:id/pipeline/status', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // Zenginleştirilmiş durum: pipeline state + task progress + derived status
  const enriched = await pipelineEngine.getEnrichedPipelineStatus(projectId);

  // Pipeline kaydı hiç yoksa ve task'lar da çalışmıyorsa 404 dön
  if (!enriched.pipelineState && enriched.taskProgress.overall.total === 0) {
    return c.json({ error: 'Bu proje için pipeline kaydı bulunamadı' }, 404);
  }

  // Pipeline stage'lerindeki task status'larını DB'den güncel haliyle eşleştir
  // Pipeline in-memory state oluşturulduğunda task'lar kopyalanıyor ama
  // execution sırasında DB'deki status güncellenirken pipeline kopyası stale kalıyor.
  const pipelineState = enriched.pipelineState;
  if (pipelineState?.stages) {
    for (const stage of pipelineState.stages) {
      if (stage.tasks) {
        for (let i = 0; i < stage.tasks.length; i++) {
          const fresh = await getTask(stage.tasks[i].id);
          if (fresh) {
            stage.tasks[i] = { ...stage.tasks[i], ...fresh };
          }
        }
      }
    }
  }

  return c.json({
    // Ham pipeline state (null olabilir — kayıt henüz oluşmamışsa)
    pipeline: pipelineState,
    // Task engine'den gelen anlık ilerleme
    taskProgress: enriched.taskProgress,
    // Task durumlarına göre türetilen gerçek durum
    // (pipeline kaydı "failed" olsa bile task'lar çalışıyorsa "running" gösterilir)
    status: enriched.derivedStatus,
    // Uyarı mesajı (pipeline/task durumları uyuşmuyorsa)
    warning: enriched.warning,
  });
});

// POST /projects/:id/pipeline/pause — pipeline'ı duraklatır
studio.post('/projects/:id/pipeline/pause', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    pipelineEngine.pausePipeline(projectId);
    return c.json({ success: true, message: 'Pipeline duraklatıldı' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipeline duraklatılamadı';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/pipeline/resume — duraklatılmış pipeline'ı devam ettirir
studio.post('/projects/:id/pipeline/resume', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    pipelineEngine.resumePipeline(projectId);
    return c.json({ success: true, message: 'Pipeline devam ettirildi' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipeline devam ettirilemedi';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/pipeline/retry — failed pipeline'ı yeniden başlatır
studio.post('/projects/:id/pipeline/retry', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    await pipelineEngine.retryFailedPipeline(projectId);
    return c.json({ success: true, message: 'Failed pipeline yeniden başlatıldı' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipeline retry başarısız';
    return c.json({ error: msg }, 400);
  }
});

// POST /projects/:id/pipeline/advance — manuel olarak bir sonraki aşamaya geçer (test amaçlı)
studio.post('/projects/:id/pipeline/advance', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const state = pipelineEngine.advanceStage(projectId);
    return c.json({ success: true, pipeline: state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipeline ilerletilemedi';
    return c.json({ error: msg }, 400);
  }
});

// ---- Analytics Routes -------------------------------------------------------

studio.get('/projects/:id/analytics/overview', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  try {
    return c.json(await getProjectAnalytics(projectId));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Analytics hesaplanamadı' }, 500);
  }
});

studio.get('/projects/:id/analytics/agents', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  try {
    return c.json(await getAgentAnalytics(projectId));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Ajan metrikleri hesaplanamadı' }, 500);
  }
});

studio.get('/projects/:id/analytics/timeline', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '7', 10) || 7, 1), 30);
  try {
    return c.json(await getActivityTimeline(projectId, days));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Zaman çizelgesi hesaplanamadı' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

studio.get('/projects/:id/costs', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await getProjectCostSummary(projectId));
});

studio.get('/projects/:id/costs/breakdown', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await getProjectCostBreakdown(projectId));
});

studio.get('/projects/:id/costs/history', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await listTokenUsage(projectId));
});

// ---------------------------------------------------------------------------
// Project Settings — CRUD
// ---------------------------------------------------------------------------

studio.get('/projects/:id/settings', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await getProjectSettingsMap(projectId));
});

studio.put('/projects/:id/settings/:category', async (c) => {
  const projectId = c.req.param('id');
  const category = c.req.param('category');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<Record<string, string>>();
  await setProjectSettings(projectId, category, body);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Docs Freshness Check
// ---------------------------------------------------------------------------

studio.get('/projects/:id/docs/freshness', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);
  const results = await checkDocsFreshness(project.repoPath);
  return c.json(results);
});

studio.post('/projects/:id/docs/regenerate', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  const tasks = await listProjectTasks(projectId);
  const doneTasks = tasks.filter((t) => t.status === 'done');

  // Build agent lookup map
  const agents = new Map<string, any>();
  for (const task of doneTasks) {
    if (!task.assignedAgent || agents.has(task.assignedAgent)) continue;
    const agent = await getAgentConfig(task.assignedAgent) ?? await getProjectAgent(task.assignedAgent);
    if (agent) agents.set(task.assignedAgent, agent);
  }

  const updated = await regenerateAllDocs(project, doneTasks, agents);
  return c.json({ regenerated: updated, total: doneTasks.length });
});

// ---------------------------------------------------------------------------
// SonarQube — scan / status / quality gate
// ---------------------------------------------------------------------------

studio.get('/projects/:id/sonar/status', async (c) => {
  const projectId = c.req.param('id');
  return c.json({ enabled: await isSonarEnabled(projectId) });
});

studio.post('/projects/:id/sonar/scan', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!project.repoPath) return c.json({ error: 'No repo path configured' }, 400);

  if (!await isSonarEnabled(projectId)) {
    return c.json({ error: 'SonarQube is not enabled. Set SONAR_ENABLED=true or enable in project settings.' }, 400);
  }

  // Ensure sonar config exists
  await initSonarConfig(project.repoPath, `studio-${projectId}`, project.name);

  const scanResult = await runSonarScan(project.repoPath, undefined, projectId);
  if (!scanResult.success) {
    return c.json({ error: scanResult.error || 'Scan failed', output: scanResult.output }, 500);
  }

  // Fetch quality gate after scan
  const gate = await fetchQualityGate(`studio-${projectId}`, projectId);
  const scanId = await recordSonarScan(projectId, gate, scanResult.output);

  return c.json({ scanId, qualityGate: gate });
});

studio.get('/projects/:id/sonar/latest', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const scan = await getLatestSonarScan(projectId);
  return c.json(scan ?? { status: 'NONE', conditions: [] });
});

// ---------------------------------------------------------------------------
// App Runner — start / stop / status
// ---------------------------------------------------------------------------

import { startApp, stopApp, getAppStatus, getResolvedConfig } from './app-runner.js';

studio.post('/projects/:id/app/start', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const result = await startApp(projectId, project.repoPath, (msg) => {
      eventBus.emitTransient({ projectId, type: 'agent:output', payload: { output: msg } });
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'App başlatılamadı' }, 500);
  }
});

studio.post('/projects/:id/app/stop', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  await stopApp(projectId);
  return c.json({ ok: true });
});

studio.get('/projects/:id/app/status', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  return c.json(getAppStatus(projectId));
});

studio.get('/projects/:id/app/config', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const config = getResolvedConfig(project.repoPath);
  return c.json(config ?? { services: [], preview: '' });
});

// (Worker/container endpoints removed — all execution is now CLI-only)

// ---- Agent Dependencies (v2 org structure) --------------------------------

studio.get('/projects/:id/dependencies', async (c) => {
  const projectId = c.req.param('id');
  const type = c.req.query('type') as DependencyType | undefined;
  return c.json(await listAgentDependencies(projectId, type));
});

studio.post('/projects/:id/dependencies', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json<{ fromAgentId: string; toAgentId: string; type?: DependencyType }>();
  if (!body.fromAgentId || !body.toAgentId) {
    return c.json({ error: 'fromAgentId and toAgentId required' }, 400);
  }
  const dep = await createAgentDependency(projectId, body.fromAgentId, body.toAgentId, body.type ?? 'workflow');
  return c.json(dep, 201);
});

studio.put('/projects/:id/dependencies', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json<{ dependencies: { fromAgentId: string; toAgentId: string; type: DependencyType }[] }>();
  await deleteAllDependencies(projectId);
  const deps = await bulkCreateDependencies(projectId, body.dependencies ?? []);
  return c.json(deps);
});

studio.delete('/projects/:id/dependencies/:depId', async (c) => {
  const depId = c.req.param('depId');
  await deleteAgentDependency(depId);
  return c.json({ ok: true });
});

// ---- Agent Capabilities (file scope restrictions) -------------------------

studio.get('/projects/:id/capabilities', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.query('agentId');
  return c.json(await listAgentCapabilities(projectId, agentId));
});

studio.post('/projects/:id/capabilities', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json<{
    agentId: string;
    pattern: string;
    scopeType?: CapabilityScopeType;
    permission?: CapabilityPermission;
  }>();
  if (!body.agentId || !body.pattern) {
    return c.json({ error: 'agentId and pattern required' }, 400);
  }
  const cap = await createAgentCapability(body.agentId, projectId, body.pattern, body.scopeType, body.permission);
  return c.json(cap, 201);
});

studio.delete('/projects/:id/capabilities/:capId', async (c) => {
  const capId = c.req.param('capId');
  await deleteAgentCapability(capId);
  return c.json({ ok: true });
});

studio.delete('/projects/:id/capabilities', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.query('agentId');
  await deleteAllCapabilities(projectId, agentId);
  return c.json({ ok: true });
});

// ---- README Auto-Generation -----------------------------------------------

/**
 * POST /projects/:id/generate-readme
 * Proje bilgilerinden README.md oluşturur ve repo köküne yazar.
 * Proje tamamlanmamış olsa da manuel tetikleme desteklenir.
 */
studio.post('/projects/:id/generate-readme', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  if (!project.repoPath) {
    return c.json({ error: 'Project has no repository path' }, 400);
  }

  const logs: string[] = [];
  try {
    await generateReadme(projectId, (msg) => logs.push(msg));
    return c.json({ success: true, logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg, logs }, 500);
  }
});

// ---- Webhooks ----------------------------------------------------------------
// Proje bazlı webhook yönetimi: liste, oluştur, güncelle, sil, test

// GET /projects/:id/webhooks — projeye ait webhook'ları listele
studio.get('/projects/:id/webhooks', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(await listWebhooks(projectId));
});

// POST /projects/:id/webhooks — yeni webhook oluştur
studio.post('/projects/:id/webhooks', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as {
    name?: string;
    url?: string;
    type?: string;
    events?: string[];
  };

  // Zorunlu alan kontrolü
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  if (!body.url?.trim()) return c.json({ error: 'url is required' }, 400);

  // URL doğrulaması — güvenli HTTPS veya geliştirme ortamı için HTTP kabul edilir
  const url = body.url.trim();
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    return c.json({ error: 'url must start with https:// (or http:// for local dev)' }, 400);
  }

  // Desteklenen webhook türleri
  const validTypes: Webhook['type'][] = ['slack', 'discord', 'generic'];
  const type = (body.type ?? 'generic') as Webhook['type'];
  if (!validTypes.includes(type)) {
    return c.json({ error: `type must be one of: ${validTypes.join(', ')}` }, 400);
  }

  const webhook = await createWebhook({
    projectId,
    name: body.name.trim(),
    url,
    type,
    events: Array.isArray(body.events) ? body.events : [],
  });

  return c.json(webhook, 201);
});

// PUT /projects/:id/webhooks/:webhookId — webhook güncelle
studio.put('/projects/:id/webhooks/:webhookId', async (c) => {
  const projectId = c.req.param('id');
  const webhookId = c.req.param('webhookId');

  const existing = await getWebhook(webhookId);
  if (!existing || existing.projectId !== projectId) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  const body = (await c.req.json()) as {
    name?: string;
    url?: string;
    type?: string;
    events?: string[];
    active?: boolean;
  };

  // URL güncelleniyorsa doğrula
  if (body.url !== undefined) {
    const url = body.url.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      return c.json({ error: 'url must start with https:// (or http:// for local dev)' }, 400);
    }
  }

  const updated = await updateWebhook(webhookId, {
    name: body.name?.trim(),
    url: body.url?.trim(),
    type: body.type as Webhook['type'] | undefined,
    events: body.events,
    active: body.active,
  });

  return c.json(updated);
});

// DELETE /projects/:id/webhooks/:webhookId — webhook sil
studio.delete('/projects/:id/webhooks/:webhookId', async (c) => {
  const projectId = c.req.param('id');
  const webhookId = c.req.param('webhookId');

  const existing = await getWebhook(webhookId);
  if (!existing || existing.projectId !== projectId) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  const ok = await deleteWebhook(webhookId);
  if (!ok) return c.json({ error: 'Webhook could not be deleted' }, 500);
  return c.json({ success: true });
});

// POST /projects/:id/webhooks/:webhookId/test — test bildirimi gönder
studio.post('/projects/:id/webhooks/:webhookId/test', async (c) => {
  const projectId = c.req.param('id');
  const webhookId = c.req.param('webhookId');

  const project = await getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const webhook = await getWebhook(webhookId);
  if (!webhook || webhook.projectId !== projectId) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  // Test payload — gerçek event'leri simüle eder
  try {
    await sendWebhookNotification(projectId, 'test', {
      message: 'Bu bir test bildirimidir — AI Dev Studio',
      projectName: project.name,
      webhookName: webhook.name,
      webhookType: webhook.type,
    });
    return c.json({ success: true, message: 'Test bildirimi gonderildi' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Test bildirimi gonderilemedi';
    return c.json({ error: msg }, 500);
  }
});

export { studio as studioRoutes };
