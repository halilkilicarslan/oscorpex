// ---------------------------------------------------------------------------
// Orenda — Container Manager
// Docker container operations for agent runtimes
// ---------------------------------------------------------------------------

import Dockerode from 'dockerode';
import { eventBus } from './event-bus.js';
import type {
  AgentConfig,
  Project,
  ContainerConfig,
  AgentRuntime,
  AgentRuntimeStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Docker client
// ---------------------------------------------------------------------------

const docker = new Dockerode();

const CODER_IMAGE = 'ai-dev-studio/coder:latest';
const TERMINAL_BUFFER_MAX = 500;

// In-memory runtime state (not persisted — ephemeral per server lifecycle)
const runtimes = new Map<string, AgentRuntime>();

function runtimeKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

// ---------------------------------------------------------------------------
// Container Manager
// ---------------------------------------------------------------------------

class ContainerManager {
  // -------------------------------------------------------------------------
  // Container lifecycle
  // -------------------------------------------------------------------------

  /** Build container config for an agent in a project */
  getContainerConfig(agent: AgentConfig, project: Project): ContainerConfig {
    return {
      image: CODER_IMAGE,
      name: `studio-${project.id.slice(0, 8)}-${agent.id.slice(0, 8)}`,
      volumes: [
        {
          source: project.repoPath || `/tmp/studio-workspaces/${project.id}`,
          target: '/workspace',
        },
      ],
      env: {
        AGENT_ID: agent.id,
        AGENT_NAME: agent.name,
        AGENT_ROLE: agent.role,
        PROJECT_ID: project.id,
        PROJECT_NAME: project.name,
        // API keys from host environment
        ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
        ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
      },
      networkMode: 'bridge',
      memoryLimit: '2g',
      cpuLimit: 2,
    };
  }

  /** Create and start a container for an agent */
  async createContainer(agent: AgentConfig, project: Project): Promise<string> {
    const config = this.getContainerConfig(agent, project);

    // Ensure workspace directory exists on host
    const workspaceDir = config.volumes[0].source;
    try {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(workspaceDir, { recursive: true });
    } catch {
      // ignore — directory may already exist
    }

    const container = await docker.createContainer({
      Image: config.image,
      name: config.name,
      Env: Object.entries(config.env).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        Binds: config.volumes.map((v) => `${v.source}:${v.target}`),
        Memory: parseMemoryLimit(config.memoryLimit),
        NanoCpus: config.cpuLimit * 1e9,
        NetworkMode: config.networkMode,
      },
      WorkingDir: '/workspace',
      Cmd: ['tail', '-f', '/dev/null'], // Keep alive
    });

    await container.start();

    const containerId = container.id;

    // Track runtime state
    const runtime: AgentRuntime = {
      agentId: agent.id,
      projectId: project.id,
      containerId,
      status: 'idle',
      terminalBuffer: [],
      branch: 'main',
      startedAt: new Date().toISOString(),
    };
    runtimes.set(runtimeKey(project.id, agent.id), runtime);

    eventBus.emit({
      projectId: project.id,
      type: 'agent:started',
      agentId: agent.id,
      payload: { containerId: containerId.slice(0, 12), name: agent.name },
    });

    return containerId;
  }

  /** Stop and remove a container */
  async stopContainer(projectId: string, agentId: string): Promise<void> {
    const key = runtimeKey(projectId, agentId);
    const runtime = runtimes.get(key);
    if (!runtime?.containerId) return;

    try {
      const container = docker.getContainer(runtime.containerId);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {
      // Container may already be stopped/removed
    }

    runtimes.delete(key);

    eventBus.emit({
      projectId,
      type: 'agent:stopped',
      agentId,
      payload: {},
    });
  }

  // -------------------------------------------------------------------------
  // Command execution
  // -------------------------------------------------------------------------

  /** Execute a command inside a container and return output */
  async execCommand(
    projectId: string,
    agentId: string,
    command: string[],
  ): Promise<{ exitCode: number; output: string }> {
    const runtime = this.getRuntime(projectId, agentId);
    if (!runtime?.containerId) {
      throw new Error(`No container for agent ${agentId} in project ${projectId}`);
    }

    this.updateRuntimeStatus(projectId, agentId, 'working');

    const container = docker.getContainer(runtime.containerId);
    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/workspace',
    });

    const stream = await exec.start({ Detach: false, Tty: false });
    const output = await collectStream(stream);

    // Append to terminal buffer
    const lines = output.split('\n');
    runtime.terminalBuffer.push(...lines);
    if (runtime.terminalBuffer.length > TERMINAL_BUFFER_MAX) {
      runtime.terminalBuffer.splice(0, runtime.terminalBuffer.length - TERMINAL_BUFFER_MAX);
    }

    // Emit output event
    eventBus.emitTransient({
      projectId,
      type: 'agent:output',
      agentId,
      payload: { output: output.slice(0, 2000) }, // Limit payload size
    });

    const inspect = await exec.inspect();
    const exitCode = inspect.ExitCode ?? -1;

    this.updateRuntimeStatus(projectId, agentId, 'idle');

    return { exitCode, output };
  }

  /** Execute a Claude Code CLI command for a task */
  async runClaudeCode(
    projectId: string,
    agentId: string,
    prompt: string,
  ): Promise<{ exitCode: number; output: string }> {
    return this.execCommand(projectId, agentId, [
      'claude',
      '--dangerously-skip-permissions',
      '--message',
      prompt,
    ]);
  }

  // -------------------------------------------------------------------------
  // Streaming (for WebSocket terminal)
  // -------------------------------------------------------------------------

  /** Attach to container stdout/stderr and call handler for each chunk */
  async streamOutput(
    projectId: string,
    agentId: string,
    onData: (data: string) => void,
    onEnd?: () => void,
  ): Promise<() => void> {
    const runtime = this.getRuntime(projectId, agentId);
    if (!runtime?.containerId) {
      throw new Error(`No container for agent ${agentId}`);
    }

    const container = docker.getContainer(runtime.containerId);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 50,
    });

    stream.on('data', (chunk: Buffer) => {
      const text = stripDockerHeader(chunk);
      if (text) {
        onData(text);
        // Also buffer
        runtime.terminalBuffer.push(...text.split('\n').filter(Boolean));
        if (runtime.terminalBuffer.length > TERMINAL_BUFFER_MAX) {
          runtime.terminalBuffer.splice(0, runtime.terminalBuffer.length - TERMINAL_BUFFER_MAX);
        }
      }
    });

    stream.on('end', () => {
      onEnd?.();
    });

    // Return cleanup function
    return () => {
      try { (stream as any).destroy?.(); } catch { /* ignore */ }
    };
  }

  // -------------------------------------------------------------------------
  // Runtime state
  // -------------------------------------------------------------------------

  getRuntime(projectId: string, agentId: string): AgentRuntime | undefined {
    return runtimes.get(runtimeKey(projectId, agentId));
  }

  getAllRuntimes(projectId: string): AgentRuntime[] {
    const result: AgentRuntime[] = [];
    for (const [key, runtime] of runtimes) {
      if (key.startsWith(`${projectId}:`)) {
        result.push(runtime);
      }
    }
    return result;
  }

  updateRuntimeStatus(projectId: string, agentId: string, status: AgentRuntimeStatus): void {
    const runtime = runtimes.get(runtimeKey(projectId, agentId));
    if (runtime) runtime.status = status;
  }

  setCurrentTask(projectId: string, agentId: string, taskId: string | undefined): void {
    const runtime = runtimes.get(runtimeKey(projectId, agentId));
    if (runtime) runtime.currentTaskId = taskId;
  }

  // -------------------------------------------------------------------------
  // Docker utilities
  // -------------------------------------------------------------------------

  /** Check if Docker is available */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Check if the coder image exists locally */
  async hasCoderImage(): Promise<boolean> {
    try {
      await docker.getImage(CODER_IMAGE).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /** Build the coder agent Docker image from a Dockerfile path */
  async buildCoderImage(dockerfilePath: string): Promise<void> {
    // This is a placeholder — actual build requires tar stream of context
    // In practice, we'd use docker build CLI or dockerode's build API
    throw new Error(`Build not implemented yet. Run: docker build -t ${CODER_IMAGE} ${dockerfilePath}`);
  }

  /** List all studio containers (running or stopped) */
  async listContainers(): Promise<{ id: string; name: string; status: string; projectId: string; agentId: string }[]> {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: ['studio-'] },
    });

    return containers.map((c) => ({
      id: c.Id.slice(0, 12),
      name: c.Names[0]?.replace(/^\//, '') ?? '',
      status: c.State,
      projectId: c.Labels?.['project_id'] ?? '',
      agentId: c.Labels?.['agent_id'] ?? '',
    }));
  }

  /** Stop all containers for a project */
  async stopAllContainers(projectId: string): Promise<void> {
    const projectRuntimes = this.getAllRuntimes(projectId);
    await Promise.all(
      projectRuntimes.map((r) => this.stopContainer(projectId, r.agentId)),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMemoryLimit(limit: string): number {
  const match = limit.match(/^(\d+)(g|m)$/i);
  if (!match) return 2 * 1024 * 1024 * 1024; // default 2GB
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return unit === 'g' ? value * 1024 * 1024 * 1024 : value * 1024 * 1024;
}

function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

/** Docker multiplexed stream has 8-byte header per frame — strip it */
function stripDockerHeader(chunk: Buffer): string {
  // Docker stream format: [type(1)][0(3)][size(4)][payload]
  // For TTY mode, there's no header
  if (chunk.length > 8 && (chunk[0] === 1 || chunk[0] === 2)) {
    return chunk.subarray(8).toString('utf-8');
  }
  return chunk.toString('utf-8');
}

export const containerManager = new ContainerManager();
