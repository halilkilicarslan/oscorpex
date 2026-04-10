// ---------------------------------------------------------------------------
// Orenda — Agent .md file system
// ---------------------------------------------------------------------------

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const AGENTS_BASE = resolve('.voltagent/agents');

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function agentDir(projectId: string, agentName: string): string {
  return join(AGENTS_BASE, projectId, slugify(agentName));
}

// Create agent directory with initial .md files
export async function createAgentFiles(
  projectId: string,
  agentName: string,
  data: {
    skills: string[];
    systemPrompt: string;
    personality: string;
    role: string;
    model: string;
  },
): Promise<string> {
  const dir = agentDir(projectId, agentName);
  await mkdir(dir, { recursive: true });

  // skills.md
  const skillsContent = `# ${agentName} — Skills\n\n${data.skills.map((s) => `- ${s}`).join('\n')}\n`;
  await writeFile(join(dir, 'skills.md'), skillsContent, 'utf-8');

  // system-prompt.md
  const promptContent = `# ${agentName} — System Prompt\n\n${data.systemPrompt}\n`;
  await writeFile(join(dir, 'system-prompt.md'), promptContent, 'utf-8');

  // personality.md
  const personalityContent = `# ${agentName} — Personality\n\nRole: ${data.role}\nModel: ${data.model}\n\n${data.personality}\n`;
  await writeFile(join(dir, 'personality.md'), personalityContent, 'utf-8');

  return dir;
}

// Update agent files when agent is edited
export async function updateAgentFiles(
  projectId: string,
  agentName: string,
  data: {
    skills?: string[];
    systemPrompt?: string;
    personality?: string;
    role?: string;
    model?: string;
  },
): Promise<void> {
  const dir = agentDir(projectId, agentName);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  if (data.skills !== undefined) {
    const content = `# ${agentName} — Skills\n\n${data.skills.map((s) => `- ${s}`).join('\n')}\n`;
    await writeFile(join(dir, 'skills.md'), content, 'utf-8');
  }

  if (data.systemPrompt !== undefined) {
    const content = `# ${agentName} — System Prompt\n\n${data.systemPrompt}\n`;
    await writeFile(join(dir, 'system-prompt.md'), content, 'utf-8');
  }

  if (data.personality !== undefined || data.role !== undefined || data.model !== undefined) {
    const content = `# ${agentName} — Personality\n\nRole: ${data.role ?? ''}\nModel: ${data.model ?? ''}\n\n${data.personality ?? ''}\n`;
    await writeFile(join(dir, 'personality.md'), content, 'utf-8');
  }
}

// Read a specific .md file for an agent
export async function readAgentFile(
  projectId: string,
  agentName: string,
  fileName: string,
): Promise<string | null> {
  const filePath = join(agentDir(projectId, agentName), fileName);
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// List all .md files for an agent
export async function listAgentFiles(projectId: string, agentName: string): Promise<string[]> {
  const dir = agentDir(projectId, agentName);
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

// Write/update a specific .md file for an agent
export async function writeAgentFile(
  projectId: string,
  agentName: string,
  fileName: string,
  content: string,
): Promise<void> {
  const dir = agentDir(projectId, agentName);
  await mkdir(dir, { recursive: true });
  // Security: prevent path traversal
  const safeName = fileName.replace(/[^a-z0-9._-]/gi, '');
  if (!safeName.endsWith('.md')) throw new Error('Only .md files allowed');
  await writeFile(join(dir, safeName), content, 'utf-8');
}

// Delete agent directory
export async function deleteAgentFiles(projectId: string, agentName: string): Promise<void> {
  const dir = agentDir(projectId, agentName);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// Get the directory path for an agent (for UI display)
export function getAgentDirPath(projectId: string, agentName: string): string {
  return agentDir(projectId, agentName);
}
