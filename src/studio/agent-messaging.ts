// ---------------------------------------------------------------------------
// AI Dev Studio — Ajan-Arası Mesajlaşma Modülü (Agent-to-Agent Messaging)
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { listProjectAgents } from './db.js';
import type { AgentMessage, MessageType, MessageStatus } from './types.js';

// ---------------------------------------------------------------------------
// Yardımcı Fonksiyonlar
// ---------------------------------------------------------------------------

/** Şu anki zamanı ISO-8601 formatında döndürür */
function now(): string {
  return new Date().toISOString();
}

/** Veritabanı satırını AgentMessage nesnesine dönüştürür */
function rowToAgentMessage(row: any): AgentMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    type: row.type as MessageType,
    subject: row.subject,
    content: row.content,
    metadata: JSON.parse(row.metadata ?? '{}'),
    status: row.status as MessageStatus,
    parentMessageId: row.parent_message_id ?? undefined,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Pipeline sırası (preset agent rolleri ile hizalı)
// ---------------------------------------------------------------------------

/** Rol adından pipeline sırasını döndürür; bilinmeyen roller için -1 */
const PIPELINE_ORDER: Record<string, number> = {
  pm: 0,
  designer: 1,
  architect: 2,
  frontend: 3,
  backend: 3,
  coder: 3,
  qa: 4,
  reviewer: 5,
  devops: 6,
};

// ---------------------------------------------------------------------------
// Temel CRUD Fonksiyonları
// ---------------------------------------------------------------------------

/**
 * Bir ajandan diğerine yeni mesaj gönderir.
 * İsteğe bağlı olarak thread bağlamı için parentMessageId verilebilir.
 */
export function sendMessage(
  projectId: string,
  fromAgentId: string,
  toAgentId: string,
  type: MessageType,
  subject: string,
  content: string,
  metadata?: Record<string, any>,
  parentMessageId?: string,
): AgentMessage {
  const db = getDb();
  const id = randomUUID();
  const ts = now();

  db.prepare(`
    INSERT INTO agent_messages
      (id, project_id, from_agent_id, to_agent_id, type, subject, content, metadata, status, parent_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?)
  `).run(
    id,
    projectId,
    fromAgentId,
    toAgentId,
    type,
    subject,
    content,
    JSON.stringify(metadata ?? {}),
    parentMessageId ?? null,
    ts,
  );

  return getMessage(id)!;
}

/**
 * Tek bir mesajı ID'ye göre getirir.
 */
export function getMessage(id: string): AgentMessage | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as any;
  return row ? rowToAgentMessage(row) : undefined;
}

/**
 * Bir ajanın gelen kutusunu döndürür.
 * İsteğe bağlı status filtresi ile sadece 'unread', 'read' veya 'archived' mesajlar getirilebilir.
 */
export function getInbox(
  projectId: string,
  agentId: string,
  status?: MessageStatus,
): AgentMessage[] {
  const db = getDb();

  // Status filtresi varsa WHERE koşuluna ekle
  if (status) {
    return (
      db
        .prepare(
          `SELECT * FROM agent_messages
           WHERE project_id = ? AND to_agent_id = ? AND status = ?
           ORDER BY created_at DESC`,
        )
        .all(projectId, agentId, status) as any[]
    ).map(rowToAgentMessage);
  }

  return (
    db
      .prepare(
        `SELECT * FROM agent_messages
         WHERE project_id = ? AND to_agent_id = ?
         ORDER BY created_at DESC`,
      )
      .all(projectId, agentId) as any[]
  ).map(rowToAgentMessage);
}

/**
 * Bir mesajın tüm thread zincirini döndürür (kök mesaj + tüm yanıtlar).
 * Kök mesajı bulmak için parent zinciri geriye doğru takip edilir.
 */
export function getThread(messageId: string): AgentMessage[] {
  const db = getDb();

  // Kök mesajı bul — parent_message_id olmayan mesaja kadar çık
  let rootId = messageId;
  let current = getMessage(messageId);
  while (current?.parentMessageId) {
    rootId = current.parentMessageId;
    current = getMessage(rootId);
  }

  // Kök mesaj + ona bağlı tüm mesajları getir
  return (
    db
      .prepare(
        `SELECT * FROM agent_messages
         WHERE id = ? OR parent_message_id = ?
         ORDER BY created_at ASC`,
      )
      .all(rootId, rootId) as any[]
  ).map(rowToAgentMessage);
}

/**
 * Mesajı okundu olarak işaretler ve read_at zaman damgasını kaydeder.
 */
export function markAsRead(messageId: string): AgentMessage | undefined {
  const db = getDb();
  const ts = now();
  db.prepare(
    `UPDATE agent_messages SET status = 'read', read_at = ? WHERE id = ? AND status = 'unread'`,
  ).run(ts, messageId);
  return getMessage(messageId);
}

