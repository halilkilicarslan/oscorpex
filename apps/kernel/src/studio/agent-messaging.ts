// ---------------------------------------------------------------------------
// Oscorpex — Ajan-Arası Mesajlaşma Modülü (Agent-to-Agent Messaging)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { listProjectAgents } from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import { execute, query, queryOne } from "./db.js";
import type { AgentMessage, MessageStatus, MessageType } from "./types.js";
const log = createLogger("agent-messaging");

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
		metadata: JSON.parse(row.metadata ?? "{}"),
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
export async function sendMessage(
	projectId: string,
	fromAgentId: string,
	toAgentId: string,
	type: MessageType,
	subject: string,
	content: string,
	metadata?: Record<string, any>,
	parentMessageId?: string,
): Promise<AgentMessage> {
	const id = randomUUID();
	const ts = now();

	await execute(
		`
    INSERT INTO agent_messages
      (id, project_id, from_agent_id, to_agent_id, type, subject, content, metadata, status, parent_message_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread', $9, $10)
  `,
		[
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
		],
	);

	const message = (await getMessage(id))!;

	eventBus.emit({
		projectId,
		type: "message:created",
		agentId: toAgentId,
		payload: { messageId: id, from: fromAgentId },
	});

	return message;
}

/**
 * Tek bir mesajı ID'ye göre getirir.
 */
export async function getMessage(id: string): Promise<AgentMessage | undefined> {
	const row = await queryOne<any>("SELECT * FROM agent_messages WHERE id = $1", [id]);
	return row ? rowToAgentMessage(row) : undefined;
}

/**
 * Bir ajanın gelen kutusunu döndürür.
 * İsteğe bağlı status filtresi ile sadece 'unread', 'read' veya 'archived' mesajlar getirilebilir.
 */
export async function getInbox(projectId: string, agentId: string, status?: MessageStatus): Promise<AgentMessage[]> {
	if (status) {
		const rows = await query<any>(
			`SELECT * FROM agent_messages
       WHERE project_id = $1 AND to_agent_id = $2 AND status = $3
       ORDER BY created_at DESC`,
			[projectId, agentId, status],
		);
		return rows.map(rowToAgentMessage);
	}

	const rows = await query<any>(
		`SELECT * FROM agent_messages
     WHERE project_id = $1 AND to_agent_id = $2
     ORDER BY created_at DESC`,
		[projectId, agentId],
	);
	return rows.map(rowToAgentMessage);
}

/**
 * Bir mesajın tüm thread zincirini döndürür (kök mesaj + tüm yanıtlar).
 * Kök mesajı bulmak için parent zinciri geriye doğru takip edilir.
 */
export async function getThread(messageId: string): Promise<AgentMessage[]> {
	// Kök mesajı bul — parent_message_id olmayan mesaja kadar çık
	let rootId = messageId;
	let current = await getMessage(messageId);
	while (current?.parentMessageId) {
		rootId = current.parentMessageId;
		current = await getMessage(rootId);
	}

	// Kök mesaj + ona bağlı tüm mesajları getir
	const rows = await query<any>(
		`SELECT * FROM agent_messages
     WHERE id = $1 OR parent_message_id = $2
     ORDER BY created_at ASC`,
		[rootId, rootId],
	);
	return rows.map(rowToAgentMessage);
}

/**
 * Mesajı okundu olarak işaretler ve read_at zaman damgasını kaydeder.
 */
export async function markAsRead(messageId: string): Promise<AgentMessage | undefined> {
	const ts = now();
	await execute(`UPDATE agent_messages SET status = 'read', read_at = $1 WHERE id = $2 AND status = 'unread'`, [
		ts,
		messageId,
	]);
	return getMessage(messageId);
}

/**
 * Mesajı arşivler (archived durumuna geçirir).
 */
export async function archiveMessage(messageId: string): Promise<AgentMessage | undefined> {
	await execute(`UPDATE agent_messages SET status = 'archived' WHERE id = $1`, [messageId]);
	return getMessage(messageId);
}

/**
 * Belirli bir ajanın projede okunmamış mesaj sayısını döndürür.
 */
export async function getUnreadCount(projectId: string, agentId: string): Promise<number> {
	const row = await queryOne<any>(
		`SELECT COUNT(*) as count FROM agent_messages
     WHERE project_id = $1 AND to_agent_id = $2 AND status = 'unread'`,
		[projectId, agentId],
	);
	return Number(row?.count ?? 0);
}

/**
 * Projedeki tüm ajanların okunmamış mesaj sayılarını tek sorguda döndürür.
 * Dönüş: agentId → okunmamış mesaj sayısı eşlemesi.
 */
