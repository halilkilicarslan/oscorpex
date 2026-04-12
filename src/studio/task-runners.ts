// ---------------------------------------------------------------------------
// Oscorpex — Special Task Runners
// Integration test ve run-app gibi özel task type'ları için executor'lar.
// ---------------------------------------------------------------------------

import { spawn, ChildProcess } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { TaskOutput } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the directory containing package.json with a given script */
function findSubProject(repoPath: string, hint: string): string | null {
  // NOTE: Do NOT return repoPath (root) here — that's handled by the
  // single-app fallback in runApp. This function only looks for *sub*-projects.

  // Check common subdirectories
  const candidates = [hint, 'src', 'app', 'server', 'api', 'web', 'client'];
  for (const dir of candidates) {
    const fullPath = join(repoPath, dir);
    if (existsSync(join(fullPath, 'package.json'))) return fullPath;
  }

  // Scan top-level directories (skip hidden dirs and build output)
  const SKIP_DIRS = new Set(['.next', '.nuxt', '.output', 'dist', 'build', 'node_modules', '.git']);
  try {
    for (const entry of readdirSync(repoPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)
          && existsSync(join(repoPath, entry.name, 'package.json'))) {
        return join(repoPath, entry.name);
      }
    }
  } catch { /* ignore */ }

  return null;
}

/** Start a process and wait for it to be ready (listen on a port) */
function startProcess(
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  readyPattern: RegExp,
  timeoutMs: number,
): Promise<{ process: ChildProcess; output: string[] }> {
  return new Promise((resolve, reject) => {
    const output: string[] = [];
    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const timer = setTimeout(() => {
      // Timeout — still resolve with the process (it might be running but no match)
      resolve({ process: proc, output });
    }, timeoutMs);

    const onData = (data: Buffer) => {
      const line = data.toString();
      output.push(line);
      if (readyPattern.test(line)) {
        clearTimeout(timer);
        resolve({ process: proc, output });
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`Process exited with code ${code}\n${output.join('')}`));
      }
    });
  });
}

/** Simple HTTP GET check */
async function httpCheck(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Integration Test Runner
// ---------------------------------------------------------------------------

export interface IntegrationTestResult {
  output: TaskOutput;
  logs: string[];
}

/**
 * Projenin backend ve frontend'ini ayağa kaldırıp HTTP smoke testleri yapar.
 * Test bittiğinde process'leri kapatır.
 */
export async function runIntegrationTest(
  repoPath: string,
  onLog: (msg: string) => void,
): Promise<TaskOutput> {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); onLog(msg); };

  log('[integration-test] Starting integration tests...');

  const backendDir = findSubProject(repoPath, 'backend');
  const frontendDir = findSubProject(repoPath, 'frontend');

  const processes: ChildProcess[] = [];
  const results: { name: string; passed: boolean; detail: string }[] = [];

  try {
    // --- Install dependencies ---
    if (backendDir) {
      log(`[integration-test] Installing backend deps: ${backendDir}`);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('pnpm', ['install', '--frozen-lockfile'], { cwd: backendDir, shell: true, stdio: 'pipe' });
        proc.on('exit', (code) => code === 0 ? resolve() : resolve()); // Don't fail on install issues
        proc.on('error', () => resolve());
      });
    }

    // --- Start Backend ---
    let backendPort = 4100;
    if (backendDir) {
      log(`[integration-test] Starting backend on port ${backendPort}...`);
      try {
        const { process: backendProc } = await startProcess(
          backendDir,
          'npx',
          ['ts-node', 'src/index.ts'],
          { PORT: String(backendPort), NODE_ENV: 'test' },
          /listening|running|started|ready/i,
          15000,
        );
        processes.push(backendProc);
        log('[integration-test] Backend started');

        // Test backend health
        await new Promise(r => setTimeout(r, 1000));
        const health = await httpCheck(`http://localhost:${backendPort}/`);
        results.push({
          name: 'Backend Health Check',
          passed: health.ok,
          detail: health.ok ? `HTTP ${health.status}` : `Failed: ${health.body}`,
        });
        log(`[integration-test] Backend health: ${health.ok ? 'PASS' : 'FAIL'} (${health.status})`);

        // Test API endpoint
        const apiCheck = await httpCheck(`http://localhost:${backendPort}/api/todos`);
        results.push({
          name: 'API Endpoint /api/todos',
          passed: apiCheck.ok,
          detail: apiCheck.ok ? `HTTP ${apiCheck.status}` : `Failed: ${apiCheck.body}`,
        });
        log(`[integration-test] API /api/todos: ${apiCheck.ok ? 'PASS' : 'FAIL'} (${apiCheck.status})`);

        // Test POST - create todo
        try {
          const postRes = await fetch(`http://localhost:${backendPort}/api/todos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Integration test todo' }),
          });
          const postOk = postRes.ok;
          results.push({
            name: 'API POST /api/todos',
            passed: postOk,
            detail: postOk ? `HTTP ${postRes.status}` : `Failed: ${postRes.status}`,
          });
          log(`[integration-test] POST /api/todos: ${postOk ? 'PASS' : 'FAIL'}`);
        } catch (err) {
          results.push({ name: 'API POST /api/todos', passed: false, detail: String(err) });
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[integration-test] Backend start failed: ${msg}`);
        results.push({ name: 'Backend Start', passed: false, detail: msg });
      }
    } else {
      log('[integration-test] No backend directory found, skipping backend tests');
    }

    // --- Start Frontend ---
    let frontendPort = 4200;
    if (frontendDir) {
      log(`[integration-test] Starting frontend on port ${frontendPort}...`);
      try {
        const { process: frontendProc } = await startProcess(
          frontendDir,
          'npx',
          ['react-scripts', 'start'],
          { PORT: String(frontendPort), BROWSER: 'none', CI: 'true' },
          /compiled|webpack|ready|started/i,
          30000,
        );
        processes.push(frontendProc);
        log('[integration-test] Frontend started');

        await new Promise(r => setTimeout(r, 2000));
        const frontendHealth = await httpCheck(`http://localhost:${frontendPort}/`);
        results.push({
          name: 'Frontend Health Check',
          passed: frontendHealth.ok,
          detail: frontendHealth.ok ? `HTTP ${frontendHealth.status}` : `Failed: ${frontendHealth.body}`,
        });
        log(`[integration-test] Frontend health: ${frontendHealth.ok ? 'PASS' : 'FAIL'} (${frontendHealth.status})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[integration-test] Frontend start failed: ${msg}`);
        results.push({ name: 'Frontend Start', passed: false, detail: msg });
      }
    } else {
      log('[integration-test] No frontend directory found, skipping frontend tests');
    }

    // --- Summary ---
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    log(`[integration-test] Results: ${passed}/${total} passed, ${failed} failed`);
    for (const r of results) {
      log(`  ${r.passed ? '✓' : '✗'} ${r.name}: ${r.detail}`);
    }

    if (failed > 0) {
      throw new Error(`Integration tests failed: ${failed}/${total} checks failed`);
    }

    return {
      filesCreated: [],
      filesModified: [],
      testResults: { passed, failed, total },
      logs,
    };
  } finally {
    // Kill all started processes
    for (const proc of processes) {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }
    // Give processes time to clean up
    await new Promise(r => setTimeout(r, 1000));
    for (const proc of processes) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Note: App runner functionality moved to app-runner.ts
// ---------------------------------------------------------------------------
