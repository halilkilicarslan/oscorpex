// ---------------------------------------------------------------------------
// Oscorpex — Provider Runtime Cache Layer (TASK 4)
// Caches adapter.isAvailable() and adapter.capabilities() with TTL + invalidation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
	supportedModels: string[];
	supportsToolRestriction: boolean;
	supportsStreaming: boolean;
	supportsResume: boolean;
	supportsCancel: boolean;
	supportsStructuredOutput: boolean;
	supportsSandboxHinting: boolean;
}

export interface AvailabilityEntry {
	providerId: string;
	available: boolean;
	checkedAt: number;
	expiresAt: number;
	source: "health_check" | "execution_failure" | "cooldown_recheck" | "manual";
}

export interface CapabilityEntry {
	providerId: string;
	capabilities: ProviderCapabilities;
	computedAt: number;
	expiresAt: number;
}

export interface RuntimeCacheStats {
	availabilityHits: number;
	availabilityMisses: number;
	capabilityHits: number;
	capabilityMisses: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

import { getHealthCacheConfig } from "./performance-config.js";

const cacheCfg = getHealthCacheConfig();
const DEFAULT_AVAILABILITY_TTL_MS = cacheCfg.availabilityTtlMs;
const DEFAULT_UNAVAILABLE_TTL_MS = Math.max(5_000, Math.round(cacheCfg.availabilityTtlMs / 3));
const DEFAULT_CAPABILITY_TTL_MS = cacheCfg.capabilityTtlMs;

// ---------------------------------------------------------------------------
// ProviderRuntimeCache
// ---------------------------------------------------------------------------

class ProviderRuntimeCache {
	private availability = new Map<string, AvailabilityEntry>();
	private capability = new Map<string, CapabilityEntry>();
	private stats: RuntimeCacheStats = {
		availabilityHits: 0,
		availabilityMisses: 0,
		capabilityHits: 0,
		capabilityMisses: 0,
	};

	// --- Availability ---

	getAvailability(providerId: string): AvailabilityEntry | undefined {
		const entry = this.availability.get(providerId);
		if (!entry) {
			this.stats.availabilityMisses++;
			return undefined;
		}
		if (Date.now() > entry.expiresAt) {
			this.availability.delete(providerId);
			this.stats.availabilityMisses++;
			return undefined;
		}
		this.stats.availabilityHits++;
		return entry;
	}

	async resolveAvailability(
		providerId: string,
		checkFn: () => Promise<boolean>,
		source: AvailabilityEntry["source"] = "health_check",
	): Promise<boolean> {
		const cached = this.getAvailability(providerId);
		if (cached) return cached.available;

		const available = await checkFn();
		const now = Date.now();
		const ttl = available ? DEFAULT_AVAILABILITY_TTL_MS : DEFAULT_UNAVAILABLE_TTL_MS;
		this.setAvailability({
			providerId,
			available,
			checkedAt: now,
			expiresAt: now + ttl,
			source,
		});
		return available;
	}

	setAvailability(entry: AvailabilityEntry): void {
		this.availability.set(entry.providerId, entry);
	}

	invalidateAvailability(providerId: string, _reason?: string): void {
		this.availability.delete(providerId);
	}

	// --- Capability ---

	getCapability(providerId: string): CapabilityEntry | undefined {
		const entry = this.capability.get(providerId);
		if (!entry) {
			this.stats.capabilityMisses++;
			return undefined;
		}
		if (Date.now() > entry.expiresAt) {
			this.capability.delete(providerId);
			this.stats.capabilityMisses++;
			return undefined;
		}
		this.stats.capabilityHits++;
		return entry;
	}

	async resolveCapability(
		providerId: string,
		fetchFn: () => Promise<ProviderCapabilities>,
	): Promise<ProviderCapabilities> {
		const cached = this.getCapability(providerId);
		if (cached) return cached.capabilities;

		const capabilities = await fetchFn();
		const now = Date.now();
		this.setCapability({
			providerId,
			capabilities,
			computedAt: now,
			expiresAt: now + DEFAULT_CAPABILITY_TTL_MS,
		});
		return capabilities;
	}

	setCapability(entry: CapabilityEntry): void {
		this.capability.set(entry.providerId, entry);
	}

	invalidateCapability(providerId: string): void {
		this.capability.delete(providerId);
	}

	// --- Stats ---

	getStats(): RuntimeCacheStats {
		return { ...this.stats };
	}

	clear(): void {
		this.availability.clear();
		this.capability.clear();
		this.stats = {
			availabilityHits: 0,
			availabilityMisses: 0,
			capabilityHits: 0,
			capabilityMisses: 0,
		};
	}

	/** Purge expired entries from both caches — call periodically to prevent unbounded growth */
	purgeExpired(): number {
		const now = Date.now();
		let purged = 0;
		for (const [id, entry] of this.availability) {
			if (now > entry.expiresAt) {
				this.availability.delete(id);
				purged++;
			}
		}
		for (const [id, entry] of this.capability) {
			if (now > entry.expiresAt) {
				this.capability.delete(id);
				purged++;
			}
		}
		return purged;
	}
}

export const providerRuntimeCache = new ProviderRuntimeCache();
