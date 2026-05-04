// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — In-Memory Credential Vault
// Encrypts sensitive strings (OAuth tokens) in process memory using AES-256-GCM.
// The encryption key is generated once at module load time and is never persisted.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Per-process ephemeral key — regenerated on every restart, never written to disk.
const VAULT_KEY = randomBytes(32);

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16;

/**
 * Encrypts a plaintext string.
 * Returns a colon-delimited hex string in the form: `iv:authTag:ciphertext`.
 */
export function encrypt(data: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, VAULT_KEY, iv);
	const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a string previously produced by `encrypt`.
 * Throws if the ciphertext is malformed or authentication fails.
 */
export function decrypt(encryptedData: string): string {
	const parts = encryptedData.split(":");
	if (parts.length !== 3) {
		throw new Error("[credential-vault] Malformed encrypted payload — expected iv:authTag:ciphertext");
	}
	const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
	const iv = Buffer.from(ivHex, "hex");
	const authTag = Buffer.from(authTagHex, "hex");
	const ciphertext = Buffer.from(ciphertextHex, "hex");

	if (iv.byteLength !== IV_BYTES) {
		throw new Error("[credential-vault] Invalid IV length");
	}
	if (authTag.byteLength !== AUTH_TAG_BYTES) {
		throw new Error("[credential-vault] Invalid auth tag length");
	}

	const decipher = createDecipheriv(ALGORITHM, VAULT_KEY, iv);
	decipher.setAuthTag(authTag);
	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return decrypted.toString("utf8");
}
