// ---------------------------------------------------------------------------
// Oscorpex — Plugin Registry (v3.9)
// In-memory registry for lifecycle hook plugins. No DB persistence.
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

const registry = new Map<string, Plugin>();

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

export function registerPlugin(plugin: Plugin): void {
	if (registry.has(plugin.name)) {
		console.warn(`[plugin-registry] Plugin "${plugin.name}" is already registered. Overwriting.`);
	}
	registry.set(plugin.name, plugin);
}

export function unregisterPlugin(name: string): void {
	registry.delete(name);
}

export function getPlugins(): Plugin[] {
	return Array.from(registry.values());
}

/**
 * Notify all registered plugins for the given hook.
 * Errors from individual plugins are caught and logged — one failing plugin
 * will NOT prevent others from being called.
 */
export async function notifyPlugins(hook: keyof PluginHooks, data: any): Promise<void> {
	const plugins = getPlugins();
	await Promise.all(
		plugins.map(async (plugin) => {
			const handler = plugin.hooks[hook];
			if (typeof handler !== "function") return;
			try {
				await handler(data);
			} catch (err) {
				console.error(`[plugin-registry] Plugin "${plugin.name}" threw on hook "${hook}":`, err);
			}
		}),
	);
}
