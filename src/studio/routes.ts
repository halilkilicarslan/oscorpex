// ---------------------------------------------------------------------------
// AI Dev Studio — Hono API Routes
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { streamText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
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
} from './db.js';
import { eventBus } from './event-bus.js';
import { PM_SYSTEM_PROMPT, pmToolkit } from './pm-agent.js';
import { taskEngine } from './task-engine.js';
import { containerManager } from './container-manager.js';
import { gitManager } from './git-manager.js';

// Ensure preset agents exist
seedPresetAgents();

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
  };
  const project = createProject({
    name: body.name,
    description: body.description ?? '',
    techStack: body.techStack ?? [],
    repoPath: '',
  });

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
  if (!process.env.OPENAI_API_KEY) {
    return c.json({ error: 'OPENAI_API_KEY is not configured. Set it in your .env file.' }, 503);
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

  // Build system prompt with project context
  const systemPrompt = `${PM_SYSTEM_PROMPT}

[Current Project Context]
Project ID: ${projectId}
Project Name: ${project.name}
Status: ${project.status}
Tech Stack: ${project.techStack.join(', ') || 'Not decided yet'}
Description: ${project.description || 'No description yet'}`;

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
        model: openai('gpt-4o-mini'),
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

  let execution: { started: boolean; readyTasks: { id: string; title: string }[] } = {
    started: false,
    readyTasks: [],
  };

  try {
    const readyTasks = taskEngine.beginExecution(projectId);
    execution = {
      started: true,
      readyTasks: readyTasks.map((t) => ({ id: t.id, title: t.title })),
    };

    eventBus.emit({
      projectId,
      type: 'execution:started',
      payload: { planId: plan.id, readyTaskCount: readyTasks.length },
    });
  } catch (_execError) {
    // Execution failed to start — plan remains approved but project stays in approved state
    updateProject(projectId, { status: 'approved' });
    return c.json({ success: true, planId: plan.id, execution });
  }

  return c.json({ success: true, planId: plan.id, execution });
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

studio.post('/projects/:id/execute', (c) => {
  const projectId = c.req.param('id');
  try {
    const readyTasks = taskEngine.beginExecution(projectId);
    return c.json({ success: true, readyTasks: readyTasks.map((t) => ({ id: t.id, title: t.title })) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Execution failed';
    return c.json({ error: msg }, 400);
  }
});

studio.get('/projects/:id/progress', (c) => {
  return c.json(taskEngine.getProgress(c.req.param('id')));
});

// ---- Tasks ----------------------------------------------------------------

studio.get('/projects/:id/tasks', (c) => {
  return c.json(listProjectTasks(c.req.param('id')));
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

  // Extract file path from wildcard
  const filePath = c.req.path.replace(`/projects/${c.req.param('id')}/files/`, '');
  if (!filePath) return c.json({ error: 'File path required' }, 400);

  try {
    const content = await gitManager.getFileContent(project.repoPath, filePath);
    return c.json({ path: filePath, content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to read file';
    return c.json({ error: msg }, 404);
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
  return c.json({ openaiConfigured: !!process.env.OPENAI_API_KEY });
});

export { studio as studioRoutes };
