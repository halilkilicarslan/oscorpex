// ---------------------------------------------------------------------------
// P9-F: Test-Pass Token
// Issues a short-lived token (30 min) when a test suite passes with zero
// failures. A commit proposal's testGatePassed flag must be set only after
// verifying a valid token exists.
//
// Storage: in-memory Map (one token per tenant:project). DB-backing can be
// added later without changing the public API.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import type { TestPassToken } from "./git-types.js";

const log = createLogger("test-pass-token");

/** Token lifetime — 30 minutes */
const TOKEN_TTL_MS = 30 * 60 * 1_000;

/** Key: `${tenantId}:${projectId}` */
const tokenStore = new Map<string, TestPassToken>();

/**
 * Issue a test-pass token for the given project if all tests passed.
 * Returns `null` if any tests failed — no token is stored.
 */
export function issueTestPassToken(opts: {
	projectId: string;
	tenantId: string;
	suiteResult: { passed: number; failed: number; total: number };
}): TestPassToken | null {
	if (opts.suiteResult.failed > 0) {
		log.warn(
			{ projectId: opts.projectId, failed: opts.suiteResult.failed },
			"[test-pass] Tests failed — no token issued",
		);
		return null;
	}

	const now = new Date();
	const token: TestPassToken = {
		projectId: opts.projectId,
		tenantId: opts.tenantId,
		passed: true,
		issuedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
		suiteResult: opts.suiteResult,
	};

	const key = `${opts.tenantId}:${opts.projectId}`;
	tokenStore.set(key, token);

	log.info(
		{ projectId: opts.projectId, total: opts.suiteResult.total, expiresAt: token.expiresAt },
		"[test-pass] Token issued",
	);

	return token;
}

/**
 * Verify that a valid (non-expired, all-pass) token exists for the project.
 * Expired tokens are removed from the store on access.
 */
export function verifyTestPassToken(projectId: string, tenantId: string): boolean {
	const key = `${tenantId}:${projectId}`;
	const token = tokenStore.get(key);

	if (!token) return false;

	if (new Date(token.expiresAt) < new Date()) {
		tokenStore.delete(key);
		return false;
	}

	return token.passed;
}

/**
 * Clear all stored tokens — intended for use in tests only.
 * @internal
 */
export function _clearTokenStore(): void {
	tokenStore.clear();
}
