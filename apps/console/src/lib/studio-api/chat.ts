import type {
  ChatMessage,
  IntakeQuestion,
  IntakeQuestionStatus,
  PlannerCLIProvider,
  PlannerChatModel,
  PlannerReasoningEffort,
  ArchitectMessage,
  TeamArchitectIntake,
} from './types.js';
import { API, json } from './base.js';

export async function fetchChatHistory(projectId: string): Promise<ChatMessage[]> {
  return json(`${API}/projects/${projectId}/chat/history`);
}

export async function fetchIntakeQuestions(
  projectId: string,
  status?: IntakeQuestionStatus,
): Promise<IntakeQuestion[]> {
  const url = status
    ? `${API}/projects/${projectId}/intake-questions?status=${status}`
    : `${API}/projects/${projectId}/intake-questions`;
  return json(url);
}

export async function answerIntakeQuestion(
  projectId: string,
  questionId: string,
  answer: string,
): Promise<IntakeQuestion> {
  return json(
    `${API}/projects/${projectId}/intake-questions/${questionId}/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer }),
    },
  );
}

export async function skipIntakeQuestion(
  projectId: string,
  questionId: string,
): Promise<IntakeQuestion> {
  return json(
    `${API}/projects/${projectId}/intake-questions/${questionId}/skip`,
    { method: 'POST' },
  );
}

export function streamPMChat(
  projectId: string,
  message: string,
  provider: PlannerCLIProvider,
  model: PlannerChatModel,
  effort: PlannerReasoningEffort | null,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  fetch(`${API}/projects/${projectId}/chat`, { // DIRECT_FETCH_INTENTIONAL: planner chat streams SSE chunks through ReadableStream.
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, provider, model, effort }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            if (currentEvent === 'error' && parsed.error) {
              throw new Error(parsed.error);
            }
            // Sadece text-delta event'lerinden gelen string text değerlerini işle.
            // tool-call, tool-result, step-finish gibi AI SDK event'leri text içermez
            // ve ekranda "undefined" olarak görünmelerine yol açar — bunları atla.
            if (currentEvent === 'text-delta' && typeof parsed.text === 'string') {
              onText(parsed.text);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
          }
          currentEvent = '';
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return () => controller.abort();
}

export function streamTeamArchitectChat(
  intake: TeamArchitectIntake,
  messages: ArchitectMessage[],
  onText: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  fetch(`${API}/team-architect/chat`, { // DIRECT_FETCH_INTENTIONAL: team architect chat streams SSE chunks through ReadableStream.
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intake, messages }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let finalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            if (currentEvent === 'error' && parsed.error) {
              throw new Error(parsed.error);
            }
            if (currentEvent === 'text-delta' && typeof parsed.text === 'string') {
              onText(parsed.text);
            }
            if (currentEvent === 'done' && typeof parsed.fullText === 'string') {
              finalText = parsed.fullText;
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
          }
          currentEvent = '';
        }
      }

      onDone(finalText);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return () => controller.abort();
}
