// ---------------------------------------------------------------------------
// AI Dev Studio — Hono API Routes
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { streamText, stepCountIs } from 'ai';
import { getAIModel, isAnyProviderConfigured } from './ai-provider-factory.js';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
} from './db.js';
import { eventBus } from './event-bus.js';
import { PM_SYSTEM_PROMPT, pmToolkit } from './pm-agent.js';
import { taskEngine } from './task-engine.js';
import { containerManager } from './container-manager.js';
import { executionEngine } from './execution-engine.js';
import { gitManager } from './git-manager.js';
import {
  createAgentFiles,
  updateAgentFiles,
  readAgentFile,
  listAgentFiles,
  writeAgentFile,
  deleteAgentFiles,
} from './agent-files.js';

// Preset agentları ve takım şablonlarını başlat
seedPresetAgents();
seedTeamTemplates();

const studio = new Hono();

// ---- Projects CRUD --------------------------------------------------------

studio.get('/projects', (c) => {
  return c.json(listProjects());
});

studio.post('/projects', async (c) => {
  const body = (await c.req.json()) as {
    name: string;
    description?: string;
    techStack?: string[];
    // İsteğe bağlı takım şablonu — belirtilmezse Full Stack Team varsayılan olarak seçilir
    teamTemplateId?: string;
  };
  const project = createProject({
    name: body.name,
    description: body.description ?? '',
    techStack: body.techStack ?? [],
    repoPath: '',
  });

  // Proje oluşturulduktan sonra takım şablonundan agentları kopyala
  const templateId = body.teamTemplateId;
  if (templateId) {
    // Kullanıcının belirttiği şablon
    const template = getTeamTemplate(templateId);
    if (template) {
      const copiedAgents = copyAgentsToProject(project.id, template.roles);
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
    const templates = listTeamTemplates();
    const fullStack = templates.find((t) => t.name === 'Full Stack Team');
    if (fullStack) {
      const copiedAgents = copyAgentsToProject(project.id, fullStack.roles);
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
    updateProject(project.id, { repoPath });
    return c.json({ ...project, repoPath }, 201);
  } catch {
    // Repo init failed — return the project without a repoPath
    return c.json(project, 201);
  }
});

studio.get('/projects/:id', (c) => {
  const project = getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(project);
});

studio.patch('/projects/:id', async (c) => {
  const body = await c.req.json();
  const project = updateProject(c.req.param('id'), body);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(project);
});

studio.delete('/projects/:id', (c) => {
  const ok = deleteProject(c.req.param('id'));
  if (!ok) return c.json({ error: 'Project not found' }, 404);
  return c.json({ success: true });
});

// ---- PM Chat (SSE streaming) ----------------------------------------------

studio.post('/projects/:id/chat', async (c) => {
  // Veritabanında varsayılan provider yoksa ve OPENAI_API_KEY de ayarlanmamışsa hata döndür
  if (!isAnyProviderConfigured()) {
    return c.json(
      { error: 'No AI provider configured. Add a provider in Settings or set OPENAI_API_KEY in your .env file.' },
      503,
    );
  }

  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as { message: string };
  const userMessage = body.message;

  // Persist user message
  insertChatMessage({ projectId, role: 'user', content: userMessage });

  // Build conversation history for context
  const history = listChatMessages(projectId);

  // Projeye özel takım bilgisini al (project_agents tablosundan)
  const agents = listProjectAgents(projectId);
  const teamInfo = agents
    .map((a) => `- ${a.avatar} **${a.name}** (${a.role}) — ${a.personality}. Skills: ${a.skills.join(', ')}`)
    .join('\n');

  // Build system prompt with project context + team info
  const systemPrompt = `${PM_SYSTEM_PROMPT}

[Current Project Context]
Project ID: ${projectId}
Project Name: ${project.name}
Status: ${project.status}
Tech Stack: ${project.techStack.join(', ') || 'Not decided yet'}
Description: ${project.description || 'No description yet'}

[Your Team — ${agents.length} agents]
${teamInfo}`;

  // Prepare messages for AI SDK
  const messages = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Stream response via SSE
  return streamSSE(c, async (stream) => {
    let fullResponse = '';

    try {
      const result = streamText({
        // Veritabanındaki varsayılan provider'ı kullan; yoksa gpt-4o-mini'ye geri dön
        model: getAIModel(),
        system: systemPrompt,
        messages,
        tools: pmToolkit,
        stopWhen: stepCountIs(5),
      });

      for await (const part of result.textStream) {
        fullResponse += part;
        await stream.writeSSE({
          event: 'text-delta',
          data: JSON.stringify({ text: part }),
        });
      }

      // Persist assistant response
      if (fullResponse) {
        insertChatMessage({ projectId, role: 'assistant', content: fullResponse });
      }

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message: 'Stream completed' }),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: errorMsg }),
      });
    }
  });
});

