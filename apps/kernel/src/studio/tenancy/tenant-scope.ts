// ---------------------------------------------------------------------------
// Oscorpex — Tenant Scope (AsyncLocalStorage)
// Carries the tenant (or explicit system) scope across async call chains so
// pg.ts can set `app.current_tenant_id` for every statement (RLS, see F1).
//
// Rules:
//  - runInTenant(id): same tenant nested is a no-op; a different tenant nested
//    is rejected; tenant inside system is allowed (system → tenant).
//  - runAsSystem(reason): rejected inside a tenant scope (no escalation).
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "node:async_hooks";

export type TenantScope = { kind: "tenant"; tenantId: string } | { kind: "system"; reason: string };

export type TenantScopeMode = "warn" | "strict";

export class TenantScopeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TenantScopeError";
	}
}

export class UnscopedQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnscopedQueryError";
	}
}

const MAX_TENANT_ID_LENGTH = 128;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Explicit "no scope" marker (AsyncLocalStorage.exit is unreliable on Node 20 when scopes are re-entered inside it). */
const NO_SCOPE = { kind: "none" } as const;
/** `implicit` marks the default test-harness scope (enterTenantScopeForTests); it is never produced by production code. */
type Store = (TenantScope & { implicit?: true }) | typeof NO_SCOPE;

const scopeStorage = new AsyncLocalStorage<Store>();

function readScope(): TenantScope | undefined {
	const store = scopeStorage.getStore();
	if (store === undefined || store.kind === "none") return undefined;
	return store.kind === "tenant"
		? { kind: "tenant", tenantId: store.tenantId }
		: { kind: "system", reason: store.reason };
}

/** True when the active scope is the implicit default test scope (never true in production). */
export function isImplicitScope(): boolean {
	const store = scopeStorage.getStore();
	return store !== undefined && store.kind !== "none" && store.implicit === true;
}

/** Current scope, or undefined when running unscoped. */
export function currentScope(): TenantScope | undefined {
	return readScope();
}

/** OSCORPEX_TENANT_SCOPE_MODE: "strict" | "warn" (default; unknown values fall back to warn). */
export function tenantScopeMode(): TenantScopeMode {
	return process.env.OSCORPEX_TENANT_SCOPE_MODE === "strict" ? "strict" : "warn";
}

function validateTenantId(tenantId: unknown): asserts tenantId is string {
	if (typeof tenantId !== "string" || tenantId.length === 0) {
		throw new TenantScopeError("tenantId must be a non-empty string");
	}
	if (tenantId.length > MAX_TENANT_ID_LENGTH) {
		throw new TenantScopeError(`tenantId exceeds ${MAX_TENANT_ID_LENGTH} characters`);
	}
	if (CONTROL_CHARS.test(tenantId)) {
		throw new TenantScopeError("tenantId contains control characters");
	}
}

/** Run fn with the given tenant scope. */
export async function runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
	validateTenantId(tenantId);
	const parent = readScope();
	if (parent?.kind === "tenant") {
		if (parent.tenantId !== tenantId) {
			throw new TenantScopeError("Cannot switch to a different tenant inside an active tenant scope");
		}
		if (!isImplicitScope()) return fn();
	}
	return scopeStorage.run({ kind: "tenant", tenantId }, fn);
}

/** Run fn as explicit system scope (sys_* functions, boot, sweepers). Not allowed inside a tenant scope. */
export async function runAsSystem<T>(reason: string, fn: () => Promise<T>): Promise<T> {
	if (typeof reason !== "string" || reason.length === 0) {
		throw new TenantScopeError("runAsSystem requires a non-empty reason");
	}
	const parent = readScope();
	if (parent?.kind === "tenant") {
		throw new TenantScopeError("Cannot escalate to system scope from inside a tenant scope");
	}
	return scopeStorage.run({ kind: "system", reason }, fn);
}

/**
 * Run fn with no tenant/system scope at all (explicit no-scope marker). Works for sync and async fn.
 * Intended for tests that assert unscoped behaviour; production code should use runInTenant/runAsSystem.
 */
export function runOutsideScope<T>(fn: () => T): T {
	return scopeStorage.run(NO_SCOPE, fn);
}

/**
 * Test-harness hook: make the rest of the current async execution context run in the given tenant scope
 * (AsyncLocalStorage.enterWith). Used by the vitest setup file to give every test a default tenant.
 */
export function enterTenantScopeForTests(tenantId: string): void {
	if (!process.env.VITEST) throw new TenantScopeError("enterTenantScopeForTests is only available under vitest");
	validateTenantId(tenantId);
	scopeStorage.enterWith({ kind: "tenant", tenantId, implicit: true });
}

/**
 * Request-boundary variants: an HTTP request is a fresh unit of work, so the implicit default test scope (or no
 * scope) is dropped before the request establishes its own. An explicit tenant/system scope is never dropped:
 * these helpers throw instead, so a handler cannot use them to switch tenants. Not for use inside handlers.
 */
function assertBoundary(): void {
	const store = scopeStorage.getStore();
	if (store !== undefined && store.kind !== "none" && store.implicit !== true) {
		throw new TenantScopeError("Request-boundary helper called inside an explicit tenant/system scope");
	}
}

export async function runInTenantAtBoundary<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
	assertBoundary();
	return runOutsideScope(() => runInTenant(tenantId, fn));
}

export async function runAsSystemAtBoundary<T>(reason: string, fn: () => Promise<T>): Promise<T> {
	assertBoundary();
	return runOutsideScope(() => runAsSystem(reason, fn));
}

/** Request-boundary variant for public routes: no tenant/system scope at all (an inherited implicit scope is dropped). */
export async function runWithoutScopeAtBoundary<T>(fn: () => Promise<T>): Promise<T> {
	// An explicit scope set by the caller is left alone (public routes never read tenant data anyway).
	if (hasExplicitScope()) return fn();
	return runOutsideScope(fn);
}

function hasExplicitScope(): boolean {
	const store = scopeStorage.getStore();
	return store !== undefined && store.kind !== "none" && store.implicit !== true;
}

/**
 * Request-boundary entry into the caller's tenant. At a fresh boundary (no scope / implicit test scope) this is
 * runInTenantAtBoundary. If an explicit scope is already active it is honoured instead of dropped: the same tenant
 * is a no-op, a different tenant is rejected by runInTenant (never silently replaced), and an explicit system scope
 * may narrow into the tenant (system → tenant is allowed; only tenant → system is refused).
 */
export async function enterRequestTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
	return hasExplicitScope() ? runInTenant(tenantId, fn) : runInTenantAtBoundary(tenantId, fn);
}

/**
 * Run a SECURITY DEFINER sys_* lookup (identity / API-key resolution) before the request tenant is known.
 * At a fresh boundary: explicit system scope. Inside an already-explicit scope: in place — sys_* functions do not
 * depend on the tenant GUC, so no scope change is needed (and none is allowed).
 */
export async function runSysLookupAtBoundary<T>(reason: string, fn: () => Promise<T>): Promise<T> {
	return hasExplicitScope() ? fn() : runAsSystemAtBoundary(reason, fn);
}
