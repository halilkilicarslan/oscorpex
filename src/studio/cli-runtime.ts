// ---------------------------------------------------------------------------
// Oscorpex — Claude CLI Runtime
// Runs agents as Claude CLI subprocesses with stream-json output.
// Provides full visibility: tool calls, file edits, bash commands, thinking.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentRuntime } from './agent-runtime.js';
import { eventBus } from './event-bus.js';
import type { TaskOutput } from './types.js';

// ---------------------------------------------------------------------------
// Types for stream-json events
// ---------------------------------------------------------------------------

interface CLIInitEvent {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  tools: string[];
}

interface CLIAssistantEvent {
  type: 'assistant';
  message: {
    model: string;
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  session_id: string;
}

interface CLIToolResultEvent {
  type: 'tool';
  tool_use_id: string;
  name: string;
  content: Array<{ type: 'text'; text: string }>;
  session_id: string;
}

interface CLIResultEvent {
  type: 'result';
  subtype: string;
  duration_ms: number;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  session_id: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD: number;
  }>;
}

type CLIStreamEvent = CLIInitEvent | CLIAssistantEvent | CLIToolResultEvent | CLIResultEvent;

// ---------------------------------------------------------------------------
// Execution result
// ---------------------------------------------------------------------------

export interface CLIExecutionResult {
  text: string;
  filesCreated: string[];
  filesModified: string[];
  logs: string[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  durationMs: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Check if Claude CLI is available
// ---------------------------------------------------------------------------

let cliAvailable: boolean | null = null;
let cliCheckedAt = 0;
const CLI_CACHE_TTL_MS = 60_000; // 1 dakika sonra tekrar kontrol et

/**
 * Resolve the claude binary path.
 * Check CLAUDE_CLI_PATH env, then common locations, then fall back to 'claude' (PATH lookup).
 */
function resolveClaudeBinary(): string {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  const candidates = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return 'claude';
}

const CLAUDE_BIN = resolveClaudeBinary();

export async function isClaudeCliAvailable(): Promise<boolean> {
  // Cache TTL: false sonucu 1dk sonra expire olsun, true sonucu kalsın
  if (cliAvailable !== null) {
    if (cliAvailable) return true;
    if (Date.now() - cliCheckedAt < CLI_CACHE_TTL_MS) return false;
  }

  console.log(`[cli-runtime] Checking CLI availability: ${CLAUDE_BIN}`);

  return new Promise((resolveResult) => {
    let resolved = false;
    const done = (result: boolean, reason: string) => {
      if (resolved) return;
      resolved = true;
      cliAvailable = result;
      cliCheckedAt = Date.now();
      console.log(`[cli-runtime] CLI check: ${reason}, available=${result}`);
      resolveResult(result);
    };

    const proc = spawn(CLAUDE_BIN, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, PATH: process.env.PATH },
    });

    let output = '';
    proc.stdout?.on('data', (d) => { output += d.toString(); });

    proc.on('close', (code) => {
      const ok = code === 0 && output.includes('Claude Code');
      done(ok, `code=${code}, output="${output.trim().slice(0, 60)}"`);
    });

    proc.on('error', (err) => {
      done(false, `spawn error: ${err.message}`);
    });

    setTimeout(() => {
      proc.kill();
      done(false, 'timed out (5s)');
    }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Execute task with Claude CLI
// ---------------------------------------------------------------------------

export function executeWithCLI(opts: {
  projectId: string;
  agentId: string;
  agentName: string;
  repoPath: string;
  prompt: string;
  systemPrompt: string;
  timeoutMs: number;
  allowedTools?: string[];
  model?: string;
  signal?: AbortSignal;
}): Promise<CLIExecutionResult> {
  const {
    projectId,
    agentId,
    agentName,
    repoPath,
    prompt,
    systemPrompt,
    timeoutMs,
    allowedTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    model = 'sonnet',
    signal,
  } = opts;

  return new Promise((resolvePromise, rejectPromise) => {
    // Ensure virtual process for terminal streaming
    agentRuntime.ensureVirtualProcess(projectId, agentId, agentName);

    const termLog = (msg: string) => {
      agentRuntime.appendVirtualOutput(projectId, agentId, msg);
      // Use emitTransient — no DB write, instant broadcast to WS subscribers
      eventBus.emitTransient({
        projectId,
        type: 'agent:output',
        agentId,
        taskId: '',
        payload: { output: msg },
      });
    };

    // Build CLI args — prompt is sent via stdin to avoid shell escaping / arg length issues
    const args = [
      '-p',                              // print mode (non-interactive)
      '--output-format', 'stream-json',  // streaming JSON
      '--verbose',                       // required for stream-json
      '--permission-mode', 'bypassPermissions', // no permission prompts
      '--model', model,
      '--system-prompt', systemPrompt,
      '--tools', allowedTools.join(','),
      '--disable-slash-commands',        // no skills/slash commands
      '--no-session-persistence',        // don't save session to disk
      '--max-budget-usd', String(Math.max(2, timeoutMs / 60000 * 1)), // ~$1 per minute, min $2
    ];

    termLog(`[${agentName}] Claude CLI başlatılıyor...`);
    termLog(`[${agentName}] Model: ${model} | Timeout: ${(timeoutMs / 60000).toFixed(1)}m`);

    const proc = spawn(CLAUDE_BIN, args, {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    });

    // Send prompt via stdin then close — avoids shell escaping and arg length issues
    proc.stdin?.write(prompt);
    proc.stdin?.end();

    // Track state
    const result: CLIExecutionResult = {
      text: '',
      filesCreated: [],
      filesModified: [],
      logs: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCostUsd: 0,
      durationMs: 0,
      model: '',
    };

    let buffer = '';
    let settled = false;

    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      proc.kill();
      if (err) {
        rejectPromise(err);
      } else {
        resolvePromise(result);
      }
    };

    // Timeout handler
    const timer = setTimeout(() => {
      termLog(`[${agentName}] Timeout! (${(timeoutMs / 60000).toFixed(1)}m)`);
      settle(new Error(`CLI task timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Abort signal handler
    if (signal) {
      const onAbort = () => {
        termLog(`[${agentName}] Task iptal edildi.`);
        settle(new Error('Task aborted'));
      };
      if (signal.aborted) {
        clearTimeout(timer);
        settle(new Error('Task aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Process stdout (stream-json lines)
    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop()!; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as CLIStreamEvent;
          processStreamEvent(event, result, termLog, agentName);
        } catch {
          // Non-JSON line — log as-is
          if (line.trim()) {
            termLog(line.trim());
          }
        }
      }
    });

    // Process stderr
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        termLog(`[${agentName}][stderr] ${text}`);
      }
    });

    // Process exit
    proc.on('close', (code) => {
      clearTimeout(timer);

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as CLIStreamEvent;
          processStreamEvent(event, result, termLog, agentName);
        } catch {
          if (buffer.trim()) termLog(buffer.trim());
        }
      }

      if (code !== 0 && !settled) {
        termLog(`[${agentName}] CLI çıkış kodu: ${code}`);
        // Non-zero exit doesn't always mean failure (e.g. budget limit)
        // If we have output, treat as success
        if (result.text || result.filesCreated.length || result.filesModified.length) {
          settle();
        } else {
          settle(new Error(`Claude CLI exited with code ${code}`));
        }
      } else {
        settle();
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      termLog(`[${agentName}] CLI hata: ${err.message}`);
      settle(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Stream event processor — formats events for the terminal view
// ---------------------------------------------------------------------------

function processStreamEvent(
  event: CLIStreamEvent,
  result: CLIExecutionResult,
  termLog: (msg: string) => void,
  agentName: string,
): void {
  switch (event.type) {
    case 'system': {
      const init = event as CLIInitEvent;
      result.model = init.model || '';
      termLog(`[${agentName}] Session: ${init.session_id?.slice(0, 8)}... | Model: ${init.model}`);
      break;
    }

    case 'assistant': {
      const msg = (event as CLIAssistantEvent).message;
      if (!msg?.content) break;

      // Accumulate usage
      if (msg.usage) {
        result.inputTokens += msg.usage.input_tokens ?? 0;
        result.outputTokens += msg.usage.output_tokens ?? 0;
        result.cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
        result.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
      }

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          result.text += block.text + '\n';
          // Show text output (truncate long lines for terminal)
          const preview = block.text.length > 300
            ? block.text.slice(0, 300) + '...'
            : block.text;
          for (const line of preview.split('\n')) {
            if (line.trim()) termLog(`  ${line}`);
          }
        } else if (block.type === 'tool_use') {
          const toolName = block.name;
          const input = block.input;

          // Format tool call for terminal display
          if (toolName === 'Write' || toolName === 'Edit') {
            const filePath = (input.file_path as string) || (input.path as string) || '';
            termLog(`[${agentName}] >> ${toolName}: ${filePath}`);
            if (toolName === 'Write') {
              result.filesCreated.push(filePath);
            } else {
              result.filesModified.push(filePath);
            }
          } else if (toolName === 'Read') {
            const filePath = (input.file_path as string) || '';
            termLog(`[${agentName}] >> Read: ${filePath}`);
          } else if (toolName === 'Bash') {
            const cmd = (input.command as string) || '';
            const preview = cmd.length > 100 ? cmd.slice(0, 100) + '...' : cmd;
            termLog(`[${agentName}] >> Bash: ${preview}`);
          } else if (toolName === 'Glob' || toolName === 'Grep') {
            const pattern = (input.pattern as string) || '';
            termLog(`[${agentName}] >> ${toolName}: ${pattern}`);
          } else {
            termLog(`[${agentName}] >> ${toolName}`);
          }
        }
      }
      break;
    }

    case 'tool': {
      // Tool result — show brief summary
      const toolResult = event as CLIToolResultEvent;
      const toolText = toolResult.content
        ?.map((c) => c.text)
        .join('')
        .trim();

      if (toolText) {
        // Show first line of tool result (truncated)
        const firstLine = toolText.split('\n')[0];
        const preview = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
        termLog(`  [result] ${preview}`);
      }
      break;
    }

    case 'result': {
      const res = event as CLIResultEvent;
      result.durationMs = res.duration_ms ?? 0;
      result.totalCostUsd = res.total_cost_usd ?? 0;

      // Extract model usage
      if (res.modelUsage) {
        for (const [modelName, usage] of Object.entries(res.modelUsage)) {
          result.model = modelName;
          result.inputTokens = usage.inputTokens ?? 0;
          result.outputTokens = usage.outputTokens ?? 0;
          result.cacheCreationTokens = usage.cacheCreationInputTokens ?? 0;
          result.cacheReadTokens = usage.cacheReadInputTokens ?? 0;
          result.totalCostUsd = usage.costUSD ?? result.totalCostUsd;
        }
      }

      const durationSec = (result.durationMs / 1000).toFixed(1);
      const totalTokens = result.inputTokens + result.outputTokens;
      termLog(`[${agentName}] Tamamlandı: ${durationSec}s | ${totalTokens} tokens | $${result.totalCostUsd.toFixed(4)}`);

      if (res.is_error) {
        termLog(`[${agentName}] Hata ile sonuçlandı: ${res.subtype}`);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve relative paths from CLI output to absolute paths
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stream CLI output — spawns Claude CLI and streams text deltas via callbacks.
// Used by PM Chat to replace AI SDK streamText().
// ---------------------------------------------------------------------------

export interface StreamCLICallbacks {
  onTextDelta: (text: string) => void;
  onDone: (fullText: string, inputTokens: number, outputTokens: number, costUsd: number) => void;
  onError: (error: Error) => void;
}

export function streamWithCLI(opts: {
  repoPath: string;
  prompt: string;
  systemPrompt: string;
  model?: string;
  timeoutMs?: number;
}, callbacks: StreamCLICallbacks): () => void {
  const {
    repoPath,
    prompt,
    systemPrompt,
    model = 'sonnet',
    timeoutMs = 120_000,
  } = opts;

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--model', model,
    '--system-prompt', systemPrompt,
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-budget-usd', '2',
  ];

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: repoPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, PATH: process.env.PATH },
  });

  proc.stdin?.write(prompt);
  proc.stdin?.end();

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let buffer = '';
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      proc.kill();
      callbacks.onError(new Error(`PM Chat CLI timed out after ${timeoutMs}ms`));
    }
  }, timeoutMs);

  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as CLIStreamEvent;

        if (event.type === 'assistant') {
          const msg = (event as CLIAssistantEvent).message;
          if (!msg?.content) continue;

          if (msg.usage) {
            inputTokens += msg.usage.input_tokens ?? 0;
            outputTokens += msg.usage.output_tokens ?? 0;
          }

          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              fullText += block.text;
              callbacks.onTextDelta(block.text);
            }
          }
        } else if (event.type === 'result') {
          const res = event as CLIResultEvent;
          costUsd = res.total_cost_usd ?? 0;
          if (res.modelUsage) {
            for (const usage of Object.values(res.modelUsage)) {
              inputTokens = usage.inputTokens ?? inputTokens;
              outputTokens = usage.outputTokens ?? outputTokens;
              costUsd = usage.costUSD ?? costUsd;
            }
          }
        }
      } catch {
        // Non-JSON line — ignore
      }
    }
  });

  proc.stderr!.on('data', () => {
    // Ignore stderr for chat — it's mainly progress info
  });

  proc.on('close', () => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer) as CLIStreamEvent;
        if (event.type === 'assistant') {
          const msg = (event as CLIAssistantEvent).message;
          if (msg?.content) {
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
                callbacks.onTextDelta(block.text);
              }
            }
          }
        } else if (event.type === 'result') {
          const res = event as CLIResultEvent;
          costUsd = res.total_cost_usd ?? costUsd;
        }
      } catch { /* ignore */ }
    }

    callbacks.onDone(fullText, inputTokens, outputTokens, costUsd);
  });

  proc.on('error', (err) => {
    clearTimeout(timer);
    if (!settled) {
      settled = true;
      callbacks.onError(err);
    }
  });

  // Return cancel function
  return () => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      proc.kill();
    }
  };
}

export function resolveFilePaths(files: string[], repoPath: string): string[] {
  return files
    .filter(Boolean)
    .map((f) => {
      // If already absolute and within repo, make relative
      if (f.startsWith(repoPath)) {
        return f.slice(repoPath.length + 1);
      }
      // If relative, resolve against repo
      const abs = resolve(repoPath, f);
      if (existsSync(abs)) {
        return f;
      }
      return f;
    })
    .filter((f, i, arr) => arr.indexOf(f) === i); // dedupe
}