export async function getAllUnreadCounts(projectId: string): Promise<Record<string, number>> {
	const rows = await query<{ to_agent_id: string; count: string }>(
		`SELECT to_agent_id, COUNT(*) as count
     FROM agent_messages
     WHERE project_id = $1 AND status = 'unread'
     GROUP BY to_agent_id`,
		[projectId],
	);
	const result: Record<string, number> = {};
	for (const row of rows) {
		result[row.to_agent_id] = Number(row.count);
	}
	return result;
}

/**
 * Projedeki tüm mesajları listeler.
 * İsteğe bağlı agentId ve status filtreleri uygulanabilir.
 */
export async function listProjectMessages(
	projectId: string,
	agentId?: string,
	status?: MessageStatus,
): Promise<AgentMessage[]> {
	const conditions: string[] = ["project_id = $1"];
	const params: any[] = [projectId];
	let idx = 2;

	// agentId verilmişse hem gönderen hem de alıcı olarak filtrele
	if (agentId) {
		conditions.push(`(from_agent_id = $${idx} OR to_agent_id = $${idx + 1})`);
		params.push(agentId, agentId);
		idx += 2;
	}

	if (status) {
		conditions.push(`status = $${idx}`);
		params.push(status);
		idx++;
	}

	const sql = `SELECT * FROM agent_messages WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
	const rows = await query<any>(sql, params);
	return rows.map(rowToAgentMessage);
}

export async function listProjectMessagesPaginated(
	projectId: string,
	agentId: string | undefined,
	status: MessageStatus | undefined,
	limit: number,
	offset: number,
): Promise<[AgentMessage[], number]> {
	const conditions: string[] = ["project_id = $1"];
	const params: any[] = [projectId];
	let idx = 2;

	if (agentId) {
		conditions.push(`(from_agent_id = $${idx} OR to_agent_id = $${idx + 1})`);
		params.push(agentId, agentId);
		idx += 2;
	}

	if (status) {
		conditions.push(`status = $${idx}`);
		params.push(status);
		idx++;
	}

	const where = conditions.join(" AND ");

	const countRow = await query<any>(`SELECT COUNT(*) AS cnt FROM agent_messages WHERE ${where}`, params);
	const total = Number(countRow[0]?.cnt ?? 0);

	const rows = await query<any>(
		`SELECT * FROM agent_messages WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
		[...params, limit, offset],
	);
	return [rows.map(rowToAgentMessage), total];
}

// ---------------------------------------------------------------------------
// Toplu İşlem Fonksiyonları
// ---------------------------------------------------------------------------

/**
 * Bir ajandan projedeki tüm diğer takım üyelerine yayın mesajı gönderir.
 * Gönderen ajan kendisine mesaj almaz.
 */
export async function broadcastToTeam(
	projectId: string,
	fromAgentId: string,
	subject: string,
	content: string,
	metadata?: Record<string, any>,
	type?: MessageType,
): Promise<AgentMessage[]> {
	// Projedeki tüm ajanları getir ve göndereni çıkar
	const teamMembers = (await listProjectAgents(projectId)).filter((a) => a.id !== fromAgentId);

	// Her takım üyesine ayrı ayrı mesaj gönder
	const sent: AgentMessage[] = [];
	for (const member of teamMembers) {
		const msg = await sendMessage(
			projectId,
			fromAgentId,
			member.id,
			type ?? "notification",
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
export async function notifyNextInPipeline(
	projectId: string,
	fromAgentId: string,
	taskId: string,
	message: string,
): Promise<AgentMessage[]> {
	const agents = await listProjectAgents(projectId);

	// Gönderen ajanı bul
	const sender = agents.find((a) => a.id === fromAgentId);
	if (!sender) return [];

	// Gönderenin pipeline sırasını belirle
	const senderOrder = sender.pipelineOrder > 0 ? sender.pipelineOrder : (PIPELINE_ORDER[sender.role] ?? -1);

	if (senderOrder < 0) return [];

	// Bir sonraki sırayı bul — mevcut ajanlar arasında senderOrder'dan büyük en küçük değer
	const nextOrders = agents
		.map((a) => (a.pipelineOrder > 0 ? a.pipelineOrder : (PIPELINE_ORDER[a.role] ?? -1)))
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
		const msg = await sendMessage(
			projectId,
			fromAgentId,
			target.id,
			"task_assignment",
			`Pipeline: ${sender.role} → ${target.role}`,
			message,
			{ taskId, fromRole: sender.role, toRole: target.role, pipelineStage: nextOrder },
		);
		sent.push(msg);
	}

	return sent;
}
