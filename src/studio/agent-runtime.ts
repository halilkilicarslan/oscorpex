// ---------------------------------------------------------------------------
// AI Dev Studio — Agent Runtime (Yerel Süreç Yöneticisi)
// Docker yerine yerel CLI araçlarını alt süreç olarak çalıştırır:
//   claude-code → `claude`
//   codex       → `codex`
//   aider       → `aider`
//   custom      → systemPrompt'u komut olarak çalıştırır
//   none        → hiçbir şey başlatmaz
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eventBus } from './event-bus.js';
import { query, queryOne, execute } from './pg.js';
import type { AgentProcessRecord, AgentProcessStatus, AgentRun } from './types.js';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** Çıktı tamponunda tutulacak maksimum satır sayısı */
const OUTPUT_BUFFER_MAX = 500;

// ---------------------------------------------------------------------------
// Bellek içi süreç kaydı
// ---------------------------------------------------------------------------

/** Çalışan veya durmuş tüm agent süreçlerini tutan harita (key: `projectId:agentId`) */
const processes = new Map<string, AgentProcessRecord>();

/** Anahtar üretici yardımcı fonksiyon */
function processKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

// ---------------------------------------------------------------------------
// Dahili yardımcılar
// ---------------------------------------------------------------------------

/**
 * Yeni çıktı satırlarını bekleyen dinleyicilerin listesi.
 * key: `projectId:agentId`, value: callback dizisi
 */
const outputListeners = new Map<string, Array<(line: string, index: number) => void>>();

/** Çıktı tamponuna yeni satır ekler; 500 satır sınırını aşmaz */
function appendLine(record: AgentProcessRecord, line: string): void {
  record.output.push(line);
  // Ring buffer — ilk satırı sil
  if (record.output.length > OUTPUT_BUFFER_MAX) {
    record.output.shift();
  }
  const lineIndex = record.output.length - 1;

  // Bekleyen SSE dinleyicilerine bildir
  const key = processKey(record.projectId, record.agentId);
  const listeners = outputListeners.get(key);
  if (listeners) {
    for (const fn of listeners) {
      try { fn(line, lineIndex); } catch { /* dinleyici hatası — yoksay */ }
    }
  }

  // Proje event bus'ına da yayımla (mevcut task log akışıyla uyum için)
  eventBus.emit({
    projectId: record.projectId,
    type: 'agent:output',
    agentId: record.agentId,
    payload: { output: line },
  });
}

