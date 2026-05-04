// ---------------------------------------------------------------------------
// Oscorpex — URL Validator (SSRF prevention)
// ---------------------------------------------------------------------------

import * as dns from "node:dns/promises";
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
 * Known DNS rebinding domains that map arbitrary subdomains to private/loopback IPs.
 * e.g. 127.0.0.1.nip.io → 127.0.0.1
 */
const REBINDING_DOMAINS = ["nip.io", "sslip.io", "localtest.me", "xip.io", "lvh.me"];

/**
 * IPv6-mapped IPv4 private address patterns.
 * e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 (hex form)
 */
const IPV6_MAPPED_PRIVATE_RANGES = [
	/^::ffff:127\./i, // ::ffff:127.x.x.x — loopback
	/^::ffff:10\./i, // ::ffff:10.x.x.x — class A private
	/^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // ::ffff:172.16-31.x.x — class B private
	/^::ffff:192\.168\./i, // ::ffff:192.168.x.x — class C private
	/^::ffff:169\.254\./i, // ::ffff:169.254.x.x — link-local
	/^::ffff:0\./i, // ::ffff:0.x.x.x — current network
	// Hex-encoded compact forms (e.g. ::ffff:7f00:0001)
	/^::ffff:7f[0-9a-f]{2}:[0-9a-f]{4}$/i, // 0x7f = 127 (loopback)
	/^::ffff:0a[0-9a-f]{2}:[0-9a-f]{4}$/i, // 0x0a = 10 (class A)
	/^::ffff:a9fe:[0-9a-f]{4}$/i, // 0xa9fe = 169.254 (link-local)
	/^::ffff:c0a8:[0-9a-f]{4}$/i, // 0xc0a8 = 192.168 (class C)
];

export interface DnsValidationResult {
	valid: boolean;
	reason: string;
	resolvedIps?: string[];
}

/**
 * Checks whether a single resolved IP address falls within a blocked range.
 * Handles both IPv4, bare IPv6, and IPv6-mapped IPv4 addresses.
 */
function isPrivateOrLoopbackIp(ip: string): boolean {
	// Strip IPv6 brackets if present (e.g. [::1] → ::1)
	const normalized = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;

	// Plain IPv6 loopback / unique-local / link-local
	for (const pattern of PRIVATE_IP_RANGES) {
		if (pattern.test(normalized)) return true;
	}

	// IPv6-mapped IPv4 forms
	for (const pattern of IPV6_MAPPED_PRIVATE_RANGES) {
		if (pattern.test(normalized)) return true;
	}

	return false;
}

/**
 * Returns true when the hostname matches a known DNS rebinding domain suffix.
 * Matching is suffix-based so sub-subdomains (e.g. foo.127.0.0.1.nip.io) are also caught.
 */
function isKnownRebindingDomain(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return REBINDING_DOMAINS.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

/**
 * Async SSRF guard that combines static hostname checks with live DNS resolution.
 *
 * Defends against:
 * - DNS rebinding via well-known services (nip.io, sslip.io, localtest.me, xip.io, lvh.me)
 * - Hostnames that resolve to private/loopback IPv4 or IPv6 addresses
 * - IPv6-mapped private IPv4 addresses (::ffff:127.x.x.x etc.)
 *
 * Usage: call this before forwarding any user-supplied webhook URL to an HTTP client.
 * The sync `validateWebhookUrl` should still be called first for a cheap pre-check.
 */
export async function resolveAndValidateUrl(url: string): Promise<DnsValidationResult> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { valid: false, reason: "Invalid URL format" };
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
	}

	const hostname = parsed.hostname.toLowerCase();

	// Fast-path: block known rebinding domains before touching DNS
	if (isKnownRebindingDomain(hostname)) {
		log.warn({ hostname }, "DNS rebinding domain blocked");
		return { valid: false, reason: `DNS rebinding domain blocked: ${hostname}` };
	}

	// Resolve both A (IPv4) and AAAA (IPv6) records concurrently.
	// We treat DNS resolution failures as non-fatal for individual record types
	// (a host may legitimately have only A or only AAAA records).
	// If *both* resolutions fail we cannot validate — reject conservatively.
	const [ipv4Result, ipv6Result] = await Promise.allSettled([
		dns.resolve4(hostname),
		dns.resolve6(hostname),
	]);

	const resolvedIps: string[] = [];

	if (ipv4Result.status === "fulfilled") resolvedIps.push(...ipv4Result.value);
	if (ipv6Result.status === "fulfilled") resolvedIps.push(...ipv6Result.value);

	if (resolvedIps.length === 0) {
		const ipv4Err = ipv4Result.status === "rejected" ? (ipv4Result.reason as Error).message : null;
		const ipv6Err = ipv6Result.status === "rejected" ? (ipv6Result.reason as Error).message : null;
		log.warn({ hostname, ipv4Err, ipv6Err }, "DNS resolution failed for both record types");
		return { valid: false, reason: `DNS resolution failed for hostname: ${hostname}` };
	}

	// Validate every resolved IP — reject if any lands in a private range
	for (const ip of resolvedIps) {
		if (isPrivateOrLoopbackIp(ip)) {
			log.warn({ hostname, ip, resolvedIps }, "Resolved IP is in a private/loopback range");
			return {
				valid: false,
				reason: `Hostname ${hostname} resolves to a private/loopback address: ${ip}`,
				resolvedIps,
			};
		}
	}

	log.info({ hostname, resolvedIps }, "DNS validation passed");
	return { valid: true, reason: "ok", resolvedIps };
}

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
