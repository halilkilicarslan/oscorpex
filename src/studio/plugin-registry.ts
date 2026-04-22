// ---------------------------------------------------------------------------
// Oscorpex — Plugin Registry (M5 Plugin SDK v2)
// Manifest-driven, timeout-protected, DB-persisted plugin platform.
// ---------------------------------------------------------------------------

import { registerPlugin as dbRegisterPlugin, updatePlugin as dbUpdatePlugin, insertPluginExecution } from "./db.js";
import type { StudioEvent } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("plugin-registry");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PluginManifest {
	name: string;
	version: string;
	description?: string;
	author?: string;
	/** List of event types this plugin subscribes to. Empty array = catch-all (all events). */
	hooks: string[];
	permissions: string[];
	/** Handler timeout in milliseconds. Default: 5000. */
	timeout?: number;
	config?: Record<string, { type: string; default?: unknown; description: string }>;
}

export interface PluginContext {
	projectId: string;
	event: StudioEvent;
	config: Record<string, unknown>;
	logger: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
	};
}

export type PluginHandler = (ctx: PluginContext) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Legacy types — kept for backward compatibility with old plugin-registry tests
// ---------------------------------------------------------------------------

export interface PluginHooks {
	onTaskComplete?: (data: { projectId: string; taskId: string; agentId: string }) => Promise<void>;
	onPipelineComplete?: (data: { projectId: string; status: string }) => Promise<void>;
	onWorkItemCreated?: (data: { projectId: string; itemId: string; type: string }) => Promise<void>;
	onPhaseComplete?: (data: { projectId: string; phaseId: string }) => Promise<void>;
}

export interface Plugin {
	name: string;
	version: string;
	hooks: PluginHooks;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface LoadedPlugin {
	manifest: PluginManifest;
	handler: PluginHandler;
	enabled: boolean;
}

// ---------------------------------------------------------------------------
// PluginRegistry — manifest-driven, DB-backed
// ---------------------------------------------------------------------------

class PluginRegistry {
	private plugins = new Map<string, LoadedPlugin>();

	/** In-memory registration (built-in plugins, no DB persistence). */
	register(manifest: PluginManifest, handler: PluginHandler): void {
		this.plugins.set(manifest.name, { manifest, handler, enabled: true });
	}

	unregister(name: string): void {
		this.plugins.delete(name);
	}

	/** DB-backed registration — persists manifest to registered_plugins table. */
	async registerPersistent(manifest: PluginManifest, handler: PluginHandler): Promise<void> {
		await dbRegisterPlugin({
			name: manifest.name,
			version: manifest.version,
			description: manifest.description ?? "",
			author: manifest.author ?? "",
			hooks: manifest.hooks,
			permissions: manifest.permissions,
			config: manifest.config
				? Object.fromEntries(Object.entries(manifest.config).map(([k, v]) => [k, v.default ?? null]))
				: {},
			manifest: manifest as unknown as Record<string, unknown>,
		});
		this.plugins.set(manifest.name, { manifest, handler, enabled: true });
	}

	async enable(name: string): Promise<void> {
		const plugin = this.plugins.get(name);
		if (plugin) plugin.enabled = true;
		await dbUpdatePlugin(name, { enabled: true });
	}

	async disable(name: string): Promise<void> {
		const plugin = this.plugins.get(name);
		if (plugin) plugin.enabled = false;
		await dbUpdatePlugin(name, { enabled: false });
	}

	/**
	 * Notify all loaded plugins for a given StudioEvent.
	 * Each plugin's manifest.hooks list is used to filter events:
	 *   - empty hooks array → receive ALL events (catch-all)
	 *   - non-empty hooks array → receive only listed event types
	 * Errors and timeouts are caught per-plugin; one failure does NOT stop others.
	 */
	async notifyPlugins(event: StudioEvent): Promise<void> {
		for (const [name, plugin] of this.plugins) {
			if (!plugin.enabled) continue;

			// Hook filter
			if (plugin.manifest.hooks.length > 0 && !plugin.manifest.hooks.includes(event.type)) {
				continue;
			}

			const startTime = Date.now();
			const ctx: PluginContext = {
				projectId: event.projectId,
				event,
				config: {},
				logger: {
					info: (msg) => console.log(`[plugin:${name}] ${msg}`),
					warn: (msg) => console.warn(`[plugin:${name}] ${msg}`),
					error: (msg) => console.error(`[plugin:${name}] ${msg}`),
				},
			};

			try {
				const timeout = plugin.manifest.timeout ?? 5000;
				await Promise.race([
					Promise.resolve(plugin.handler(ctx)),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error(`Plugin "${name}" timed out after ${timeout}ms`)), timeout),
					),
				]);
				const durationMs = Date.now() - startTime;
				insertPluginExecution({
					pluginName: name,
					hook: event.type,
					projectId: event.projectId,
					durationMs,
					success: true,
					error: null,
				}).catch((err) => console.warn("[plugin-registry] Non-blocking operation failed:", err?.message ?? err));
			} catch (err) {
				const durationMs = Date.now() - startTime;
				const errorMsg = err instanceof Error ? err.message : String(err);
				console.error(`[plugin-registry] Plugin "${name}" failed on ${event.type}:`, errorMsg);
				insertPluginExecution({
					pluginName: name,
					hook: event.type,
					projectId: event.projectId,
					durationMs,
					success: false,
					error: errorMsg,
				}).catch((err) => console.warn("[plugin-registry] Non-blocking operation failed:", err?.message ?? err));
			}
		}
	}

	getPlugin(name: string): LoadedPlugin | undefined {
		return this.plugins.get(name);
	}

	listLoaded(): { name: string; hooks: string[]; enabled: boolean }[] {
		return Array.from(this.plugins.entries()).map(([name, p]) => ({
			name,
			hooks: p.manifest.hooks,
			enabled: p.enabled,
		}));
	}
}

export const pluginRegistry = new PluginRegistry();

// ---------------------------------------------------------------------------
// Legacy API — backward compatibility with v3.9 tests and callers
// ---------------------------------------------------------------------------

/** Legacy registry: simple map of Plugin objects (for old tests). */
const legacyRegistry = new Map<string, Plugin>();

export function registerPlugin(plugin: Plugin): void {
	if (legacyRegistry.has(plugin.name)) {
		console.warn(`[plugin-registry] Plugin "${plugin.name}" is already registered. Overwriting.`);
	}
	legacyRegistry.set(plugin.name, plugin);
}

export function unregisterPlugin(name: string): void {
	legacyRegistry.delete(name);
}

export function getPlugins(): Plugin[] {
	return Array.from(legacyRegistry.values());
}

/**
 * Legacy notifyPlugins — fires hook-based handlers (old API).
 * Used by routes/index.ts bridge and old tests.
 */
export async function notifyPlugins(hook: keyof PluginHooks, data: unknown): Promise<void> {
	const plugins = getPlugins();
	await Promise.all(
		plugins.map(async (plugin) => {
			const handler = plugin.hooks[hook];
			if (typeof handler !== "function") return;
			try {
				await (handler as (d: unknown) => Promise<void>)(data);
			} catch (err) {
				console.error(`[plugin-registry] Plugin "${plugin.name}" threw on hook "${hook}":`, err);
			}
		}),
	);
}