/**
 * Mesajı arşivler (archived durumuna geçirir).
 */
export function archiveMessage(messageId: string): AgentMessage | undefined {
  const db = getDb();
  db.prepare(`UPDATE agent_messages SET status = 'archived' WHERE id = ?`).run(messageId);
  return getMessage(messageId);
}

/**
 * Belirli bir ajanın projede okunmamış mesaj sayısını döndürür.
 */
export function getUnreadCount(projectId: string, agentId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM agent_messages
       WHERE project_id = ? AND to_agent_id = ? AND status = 'unread'`,
    )
    .get(projectId, agentId) as any;
  return row?.count ?? 0;
}

/**
 * Projedeki tüm mesajları listeler.
 * İsteğe bağlı agentId ve status filtreleri uygulanabilir.
 */
export function listProjectMessages(
  projectId: string,
  agentId?: string,
  status?: MessageStatus,
): AgentMessage[] {
  const db = getDb();
  const conditions: string[] = ['project_id = ?'];
  const params: any[] = [projectId];

  // agentId verilmişse hem gönderen hem de alıcı olarak filtrele
  if (agentId) {
    conditions.push('(from_agent_id = ? OR to_agent_id = ?)');
    params.push(agentId, agentId);
  }

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const sql = `SELECT * FROM agent_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
  return (db.prepare(sql).all(...params) as any[]).map(rowToAgentMessage);
}

// ---------------------------------------------------------------------------
// Toplu İşlem Fonksiyonları
// ---------------------------------------------------------------------------

/**
 * Bir ajandan projedeki tüm diğer takım üyelerine yayın mesajı gönderir.
 * Gönderen ajan kendisine mesaj almaz.
 */
export function broadcastToTeam(
  projectId: string,
  fromAgentId: string,
  subject: string,
  content: string,
  metadata?: Record<string, any>,
): AgentMessage[] {
  // Projedeki tüm ajanları getir ve göndereni çıkar
  const teamMembers = listProjectAgents(projectId).filter((a) => a.id !== fromAgentId);

  // Her takım üyesine ayrı ayrı bildirim mesajı gönder
  const sent: AgentMessage[] = [];
  for (const member of teamMembers) {
    const msg = sendMessage(
      projectId,
      fromAgentId,
      member.id,
      'notification',
      subject,
      content,
      metadata,
    );
    sent.push(msg);
  }

  return sent;
}

/**
 * Pipeline sırasındaki bir sonraki aşamadaki ajan(lar)a otomatik bildirim gönderir.
 * Aynı pipeline sırasındaki birden fazla ajan varsa (paralel aşama) hepsine gönderir.
 *
 * @param projectId   Proje ID
 * @param fromAgentId Gönderen ajanın ID'si
 * @param taskId      İlgili görevin ID'si (metadata olarak eklenir)
 * @param message     Mesaj içeriği
 */
export function notifyNextInPipeline(
  projectId: string,
  fromAgentId: string,
  taskId: string,
  message: string,
): AgentMessage[] {
  const agents = listProjectAgents(projectId);

  // Gönderen ajanı bul
  const sender = agents.find((a) => a.id === fromAgentId);
  if (!sender) return [];

  // Gönderenin pipeline sırasını belirle
  const senderOrder = sender.pipelineOrder > 0
    ? sender.pipelineOrder
    : PIPELINE_ORDER[sender.role] ?? -1;

  if (senderOrder < 0) return [];

  // Bir sonraki sırayı bul — mevcut ajanlar arasında senderOrder'dan büyük en küçük değer
  const nextOrders = agents
    .map((a) => a.pipelineOrder > 0 ? a.pipelineOrder : (PIPELINE_ORDER[a.role] ?? -1))
    .filter((o) => o > senderOrder);

  if (nextOrders.length === 0) return [];

  const nextOrder = Math.min(...nextOrders);

  // Bir sonraki aşamadaki tüm ajanları bul (paralel aşamalar desteklenir)
  const nextAgents = agents.filter((a) => {
    const order = a.pipelineOrder > 0 ? a.pipelineOrder : (PIPELINE_ORDER[a.role] ?? -1);
    return order === nextOrder;
  });

  // Her bir sonraki ajana görev atama mesajı gönder
  const sent: AgentMessage[] = [];
  for (const target of nextAgents) {
    const msg = sendMessage(
      projectId,
      fromAgentId,
      target.id,
      'task_assignment',
      `Pipeline: ${sender.role} → ${target.role}`,
      message,
      { taskId, fromRole: sender.role, toRole: target.role, pipelineStage: nextOrder },
    );
    sent.push(msg);
  }

  return sent;
}
