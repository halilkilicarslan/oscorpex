// ---------------------------------------------------------------------------
// Oscorpex — SharedState: Abstraction layer for distributed state management
// Defaults to in-memory; can be swapped to Redis via OSCORPEX_STATE_PROVIDER=redis
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { createLogger } from "./logger.js";
const log = createLogger("shared-state");

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SharedStateProvider {
	/** Get a value by key. Returns undefined if not found or expired. */
	get(key: string): Promise<unknown>;

	/** Set a value. Optional TTL in milliseconds. */
	set(key: string, value: unknown, ttlMs?: number): Promise<void>;

	/** Delete a key. */
	del(key: string): Promise<void>;

	/** Check if a key exists and has not expired. */
	has(key: string): Promise<boolean>;

	/** Publish a message to a channel. */
	publish(channel: string, message: unknown): Promise<void>;

	/** Subscribe to a channel. Returns unsubscribe function. */
	subscribe(channel: string, handler: (message: unknown) => void): () => void;

	/** Unsubscribe all handlers from a channel. */
	unsubscribe(channel: string): void;

	/** Acquire a distributed lock. Returns true if acquired, false if already held. */
	acquireLock(key: string, ttlMs?: number): Promise<boolean>;

	/** Release a lock. */
	releaseLock(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryStateProvider
// ---------------------------------------------------------------------------

interface StoredEntry {
	value: unknown;
	expiresAt: number | null; // null = no expiration
	timer: ReturnType<typeof setTimeout> | null;
}

interface LockEntry {
	acquiredAt: number;
	timer: ReturnType<typeof setTimeout> | null;
}

export class InMemoryStateProvider implements SharedStateProvider {
	private store = new Map<string, StoredEntry>();
	private locks = new Map<string, LockEntry>();
	private emitter = new EventEmitter();

	constructor() {
		// Allow many subscribers for high-traffic pub/sub channels
		this.emitter.setMaxListeners(200);
	}

	async get(key: string): Promise<unknown> {
		const entry = this.store.get(key);
		if (!entry) return undefined;

		// Lazily check expiration (belt-and-suspenders with setTimeout cleanup)
		if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
			this._evict(key);
			return undefined;
		}

		return entry.value;
	}

	async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
		// Clear any existing timer for this key
		const existing = this.store.get(key);
		if (existing?.timer) {
			clearTimeout(existing.timer);
		}

		let timer: ReturnType<typeof setTimeout> | null = null;
		let expiresAt: number | null = null;

		if (ttlMs !== undefined && ttlMs > 0) {
			expiresAt = Date.now() + ttlMs;
			timer = setTimeout(() => {
				this._evict(key);
			}, ttlMs);
			// Allow process to exit naturally even with pending timers
			if (timer.unref) timer.unref();
		}

		this.store.set(key, { value, expiresAt, timer });
	}

	async del(key: string): Promise<void> {
		this._evict(key);
	}

	async has(key: string): Promise<boolean> {
		const entry = this.store.get(key);
		if (!entry) return false;

		if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
			this._evict(key);
			return false;
		}

		return true;
	}

	async publish(channel: string, message: unknown): Promise<void> {
		// Emit synchronously — subscribers called in same tick
		this.emitter.emit(`ch:${channel}`, message);
	}

	subscribe(channel: string, handler: (message: unknown) => void): () => void {
		const eventName = `ch:${channel}`;
		this.emitter.on(eventName, handler);

		return () => {
			this.emitter.off(eventName, handler);
		};
	}

	unsubscribe(channel: string): void {
		this.emitter.removeAllListeners(`ch:${channel}`);
	}

	async acquireLock(key: string, ttlMs = 30_000): Promise<boolean> {
		const lockKey = `lock:${key}`;
		const existing = this.locks.get(lockKey);

		if (existing) {
			// Check if lock has expired (belt-and-suspenders)
			if (Date.now() - existing.acquiredAt >= ttlMs) {
				this._releaseLockInternal(lockKey);
			} else {
				return false; // Lock is held by someone else
			}
		}

		const timer = setTimeout(() => {
			this._releaseLockInternal(lockKey);
		}, ttlMs);
		if (timer.unref) timer.unref();

		this.locks.set(lockKey, {
			acquiredAt: Date.now(),
			timer,
		});

		return true;
	}

	async releaseLock(key: string): Promise<void> {
		const lockKey = `lock:${key}`;
		this._releaseLockInternal(lockKey);
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private _evict(key: string): void {
		const entry = this.store.get(key);
		if (entry?.timer) clearTimeout(entry.timer);
		this.store.delete(key);
	}

	private _releaseLockInternal(lockKey: string): void {
		const entry = this.locks.get(lockKey);
		if (entry?.timer) clearTimeout(entry.timer);
		this.locks.delete(lockKey);
	}

	/** Expose store size for testing/metrics. */
	get size(): number {
		return this.store.size;
	}

	/** Expose lock count for testing/metrics. */
	get lockCount(): number {
		return this.locks.size;
	}
}

// ---------------------------------------------------------------------------
// RedisStateProvider — Stub for future ioredis integration
// ---------------------------------------------------------------------------

export class RedisStateProvider implements SharedStateProvider {
	constructor() {
		console.warn(
			"[shared-state] RedisStateProvider is a stub. " +
				"Set OSCORPEX_STATE_PROVIDER=memory (default) or implement ioredis integration. " +
				"All calls will throw until a real implementation is provided.",
		);
	}

	async get(_key: string): Promise<unknown> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	async set(_key: string, _value: unknown, _ttlMs?: number): Promise<void> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	async del(_key: string): Promise<void> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	async has(_key: string): Promise<boolean> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	async publish(_channel: string, _message: unknown): Promise<void> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	subscribe(_channel: string, _handler: (message: unknown) => void): () => void {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	unsubscribe(_channel: string): void {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	async acquireLock(_key: string, _ttlMs?: number): Promise<boolean> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}

	async releaseLock(_key: string): Promise<void> {
		throw new Error("Redis not configured. Install ioredis and implement RedisStateProvider.");
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type StateProviderType = "memory" | "redis";

export function createStateProvider(type?: StateProviderType): SharedStateProvider {
	const resolvedType = type ?? (process.env.OSCORPEX_STATE_PROVIDER as StateProviderType | undefined) ?? "memory";

	if (resolvedType === "redis") {
		return new RedisStateProvider();
	}
	return new InMemoryStateProvider();
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const sharedState: SharedStateProvider = createStateProvider();