/** CLI aracına göre komut ve argüman dizisi oluşturur */
function buildCommand(
  cliTool: string,
  taskPrompt?: string,
  systemPrompt?: string,
): { cmd: string; args: string[] } | null {
  switch (cliTool) {
    case 'claude-code':
      if (taskPrompt) {
        // Görev istemiyle yazdırma modunda çalıştır
        return { cmd: 'claude', args: ['--print', taskPrompt] };
      }
      // İstemi yoksa etkileşimli mod (terminal'e bağlı değil — çıktı akışı okunur)
      return { cmd: 'claude', args: [] };

    case 'codex':
      if (taskPrompt) {
        return { cmd: 'codex', args: [taskPrompt] };
      }
      return { cmd: 'codex', args: [] };

    case 'aider':
      if (taskPrompt) {
        return { cmd: 'aider', args: ['--message', taskPrompt] };
      }
      return { cmd: 'aider', args: [] };

    case 'custom':
      // systemPrompt komutu ikiye böl: ilk kelime = program, geri kalanı = argümanlar
      if (!systemPrompt?.trim()) return null;
      const parts = systemPrompt.trim().split(/\s+/);
      return { cmd: parts[0], args: parts.slice(1) };

    case 'none':
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Dışa açık fonksiyonlar
// ---------------------------------------------------------------------------

/**
 * Agent için alt süreç başlatır.
 * Zaten çalışan bir süreç varsa mevcut kaydı döndürür.
 */
export async function startAgent(
  projectId: string,
  agent: { id: string; name: string; cliTool: string; systemPrompt?: string },
  taskPrompt?: string,
): Promise<AgentProcessRecord> {
  const key = processKey(projectId, agent.id);

  // Zaten çalışıyor mu? Aynı kaydı döndür
  const existing = processes.get(key);
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    return existing;
  }

  // Proje repoPath'ini veritabanından al
  const projectRow = await queryOne<{ repo_path: string }>(
    'SELECT repo_path FROM projects WHERE id = $1',
    [projectId],
  );
  const cwd = projectRow?.repo_path || process.cwd();

  // Kayıt oluştur
  const record: AgentProcessRecord = {
    id: randomUUID(),
    projectId,
    agentId: agent.id,
    agentName: agent.name,
    cliTool: agent.cliTool,
    process: null,
    status: 'starting',
    output: [],
    startedAt: new Date().toISOString(),
  };

  processes.set(key, record);

  // `none` — süreç başlatma, sadece idle durumu döndür
  const cmdSpec = buildCommand(agent.cliTool, taskPrompt, agent.systemPrompt);
  if (!cmdSpec) {
    record.status = 'idle';
    return record;
  }

  // Alt süreci oluştur
  const child: ChildProcess = spawn(cmdSpec.cmd, cmdSpec.args, {
    cwd,
    env: {
      ...process.env,
      // API anahtarlarını ortam üzerinden geçir
      ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
    },
    // stdio akışlarını ayrı tutarak stdout/stderr'ı dinle
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  record.process = child;
  record.pid = child.pid;
  record.status = 'running';

  // stdout satırlarını tampon ve event'e aktar
  let stdoutPartial = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutPartial += chunk.toString('utf-8');
    const lines = stdoutPartial.split('\n');
    // Son eleman henüz tamamlanmamış satır — bir sonraki chunk'a bırak
    stdoutPartial = lines.pop() ?? '';
    for (const line of lines) {
      appendLine(record, line);
    }
  });

  // stderr satırlarını da aynı tampona ekle
  let stderrPartial = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrPartial += chunk.toString('utf-8');
    const lines = stderrPartial.split('\n');
    stderrPartial = lines.pop() ?? '';
    for (const line of lines) {
      appendLine(record, `[stderr] ${line}`);
    }
  });

  // Süreç çıkışında durumu güncelle
  child.on('exit', (code, signal) => {
    // Kalan kısmi satırları temizle
    if (stdoutPartial) { appendLine(record, stdoutPartial); stdoutPartial = ''; }
    if (stderrPartial) { appendLine(record, `[stderr] ${stderrPartial}`); stderrPartial = ''; }

    record.exitCode = code;
    record.stoppedAt = new Date().toISOString();

    if (record.status !== 'stopping') {
      // Beklenmedik çıkış
      record.status = code === 0 ? 'stopped' : 'error';
    } else {
      record.status = 'stopped';
    }

    // DB kaydını güncelle
    _syncRunToDb(record);

    eventBus.emit({
      projectId,
      type: 'agent:stopped',
      agentId: agent.id,
      payload: { exitCode: code, signal },
    });
  });

  child.on('error', (err) => {
    appendLine(record, `[error] Süreç başlatılamadı: ${err.message}`);
    record.status = 'error';
    record.stoppedAt = new Date().toISOString();
    _syncRunToDb(record);

    eventBus.emit({
      projectId,
      type: 'agent:error',
      agentId: agent.id,
      payload: { error: err.message },
    });
  });

  // DB'ye başlangıç kaydını yaz (fire-and-forget)
  _createRunInDb(record, taskPrompt);

  eventBus.emit({
    projectId,
    type: 'agent:started',
    agentId: agent.id,
    payload: { pid: child.pid, cliTool: agent.cliTool, cwd },
  });

  return record;
}

/**
 * Agent sürecini durdurur.
 * Önce SIGTERM gönderir; 5 saniye içinde çıkmazsa SIGKILL uygular.
 */
