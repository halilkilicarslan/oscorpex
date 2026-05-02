// ---------------------------------------------------------------------------
// Oscorpex — AI Provider Types
// ---------------------------------------------------------------------------

export type AIProviderType = "openai" | "anthropic" | "google" | "ollama" | "custom" | "cli";

/** CLI subtype for type="cli" providers. Each CLI uses its own auth (no api key). */
export type ProviderCliTool = "claude" | "codex" | "gemini" | "cursor";
/** @deprecated Use ProviderCliTool instead. */
export type CliTool = ProviderCliTool;

export interface AIProvider {
	id: string;
	name: string;
	type: AIProviderType;
	apiKey: string;
	baseUrl: string;
	model: string;
	isDefault: boolean;
	isActive: boolean;
	/** Fallback zincirindeki sıra. 0 = primary (default), küçük değer = daha önce denenir. */
	fallbackOrder: number;
	/** Only for type="cli": which CLI to spawn (claude/codex/gemini). */
	cliTool?: ProviderCliTool;
	createdAt: string;
	updatedAt: string;
}
