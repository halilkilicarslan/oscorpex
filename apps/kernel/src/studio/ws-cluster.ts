// ---------------------------------------------------------------------------
// Oscorpex — WsCluster: WebSocket cluster coordination via SharedState
// Enables multi-instance coordination without Redis dependency (uses in-memory
// by default; swaps to Redis when OSCORPEX_STATE_PROVIDER=redis).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "./logger.js";
import { type SharedStateProvider, sharedState } from "./shared-state.js";
const log = createLogger("ws-cluster");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstanceInfo {
	instanceId: string;
	startedAt: string; // ISO timestamp
	lastHeartbeat: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const STALE_THRESHOLD_MS = 90_000; // 90 seconds — instance is considered dead
const INSTANCE_KEY_PREFIX = "cluster:instance:";
const INSTANCE_LIST_KEY = "cluster:instances";

// ---------------------------------------------------------------------------
// WsCluster
// ---------------------------------------------------------------------------

export class WsCluster {
	private provider: SharedStateProvider;
	private instanceId: string;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private registered = false;

	constructor(provider: SharedStateProvider, instanceId?: string) {
		this.provider = provider;
		this.instanceId = instanceId ?? randomUUID();
	}

	// ---------------------------------------------------------------------------
	// Instance lifecycle
	// ---------------------------------------------------------------------------

	/**
	 * Register this server instance in the shared state.
	 * Starts the heartbeat interval.
	 */
	async registerInstance(instanceId?: string): Promise<void> {
		if (instanceId) this.instanceId = instanceId;

		const info: InstanceInfo = {
			instanceId: this.instanceId,
			startedAt: new Date().toISOString(),
			lastHeartbeat: new Date().toISOString(),
		};

		// Store instance record with 2× stale threshold TTL
		await this.provider.set(`${INSTANCE_KEY_PREFIX}${this.instanceId}`, info, STALE_THRESHOLD_MS * 2);

		// Add to active instance list
		const existing = (await this.provider.get(INSTANCE_LIST_KEY)) as string[] | undefined;
		const list = Array.isArray(existing) ? existing : [];
		if (!list.includes(this.instanceId)) {
			list.push(this.instanceId);
		}
		await this.provider.set(INSTANCE_LIST_KEY, list);

		this.registered = true;

		// Start heartbeat
		this._startHeartbeat();
	}

	/**
	 * Deregister this instance from shared state and stop heartbeat.
	 */
	async deregisterInstance(instanceId?: string): Promise<void> {
		const id = instanceId ?? this.instanceId;

		this._stopHeartbeat();

		await this.provider.del(`${INSTANCE_KEY_PREFIX}${id}`);

		// Remove from instance list
		const existing = (await this.provider.get(INSTANCE_LIST_KEY)) as string[] | undefined;
		if (Array.isArray(existing)) {
			const updated = existing.filter((i) => i !== id);
			await this.provider.set(INSTANCE_LIST_KEY, updated);
		}

		this.registered = false;
	}

	/**
	 * Update this instance's heartbeat timestamp.
	 */
	async heartbeat(): Promise<void> {
		const existing = (await this.provider.get(`${INSTANCE_KEY_PREFIX}${this.instanceId}`)) as InstanceInfo | undefined;

		const info: InstanceInfo = {
			instanceId: this.instanceId,
			startedAt: existing?.startedAt ?? new Date().toISOString(),
			lastHeartbeat: new Date().toISOString(),
		};

		await this.provider.set(`${INSTANCE_KEY_PREFIX}${this.instanceId}`, info, STALE_THRESHOLD_MS * 2);
	}

	/**
	 * Return list of active (non-stale) instances.
	 * Stale instances (no heartbeat within STALE_THRESHOLD_MS) are pruned.
	 */
	async getActiveInstances(): Promise<InstanceInfo[]> {
		const list = (await this.provider.get(INSTANCE_LIST_KEY)) as string[] | undefined;
		if (!Array.isArray(list) || list.length === 0) return [];

		const now = Date.now();
		const active: InstanceInfo[] = [];
		const stale: string[] = [];

		await Promise.all(
			list.map(async (id) => {
				const info = (await this.provider.get(`${INSTANCE_KEY_PREFIX}${id}`)) as InstanceInfo | undefined;

				if (!info) {
					stale.push(id);
					return;
				}

				const lastHb = new Date(info.lastHeartbeat).getTime();
				if (now - lastHb > STALE_THRESHOLD_MS) {
					stale.push(id);
				} else {
					active.push(info);
				}
			}),
		);

		// Prune stale instances
		if (stale.length > 0) {
			const updated = list.filter((id) => !stale.includes(id));
			await this.provider.set(INSTANCE_LIST_KEY, updated);
			await Promise.all(stale.map((id) => this.provider.del(`${INSTANCE_KEY_PREFIX}${id}`)));
		}

		return active;
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	private _startHeartbeat(): void {
		if (this.heartbeatTimer) return; // Already running

		this.heartbeatTimer = setInterval(async () => {
			try {
				await this.heartbeat();
			} catch (err) {
				log.warn("[ws-cluster] Heartbeat failed: " + (err instanceof Error ? err.message : String(err)));
			}
		}, HEARTBEAT_INTERVAL_MS);

		if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
	}

	private _stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	// ---------------------------------------------------------------------------
	// Accessors
	// ---------------------------------------------------------------------------

	get currentInstanceId(): string {
		return this.instanceId;
	}

	get isRegistered(): boolean {
		return this.registered;
	}

	get staleThresholdMs(): number {
		return STALE_THRESHOLD_MS;
	}

	get heartbeatIntervalMs(): number {
		return HEARTBEAT_INTERVAL_MS;
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const wsCluster = new WsCluster(sharedState);