export function stopAgent(projectId: string, agentId: string): void {
  const key = processKey(projectId, agentId);
  const record = processes.get(key);
  if (!record || !record.process) return;

  // Zaten durmuş/duruyor
  if (record.status === 'stopped' || record.status === 'stopping') return;

  record.status = 'stopping';

  const child = record.process;

  // SIGTERM ile kibarca sor
  child.kill('SIGTERM');

  // 5 saniye sonra SIGKILL ile zorla sonlandır
  const killer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* süreç zaten ölmüş */ }
  }, 5000);

  // Süreç exit olduğunda zamanlayıcıyı iptal et
  child.once('exit', () => clearTimeout(killer));
}

/**
 * Belirli bir agent sürecinin kaydını döndürür.
 * Bulunamazsa null döner.
 */
export function getAgentProcess(projectId: string, agentId: string): AgentProcessRecord | null {
  return processes.get(processKey(projectId, agentId)) ?? null;
}

/**
 * Projenin tüm agent süreçlerini listeler.
 */
export function listProjectProcesses(projectId: string): AgentProcessRecord[] {
  const result: AgentProcessRecord[] = [];
  for (const [key, record] of processes) {
    if (key.startsWith(`${projectId}:`)) {
      result.push(record);
    }
  }
  return result;
}

/**
 * Çıktı tamponunu döndürür.
 * `since` parametresi verilirse yalnızca o indeksten itibaren satırları döndürür.
 */
export function getAgentOutput(
  projectId: string,
  agentId: string,
  since?: number,
): string[] {
  const record = processes.get(processKey(projectId, agentId));
  if (!record) return [];
  if (since !== undefined && since >= 0) {
    return record.output.slice(since);
  }
  return [...record.output];
}

/**
 * SSE akışı için yeni satırları push eden bir ReadableStream döndürür.
 * Yoklama tabanlı (500ms aralık) basit bir uygulama.
 */
export function streamAgentOutput(
  projectId: string,
  agentId: string,
): ReadableStream<string> | null {
  const record = processes.get(processKey(projectId, agentId));
  if (!record) return null;

  const key = processKey(projectId, agentId);
  let lastIndex = 0; // Mevcut satırları da gönder (replay)
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<string>({
    start(controller) {
      // Mevcut output'u replay et
      for (let i = 0; i < record.output.length; i++) {
        try {
          const payload = JSON.stringify({ line: record.output[i], index: i });
          controller.enqueue(`data: ${payload}\n\n`);
        } catch {
          cancelled = true;
          return;
        }
      }
      lastIndex = record.output.length;

      // Dinleyici tabanlı anlık bildirim
      const listener = (line: string, index: number) => {
        if (cancelled) return;
        try {
          // SSE formatında gönder
          const payload = JSON.stringify({ line, index });
          controller.enqueue(`data: ${payload}\n\n`);
          lastIndex = index + 1;
        } catch {
          // Denetleyici kapatılmış — temizle
          cancelled = true;
          removeListener();
        }
      };

      // Dinleyici kaydet
      if (!outputListeners.has(key)) {
        outputListeners.set(key, []);
      }
      outputListeners.get(key)!.push(listener);

      const removeListener = () => {
        const listeners = outputListeners.get(key);
        if (listeners) {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        }
      };

      // Süreç durduğunda akışı kapat
      intervalId = setInterval(() => {
        if (cancelled) {
          if (intervalId) clearInterval(intervalId);
          return;
        }
        const current = processes.get(key);
        if (!current || current.status === 'stopped' || current.status === 'error') {
          try { controller.close(); } catch { /* zaten kapalı */ }
          cancelled = true;
          removeListener();
          if (intervalId) clearInterval(intervalId);
        }
      }, 500);
    },
    cancel() {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      // Dinleyiciyi temizle
      const listeners = outputListeners.get(key);
      if (listeners) {
        // cancel çağrısında referansa erişemeyiz; tümünü bırak (start'ta temizlendi)
      }
    },
  });
}

/**
 * Projenin tüm agent süreçlerini durdurur ve haritadan siler.
 */
