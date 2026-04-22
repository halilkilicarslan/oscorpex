// ---------------------------------------------------------------------------
// Oscorpex — Provider Repository: AI Provider + Fallback Chain
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, getPool, query, queryOne } from "../pg.js";
import { decrypt, encrypt, isEncrypted } from "../secret-vault.js";
import type { AIProvider } from "../types.js";
import { now, rowToProvider } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("provider-repo");

// ---------------------------------------------------------------------------
// AI Providers CRUD
// ---------------------------------------------------------------------------

export async function createProvider(
	data: Pick<AIProvider, "name" | "type" | "apiKey" | "baseUrl" | "model" | "isActive"> & {
		cliTool?: AIProvider["cliTool"];
	},
): Promise<AIProvider> {
	const id = randomUUID();
	const ts = now();

	// Auto-set as default if it is the very first provider
	const countRow = await queryOne<any>("SELECT COUNT(*) as c FROM ai_providers");
	const existingCount = Number.parseInt(countRow?.c ?? "0", 10);
	const isDefault = existingCount === 0 ? 1 : 0;

	const encryptedKey = data.apiKey ? encrypt(data.apiKey) : "";

	await execute(
		`
    INSERT INTO ai_providers (id, name, type, api_key, base_url, model, is_default, is_active, created_at, updated_at, cli_tool)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `,
		[
			id,
			data.name,
			data.type,
			encryptedKey,
			data.baseUrl,
			data.model,
			isDefault,
			data.isActive ? 1 : 0,
			ts,
			ts,
			data.cliTool ?? null,
		],
	);

	return (await getProvider(id))!;
}

export async function getProvider(id: string): Promise<AIProvider | undefined> {
	const row = await queryOne<any>("SELECT * FROM ai_providers WHERE id = $1", [id]);
	return row ? rowToProvider(row, true) : undefined;
}

export async function listProviders(): Promise<AIProvider[]> {
	const rows = await query<any>("SELECT * FROM ai_providers ORDER BY created_at ASC");
	return rows.map((r) => rowToProvider(r, true));
}

export async function updateProvider(
	id: string,
	data: Partial<Pick<AIProvider, "name" | "type" | "apiKey" | "baseUrl" | "model" | "isActive" | "cliTool">>,
): Promise<AIProvider | undefined> {
	const fields: string[] = [];
	const values: any[] = [];
	let idx = 1;

	if (data.name !== undefined) {
		fields.push(`name = $${idx++}`);
		values.push(data.name);
	}
	if (data.type !== undefined) {
		fields.push(`type = $${idx++}`);
		values.push(data.type);
	}
	if (data.apiKey !== undefined) {
		const encryptedKey = encrypt(data.apiKey);
		fields.push(`api_key = $${idx++}`);
		values.push(encryptedKey);
	}
	if (data.baseUrl !== undefined) {
		fields.push(`base_url = $${idx++}`);
		values.push(data.baseUrl);
	}
	if (data.model !== undefined) {
		fields.push(`model = $${idx++}`);
		values.push(data.model);
	}
	if (data.isActive !== undefined) {
		fields.push(`is_active = $${idx++}`);
		values.push(data.isActive ? 1 : 0);
	}
	if (data.cliTool !== undefined) {
		fields.push(`cli_tool = $${idx++}`);
		values.push(data.cliTool ?? null);
	}

	if (fields.length === 0) return getProvider(id);

	fields.push(`updated_at = $${idx++}`);
	values.push(now());
	values.push(id);

	await execute(`UPDATE ai_providers SET ${fields.join(", ")} WHERE id = $${idx}`, values);
	return getProvider(id);
}

export async function deleteProvider(id: string): Promise<{ success: boolean; error?: string }> {
	const row = await queryOne<any>("SELECT * FROM ai_providers WHERE id = $1", [id]);
	if (!row) return { success: false, error: "Provider not found" };
	if (row.is_default) {
		return {
			success: false,
			error: "Cannot delete the default provider. Set another provider as default first.",
		};
	}
	await execute("DELETE FROM ai_providers WHERE id = $1", [id]);
	return { success: true };
}

export async function setDefaultProvider(id: string): Promise<AIProvider | undefined> {
	const row = await queryOne<any>("SELECT * FROM ai_providers WHERE id = $1", [id]);
	if (!row) return undefined;

	// Use a transaction to swap default atomically
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		await client.query("UPDATE ai_providers SET is_default = 0, updated_at = $1", [now()]);
		await client.query("UPDATE ai_providers SET is_default = 1, updated_at = $1 WHERE id = $2", [now(), id]);
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}

	return getProvider(id);
}

export async function getDefaultProvider(): Promise<AIProvider | undefined> {
	const row = await queryOne<any>("SELECT * FROM ai_providers WHERE is_default = 1 LIMIT 1");
	// Return with unmasked key — for backend usage
	return row ? rowToProvider(row, false) : undefined;
}

/** Returns the raw (unmasked) API key for a provider — for internal backend use only. */
export async function getRawProviderApiKey(id: string): Promise<string> {
	const row = await queryOne<any>("SELECT api_key FROM ai_providers WHERE id = $1", [id]);
	const raw = row?.api_key ?? "";
	if (!raw) return "";
	// Geriye dönük uyumluluk: eski plaintext key'leri olduğu gibi döndür
	return isEncrypted(raw) ? decrypt(raw) : raw;
}

// ---------------------------------------------------------------------------
// Fallback Chain
// ---------------------------------------------------------------------------

/**
 * Aktif provider'ları fallback_order alanına göre sıralı olarak döndürür.
 */
export async function getFallbackChain(): Promise<AIProvider[]> {
	const rows = await query<any>(
		`SELECT * FROM ai_providers
     WHERE is_active = 1
     ORDER BY is_default DESC, fallback_order ASC, created_at ASC`,
	);
	return rows.map((r) => rowToProvider(r, true));
}

/**
 * Fallback sıralamasını toplu olarak günceller.
 */
export async function updateFallbackOrder(orderedIds: string[]): Promise<void> {
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		for (let index = 0; index < orderedIds.length; index++) {
			const id = orderedIds[index];
			await client.query("UPDATE ai_providers SET fallback_order = $1, updated_at = $2 WHERE id = $3", [
				index,
				now(),
				id,
			]);
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}
