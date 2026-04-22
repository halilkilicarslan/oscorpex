// ---------------------------------------------------------------------------
// Oscorpex — Webhook Repository: Webhooks + Deliveries
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import { now } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("webhook-repo");

// ---------------------------------------------------------------------------
// Webhook interfaces — DB layer only
// ---------------------------------------------------------------------------

/** Webhook veri yapısı */
export interface Webhook {
	id: string;
	projectId: string;
	name: string;
	url: string;
	/** Webhook türü: Slack, Discord veya Generic */
	type: "slack" | "discord" | "generic";
	/** Dinlenen event tipleri: JSON dizisi olarak saklanır */
	events: string[];
	active: boolean;
	/** HMAC imzası için gizli anahtar — opsiyonel */
	secret?: string;
	createdAt: string;
}

/** Webhook teslimat log kaydı */
export interface WebhookDelivery {
	id: string;
	webhookId: string;
	eventType: string;
	status: "success" | "failed";
	statusCode?: number;
	responseBody?: string;
	durationMs: number;
	attempt: number;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToWebhook(row: any): Webhook {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		url: row.url,
		type: row.type as Webhook["type"],
		events: JSON.parse(row.events ?? "[]"),
		active: Boolean(row.active),
		secret: row.secret ?? undefined,
		createdAt: row.created_at,
	};
}

function rowToDelivery(row: any): WebhookDelivery {
	return {
		id: row.id,
		webhookId: row.webhook_id,
		eventType: row.event_type,
		status: row.status as "success" | "failed",
		statusCode: row.status_code ?? undefined,
		responseBody: row.response_body ?? undefined,
		durationMs: row.duration_ms,
		attempt: row.attempt,
		createdAt: row.created_at,
	};
}

// ---------------------------------------------------------------------------
// Webhooks CRUD
// ---------------------------------------------------------------------------

/** Yeni webhook oluştur — URL https:// ile başlamalı */
export async function createWebhook(data: {
	projectId: string;
	name: string;
	url: string;
	type: Webhook["type"];
	events: string[];
	secret?: string;
}): Promise<Webhook> {
	const id = randomUUID();
	const ts = now();
	await execute(
		"INSERT INTO webhooks (id, project_id, name, url, type, events, active, secret, created_at) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)",
		[id, data.projectId, data.name, data.url, data.type, JSON.stringify(data.events), data.secret ?? null, ts],
	);
	return (await getWebhook(id))!;
}

/** Projeye ait webhook'ları listele */
export async function listWebhooks(projectId: string): Promise<Webhook[]> {
	const rows = await query<any>("SELECT * FROM webhooks WHERE project_id = $1 ORDER BY created_at DESC", [projectId]);
	return rows.map(rowToWebhook);
}

/** Tekil webhook'u getir */
export async function getWebhook(id: string): Promise<Webhook | undefined> {
	const row = await queryOne<any>("SELECT * FROM webhooks WHERE id = $1", [id]);
	return row ? rowToWebhook(row) : undefined;
}

/** Webhook'u güncelle — kısmi güncelleme desteklenir */
export async function updateWebhook(
	id: string,
	data: Partial<Pick<Webhook, "name" | "url" | "type" | "events" | "active" | "secret">>,
): Promise<Webhook | undefined> {
	const fields: string[] = [];
	const values: (string | number | null)[] = [];
	let idx = 1;

	if (data.name !== undefined) {
		fields.push(`name = $${idx++}`);
		values.push(data.name);
	}
	if (data.url !== undefined) {
		fields.push(`url = $${idx++}`);
		values.push(data.url);
	}
	if (data.type !== undefined) {
		fields.push(`type = $${idx++}`);
		values.push(data.type);
	}
	if (data.events !== undefined) {
		fields.push(`events = $${idx++}`);
		values.push(JSON.stringify(data.events));
	}
	if (data.active !== undefined) {
		fields.push(`active = $${idx++}`);
		values.push(data.active ? 1 : 0);
	}
	if (data.secret !== undefined) {
		fields.push(`secret = $${idx++}`);
		values.push(data.secret ?? null);
	}

	if (fields.length === 0) return getWebhook(id);

	values.push(id);
	await execute(`UPDATE webhooks SET ${fields.join(", ")} WHERE id = $${idx}`, values as any[]);
	return getWebhook(id);
}

/** Webhook'u sil */
export async function deleteWebhook(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM webhooks WHERE id = $1", [id]);
	return (result.rowCount ?? 0) > 0;
}

/** Belirli bir event'i dinleyen aktif webhook'ları getir */
export async function listWebhooksForEvent(projectId: string, eventType: string): Promise<Webhook[]> {
	// Tüm aktif webhook'ları çek ve JavaScript tarafında filtrele
	const all = await query<any>("SELECT * FROM webhooks WHERE project_id = $1 AND active = 1", [projectId]);
	const webhooks = all.map(rowToWebhook);
	// 'test' event türü tüm aktif webhook'lara gönderilir
	if (eventType === "test") return webhooks;
	return webhooks.filter((w) => w.events.includes(eventType));
}

// ---------------------------------------------------------------------------
// Webhook Deliveries CRUD
// ---------------------------------------------------------------------------

/** Yeni teslimat kaydı oluştur */
export async function insertWebhookDelivery(data: Omit<WebhookDelivery, "id" | "createdAt">): Promise<WebhookDelivery> {
	const id = randomUUID();
	const ts = now();
	await execute(
		`INSERT INTO webhook_deliveries
       (id, webhook_id, event_type, status, status_code, response_body, duration_ms, attempt, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[
			id,
			data.webhookId,
			data.eventType,
			data.status,
			data.statusCode ?? null,
			data.responseBody ?? null,
			data.durationMs,
			data.attempt,
			ts,
		],
	);
	return (await queryOne<any>("SELECT * FROM webhook_deliveries WHERE id = $1", [id]).then((r) =>
		r ? rowToDelivery(r) : undefined,
	))!;
}

/** Webhook'a ait son N teslimat kaydını getir */
export async function listWebhookDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
	const rows = await query<any>(
		"SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT $2",
		[webhookId, limit],
	);
	return rows.map(rowToDelivery);
}
