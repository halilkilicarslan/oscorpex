// @oscorpex/provider-sdk — Cost calculation and model pricing
// Extracted from kernel's ai-provider-factory.ts for provider-agnostic use.

export interface ModelPricing {
	input: number;
	output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
	// OpenAI
	"gpt-4o": { input: 2.5, output: 10.0 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
	"gpt-4-turbo": { input: 10.0, output: 30.0 },
	"gpt-4": { input: 30.0, output: 60.0 },
	"gpt-3.5-turbo": { input: 0.5, output: 1.5 },
	o1: { input: 15.0, output: 60.0 },
	"o1-mini": { input: 3.0, output: 12.0 },
	"o3-mini": { input: 1.1, output: 4.4 },
	// Anthropic
	"claude-opus-4-6": { input: 15.0, output: 75.0 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0 },
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
	"claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
	"claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
	// Google
	"gemini-1.5-pro": { input: 1.25, output: 5.0 },
	"gemini-1.5-flash": { input: 0.075, output: 0.3 },
	"gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

export function calculateCost(modelName: string, inputTokens: number, outputTokens: number): number {
	const pricing = MODEL_PRICING[modelName];
	if (!pricing) return 0;
	return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function defaultModelForType(type: string): string {
	switch (type) {
		case "openai":
			return "gpt-4o-mini";
		case "anthropic":
			return "claude-3-5-haiku-20241022";
		case "google":
			return "gemini-1.5-flash";
		case "ollama":
			return "llama3.2";
		case "cli":
			return "sonnet";
		default:
			return "gpt-4o-mini";
	}
}