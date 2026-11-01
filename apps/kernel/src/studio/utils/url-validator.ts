// ---------------------------------------------------------------------------
// Oscorpex — URL Validator (SSRF prevention)
// ---------------------------------------------------------------------------

import * as dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { createLogger } from "../logger.js";
const log = createLogger("url-validator");

/** Blocked address space (SSRF): loopback, private, link-local/metadata, CGNAT, unspecified, IPv6 ULA/link-local. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
] as const) {
	BLOCKED.addSubnet(net, prefix, "ipv4");
}
BLOCKED.addAddress("::1", "ipv6");
BLOCKED.addAddress("::", "ipv6");
BLOCKED.addSubnet("fc00::", 7, "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");

/** `::ffff:a.b.c.d` / `::ffff:hhhh:hhhh` (any spelling) → the embedded dotted IPv4, otherwise undefined. */
function embeddedIpv4(ip: string): string | undefined {
	const lower = ip.toLowerCase();
	const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
	if (dotted) return dotted[1];
	// expand the hex forms through the URL parser, which canonicalises IPv6 literals to `::ffff:hhhh:hhhh`
	let host: string;
	try {
		host = new URL(`http://[${lower}]/`).hostname.replace(/^\[|\]$/g, "");
	} catch {
		return undefined;
	}
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
	if (!hex) return undefined;
	const hi = Number.parseInt(hex[1], 16);
	const lo = Number.parseInt(hex[2], 16);
	return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * Known DNS rebinding domains that map arbitrary subdomains to private/loopback IPs.
 * e.g. 127.0.0.1.nip.io → 127.0.0.1
 */
const REBINDING_DOMAINS = ["nip.io", "sslip.io", "localtest.me", "xip.io", "lvh.me"];

export interface DnsValidationResult {
	valid: boolean;
	reason: string;
	resolvedIps?: string[];
}

/**
 * Checks whether a single resolved IP address falls within a blocked range.
 * Handles both IPv4, bare IPv6, and IPv6-mapped IPv4 addresses.
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
	// Strip IPv6 brackets if present (e.g. [::1] → ::1)
	const normalized = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
	const family = isIP(normalized);
	if (family === 4) return BLOCKED.check(normalized, "ipv4");
	if (family === 6) {
		const mapped = embeddedIpv4(normalized);
		return mapped ? BLOCKED.check(mapped, "ipv4") : BLOCKED.check(normalized, "ipv6");
	}
	// not an address at all: be conservative
	return true;
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

	// An IP literal is judged directly: it never goes through DNS and can never be "unresolvable"
	const literal = hostname.replace(/^\[|\]$/g, "");
	if (isIP(literal)) {
		if (isPrivateOrLoopbackIp(literal)) {
			log.warn({ hostname }, "IP literal is in a private/loopback range");
			return { valid: false, reason: `Address ${literal} is a private/loopback address`, resolvedIps: [literal] };
		}
		return { valid: true, reason: "IP literal", resolvedIps: [literal] };
	}

	// Fast-path: block known rebinding domains before touching DNS
	if (isKnownRebindingDomain(hostname)) {
		log.warn({ hostname }, "DNS rebinding domain blocked");
		return { valid: false, reason: `DNS rebinding domain blocked: ${hostname}` };
	}

	// Resolve both A (IPv4) and AAAA (IPv6) records concurrently.
	// We treat DNS resolution failures as non-fatal for individual record types
	// (a host may legitimately have only A or only AAAA records).
	// If *both* resolutions fail we cannot validate — reject conservatively.
	const [ipv4Result, ipv6Result] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);

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
		if (isIP(hostname.replace(/^\[|\]$/g, "")) && isPrivateOrLoopbackIp(hostname)) {
			return { valid: false, reason: `Private/loopback IP blocked: ${hostname}` };
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

/**
 * Validation for a tenant-supplied OUTBOUND host (e.g. a SonarQube server): http(s) only, no loopback / private /
 * link-local / metadata literal, no `localhost`, and the DNS answer must not point at a private address.
 * A name that does not resolve at all is let through (nothing can connect to it either); callers re-validate at use
 * time. Residual: DNS rebinding between this check and the connection.
 */
export async function validateOutboundHostUrl(url: string): Promise<{ valid: boolean; reason: string }> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { valid: false, reason: "Invalid URL format" };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
	}
	if (parsed.username || parsed.password) return { valid: false, reason: "Credentials in the URL are not allowed" };
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::") {
		return { valid: false, reason: "Loopback hosts are not allowed" };
	}
	if (isIP(host) && isPrivateOrLoopbackIp(host)) {
		return { valid: false, reason: "Private or loopback addresses are not allowed" };
	}
	const result = await resolveAndValidateUrl(url);
	if (!result.valid && result.reason.startsWith("DNS resolution failed")) return { valid: true, reason: "unresolved" };
	return { valid: result.valid, reason: result.reason };
}
