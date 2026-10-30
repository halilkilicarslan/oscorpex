// ---------------------------------------------------------------------------
// Oscorpex — WebSocket tickets
// Browsers cannot send an Authorization header on a WebSocket upgrade, so an authenticated HTTP call mints a
// short-lived, single-use ticket that the upgrade presents instead of a token. In-memory: single node only.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { getWsConfig } from "./performance-config.js";

const TICKET_TTL_S = 30;

export interface WsTicketIdentity {
	userId: string;
	tenantId: string;
	role: string;
	isPlatformAdmin: boolean;
	authType?: "jwt" | "api-key-db" | "api-key" | "none";
	/** api_keys.id and sha256 of the key, for re-validating an API-key socket on every subscribe. */
	apiKeyId?: string;
	apiKeyHash?: string;
	/** Epoch ms at which the credential the ticket was minted from expires; the socket ends then. */
	tokenExpiresAt?: number;
}

interface StoredTicket {
	identity: WsTicketIdentity;
	issuedAt: number;
}

const tickets = new Map<string, StoredTicket>();
/** Outstanding tickets per user, oldest first. */
const byUser = new Map<string, string[]>();

function forget(ticket: string, userId: string): void {
	tickets.delete(ticket);
	const list = byUser.get(userId);
	if (!list) return;
	const idx = list.indexOf(ticket);
	if (idx >= 0) list.splice(idx, 1);
	if (list.length === 0) byUser.delete(userId);
}

function pruneExpired(now: number): void {
	for (const [ticket, stored] of tickets) {
		// Insertion order is issue order: the first live ticket ends the scan.
		if (now - stored.issuedAt <= TICKET_TTL_S * 1000) break;
		forget(ticket, stored.identity.userId);
	}
}

export function issueWsTicket(identity: WsTicketIdentity): { ticket: string; expiresIn: 30 } {
	const now = Date.now();
	pruneExpired(now);
	const { ticketStoreMax, ticketsPerUserMax } = getWsConfig();
	// A user can only evict their own oldest tickets; the global bound is the last resort.
	const own = byUser.get(identity.userId);
	while (own && own.length >= ticketsPerUserMax) forget(own[0], identity.userId);
	while (tickets.size >= ticketStoreMax) {
		const oldest = tickets.keys().next().value;
		if (oldest === undefined) break;
		const stored = tickets.get(oldest);
		forget(oldest, stored?.identity.userId ?? "");
	}
	const ticket = randomBytes(32).toString("base64url");
	tickets.set(ticket, { identity, issuedAt: now });
	const list = byUser.get(identity.userId) ?? [];
	list.push(ticket);
	byUser.set(identity.userId, list);
	return { ticket, expiresIn: TICKET_TTL_S };
}

/** Single use: the ticket is gone after the first call, valid or not. */
export function consumeWsTicket(ticket: string): WsTicketIdentity | null {
	const stored = tickets.get(ticket);
	if (!stored) return null;
	forget(ticket, stored.identity.userId);
	if (Date.now() - stored.issuedAt > TICKET_TTL_S * 1000) return null;
	return stored.identity;
}
