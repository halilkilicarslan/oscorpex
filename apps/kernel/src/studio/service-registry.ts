// ---------------------------------------------------------------------------
// Oscorpex — Lightweight Service Registry
//
// Provides a typed Map-based registry for singletons.
// Existing direct imports continue to work — this is additive.
// Primary use case: test isolation via resetServices().
//
// Usage:
//   registerService("executionEngine", executionEngine);
//   const ee = getService<ExecutionEngine>("executionEngine");
//   resetServices(); // test cleanup
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";
const log = createLogger("service-registry");

const registry = new Map<string, unknown>();

/**
 * Register a service instance by key.
 * Overwrites any existing registration for the same key.
 */
export function registerService<T>(key: string, instance: T): void {
	registry.set(key, instance);
	log.info(`Service registered: ${key}`);
}

/**
 * Retrieve a service instance by key.
 * Throws if the service has not been registered.
 */
export function getService<T>(key: string): T {
	const instance = registry.get(key);
	if (instance === undefined) {
		throw new Error(`[service-registry] Service not registered: ${key}`);
	}
	return instance as T;
}

/**
 * Check if a service is registered.
 */
export function hasService(key: string): boolean {
	return registry.has(key);
}

/**
 * Reset all service registrations.
 * Intended for test isolation — clears the entire registry.
 */
export function resetServices(): void {
	registry.clear();
	log.info("All services reset");
}

/**
 * List all registered service keys.
 * Useful for debugging and introspection.
 */
export function listServices(): string[] {
	return Array.from(registry.keys());
}
