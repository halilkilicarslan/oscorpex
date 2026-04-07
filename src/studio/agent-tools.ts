// ---------------------------------------------------------------------------
// AI Dev Studio — Agent Execution Tools
// Tools that AI agents can use during task execution to interact with the
// file system, run commands, and commit changes.
// ---------------------------------------------------------------------------

import { tool } from 'ai';
import { z } from 'zod';
import { gitManager } from './git-manager.js';
import { eventBus } from './event-bus.js';

interface ToolContext {
  projectId: string;
  agentId: string;
  taskId: string;
  repoPath: string;
}

/** Track files created/modified by tools for TaskOutput */
interface ToolTracker {
  filesCreated: string[];
  filesModified: string[];
  logs: string[];
}

export function createAgentTools(ctx: ToolContext, tracker: ToolTracker) {
  const { projectId, agentId, taskId, repoPath } = ctx;

  const emitLog = (message: string) => {
    tracker.logs.push(message);
    eventBus.emit({
      projectId,
      type: 'agent:output',
      agentId,
      taskId,
      payload: { output: message },
    });
  };

  return {
    listFiles: tool({
      description:
        'List files and directories at the given path (relative to project root). Returns names, types, and paths.',
      inputSchema: z.object({
        path: z
          .string()
          .default('')
          .describe('Relative directory path. Empty string for project root.'),
      }),
      execute: async ({ path }) => {
        try {
          const tree = await gitManager.getFileTree(repoPath, path || '');
          const entries = tree.map((n) => ({
            name: n.name,
            type: n.type,
            path: n.path,
          }));
          emitLog(`[listFiles] ${path || '/'} → ${entries.length} entries`);
          return { entries };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emitLog(`[listFiles] ERROR: ${msg}`);
          return { error: msg };
        }
      },
    }),

    readFile: tool({
      description:
        'Read the contents of a file (relative to project root). Returns the file content as a string.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path, e.g. "src/index.ts"'),
      }),
      execute: async ({ path }) => {
        try {
          const content = await gitManager.getFileContent(repoPath, path);
          emitLog(`[readFile] ${path} (${content.length} chars)`);
          return { path, content };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emitLog(`[readFile] ERROR ${path}: ${msg}`);
          return { error: msg };
        }
      },
    }),

    writeFile: tool({
      description:
        'Write or overwrite a file with the given content. Creates parent directories if needed. Use for both new files and updates.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path, e.g. "src/utils/helper.ts"'),
        content: z.string().describe('Full file content to write'),
      }),
      execute: async ({ path, content }) => {
        try {
          // Check if file exists to track created vs modified
          let existed = false;
          try {
            await gitManager.getFileContent(repoPath, path);
            existed = true;
          } catch {
            // File doesn't exist yet
          }

          await gitManager.writeFileContent(repoPath, path, content);

          if (existed) {
            if (!tracker.filesModified.includes(path)) tracker.filesModified.push(path);
            emitLog(`[writeFile] Modified: ${path}`);
          } else {
            if (!tracker.filesCreated.includes(path)) tracker.filesCreated.push(path);
            emitLog(`[writeFile] Created: ${path}`);
          }

          return { path, written: true, action: existed ? 'modified' : 'created' };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emitLog(`[writeFile] ERROR ${path}: ${msg}`);
          return { error: msg };
        }
      },
    }),

    runCommand: tool({
      description:
        'Run a shell command in the project directory. Use for installing dependencies (npm/pnpm install), running tests, build steps, etc. Returns stdout and stderr.',
      inputSchema: z.object({
        command: z
          .string()
          .describe('Shell command to execute, e.g. "pnpm install" or "npx tsc --noEmit"'),
      }),
      execute: async ({ command }) => {
        emitLog(`[runCommand] $ ${command}`);
        try {
          const { exec } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execAsync = promisify(exec);

          const { stdout, stderr } = await execAsync(command, {
            cwd: repoPath,
            timeout: 120_000, // 2 minutes max
            maxBuffer: 1024 * 1024, // 1MB
            env: { ...process.env, CI: 'true' },
          });

          const output = (stdout || '').trim();
          const errOutput = (stderr || '').trim();

          if (output) emitLog(`[runCommand] stdout: ${output.slice(0, 500)}`);
          if (errOutput) emitLog(`[runCommand] stderr: ${errOutput.slice(0, 500)}`);

          return { exitCode: 0, stdout: output, stderr: errOutput };
        } catch (err: any) {
          const exitCode = err.code ?? 1;
          const stdout = (err.stdout || '').trim();
          const stderr = (err.stderr || err.message || '').trim();
          emitLog(`[runCommand] FAILED (exit ${exitCode}): ${stderr.slice(0, 300)}`);
          return { exitCode, stdout, stderr };
        }
      },
    }),

    commitChanges: tool({
      description:
        'Stage and commit changes in the project git repository. Optionally specify which files to stage; defaults to all changed files.',
      inputSchema: z.object({
        message: z.string().describe('Git commit message'),
        files: z
          .array(z.string())
          .optional()
          .describe('Specific files to stage. If omitted, stages all changes.'),
      }),
      execute: async ({ message, files }) => {
        try {
          const hash = await gitManager.commitChanges(repoPath, message, files);
          emitLog(`[commitChanges] Committed: ${hash} — ${message}`);
          return { hash, message };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emitLog(`[commitChanges] ERROR: ${msg}`);
          return { error: msg };
        }
      },
    }),
  };
}