export function cleanupProject(projectId: string): void {
  for (const [key, record] of processes) {
    if (key.startsWith(`${projectId}:`)) {
      stopAgent(projectId, record.agentId);
      processes.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Sunucu kapatılırken tüm süreçleri temizle
// ---------------------------------------------------------------------------

process.on('exit', () => {
  for (const [, record] of processes) {
    try { record.process?.kill('SIGKILL'); } catch { /* yoksay */ }
  }
});

process.on('SIGINT', () => {
  for (const [, record] of processes) {
    try { record.process?.kill('SIGTERM'); } catch { /* yoksay */ }
  }
  process.exit(0);
});

// ---------------------------------------------------------------------------
// DB yardımcıları — agent_runs tablosu
// ---------------------------------------------------------------------------

function _createRunInDb(record: AgentProcessRecord, taskPrompt?: string): void {
  execute(`
    INSERT INTO agent_runs
      (id, project_id, agent_id, cli_tool, status, task_prompt, pid, started_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    record.id,
    record.projectId,
    record.agentId,
    record.cliTool,
    record.status,
    taskPrompt ?? null,
    record.pid ?? null,
    record.startedAt ?? null,
    new Date().toISOString(),
  ]).catch((err) => {
    // DB hatası agent'ı durdurmasın — sadece logla
    console.error('[agent-runtime] DB kaydı oluşturulamadı:', err);
  });
}

function _syncRunToDb(record: AgentProcessRecord): void {
  // Son 500 satırı özetle (ilk 2000 karakter)
  const summary = record.output.slice(-50).join('\n').slice(0, 2000);
  execute(`
    UPDATE agent_runs
    SET status = $1, output_summary = $2, exit_code = $3, stopped_at = $4
    WHERE id = $5
  `, [
    record.status,
    summary || null,
    record.exitCode ?? null,
    record.stoppedAt ?? null,
    record.id,
  ]).catch((err) => {
    console.error('[agent-runtime] DB kaydı güncellenemedi:', err);
  });
}

// ---------------------------------------------------------------------------
// Sanal süreç kaydı — execution-engine tarafından kullanılır
// ---------------------------------------------------------------------------

/**
 * Execution engine'in AI SDK ile çalıştırdığı görevler için sanal bir süreç
 * kaydı oluşturur. Eğer zaten varsa mevcut kaydı döndürür.
 * Bu sayede terminal SSE stream'i bu agent için çalışır.
 */
function ensureVirtualProcess(
  projectId: string,
  agentId: string,
  agentName: string,
): AgentProcessRecord {
  const key = processKey(projectId, agentId);
  const existing = processes.get(key);
  if (existing) {
    // Halihazırda kayıt varsa durumunu running yap
    existing.status = 'running';
    return existing;
  }

  const record: AgentProcessRecord = {
    id: randomUUID(),
    projectId,
    agentId,
    agentName,
    cliTool: 'ai-sdk',
    process: null,
    status: 'running',
    output: [],
    startedAt: new Date().toISOString(),
  };
  processes.set(key, record);
  return record;
}

/**
 * Sanal süreç kaydına çıktı satırı ekler.
 * Execution engine'deki agent:output event'leri için kullanılır.
 */
function appendVirtualOutput(projectId: string, agentId: string, line: string): void {
  const key = processKey(projectId, agentId);
  const record = processes.get(key);
  if (!record) return;
  appendLine(record, line);
}

/**
 * Sanal süreç kaydını tamamlandı olarak işaretler.
 */
function markVirtualStopped(projectId: string, agentId: string): void {
  const key = processKey(projectId, agentId);
  const record = processes.get(key);
  if (!record) return;
  record.status = 'stopped';
  record.stoppedAt = new Date().toISOString();
}

/**
 * Çalıştırılabilir bir örnek olarak dışa aktarılan nesne.
 * routes.ts'de containerManager ile aynı erişim kalıbını korumak için.
 */
export const agentRuntime = {
  startAgent,
  stopAgent,
  getAgentProcess,
  listProjectProcesses,
  getAgentOutput,
  streamAgentOutput,
  cleanupProject,
  ensureVirtualProcess,
  appendVirtualOutput,
  markVirtualStopped,
} as const;
