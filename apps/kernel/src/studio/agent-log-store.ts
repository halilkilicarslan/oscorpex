// ---------------------------------------------------------------------------
// Oscorpex — Agent Log Store (Dosya Tabanlı)
// Agent terminal çıktılarını .oscorpex/logs/{projectId}/{agentId}.log
// dosyalarına persist eder. DB'ye yük binmez.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "./logger.js";
const log = createLogger("agent-log-store");

const LOGS_BASE = join(process.cwd(), ".oscorpex", "logs");

function logDir(projectId: string): string {
	return join(LOGS_BASE, projectId);
}

function logPath(projectId: string, agentId: string): string {
	return join(logDir(projectId), `${agentId}.log`);
}

/**
 * Agent output satırlarını .log dosyasına append eder.
 * Dizin yoksa oluşturur. Hata fırlatmaz.
 */
export async function persistAgentLog(projectId: string, agentId: string, lines: string[]): Promise<void> {
	if (lines.length === 0) return;
	try {
		await mkdir(logDir(projectId), { recursive: true });
		const content = lines.map((l) => l.replace(/\n$/, "")).join("\n") + "\n";
		await writeFile(logPath(projectId, agentId), content, "utf8");
	} catch (err) {
		log.warn("[agent-log-store] Log yazılamadı: " + (err instanceof Error ? err.message : String(err)));
	}
}

/**
 * Agent log dosyasını okuyup satır dizisi döndürür.
 * Dosya yoksa boş dizi döner.
 */
export async function loadAgentLog(projectId: string, agentId: string): Promise<string[]> {
	try {
		const raw = await readFile(logPath(projectId, agentId), "utf8");
		return raw.split("\n").filter((l) => l.length > 0);
	} catch {
		return [];
	}
}
