import type { AgentMessage, SendMessageData, BroadcastMessageData } from './types.js';
import { API, json, fetchPaginated, type PaginatedResult } from './base.js';

// Proje mesajlarını listele (opsiyonel: agentId ve status filtresi)
export async function fetchProjectMessages(
  projectId: string,
  agentId?: string,
  status?: string,
): Promise<AgentMessage[]> {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  if (status) params.set('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';
  return json(`${API}/projects/${projectId}/messages${query}`);
}

// Ajan gelen kutusunu getir
export async function fetchAgentInbox(
  projectId: string,
  agentId: string,
  status?: string,
): Promise<AgentMessage[]> {
  const query = status ? `?status=${status}` : '';
  return json(`${API}/projects/${projectId}/agents/${agentId}/inbox${query}`);
}

// Okunmamış mesaj sayısını getir
export async function fetchUnreadCount(
  projectId: string,
  agentId: string,
): Promise<{ agentId: string; unreadCount: number }> {
  return json(`${API}/projects/${projectId}/agents/${agentId}/inbox/count`);
}

// Tüm ajanların okunmamış mesaj sayılarını tek istekte getir (agentId → count)
export async function fetchAllUnreadCounts(
  projectId: string,
): Promise<Record<string, number>> {
  return json<Record<string, number>>(`${API}/projects/${projectId}/agents/unread-counts`);
}

// Yeni mesaj gönder
export async function sendAgentMessage(
  projectId: string,
  data: SendMessageData,
): Promise<AgentMessage> {
  return json(
    `${API}/projects/${projectId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}

// Mesajı okundu olarak işaretle
export async function markMessageRead(
  projectId: string,
  messageId: string,
): Promise<AgentMessage> {
  return json(
    `${API}/projects/${projectId}/messages/${messageId}/read`,
    { method: 'PUT' },
  );
}

// Mesajı arşivle
export async function archiveAgentMessage(
  projectId: string,
  messageId: string,
): Promise<AgentMessage> {
  return json(
    `${API}/projects/${projectId}/messages/${messageId}/archive`,
    { method: 'PUT' },
  );
}

// Mesaj zincirini (thread) getir
export async function fetchMessageThread(
  projectId: string,
  messageId: string,
): Promise<AgentMessage[]> {
  return json(`${API}/projects/${projectId}/messages/${messageId}/thread`);
}

export async function fetchProjectMessagesPaginated(
	projectId: string,
	limit = 50,
	offset = 0,
): Promise<PaginatedResult<AgentMessage>> {
	return fetchPaginated<AgentMessage>(`${API}/projects/${projectId}/messages`, limit, offset);
}

// Tüm ekibe yayın mesajı gönder
export async function broadcastMessage(
  projectId: string,
  data: BroadcastMessageData,
): Promise<{ sent: number; messages: AgentMessage[] }> {
  return json(
    `${API}/projects/${projectId}/messages/broadcast`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}
