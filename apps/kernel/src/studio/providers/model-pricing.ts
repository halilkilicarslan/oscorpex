// ---------------------------------------------------------------------------
// Oscorpex — Model Pricing Table (USD per 1M tokens)
// Source: Official API pricing pages (May 2025)
// ---------------------------------------------------------------------------

export interface ModelPricing {
	inputPer1M: number;
	outputPer1M: number;
	cacheWritePer1M: number;
	cacheReadPer1M: number;
}

// ---------------------------------------------------------------------------
// Anthropic Claude
// ---------------------------------------------------------------------------
const CLAUDE_OPUS: ModelPricing = {
	inputPer1M: 15.0,
	outputPer1M: 75.0,
	cacheWritePer1M: 18.75, // 1.25x input
	cacheReadPer1M: 1.50, // 0.1x input
};

const CLAUDE_SONNET: ModelPricing = {
	inputPer1M: 3.0,
	outputPer1M: 15.0,
	cacheWritePer1M: 3.75, // 1.25x input
	cacheReadPer1M: 0.30, // 0.1x input
};

const CLAUDE_HAIKU: ModelPricing = {
	inputPer1M: 0.80,
	outputPer1M: 4.0,
	cacheWritePer1M: 1.0, // 1.25x input
	cacheReadPer1M: 0.08, // 0.1x input
};

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
const GPT_4O: ModelPricing = {
	inputPer1M: 2.5,
	outputPer1M: 10.0,
	cacheWritePer1M: 2.5, // same as input (automatic caching)
	cacheReadPer1M: 1.25, // 0.5x input
};

const GPT_4O_MINI: ModelPricing = {
	inputPer1M: 0.15,
	outputPer1M: 0.60,
	cacheWritePer1M: 0.15,
	cacheReadPer1M: 0.075, // 0.5x input
};

const GPT_4_TURBO: ModelPricing = {
	inputPer1M: 10.0,
	outputPer1M: 30.0,
	cacheWritePer1M: 10.0,
	cacheReadPer1M: 5.0,
};

const O3: ModelPricing = {
	inputPer1M: 10.0,
	outputPer1M: 40.0,
	cacheWritePer1M: 10.0,
	cacheReadPer1M: 2.50,
};

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------
const GEMINI_15_PRO: ModelPricing = {
	inputPer1M: 1.25,
	outputPer1M: 5.0,
	cacheWritePer1M: 1.25,
	cacheReadPer1M: 0.3125, // 0.25x input
};

const GEMINI_FLASH: ModelPricing = {
	inputPer1M: 0.075,
	outputPer1M: 0.30,
	cacheWritePer1M: 0.075,
	cacheReadPer1M: 0.01875, // 0.25x input
};

// ---------------------------------------------------------------------------
// Resolver — matches model name string to pricing
// ---------------------------------------------------------------------------

export function getModelPricing(modelName: string): ModelPricing {
	const m = modelName.toLowerCase();

	// Anthropic
	if (m.includes("opus")) return CLAUDE_OPUS;
	if (m.includes("sonnet")) return CLAUDE_SONNET;
	if (m.includes("haiku")) return CLAUDE_HAIKU;

	// OpenAI
	if (m.includes("gpt-4o-mini")) return GPT_4O_MINI;
	if (m.includes("gpt-4o")) return GPT_4O;
	if (m.includes("gpt-4-turbo") || m.includes("gpt-4-1106") || m.includes("gpt-4-0125")) return GPT_4_TURBO;
	if (m === "o3" || m.includes("o3-")) return O3;

	// Gemini
	if (m.includes("gemini-1.5-pro") || m.includes("gemini-2.0-pro")) return GEMINI_15_PRO;
	if (m.includes("gemini")) return GEMINI_FLASH;

	// Default: Sonnet
	return CLAUDE_SONNET;
}

// ---------------------------------------------------------------------------
// Cost calculator — per token_usage record
// ---------------------------------------------------------------------------

export interface TokenUsageRecord {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	costUsd: number; // actual billed cost from provider
}

export interface CostBreakdown {
	actualCostUsd: number;
	hypotheticalCostUsd: number; // what it would cost without caching
	cacheSavingsUsd: number; // hypothetical - actual
	cacheWriteOverheadUsd: number; // extra cost of cache writes vs regular input
}

/**
 * Calculate accurate cost breakdown for a single token usage record.
 *
 * hypothetical = all tokens at regular input/output price (no caching)
 * actual = provider's billed amount (already includes cache pricing)
 * savings = hypothetical - actual
 */
export function calculateCostBreakdown(record: TokenUsageRecord): CostBreakdown {
	const pricing = getModelPricing(record.model);
	const per = 1_000_000;

	// What it would cost without caching — all input-side tokens at full input price
	const hypotheticalInput =
		(record.inputTokens + record.cacheReadTokens + record.cacheCreationTokens) * (pricing.inputPer1M / per);
	const hypotheticalOutput = record.outputTokens * (pricing.outputPer1M / per);
	const hypotheticalCostUsd = hypotheticalInput + hypotheticalOutput;

	// Cache write overhead: cache writes cost more than regular input
	const cacheWriteOverheadUsd =
		record.cacheCreationTokens * ((pricing.cacheWritePer1M - pricing.inputPer1M) / per);

	// Actual cost from provider (or estimate if provider didn't report)
	let actualCostUsd = record.costUsd;
	if (actualCostUsd <= 0) {
		// Provider didn't report cost — estimate from pricing table
		actualCostUsd =
			record.inputTokens * (pricing.inputPer1M / per) +
			record.outputTokens * (pricing.outputPer1M / per) +
			record.cacheCreationTokens * (pricing.cacheWritePer1M / per) +
			record.cacheReadTokens * (pricing.cacheReadPer1M / per);
	}

	const cacheSavingsUsd = Math.max(0, hypotheticalCostUsd - actualCostUsd);

	return { actualCostUsd, hypotheticalCostUsd, cacheSavingsUsd, cacheWriteOverheadUsd };
}

/**
 * Aggregate cost breakdowns for multiple records.
 */
export function aggregateCostBreakdowns(records: TokenUsageRecord[]): CostBreakdown {
	let actualCostUsd = 0;
	let hypotheticalCostUsd = 0;
	let cacheSavingsUsd = 0;
	let cacheWriteOverheadUsd = 0;

	for (const r of records) {
		const b = calculateCostBreakdown(r);
		actualCostUsd += b.actualCostUsd;
		hypotheticalCostUsd += b.hypotheticalCostUsd;
		cacheSavingsUsd += b.cacheSavingsUsd;
		cacheWriteOverheadUsd += b.cacheWriteOverheadUsd;
	}

	return { actualCostUsd, hypotheticalCostUsd, cacheSavingsUsd, cacheWriteOverheadUsd };
}
