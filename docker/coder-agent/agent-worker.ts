// ---------------------------------------------------------------------------
// AI Dev Studio — Agent Worker
// Runs inside isolated Docker container. Receives tasks via HTTP from host,
// executes them using AI SDK, and reports results back.
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.WORKER_PORT ?? '9900', 10);
const HOST_API = process.env.HOST_API ?? 'http://host.docker.internal:3141';
const WORKSPACE = process.env.WORKSPACE ?? '/workspace';
const AGENT_ID = process.env.AGENT_ID ?? '';
const AGENT_NAME = process.env.AGENT_NAME ?? 'Agent';
const AGENT_ROLE = process.env.AGENT_ROLE ?? 'coder';
const PROJECT_ID = process.env.PROJECT_ID ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRequest {
  taskId: string;
  prompt: string;
  systemPrompt?: string;
  repoPath?: string; // relative within /workspace
  timeout?: number;
}

interface TaskResult {
  status: 'completed' | 'failed';
  output: string;
  filesCreated: string[];
  filesModified: string[];
  logs: string[];
  exitCode: number;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// File system tools — sandboxed to /workspace
// ---------------------------------------------------------------------------

function safePath(filePath: string): string {
  // Prevent path traversal
  const resolved = join(WORKSPACE, filePath.replace(/\.\.\//g, ''));
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error(`Path traversal blocked: ${filePath}`);
  }
  return resolved;
}

const filesCreated: string[] = [];
const filesModified: string[] = [];
const logs: string[] = [];

async function toolReadFile(args: { path: string }): Promise<string> {
  const p = safePath(args.path);
  logs.push(`[read] ${args.path}`);
  return readFile(p, 'utf-8');
}

async function toolWriteFile(args: { path: string; content: string }): Promise<string> {
  const p = safePath(args.path);
  let existed = false;
  try {
    await stat(p);
    existed = true;
  } catch { /* file doesn't exist */ }

  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, args.content, 'utf-8');

  if (existed) {
    if (!filesModified.includes(args.path)) filesModified.push(args.path);
  } else {
    if (!filesCreated.includes(args.path)) filesCreated.push(args.path);
  }
  logs.push(`[write] ${args.path} (${existed ? 'modified' : 'created'})`);
  return `File ${existed ? 'modified' : 'created'}: ${args.path}`;
}

async function toolListFiles(args: { path?: string; recursive?: boolean }): Promise<string> {
  const dir = safePath(args.path ?? '.');
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = args.path ? `${args.path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(`${rel}/`);
      if (args.recursive) {
        const sub = await toolListFiles({ path: rel, recursive: true });
        result.push(...sub.split('\n').filter(Boolean));
      }
    } else {
      result.push(rel);
    }
  }
  logs.push(`[list] ${args.path ?? '.'} (${result.length} items)`);
  return result.join('\n');
}

function toolRunCommand(args: { command: string }): string {
  // Block dangerous commands
  const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /'];
  if (blocked.some((b) => args.command.includes(b))) {
    throw new Error(`Blocked dangerous command: ${args.command}`);
  }
  logs.push(`[exec] ${args.command}`);
  try {
    const output = execSync(args.command, {
      cwd: WORKSPACE,
      timeout: 30_000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 5,
    });
    return output;
  } catch (err: any) {
    return `Command failed (exit ${err.status}): ${err.stderr || err.message}`;
  }
}

function toolCommitChanges(args: { message: string; files?: string[] }): string {
  try {
    if (args.files?.length) {
      execSync(`git add ${args.files.map((f) => `"${f}"`).join(' ')}`, { cwd: WORKSPACE });
    } else {
      execSync('git add -A', { cwd: WORKSPACE });
    }
    execSync(`git commit -m "${args.message.replace(/"/g, '\\"')}"`, { cwd: WORKSPACE });
    logs.push(`[commit] ${args.message}`);
    return `Committed: ${args.message}`;
  } catch (err: any) {
    return `Commit failed: ${err.message}`;
  }
}

// Tool dispatcher
async function executeTool(call: ToolCall): Promise<string> {
  switch (call.name) {
    case 'readFile': return toolReadFile(call.args as any);
    case 'writeFile': return toolWriteFile(call.args as any);
    case 'listFiles': return toolListFiles(call.args as any);
    case 'runCommand': return toolRunCommand(call.args as any);
    case 'commitChanges': return toolCommitChanges(call.args as any);
    default: return `Unknown tool: ${call.name}`;
  }
}

// ---------------------------------------------------------------------------
// AI execution — calls host API to use AI model
// ---------------------------------------------------------------------------

async function executeWithAI(task: TaskRequest): Promise<string> {
  // Send to host API for AI generation (host manages model/provider)
  const res = await fetch(`${HOST_API}/api/studio/api/studio/worker/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      taskId: task.taskId,
      prompt: task.prompt,
      systemPrompt: task.systemPrompt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Host AI API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { text: string; toolCalls?: ToolCall[] };

  // If AI returned tool calls, execute them and do a follow-up
  if (data.toolCalls && data.toolCalls.length > 0) {
    const toolResults: string[] = [];
    for (const call of data.toolCalls) {
      try {
        const result = await executeTool(call);
        toolResults.push(`[${call.name}] ${result.slice(0, 500)}`);
      } catch (err: any) {
        toolResults.push(`[${call.name}] Error: ${err.message}`);
      }
    }
    // Report tool results back for continued generation
    const followUp = await fetch(`${HOST_API}/api/studio/api/studio/worker/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        taskId: task.taskId,
        prompt: `Tool results:\n${toolResults.join('\n')}\n\nContinue with the task.`,
        systemPrompt: task.systemPrompt,
        isFollowUp: true,
      }),
    });
    if (followUp.ok) {
      const followData = await followUp.json() as { text: string; toolCalls?: ToolCall[] };
      return data.text + '\n' + followData.text;
    }
  }

  return data.text;
}

// ---------------------------------------------------------------------------
// Task handler
// ---------------------------------------------------------------------------

async function handleTask(task: TaskRequest): Promise<TaskResult> {
  // Reset tracking
  filesCreated.length = 0;
  filesModified.length = 0;
  logs.length = 0;

  try {
    // Notify host that task started
    await reportStatus('working', task.taskId);

    const output = await executeWithAI(task);

    await reportStatus('idle', task.taskId);

    return {
      status: 'completed',
      output,
      filesCreated: [...filesCreated],
      filesModified: [...filesModified],
      logs: [...logs],
      exitCode: 0,
    };
  } catch (err: any) {
    await reportStatus('error', task.taskId);
    return {
      status: 'failed',
      output: err.message,
      filesCreated: [...filesCreated],
      filesModified: [...filesModified],
      logs: [...logs, `Error: ${err.message}`],
      exitCode: 1,
    };
  }
}

async function reportStatus(status: string, taskId?: string): Promise<void> {
  try {
    await fetch(`${HOST_API}/api/studio/api/studio/worker/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, agentId: AGENT_ID, taskId, status }),
    });
  } catch { /* non-blocking */ }
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '/';

  // Health check
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready', agentId: AGENT_ID, agentName: AGENT_NAME }));
    return;
  }

  // Execute task
  if (url === '/task' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as TaskRequest;
      const result = await handleTask(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Execute single tool (for host-driven tool calling)
  if (url === '/tool' && req.method === 'POST') {
    try {
      const call = JSON.parse(await readBody(req)) as ToolCall;
      const result = await executeTool(call);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[agent-worker] ${AGENT_NAME} (${AGENT_ROLE}) ready on port ${PORT}`);
  reportStatus('idle');
});
