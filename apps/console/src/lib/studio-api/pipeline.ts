import type { PipelineState, AgentProcessInfo, AgentRunHistory } from './types.js';
import { API, json, httpPost } from './base.js';

// Pipeline'ı başlat
export async function startPipeline(projectId: string): Promise<PipelineState> {
  const data = await json<{ pipeline?: PipelineState } & PipelineState>(
    `${API}/projects/${projectId}/pipeline/start`,
    { method: 'POST' },
  );
  return data.pipeline ?? data;
}

// Pipeline durumunu getir
export async function getPipelineStatus(projectId: string): Promise<PipelineState> {
  const data = await json<{ pipeline?: PipelineState } & PipelineState>(
    `${API}/projects/${projectId}/pipeline/status`,
  );
  // API { pipeline, taskProgress, status } formatında dönüyor — içindeki pipeline objesini çıkar
  return data.pipeline ?? data;
}

// Pipeline'ı duraklat
export async function pausePipeline(projectId: string): Promise<void> {
  await json(`${API}/projects/${projectId}/pipeline/pause`, { method: 'POST' });
}

// Pipeline'ı devam ettir
export async function resumePipeline(projectId: string): Promise<void> {
  await json(`${API}/projects/${projectId}/pipeline/resume`, { method: 'POST' });
}

// Pipeline'ı manuel olarak ilerlet (test amaçlı)
export async function advancePipeline(projectId: string): Promise<PipelineState> {
  const data = await json<{ pipeline?: PipelineState } & PipelineState>(
    `${API}/projects/${projectId}/pipeline/advance`,
    { method: 'POST' },
  );
  return data.pipeline ?? data;
}

export async function fetchAgentFiles(
  projectId: string,
  agentId: string,
): Promise<{ agentId: string; agentName: string; files: string[] }> {
  return json(`${API}/projects/${projectId}/team/${agentId}/files`);
}

export async function fetchAgentFile(
  projectId: string,
  agentId: string,
  fileName: string,
): Promise<{ fileName: string; content: string }> {
  return json(`${API}/projects/${projectId}/team/${agentId}/files/${fileName}`);
}

export async function writeAgentFile(
  projectId: string,
  agentId: string,
  fileName: string,
  content: string,
): Promise<void> {
  await json(
    `${API}/projects/${projectId}/team/${agentId}/files/${fileName}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}

// Ajan sürecini başlat
export async function startAgentProcess(
  projectId: string,
  agentId: string,
  taskPrompt?: string,
): Promise<AgentProcessInfo> {
  return json(
    `${API}/projects/${projectId}/agents/${agentId}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPrompt }),
    },
  );
}

// Ajan sürecini durdur
export async function stopAgentProcess(projectId: string, agentId: string): Promise<void> {
  await httpPost<void>(`${API}/projects/${projectId}/agents/${agentId}/stop`);
}

// Ajan durumunu sorgula
export async function getAgentStatus(
  projectId: string,
  agentId: string,
): Promise<AgentProcessInfo> {
  return json(`${API}/projects/${projectId}/agents/${agentId}/status`);
}

// Mevcut çıktı tamponunu getir (since parametresi ile offset desteği)
export async function getAgentOutput(
  projectId: string,
  agentId: string,
  since?: number,
): Promise<{ agentId: string; lines: string[]; total: number }> {
  const url =
    since !== undefined
      ? `${API}/projects/${projectId}/agents/${agentId}/output?since=${since}`
      : `${API}/projects/${projectId}/agents/${agentId}/output`;
  return json(url);
}

// Tüm ajanların çalışma durumlarını listele
export async function getAgentRuntimes(projectId: string): Promise<AgentProcessInfo[]> {
  return json(`${API}/projects/${projectId}/runtimes`);
}

// Ajan çalıştırma geçmişini getir
export async function getAgentRunHistory(
  projectId: string,
  agentId: string,
  limit?: number,
): Promise<AgentRunHistory[]> {
  const url =
    limit !== undefined
      ? `${API}/projects/${projectId}/agents/${agentId}/runs?limit=${limit}`
      : `${API}/projects/${projectId}/agents/${agentId}/runs`;
  return json(url);
}

