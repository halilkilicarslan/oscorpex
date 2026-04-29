import type { AgentInfo, WorkflowInfo } from '../types';
import { httpGet, httpPost } from './studio-api/base.js';

const BASE = '/api/studio';

export async function fetchAgents(): Promise<AgentInfo[]> {
  const json = await httpGet<unknown[] | { data?: unknown[] }>(`${BASE}/agents`);
  const items = Array.isArray(json) ? json : (json.data ?? []);
  // Map Oscorpex AgentConfig → Dashboard AgentInfo
  return (items as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    description: a.personality || a.systemPrompt?.slice(0, 120) || a.role,
    status: a.isPreset ? 'preset' : 'active',
    model: a.model,
    tools: (a.skills || []).map((s: string) => ({ id: s, name: s, description: '', type: 'skill' })),
    subAgents: [],
  }));
}

export async function fetchWorkflows(): Promise<WorkflowInfo[]> {
  // Oscorpex does not have a /workflows endpoint (VoltAgent legacy)
  return [];
}

export async function sendText(agentId: string, input: string): Promise<string> {
  const json = await httpPost<{ data?: { text?: string } }>(`${BASE}/agents/${agentId}/text`, { input });
  return json.data?.text ?? '';
}

export function streamChat(
  agentId: string,
  input: string,
  conversationId?: string,
  onEvent: (event: { type: string; [key: string]: unknown }) => void = () => {},
  onDone: () => void = () => {},
  onError: (err: Error) => void = () => {},
) {
  const controller = new AbortController();

  const body: Record<string, unknown> = { input };
  if (conversationId) body.conversationId = conversationId;

  fetch(`${BASE}/agents/${agentId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            onEvent(parsed);
          } catch {
            // skip malformed JSON
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return () => controller.abort();
}

export async function executeWorkflow(
  workflowId: string,
  input: Record<string, unknown>,
): Promise<{ executionId: string }> {
  const json = await httpPost<{ data?: { executionId: string } }>(`${BASE}/workflows/${workflowId}/execute`, { input });
  return json.data ?? { executionId: '' };
}

export async function resumeWorkflow(
  workflowId: string,
  executionId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return httpPost<unknown>(`${BASE}/workflows/${workflowId}/executions/${executionId}/resume`, { input });
}
