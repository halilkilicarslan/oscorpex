import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";

const log = createLogger("hermes-key-mgmt");

export interface HermesKeyCreateResult {
	id: string;
	rawKey: string; // Only returned once at creation — never persisted in plaintext
	keyHash: string;
	tenantId: string;
	name: string;
}

// P13-G: Generate a new Hermes API key.  The raw key is returned exactly once;
// the caller is responsible for displaying/storing it.  Only the SHA-256 hash
// is retained for future verification.
export function generateHermesApiKey(opts: { tenantId: string; name: string }): HermesKeyCreateResult {
	const id = randomUUID();
	const rawKey = `hms_${randomBytes(32).toString("hex")}`;
	const keyHash = createHash("sha256").update(rawKey).digest("hex");

	log.info({ id, name: opts.name, tenantId: opts.tenantId }, "[hermes-key] API key generated");

	return { id, rawKey, keyHash, tenantId: opts.tenantId, name: opts.name };
}

// Hash an incoming raw key for comparison against stored hashes.
export function hashHermesKey(rawKey: string): string {
	return createHash("sha256").update(rawKey).digest("hex");
}

// Validate that a key string matches the expected Hermes key format.
// Format: "hms_" followed by exactly 64 lowercase hex characters.
export function validateHermesKeyFormat(key: string): boolean {
	return /^hms_[a-f0-9]{64}$/.test(key);
}
