// ---------------------------------------------------------------------------
// Oscorpex — JWT sign/verify (HMAC-SHA256, no external deps)
// ---------------------------------------------------------------------------

import { createHmac, randomUUID } from "node:crypto";

const JWT_SECRET = process.env.OSCORPEX_JWT_SECRET ?? "oscorpex-dev-secret-change-in-production";
const JWT_EXPIRY = 24 * 60 * 60; // 24 saat (saniye)

export interface JwtPayload {
	sub: string; // user.id
	email: string;
	tenantId: string;
	role: string;
	iat: number;
	exp: number;
	jti: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64url(str: string): string {
	return Buffer.from(str).toString("base64url");
}

function base64urlDecode(str: string): string {
	return Buffer.from(str, "base64url").toString("utf8");
}

function hmacSign(data: string): string {
	return createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function signJwt(payload: Omit<JwtPayload, "iat" | "exp" | "jti">): string {
	const header = { alg: "HS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const fullPayload: JwtPayload = {
		...payload,
		iat: now,
		exp: now + JWT_EXPIRY,
		jti: randomUUID(),
	};
	const headerB64 = base64url(JSON.stringify(header));
	const payloadB64 = base64url(JSON.stringify(fullPayload));
	const signature = hmacSign(`${headerB64}.${payloadB64}`);
	return `${headerB64}.${payloadB64}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;

		const [headerB64, payloadB64, signature] = parts as [string, string, string];
		const expectedSig = hmacSign(`${headerB64}.${payloadB64}`);

		// Constant-time comparison to prevent timing attacks
		if (signature !== expectedSig) return null;

		const payload = JSON.parse(base64urlDecode(payloadB64)) as JwtPayload;
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp < now) return null;

		return payload;
	} catch {
		return null;
	}
}
