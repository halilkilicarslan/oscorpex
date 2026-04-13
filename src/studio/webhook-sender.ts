// ---------------------------------------------------------------------------
// Oscorpex — Webhook Bildirici
// Slack, Discord ve Generic webhook formatlarını destekler.
// HMAC-SHA256 imzası, exponential backoff retry ve teslimat loglama içerir.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import { insertWebhookDelivery, listWebhooksForEvent } from "./db.js";
import type { Webhook } from "./db.js";
import { eventBus } from "./event-bus.js";
import type { EventType, StudioEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** HTTP isteği için maksimum bekleme süresi (milisaniye) */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** Maksimum yeniden deneme sayısı */
const MAX_RETRIES = 3;

/** Retry bekleme süreleri (ms): 1s, 5s, 15s */
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

// ---------------------------------------------------------------------------
// Payload oluşturucuları — her platform için ayrı format
// ---------------------------------------------------------------------------

/** Slack Webhook gövdesi — renkli attachment ile */
function buildSlackPayload(
	eventType: string,
	projectId: string,
	data: Record<string, unknown>,
): Record<string, unknown> {
	// Renk: hata kırmızı, tamamlanma yeşil, diğerleri mavi
	const color =
		eventType.includes("error") || eventType.includes("failed") || eventType.includes("rejected")
			? "#ef4444"
			: eventType.includes("completed") || eventType.includes("approved")
				? "#22c55e"
				: eventType.includes("approval_required") || eventType.includes("warning")
					? "#f59e0b"
					: "#3b82f6";

	const title = formatEventTitle(eventType);
	const text = buildEventText(eventType, data);

	return {
		text: `*Oscorpex* — ${title}`,
		attachments: [
			{
				color,
				title,
				text,
				footer: `Proje: ${projectId}`,
				ts: Math.floor(Date.now() / 1000),
				fields: buildSlackFields(data),
			},
		],
	};
}

/** Discord Webhook gövdesi — embed formatı */
function buildDiscordPayload(
	eventType: string,
	projectId: string,
	data: Record<string, unknown>,
): Record<string, unknown> {
	// Discord renk kodu: ondalık integer
	const color =
		eventType.includes("error") || eventType.includes("failed") || eventType.includes("rejected")
			? 0xef4444 // kırmızı
			: eventType.includes("completed") || eventType.includes("approved")
				? 0x22c55e // yeşil
				: eventType.includes("approval_required") || eventType.includes("warning")
					? 0xf59e0b // sarı
					: 0x3b82f6; // mavi

	const title = formatEventTitle(eventType);
	const description = buildEventText(eventType, data);

	return {
		embeds: [
			{
				title: `Oscorpex — ${title}`,
				description,
				color,
				footer: { text: `Proje: ${projectId}` },
				timestamp: new Date().toISOString(),
				fields: buildDiscordFields(data),
			},
		],
	};
}

/** Generic Webhook gövdesi — standart JSON */
function buildGenericPayload(
	eventType: string,
	projectId: string,
	data: Record<string, unknown>,
): Record<string, unknown> {
	return {
		event: eventType,
		project: projectId,
		data,
		timestamp: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Yardımcı formatlayıcılar
// ---------------------------------------------------------------------------

/** Event tipini okunabilir başlığa çevir */
function formatEventTitle(eventType: string): string {
	const titles: Record<string, string> = {
		task_completed: "Gorev Tamamlandi",
		task_failed: "Gorev Basarisiz",
		task_approval_required: "Onay Bekliyor",
		task_approved: "Gorev Onaylandi",
		task_rejected: "Gorev Reddedildi",
		pipeline_completed: "Pipeline Bitti",
		execution_error: "Calisma Hatasi",
		budget_warning: "Butce Uyarisi",
		plan_approved: "Plan Onaylandi",
		agent_started: "Agent Basladi",
		agent_stopped: "Agent Durdu",
		test: "Test Bildirimi",
	};
	return titles[eventType] ?? eventType.replace(/_/g, " ");
}

/** Event verisinden okunabilir metin oluştur */
function buildEventText(eventType: string, data: Record<string, unknown>): string {
	if (eventType === "task_completed" && data.taskTitle) {
		return `"${data.taskTitle}" gorevi basariyla tamamlandi.`;
	}
	if (eventType === "pipeline_completed") {
		return "Proje pipeline'i tum asama ve gorevleri tamamladi.";
	}
	if (eventType === "execution_error" && data.error) {
		return `Hata: ${data.error}`;
	}
	if (eventType === "budget_warning" && data.currentCost) {
		return `Mevcut maliyet: $${data.currentCost} — Butce limitine yaklasiliyor!`;
	}
	if (eventType === "task_approval_required" && data.taskTitle) {
		return `"${data.taskTitle}" gorevi onay bekliyor. Lutfen inceleyin.`;
	}
	if (eventType === "task_approved" && data.taskTitle) {
		return `"${data.taskTitle}" gorevi onaylandi.`;
	}
	if (eventType === "task_rejected" && data.taskTitle) {
		return `"${data.taskTitle}" gorevi reddedildi.${data.reason ? ` Sebep: ${data.reason}` : ""}`;
	}
	return JSON.stringify(data, null, 2).slice(0, 500);
}

/** Slack field listesi oluştur */
function buildSlackFields(data: Record<string, unknown>): Array<{ title: string; value: string; short: boolean }> {
	const fields: Array<{ title: string; value: string; short: boolean }> = [];
	for (const [key, value] of Object.entries(data)) {
		if (typeof value === "string" || typeof value === "number") {
			fields.push({ title: key, value: String(value), short: true });
		}
	}
	return fields.slice(0, 6); // Slack en fazla 6 field gösterir
}

/** Discord field listesi oluştur */
function buildDiscordFields(data: Record<string, unknown>): Array<{ name: string; value: string; inline: boolean }> {
	const fields: Array<{ name: string; value: string; inline: boolean }> = [];
	for (const [key, value] of Object.entries(data)) {
		if (typeof value === "string" || typeof value === "number") {
			fields.push({ name: key, value: String(value), inline: true });
		}
	}
	return fields.slice(0, 25); // Discord en fazla 25 field destekler
}

// ---------------------------------------------------------------------------
// HMAC imza yardımcısı
// ---------------------------------------------------------------------------

/**
 * Webhook gövdesi için HMAC-SHA256 imzası üret.
 * Secret yoksa undefined döner — başlık atlanır.
 */
function computeSignature(body: string, secret: string | undefined): string | undefined {
	if (!secret) return undefined;
	const hmac = createHmac("sha256", secret);
	hmac.update(body, "utf8");
	return `sha256=${hmac.digest("hex")}`;
}

// ---------------------------------------------------------------------------
// WebhookSender sınıfı
// ---------------------------------------------------------------------------

class WebhookSender {
	private initialized = false;

	/**
	 * Event bus'a abone ol — tüm EventType'lar için tek handler.
	 * Uygulama başlangıcında bir kez çağrılmalıdır.
	 */
	init(): void {
		if (this.initialized) return;
		this.initialized = true;

		// Tüm desteklenen event tiplerini dinle
		const eventTypes: EventType[] = [
			"task:assigned",
			"task:started",
			"task:completed",
			"task:failed",
			"task:timeout",
			"task:retry",
			"task:approval_required",
			"task:approved",
			"task:rejected",
			"agent:started",
			"agent:stopped",
			"agent:output",
			"agent:error",
			"phase:started",
			"phase:completed",
			"plan:created",
			"plan:approved",
			"execution:started",
			"execution:error",
			"escalation:user",
			"git:commit",
			"git:pr-created",
			"task:timeout_warning",
			"pipeline:completed",
			"budget:warning",
			"budget:exceeded",
		];

		for (const type of eventTypes) {
			eventBus.on(type, (event) => {
				// Arka planda çalışır — event akışını bloklamamak için
				this.processEvent(event).catch((err) => {
					console.warn(`[webhook-sender] processEvent hatasi (${type}):`, err instanceof Error ? err.message : err);
				});
			});
		}

		console.log(`[webhook-sender] Baslatildi — ${eventTypes.length} event tipi dinleniyor`);
	}

	/**
	 * Gelen event için eşleşen aktif webhook'ları bulup gönderim başlatır.
	 * EventType -> webhook event string eşlemesi burada yapılır.
	 */
	async processEvent(event: StudioEvent): Promise<void> {
		// EventBus tipi ('task:completed') → webhook event string ('task_completed')
		const webhookEventType = event.type.replace(":", "_");

		let webhooks: Webhook[];
		try {
			webhooks = await listWebhooksForEvent(event.projectId, webhookEventType);
		} catch (err) {
			console.warn("[webhook-sender] Webhook listesi alinamadi:", err instanceof Error ? err.message : err);
			return;
		}

		if (webhooks.length === 0) return;

		const payload = event.payload as Record<string, unknown>;

		// Tüm webhook'ları paralel gönder — Promise.allSettled ile hata izolasyonu
		await Promise.allSettled(
			webhooks.map((wh) => this.sendWithRetry(wh, webhookEventType, event.projectId, payload, 1)),
		);
	}

	/**
	 * Tek bir webhook'a POST gönder.
	 * Platform tipine göre payload formatı seçilir.
	 * HMAC-SHA256 imzası webhook.secret varsa eklenir.
	 */
	async sendWebhook(
		webhook: Webhook,
		eventType: string,
		projectId: string,
		data: Record<string, unknown>,
		attempt: number,
	): Promise<{ success: boolean; statusCode?: number; responseBody?: string; durationMs: number }> {
		// Platform tipine göre payload seç
		let body: Record<string, unknown>;
		if (webhook.type === "slack") {
			body = buildSlackPayload(eventType, projectId, data);
		} else if (webhook.type === "discord") {
			body = buildDiscordPayload(eventType, projectId, data);
		} else {
			// Generic format: görev tanımındaki standart yapı
			body = {
				event: eventType,
				payload: data,
				timestamp: new Date().toISOString(),
				projectId,
			};
		}

		const bodyStr = JSON.stringify(body);
		const signature = computeSignature(bodyStr, webhook.secret);

		// İstek başlıkları
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Webhook-Event": eventType,
		};
		if (webhook.secret) {
			// Secret'ı loglamıyoruz — sadece imzayı ekliyoruz
			headers["X-Webhook-Secret"] = webhook.secret;
		}
		if (signature) {
			headers["X-Webhook-Signature"] = signature;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
		const startMs = Date.now();

		try {
			const res = await fetch(webhook.url, {
				method: "POST",
				headers,
				body: bodyStr,
				signal: controller.signal,
			});

			const durationMs = Date.now() - startMs;

			// Yanıt gövdesini truncate et (maksimum 500 karakter)
			let responseBody: string | undefined;
			try {
				const rawText = await res.text();
				responseBody = rawText.slice(0, 500);
			} catch {
				responseBody = undefined;
			}

			return {
				success: res.ok,
				statusCode: res.status,
				responseBody,
				durationMs,
			};
		} catch (err) {
			const durationMs = Date.now() - startMs;
			if (err instanceof Error && err.name === "AbortError") {
				return { success: false, durationMs, responseBody: `Timeout: ${WEBHOOK_TIMEOUT_MS}ms asildi` };
			}
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, durationMs, responseBody: `Network hatasi: ${msg}` };
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Exponential backoff ile yeniden deneme.
	 * Başarılı veya maksimum deneme sayısına ulaşıldığında durur.
	 * Her deneme webhook_deliveries tablosuna kaydedilir.
	 */
	async sendWithRetry(
		webhook: Webhook,
		eventType: string,
		projectId: string,
		data: Record<string, unknown>,
		attempt: number,
	): Promise<void> {
		const result = await this.sendWebhook(webhook, eventType, projectId, data, attempt);

		// Teslimat kaydını logla
		try {
			await insertWebhookDelivery({
				webhookId: webhook.id,
				eventType,
				status: result.success ? "success" : "failed",
				statusCode: result.statusCode,
				responseBody: result.responseBody,
				durationMs: result.durationMs,
				attempt,
			});
		} catch (logErr) {
			// Log hatası ana akışı engellemez
			console.warn("[webhook-sender] Teslimat kaydedilemedi:", logErr instanceof Error ? logErr.message : logErr);
		}

		if (result.success) {
			console.log(
				`[webhook-sender] Gonderildi — ${webhook.name} (${webhook.type}), event: ${eventType}, ` +
					`${result.durationMs}ms, HTTP ${result.statusCode}`,
			);
			return;
		}

		// Başarısız — retry gerekiyor mu?
		if (attempt >= MAX_RETRIES) {
			console.warn(
				`[webhook-sender] Maksimum deneme sayisina ulasildi — ${webhook.name}, event: ${eventType}, ` +
					`deneme: ${attempt}/${MAX_RETRIES}, HTTP ${result.statusCode ?? "N/A"}`,
			);
			return;
		}

		const delay = RETRY_DELAYS_MS[attempt - 1] ?? 15_000;
		console.warn(
			`[webhook-sender] Gonderim basarisiz — ${webhook.name}, event: ${eventType}, ` +
				`HTTP ${result.statusCode ?? "N/A"}, ${delay}ms sonra tekrar denenecek (${attempt}/${MAX_RETRIES})`,
		);

		// Asenkron bekleme — retry gecikmesi
		await new Promise<void>((resolve) => setTimeout(resolve, delay));
		await this.sendWithRetry(webhook, eventType, projectId, data, attempt + 1);
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const webhookSender = new WebhookSender();

// ---------------------------------------------------------------------------
// Geriye dönük uyumluluk — routes.ts sendWebhookNotification kullanıyor
// ---------------------------------------------------------------------------

/**
 * Proje için belirli bir event'te kayıtlı tüm aktif webhook'lara bildirim gönder.
 *
 * @param projectId  Proje ID'si
 * @param eventType  Event tipi: 'task_completed' | 'pipeline_completed' | 'execution_error' | 'budget_warning' | ...
 * @param payload    Event'e özgü veri (başlık, hata mesajı vb.)
 */
export async function sendWebhookNotification(
	projectId: string,
	eventType: string,
	payload: Record<string, unknown> = {},
): Promise<void> {
	let webhooks: Webhook[];

	try {
		webhooks = await listWebhooksForEvent(projectId, eventType);
	} catch (err) {
		// DB hatası — sessizce logla
		console.warn("[webhook-sender] Webhook listesi alinamadi:", err instanceof Error ? err.message : err);
		return;
	}

	if (webhooks.length === 0) return;

	// Tüm webhook'ları paralel gönder — birbirini bloklamamak için
	await Promise.allSettled(webhooks.map((wh) => webhookSender.sendWithRetry(wh, eventType, projectId, payload, 1)));
}