studio.get('/projects/:id/chat/history', (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(listChatMessages(projectId));
});

// ---- Plans ----------------------------------------------------------------

studio.get('/projects/:id/plan', (c) => {
  const plan = getLatestPlan(c.req.param('id'));
  if (!plan) return c.json({ error: 'No plan found' }, 404);
  return c.json(plan);
});

studio.post('/projects/:id/plan/approve', (c) => {
  const projectId = c.req.param('id');
  const plan = getLatestPlan(projectId);
  if (!plan) return c.json({ error: 'No plan found' }, 404);
  if (plan.status !== 'draft') return c.json({ error: 'Plan is not in draft status' }, 400);

  updatePlanStatus(plan.id, 'approved');

  eventBus.emit({
    projectId,
    type: 'plan:approved',
    payload: { planId: plan.id },
  });

  // Start actual execution in the background — executionEngine calls
  // taskEngine.beginExecution internally and dispatches all tasks.
  executionEngine.startProjectExecution(projectId).catch((err) => {
    console.error('[execution-engine] startProjectExecution failed:', err);
  });

  return c.json({ success: true, planId: plan.id, execution: { started: true } });
});

studio.post('/projects/:id/plan/reject', async (c) => {
  const plan = getLatestPlan(c.req.param('id'));
  if (!plan) return c.json({ error: 'No plan found' }, 404);
  if (plan.status !== 'draft') return c.json({ error: 'Plan is not in draft status' }, 400);

  const body = (await c.req.json()) as { feedback?: string };
  updatePlanStatus(plan.id, 'rejected');

  return c.json({ success: true, planId: plan.id, feedback: body.feedback });
});

// ---- Execution ------------------------------------------------------------

// Manual trigger to start or resume execution for a project.
studio.post('/projects/:id/execute', (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // Fire and forget — progress is observable via SSE events and /progress
  executionEngine.startProjectExecution(projectId).catch((err) => {
    console.error('[execution-engine] manual execute failed:', err);
  });

  return c.json({ success: true, message: 'Execution started' });
});

// Execution status snapshot: running containers + task progress.
studio.get('/projects/:id/execution/status', (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(executionEngine.getExecutionStatus(projectId));
});

studio.get('/projects/:id/progress', (c) => {
  return c.json(taskEngine.getProgress(c.req.param('id')));
});

// ---- Tasks ----------------------------------------------------------------

