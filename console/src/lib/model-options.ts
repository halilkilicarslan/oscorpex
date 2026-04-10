// ---------------------------------------------------------------------------
// Orenda — Shared model option lists
// ---------------------------------------------------------------------------

export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

export const MODEL_OPTIONS: Record<AIProviderType, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'o4-mini',
    'o3',
    'o3-mini',
  ],
  anthropic: [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-haiku-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  google: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  ollama: [
    'llama3',
    'llama3.1',
    'llama3.2',
    'mistral',
    'mixtral',
    'codellama',
    'deepseek-coder',
    'phi3',
    'qwen2.5-coder',
  ],
  custom: [],
};

// Get all available models grouped by active provider type.
// Falls back to all providers when no active providers are found.
export function getModelsFromProviders(
  providers: { type: AIProviderType; model: string; isActive: boolean }[],
): { label: string; models: string[] }[] {
  const activeProviders = providers.filter((p) => p.isActive);
  const typeMap = new Map<AIProviderType, Set<string>>();

  for (const p of activeProviders) {
    if (!typeMap.has(p.type)) {
      typeMap.set(p.type, new Set(MODEL_OPTIONS[p.type]));
    }
  }

  const groups: { label: string; models: string[] }[] = [];

  for (const [type, models] of typeMap) {
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    groups.push({ label, models: [...models] });
  }

  // If no active providers, expose all known models
  if (groups.length === 0) {
    for (const [type, models] of Object.entries(MODEL_OPTIONS) as [AIProviderType, string[]][]) {
      if (models.length > 0) {
        groups.push({
          label: type.charAt(0).toUpperCase() + type.slice(1),
          models,
        });
      }
    }
  }

  return groups;
}
