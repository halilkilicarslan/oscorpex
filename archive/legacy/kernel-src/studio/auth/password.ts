// ---------------------------------------------------------------------------
// Oscorpex — Password hashing with scrypt (no external deps)
// ---------------------------------------------------------------------------

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createLogger } from "../logger.js";
const log = createLogger("password");

/**
 * Hash a plaintext password using scrypt with a random salt.
 * Returns "salt:hash" format where both are hex-encoded.
 */
export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString("hex");
	const hash = scryptSync(password, salt, 64).toString("hex");
	return `${salt}:${hash}`;
}

/**
 * Verify a plaintext password against a stored "salt:hash" string.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(":");
	if (!salt || !hash) return false;
	try {
		const derivedHash = scryptSync(password, salt, 64).toString("hex");
		return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derivedHash, "hex"));
	} catch {
		return false;
	}
}