studio.get('/projects/:id/tasks', (c) => {
  const tasks = listProjectTasks(c.req.param('id'));

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

studio.get('/projects/:id/tasks/:taskId', (c) => {
  const task = getTask(c.req.param('taskId'));
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

studio.patch('/projects/:id/tasks/:taskId', async (c) => {
  const body = await c.req.json();
  const task = updateTask(c.req.param('taskId'), body);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

studio.post('/projects/:id/tasks/:taskId/retry', (c) => {
  try {
    const updated = taskEngine.retryTask(c.req.param('taskId'));
    return c.json({ success: true, task: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Retry failed';
    return c.json({ error: msg }, 400);
  }
});

// GET /projects/:id/tasks/:taskId/logs
// Returns stored logs from task.output.logs as JSON.
// For still-running tasks also appends the agent's live terminal buffer.
studio.get('/projects/:id/tasks/:taskId/logs', (c) => {
  const task = getTask(c.req.param('taskId'));
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
studio.get('/projects/:id/tasks/:taskId/output', (c) => {
  const task = getTask(c.req.param('taskId'));
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

  const task = getTask(taskId);
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
          if (text) appendTaskLogs(taskId, [text]);
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

studio.get('/agents', (c) => {
  return c.json(listAgentConfigs());
});

studio.get('/agents/presets', (c) => {
  return c.json(listPresetAgents());
});

studio.post('/agents', async (c) => {
  const body = await c.req.json();
  const agent = createAgentConfig({ ...body, isPreset: false });
  return c.json(agent, 201);
});

studio.get('/agents/:id', (c) => {
  const agent = getAgentConfig(c.req.param('id'));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

studio.put('/agents/:id', async (c) => {
  const body = await c.req.json();
  const agent = updateAgentConfig(c.req.param('id'), body);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

studio.delete('/agents/:id', (c) => {
  const ok = deleteAgentConfig(c.req.param('id'));
  if (!ok) return c.json({ error: 'Agent not found or is a preset' }, 404);
  return c.json({ success: true });
});

// ---- Team Templates -------------------------------------------------------

// Tüm takım şablonlarını listele
studio.get('/team-templates', (c) => {
  return c.json(listTeamTemplates());
});

// ---- Project Team (project_agents) ----------------------------------------

// Projenin takım üyelerini listele
studio.get('/projects/:id/team', (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(listProjectAgents(projectId));
});

// Projeye yeni takım üyesi ekle (manuel veya preset'ten kopyalama)
studio.post('/projects/:id/team', async (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
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
    const preset = getAgentConfig(body.sourceAgentId);
    if (!preset) return c.json({ error: 'Source agent not found' }, 404);
    const agent = createProjectAgent({
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

  const agent = createProjectAgent({
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

// Tekil proje agentını getir
studio.get('/projects/:id/team/:agentId', (c) => {
  const agent = getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  return c.json(agent);
});

// Proje agentını güncelle
studio.put('/projects/:id/team/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const existing = getProjectAgent(agentId);
  if (!existing || existing.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json();
  const updated = updateProjectAgent(agentId, body);
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
studio.delete('/projects/:id/team/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const existing = getProjectAgent(agentId);
  if (!existing || existing.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const ok = deleteProjectAgent(agentId);
  if (!ok) return c.json({ error: 'Agent not found' }, 404);
  deleteAgentFiles(c.req.param('id'), existing.name).catch(() => {});
  return c.json({ success: true });
});

// Şablondan agentları projeye toplu kopyala
studio.post('/projects/:id/team/from-template', async (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = (await c.req.json()) as { templateId: string };
  if (!body.templateId) return c.json({ error: 'templateId is required' }, 400);

  const template = getTeamTemplate(body.templateId);
  if (!template) return c.json({ error: 'Template not found' }, 404);

  const agents = copyAgentsToProject(projectId, template.roles);
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
  const agent = getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const files = await listAgentFiles(c.req.param('id'), agent.name);
  return c.json({ agentId: agent.id, agentName: agent.name, files });
});

// Read a specific .md file
studio.get('/projects/:id/team/:agentId/files/:fileName', async (c) => {
  const agent = getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const content = await readAgentFile(c.req.param('id'), agent.name, c.req.param('fileName'));
  if (content === null) return c.json({ error: 'File not found' }, 404);
  return c.json({ fileName: c.req.param('fileName'), content });
});

// Write/update a .md file
studio.put('/projects/:id/team/:agentId/files/:fileName', async (c) => {
  const agent = getProjectAgent(c.req.param('agentId'));
  if (!agent || agent.projectId !== c.req.param('id')) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const body = (await c.req.json()) as { content: string };
  await writeAgentFile(c.req.param('id'), agent.name, c.req.param('fileName'), body.content);
  return c.json({ success: true });
});

// ---- Container / Runtime --------------------------------------------------

studio.get('/projects/:id/agents/:agentId/status', (c) => {
  const runtime = containerManager.getRuntime(c.req.param('id'), c.req.param('agentId'));
  if (!runtime) return c.json({ error: 'No runtime found' }, 404);
  return c.json(runtime);
});

studio.get('/projects/:id/runtimes', (c) => {
  return c.json(containerManager.getAllRuntimes(c.req.param('id')));
});

studio.post('/projects/:id/agents/:agentId/start', async (c) => {
  const projectId = c.req.param('id');
  const agentId = c.req.param('agentId');

  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const agent = getAgentConfig(agentId);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  try {
    const containerId = await containerManager.createContainer(agent, project);
    return c.json({ success: true, containerId: containerId.slice(0, 12) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start container';
    return c.json({ error: msg }, 500);
  }
});

studio.post('/projects/:id/agents/:agentId/stop', async (c) => {
  try {
    await containerManager.stopContainer(c.req.param('id'), c.req.param('agentId'));
    return c.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to stop container';
    return c.json({ error: msg }, 500);
  }
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
  const project = getProject(c.req.param('id'));
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
  const project = getProject(c.req.param('id'));
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
  const project = getProject(c.req.param('id'));
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
  const project = getProject(c.req.param('id'));
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
  const project = getProject(c.req.param('id'));
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
  const project = getProject(c.req.param('id'));
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

// ---- Event Stream (SSE) ---------------------------------------------------

studio.get('/projects/:id/events', (c) => {
  const projectId = c.req.param('id');
  const project = getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  return streamSSE(c, async (stream) => {
    // Send recent events first
    const recent = listEvents(projectId, 20);
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

studio.get('/projects/:id/events/recent', (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  return c.json(listEvents(c.req.param('id'), limit));
});

// ---- Config status --------------------------------------------------------

studio.get('/config/status', (c) => {
  // Veritabanındaki varsayılan provider bilgisini de döndür
  const defaultProvider = getDefaultProvider();

  return c.json({
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    providerConfigured: isAnyProviderConfigured(),
    providerName: defaultProvider?.name,
  });
});

// ---- AI Providers ---------------------------------------------------------

studio.get('/providers', (c) => {
  return c.json(listProviders());
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

  const provider = createProvider({
    name: body.name.trim(),
    type: (body.type ?? 'openai') as any,
    apiKey: body.apiKey ?? '',
    baseUrl: body.baseUrl ?? '',
    model: body.model ?? '',
    isActive: body.isActive !== false,
  });

  return c.json(provider, 201);
});

studio.get('/providers/:id', (c) => {
  const provider = getProvider(c.req.param('id'));
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

  const provider = updateProvider(c.req.param('id'), {
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

studio.delete('/providers/:id', (c) => {
  const result = deleteProvider(c.req.param('id'));
  if (!result.success) {
    return c.json({ error: result.error }, result.error === 'Provider not found' ? 404 : 400);
  }
  return c.json({ success: true });
});

studio.post('/providers/:id/default', (c) => {
  const provider = setDefaultProvider(c.req.param('id'));
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json(provider);
});

studio.post('/providers/:id/test', async (c) => {
  const provider = getProvider(c.req.param('id'));
  if (!provider) return c.json({ error: 'Provider not found' }, 404);

  if (provider.type !== 'openai') {
    return c.json({ valid: true, message: 'Validation not available for this provider type' });
  }

  try {
    const apiKey = getRawProviderApiKey(provider.id);
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

export { studio as studioRoutes };
