// ---------------------------------------------------------------------------
// Oscorpex — URL Validator (SSRF prevention)
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
const log = createLogger("url-validator");

const PRIVATE_IP_RANGES = [
	/^127\./, // loopback
	/^10\./, // class A private
	/^172\.(1[6-9]|2\d|3[01])\./, // class B private
	/^192\.168\./, // class C private
	/^169\.254\./, // link-local
	/^0\./, // current network
	/^::1$/, // IPv6 loopback
	/^fc00:/i, // IPv6 unique local
	/^fe80:/i, // IPv6 link-local
];

/**
 * Validates a webhook URL to prevent SSRF attacks.
 * Rejects private IPs, loopback, metadata endpoints, and non-HTTP(S) schemes.
 */
export function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
	try {
		const parsed = new URL(url);

		// Only allow HTTP(S)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
		}

		const hostname = parsed.hostname;

		// Block cloud metadata endpoints
		if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
			return { valid: false, reason: "Cloud metadata endpoint blocked" };
		}

		// Block private/loopback IPs
		for (const pattern of PRIVATE_IP_RANGES) {
			if (pattern.test(hostname)) {
				return { valid: false, reason: `Private/loopback IP blocked: ${hostname}` };
			}
		}

		// Block localhost variants
		if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "[::1]") {
			return { valid: false, reason: `Localhost blocked: ${hostname}` };
		}

		return { valid: true };
	} catch {
		return { valid: false, reason: "Invalid URL format" };
	}
}
