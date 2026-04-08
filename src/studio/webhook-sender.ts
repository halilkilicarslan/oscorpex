// ---------------------------------------------------------------------------
// AI Dev Studio — Webhook Bildirici
// Slack, Discord ve Generic webhook formatlarını destekler.
// ---------------------------------------------------------------------------

import { listWebhooksForEvent } from './db.js';
import type { Webhook } from './db.js';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** HTTP isteği için maksimum bekleme süresi (milisaniye) */
const WEBHOOK_TIMEOUT_MS = 5_000;

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
  const color = eventType.includes('error') || eventType.includes('failed')
    ? '#ef4444'
    : eventType.includes('completed') || eventType.includes('finished')
    ? '#22c55e'
    : '#3b82f6';

  const title = formatEventTitle(eventType);
  const text = buildEventText(eventType, data);

  return {
    text: `*AI Dev Studio* — ${title}`,
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
  const color = eventType.includes('error') || eventType.includes('failed')
    ? 0xef4444  // kırmızı
    : eventType.includes('completed') || eventType.includes('finished')
    ? 0x22c55e  // yeşil
    : 0x3b82f6; // mavi

  const title = formatEventTitle(eventType);
  const description = buildEventText(eventType, data);

  return {
    embeds: [
      {
        title: `AI Dev Studio — ${title}`,
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
    task_completed:    'Gorev Tamamlandi',
    pipeline_finished: 'Pipeline Bitti',
    execution_error:   'Calisma Hatasi',
    budget_warning:    'Butce Uyarisi',
    plan_approved:     'Plan Onaylandi',
    task_failed:       'Gorev Basarisiz',
    agent_started:     'Agent Basladi',
    agent_stopped:     'Agent Durdu',
  };
  return titles[eventType] ?? eventType.replace(/_/g, ' ');
}

/** Event verisinden okunabilir metin oluştur */
function buildEventText(eventType: string, data: Record<string, unknown>): string {
  if (eventType === 'task_completed' && data.taskTitle) {
    return `"${data.taskTitle}" gorevi basariyla tamamlandi.`;
  }
  if (eventType === 'pipeline_finished') {
    return 'Proje pipeline\'i tum asama ve gorevleri tamamladi.';
  }
  if (eventType === 'execution_error' && data.error) {
    return `Hata: ${data.error}`;
  }
  if (eventType === 'budget_warning' && data.currentCost) {
    return `Mevcut maliyet: $${data.currentCost} — Butce limitine yaklasiliyor!`;
  }
  return JSON.stringify(data, null, 2).slice(0, 500);
}

/** Slack field listesi oluştur */
function buildSlackFields(
  data: Record<string, unknown>,
): Array<{ title: string; value: string; short: boolean }> {
  const fields: Array<{ title: string; value: string; short: boolean }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' || typeof value === 'number') {
      fields.push({ title: key, value: String(value), short: true });
    }
  }
  return fields.slice(0, 6); // Slack en fazla 6 field gösterir
}

/** Discord field listesi oluştur */
function buildDiscordFields(
  data: Record<string, unknown>,
): Array<{ name: string; value: string; inline: boolean }> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' || typeof value === 'number') {
      fields.push({ name: key, value: String(value), inline: true });
    }
  }
  return fields.slice(0, 25); // Discord en fazla 25 field destekler
}

// ---------------------------------------------------------------------------
// Ana gönderim fonksiyonu
// ---------------------------------------------------------------------------

/**
 * Tek bir webhook'a bildirim gönder.
 * Hata durumunda sessizce loglar — çağrıyı bloklamamak için tasarlandı.
 */
async function sendToWebhook(
  webhook: Webhook,
  eventType: string,
  projectId: string,
  data: Record<string, unknown>,
): Promise<void> {
  let payload: Record<string, unknown>;

  // Platform tipine göre payload seç
  if (webhook.type === 'slack') {
    payload = buildSlackPayload(eventType, projectId, data);
  } else if (webhook.type === 'discord') {
    payload = buildDiscordPayload(eventType, projectId, data);
  } else {
    payload = buildGenericPayload(eventType, projectId, data);
  }

  // AbortController ile timeout uygula
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(
        `[webhook] Bildirim başarısız — ${webhook.name} (${webhook.type}): HTTP ${res.status}`,
      );
    } else {
      console.log(
        `[webhook] Gonderildi — ${webhook.name} (${webhook.type}), event: ${eventType}`,
      );
    }
  } catch (err) {
    // Timeout veya ağ hatası — sessizce logla, üst katmanı bloklama
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[webhook] Timeout — ${webhook.name}: ${WEBHOOK_TIMEOUT_MS}ms asildi`);
    } else {
      console.warn(
        `[webhook] Gonderim hatasi — ${webhook.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Proje için belirli bir event'te kayıtlı tüm aktif webhook'lara bildirim gönder.
 *
 * @param projectId  Proje ID'si
 * @param eventType  Event tipi: 'task_completed' | 'pipeline_finished' | 'execution_error' | 'budget_warning' | ...
 * @param payload    Event'e özgü veri (başlık, hata mesajı vb.)
 */
export async function sendWebhookNotification(
  projectId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  let webhooks: Webhook[];

  try {
    webhooks = listWebhooksForEvent(projectId, eventType);
  } catch (err) {
    // DB hatası — sessizce logla
    console.warn('[webhook] Webhook listesi alinamadi:', err);
    return;
  }

  if (webhooks.length === 0) return;

  // Tüm webhook'ları paralel olarak gönder — birbirini bloklamamak için
  await Promise.allSettled(
    webhooks.map((wh) => sendToWebhook(wh, eventType, projectId, payload)),
  );
}