// ---------------------------------------------------------------------------
// WebSocket tabanlı Agent Output Streaming
// ---------------------------------------------------------------------------
//
// SSE'ye kıyasla avantajları:
//   - Bidirectional: ilerleyen süreçte client'tan agent'a komut gönderilebilir
//   - Tek bir kalıcı bağlantı üzerinden tüm projeler için multiplexing
//   - Daha düşük overhead (HTTP başlıkları her mesajda tekrar edilmez)
//
// Kullanım:
//   const stop = streamAgentOutputWS(projectId, agentId, (line, index) => {
//     console.log(line);
//   });
//   // Durdur:
//   stop();

const STUDIO_WS_URL = `ws://localhost:${import.meta.env.VITE_STUDIO_WS_PORT ?? 3142}/api/studio/ws`;
const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS  = 15_000;

export function streamAgentOutputWS(
  projectId: string,
  agentId: string | undefined,
  onLine: (line: string, index: number) => void,
  onError?: (err: Error) => void,
  taskId?: string,
): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let lineCounter = 0;

  function connect() {
    if (stopped) return;

    try {
      ws = new WebSocket(STUDIO_WS_URL);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      // Projeye abone ol
      ws!.send(JSON.stringify({ type: 'subscribe', projectId }));
    };

    ws.onmessage = (e: MessageEvent<string>) => {
      if (stopped) return;
      let msg: { type: string; payload?: unknown };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.type !== 'event') return;

      const event = msg.payload as {
        type: string;
        agentId?: string;
        taskId?: string;
        payload?: { line?: string; index?: number; output?: string };
      };

      // Filter by agentId or taskId
      if (
        event.type === 'agent:output' &&
        event.payload &&
        (agentId ? event.agentId === agentId : taskId ? event.taskId === taskId : false)
      ) {
        const { line, index, output } = event.payload;
        if (typeof line === 'string' && typeof index === 'number') {
          onLine(line, index);
        } else if (typeof output === 'string') {
          onLine(output, lineCounter++);
        }
      }
    };

    ws.onerror = () => {
      if (stopped) return;
      onError?.(new Error('WebSocket bağlantı hatası'));
    };

    ws.onclose = () => {
      if (stopped) return;
      ws = null;
      // Exponential backoff ile yeniden bağlan
      const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** attempt, WS_RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.close(1000, 'caller stopped');
      ws = null;
    }
  };
}

// ---------------------------------------------------------------------------
// SSE akışını fetch + ReadableStream ile bağla.
// EventSource yerine fetch tercih edilir: daha iyi hata yönetimi ve iptal desteği sağlar.
// Dönen fonksiyon çağrıldığında bağlantıyı iptal eder (abort).
// NOT: Yeni kodda streamAgentOutputWS tercih edilmeli; bu fonksiyon geriye uyumluluk içindir.
export function streamAgentOutput(
  projectId: string,
  agentId: string,
  onLine: (line: string, index: number) => void,
  onError?: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  // SSE akışını asenkron olarak başlat
  const connect = async () => {
    try {
      const res = await fetch(`${API}/projects/${projectId}/agents/${agentId}/stream`, { signal: controller.signal }); // DIRECT_FETCH_INTENTIONAL: agent output SSE requires raw ReadableStream access.

      if (!res.ok) {
        throw new Error(`SSE bağlantısı başarısız: HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream desteklenmiyor');

      const decoder = new TextDecoder();
      let buffer = '';

      // Veri satırlarını sürekli oku
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Tampondaki tüm tam satırları işle
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          // Yalnızca SSE veri satırlarını işle
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr) as { line: string; index: number };
            if (typeof parsed.line === 'string' && typeof parsed.index === 'number') {
              onLine(parsed.line, parsed.index);
            }
          } catch {
            // JSON ayrıştırma hatalarını sessizce atla
          }
        }
      }
    } catch (err) {
      // AbortError normal kapatma sinyalidir; hata olarak iletme
      if (err instanceof Error && err.name === 'AbortError') return;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  connect();

  // Bağlantıyı iptal eden fonksiyonu döndür
  return () => controller.abort();
}
