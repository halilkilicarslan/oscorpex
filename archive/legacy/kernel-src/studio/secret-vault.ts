// ---------------------------------------------------------------------------
// Oscorpex — Secret Vault
// API key'leri AES-256-GCM ile şifreler / çözer.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { createLogger } from "./logger.js";
const log = createLogger("secret-vault");

// ---------------------------------------------------------------------------
// Vault anahtarı — 32 byte (AES-256 için)
// ---------------------------------------------------------------------------

function getVaultKey(): Buffer {
	const envKey = process.env.OSCORPEX_VAULT_KEY;
	if (envKey && envKey.length >= 32) {
		// Env var'dan SHA-256 türet → deterministik 32 byte
		return createHash("sha256").update(envKey).digest();
	}

	// Production'da mutlaka env var set edilmeli
	log.warn(
		"[secret-vault] OSCORPEX_VAULT_KEY not set — using hostname-derived key. Set a proper key for production.",
	);
	return createHash("sha256").update(hostname()).digest();
}

// ---------------------------------------------------------------------------
// Şifreleme
// ---------------------------------------------------------------------------

/**
 * Verilen düz metni AES-256-GCM ile şifreler.
 * Dönen format: `<iv_hex>:<tag_hex>:<ciphertext_hex>`
 */
export function encrypt(plaintext: string): string {
	const key = getVaultKey();
	const iv = randomBytes(12); // GCM için 12 byte IV
	const cipher = createCipheriv("aes-256-gcm", key, iv);

	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag(); // 16 byte auth tag

	return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Çözme
// ---------------------------------------------------------------------------

/**
 * `encrypt()` çıktısını çözer ve düz metni döner.
 * Hata durumunda `Failed to decrypt value` fırlatır.
 */
export function decrypt(encrypted: string): string {
	try {
		const parts = encrypted.split(":");
		if (parts.length !== 3) throw new Error("Invalid format");

		const [ivHex, tagHex, ciphertextHex] = parts;
		const key = getVaultKey();
		const iv = Buffer.from(ivHex, "hex");
		const tag = Buffer.from(tagHex, "hex");
		const ciphertext = Buffer.from(ciphertextHex, "hex");

		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);

		return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
	} catch {
		throw new Error("Failed to decrypt value");
	}
}

// ---------------------------------------------------------------------------
// Şifreli mi kontrolü
// ---------------------------------------------------------------------------

// 24 hex = 12 byte IV, 32 hex = 16 byte tag, ardından herhangi uzunlukta ciphertext
const ENCRYPTED_PATTERN = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

/**
 * Değerin daha önce `encrypt()` ile şifrelenip şifrelenmediğini kontrol eder.
 * Geriye dönük uyumluluk için plaintext değerleri ayırt etmeye yarar.
 */
export function isEncrypted(value: string): boolean {
	return ENCRYPTED_PATTERN.test(value);
}
