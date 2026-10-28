// ---------------------------------------------------------------------------
// Request identity accessors — typed reads of what authMiddleware stored on the Hono context.
// ---------------------------------------------------------------------------

import type { Context } from "hono";

// biome-ignore lint/suspicious/noExplicitAny: routers declare differing Variables; accessors stay env-agnostic
type AnyContext = Context<any>;

export function isPlatformAdminRequest(c: AnyContext): boolean {
	return c.get("isPlatformAdmin") === true;
}

export function callerUserId(c: AnyContext): string | undefined {
	return (c.get("userId") as string | undefined) ?? undefined;
}

export function callerTenantId(c: AnyContext): string | undefined {
	return (c.get("tenantId") as string | undefined) ?? undefined;
}
