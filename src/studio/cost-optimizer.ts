// ---------------------------------------------------------------------------
// Oscorpex — Cost Optimization Engine (V6 M2 F8)
// Analyzes historical token_usage to recommend optimal model selections,
// balancing cost efficiency against quality (success rate).
// ---------------------------------------------------------------------------

import { getDefaultRoutingConfig } from "./model-router.js";
import { getProjectCostBreakdown, listTokenUsage } from "./db.js";
import type { TaskComplexity } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("cost-optimizer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelEfficiencyStats {
	model: string;
	provider: string;
	taskCount: number;
	totalCostUsd: number;
	avgCostPerTask: number;
	totalTokens: number;
	avgTokensPerTask: number;
	// Quality is derived from success rate recorded via recordOutcome()
	successRate: number;
	// Composite efficiency score: higher = better value
	efficiencyScore: number;
}

export interface CostRecommendation {
	recommendedModel: string;
	currentDefaultModel: string;
	complexity: TaskComplexity;
	taskType?: string;
	reasoning: string;
	estimatedCostUsd: number;
	confidenceLevel: "high" | "medium" | "low";
	potentialSavingsPct: number;
}

export interface CostInsights {
	projectId: string;
	totalCostUsd: number;
	taskCount: number;
	avgCostPerTask: number;
	mostExpensiveModel: string | null;
	mostEfficientModel: string | null;
	potentialSavingsUsd: number;
	potentialSavingsPct: number;
	recommendations: string[];
	modelStats: ModelEfficiencyStats[];
}

// Internal outcome record — stored in memory for learning within a session
interface OutcomeRecord {
	taskId: string;
	model: string;
	costUsd: number;
	// quality: 0.0–1.0 (e.g. 1.0 = passed review first time, 0.0 = failed)
	quality: number;
	recordedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Model cost tiers (USD per 1M tokens, blended input+output approximation)
// Used as fallback when historical data is absent.
const MODEL_COST_PER_MTK: Record<string, number> = {
	"claude-haiku-4-5-20251001": 0.8,
	"claude-sonnet-4-6": 3.0,
	"claude-opus-4-6": 15.0,
	"gpt-4o-mini": 0.6,
	"gpt-4o": 5.0,
	o3: 60.0,
	"cursor-small": 1.0,
	"cursor-large": 5.0,
};

// Minimum task sample size required before trusting historical data
const MIN_SAMPLE_SIZE = 3;

// Weight for quality vs cost in the efficiency score calculation
// efficiencyScore = quality * W_QUALITY + costScore * W_COST
const W_QUALITY = 0.6;
const W_COST = 0.4;

// ---------------------------------------------------------------------------
// CostOptimizer class
// ---------------------------------------------------------------------------

export class CostOptimizer {
	// In-memory outcome store — augments the DB data with quality signals
	private _outcomes: OutcomeRecord[] = [];

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Records a task outcome for in-session learning.
	 * quality: 0.0 (complete failure/rejection) to 1.0 (first-pass success).
	 */
	recordOutcome(taskId: string, model: string, costUsd: number, quality: number): void {
		const clamped = Math.max(0, Math.min(1, quality));
		this._outcomes.push({
			taskId,
			model,
			costUsd,
			quality: clamped,
			recordedAt: new Date().toISOString(),
		});
	}

	/**
	 * Returns the recommended model for the next task in this project,
	 * given task complexity and optional type hint.
	 *
	 * Decision logic:
	 *  1. Pull per-model efficiency stats from DB history + in-memory outcomes.
	 *  2. For each model in the tier's candidate set, compute an efficiency score.
	 *  3. Recommend the model with the highest efficiency score that covers
	 *     the required quality threshold for the complexity tier.
	 *  4. If sample size is too small, fall back to the default routing config.
	 */
	async getRecommendation(
		projectId: string,
		taskComplexity: TaskComplexity,
		taskType?: string,
	): Promise<CostRecommendation> {
		const defaultConfig = getDefaultRoutingConfig();
		const defaultModel = defaultConfig[taskComplexity] ?? defaultConfig["M"] ?? "claude-sonnet-4-6";

		// Fetch efficiency stats from DB
		const modelStats = await this.getModelEfficiency(projectId);

		// If we have no data at all, use defaults with low confidence
		if (modelStats.length === 0) {
			return this._buildFallbackRecommendation(defaultModel, taskComplexity, taskType);
		}

		// Determine the candidate models for this complexity tier
		const candidates = this._candidatesForComplexity(taskComplexity, modelStats);

		if (candidates.length === 0) {
			return this._buildFallbackRecommendation(defaultModel, taskComplexity, taskType);
		}

		// Pick the candidate with the best efficiency score meeting quality threshold
		const minQuality = this._minQualityForComplexity(taskComplexity);
		const qualified = candidates.filter(
			(s) => s.taskCount >= MIN_SAMPLE_SIZE && s.successRate >= minQuality,
		);

		const best = qualified.length > 0
			? qualified.reduce((a, b) => (a.efficiencyScore > b.efficiencyScore ? a : b))
			: candidates.reduce((a, b) => (a.efficiencyScore > b.efficiencyScore ? a : b));

		const confidence = best.taskCount >= MIN_SAMPLE_SIZE ? "high" : best.taskCount > 0 ? "medium" : "low";

		const defaultStats = modelStats.find((s) => s.model === defaultModel);
		const defaultAvgCost = defaultStats?.avgCostPerTask ?? this._estimatedCostPerTask(defaultModel);
		const bestAvgCost = best.avgCostPerTask > 0 ? best.avgCostPerTask : this._estimatedCostPerTask(best.model);

		const savingsPct =
			defaultAvgCost > 0 && best.model !== defaultModel
				? Math.max(0, ((defaultAvgCost - bestAvgCost) / defaultAvgCost) * 100)
				: 0;

		const reasoning = this._buildReasoning(best, defaultModel, taskComplexity, confidence, savingsPct);

		return {
			recommendedModel: best.model,
			currentDefaultModel: defaultModel,
			complexity: taskComplexity,
			taskType,
			reasoning,
			estimatedCostUsd: bestAvgCost,
			confidenceLevel: confidence,
			potentialSavingsPct: Math.round(savingsPct * 10) / 10,
		};
	}

	/**
	 * Returns cost optimization insights for the project:
	 * - Total cost breakdown
	 * - Model efficiency ranking
	 * - Potential savings if optimal models are used
	 * - Actionable recommendations
	 */
	async getCostInsights(projectId: string): Promise<CostInsights> {
		const [breakdown, usage] = await Promise.all([
			getProjectCostBreakdown(projectId),
			listTokenUsage(projectId),
		]);

		const modelStats = await this.getModelEfficiency(projectId);

		const totalCostUsd = usage.reduce((sum, u) => sum + u.costUsd, 0);
		const taskCount = usage.length;
		const avgCostPerTask = taskCount > 0 ? totalCostUsd / taskCount : 0;

		// Most expensive model by avg cost per task (min 1 task)
		const withCost = modelStats.filter((s) => s.taskCount > 0);
		const mostExpensiveModel =
			withCost.length > 0
				? withCost.reduce((a, b) => (a.avgCostPerTask > b.avgCostPerTask ? a : b)).model
				: null;

		// Most efficient model by efficiencyScore (min MIN_SAMPLE_SIZE tasks)
		const qualified = modelStats.filter((s) => s.taskCount >= MIN_SAMPLE_SIZE);
		const mostEfficientModel =
			qualified.length > 0
				? qualified.reduce((a, b) => (a.efficiencyScore > b.efficiencyScore ? a : b)).model
				: withCost.length > 0
					? withCost.reduce((a, b) => (a.efficiencyScore > b.efficiencyScore ? a : b)).model
					: null;

		// Potential savings: compare actual spend vs optimal model spend
		let potentialSavingsUsd = 0;
		if (mostEfficientModel && mostEfficientModel !== mostExpensiveModel) {
			const efficientStats = modelStats.find((s) => s.model === mostEfficientModel);
			const expensiveStats = modelStats.find((s) => s.model === mostExpensiveModel);
			if (efficientStats && expensiveStats && expensiveStats.taskCount > 0) {
				const diff = expensiveStats.avgCostPerTask - efficientStats.avgCostPerTask;
				potentialSavingsUsd = Math.max(0, diff * expensiveStats.taskCount);
			}
		}

		const potentialSavingsPct =
			totalCostUsd > 0 ? Math.min(100, (potentialSavingsUsd / totalCostUsd) * 100) : 0;

		const recommendations = this._generateRecommendations(modelStats, totalCostUsd, taskCount);

		return {
			projectId,
			totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
			taskCount,
			avgCostPerTask: Math.round(avgCostPerTask * 10000) / 10000,
			mostExpensiveModel,
			mostEfficientModel,
			potentialSavingsUsd: Math.round(potentialSavingsUsd * 10000) / 10000,
			potentialSavingsPct: Math.round(potentialSavingsPct * 10) / 10,
			recommendations,
			modelStats,
		};
	}

	/**
	 * Returns per-model efficiency metrics for the project.
	 * Merges DB token_usage data with in-memory outcome quality signals.
	 */
	async getModelEfficiency(projectId: string): Promise<ModelEfficiencyStats[]> {
		const breakdown = await getProjectCostBreakdown(projectId);
		const usage = await listTokenUsage(projectId);

		// Aggregate raw DB data per model
		const dbMap = new Map<string, {
			provider: string;
			taskCount: number;
			totalCostUsd: number;
			totalTokens: number;
		}>();

		for (const entry of breakdown) {
			const key = entry.model;
			const existing = dbMap.get(key);
			if (existing) {
				existing.taskCount += entry.taskCount;
				existing.totalCostUsd += entry.costUsd;
				existing.totalTokens += entry.totalTokens;
			} else {
				// Infer provider from usage records for this model
				const providerMatch = usage.find((u) => u.model === entry.model);
				dbMap.set(key, {
					provider: providerMatch?.provider ?? "anthropic",
					taskCount: entry.taskCount,
					totalCostUsd: entry.costUsd,
					totalTokens: entry.totalTokens,
				});
			}
		}

		// Merge in-memory outcome quality signals
		const qualityMap = new Map<string, { total: number; count: number }>();
		for (const o of this._outcomes) {
			const existing = qualityMap.get(o.model);
			if (existing) {
				existing.total += o.quality;
				existing.count++;
			} else {
				qualityMap.set(o.model, { total: o.quality, count: 1 });
			}
		}

		// Also seed qualityMap with usage-derived success rates:
		// We don't have per-task success in token_usage, so we default to 0.8
		// (a reasonable baseline representing typical first-pass rate).
		// In-memory outcomes override this for models with recorded outcomes.
		const DEFAULT_SUCCESS_RATE = 0.8;

		// Compute max avgCost across all models (for cost score normalization)
		const allAvgCosts = [...dbMap.values()].map((v) =>
			v.taskCount > 0 ? v.totalCostUsd / v.taskCount : 0,
		);
		const maxAvgCost = allAvgCosts.length > 0 ? Math.max(...allAvgCosts) : 1;

		const stats: ModelEfficiencyStats[] = [];

		for (const [model, data] of dbMap) {
			const avgCostPerTask = data.taskCount > 0 ? data.totalCostUsd / data.taskCount : 0;
			const avgTokensPerTask = data.taskCount > 0 ? Math.round(data.totalTokens / data.taskCount) : 0;

			const qualityData = qualityMap.get(model);
			const successRate = qualityData
				? qualityData.total / qualityData.count
				: DEFAULT_SUCCESS_RATE;

			// Cost score: 1.0 = cheapest, 0.0 = most expensive
			const costScore = maxAvgCost > 0 ? 1 - avgCostPerTask / maxAvgCost : 1;

			const efficiencyScore = Math.round((successRate * W_QUALITY + costScore * W_COST) * 100) / 100;

			stats.push({
				model,
				provider: data.provider,
				taskCount: data.taskCount,
				totalCostUsd: Math.round(data.totalCostUsd * 10000) / 10000,
				avgCostPerTask: Math.round(avgCostPerTask * 10000) / 10000,
				totalTokens: data.totalTokens,
				avgTokensPerTask,
				successRate: Math.round(successRate * 100) / 100,
				efficiencyScore,
			});
		}

		// Sort by efficiency score descending
		stats.sort((a, b) => b.efficiencyScore - a.efficiencyScore);
		return stats;
	}

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	private _estimatedCostPerTask(model: string): number {
		// Assume average of 2000 total tokens per task as rough baseline
		const costPerMtk = MODEL_COST_PER_MTK[model] ?? 3.0;
		return (costPerMtk / 1_000_000) * 2000;
	}

	private _minQualityForComplexity(complexity: TaskComplexity): number {
		// Higher complexity tasks require higher quality threshold
		const thresholds: Record<TaskComplexity, number> = { S: 0.6, M: 0.7, L: 0.75, XL: 0.8 };
		return thresholds[complexity] ?? 0.7;
	}

	/**
	 * Returns candidate models from stats that are appropriate for the given complexity tier.
	 * The model-router maps: S→Haiku, M/L→Sonnet, XL→Opus.
	 * For cost optimization we allow one tier down but not more (safety floor).
	 */
	private _candidatesForComplexity(
		complexity: TaskComplexity,
		stats: ModelEfficiencyStats[],
	): ModelEfficiencyStats[] {
		// Build an allowlist of model name substrings appropriate per tier
		const allowPatterns: Record<TaskComplexity, string[]> = {
			S: ["haiku", "gpt-4o-mini", "cursor-small"],
			M: ["haiku", "sonnet", "gpt-4o", "cursor-small", "cursor-large"],
			L: ["sonnet", "opus", "o3", "cursor-large", "gpt-4o"],
			XL: ["sonnet", "opus", "o3", "cursor-large"],
		};

		const patterns = allowPatterns[complexity] ?? allowPatterns["M"];
		return stats.filter((s) =>
			patterns.some((p) => s.model.toLowerCase().includes(p)),
		);
	}

	private _buildFallbackRecommendation(
		defaultModel: string,
		complexity: TaskComplexity,
		taskType?: string,
	): CostRecommendation {
		return {
			recommendedModel: defaultModel,
			currentDefaultModel: defaultModel,
			complexity,
			taskType,
			reasoning: "No historical usage data available. Using default model routing configuration.",
			estimatedCostUsd: this._estimatedCostPerTask(defaultModel),
			confidenceLevel: "low",
			potentialSavingsPct: 0,
		};
	}

	private _buildReasoning(
		best: ModelEfficiencyStats,
		defaultModel: string,
		complexity: TaskComplexity,
		confidence: "high" | "medium" | "low",
		savingsPct: number,
	): string {
		const parts: string[] = [];

		if (best.model === defaultModel) {
			parts.push(`Default model ${best.model} is already the most efficient choice based on historical data.`);
		} else {
			parts.push(
				`Recommending ${best.model} over default ${defaultModel} for ${complexity}-complexity tasks.`,
			);
		}

		if (best.taskCount > 0) {
			parts.push(
				`Based on ${best.taskCount} historical task(s): avg cost $${best.avgCostPerTask.toFixed(4)}/task, ` +
				`success rate ${Math.round(best.successRate * 100)}%, efficiency score ${best.efficiencyScore}.`,
			);
		}

		if (savingsPct > 0) {
			parts.push(`Potential cost savings: ${savingsPct.toFixed(1)}% vs current default.`);
		}

		parts.push(`Confidence: ${confidence}${best.taskCount < MIN_SAMPLE_SIZE ? ` (limited sample: ${best.taskCount} task(s))` : ""}.`);

		return parts.join(" ");
	}

	private _generateRecommendations(
		modelStats: ModelEfficiencyStats[],
		totalCostUsd: number,
		taskCount: number,
	): string[] {
		const recs: string[] = [];

		if (taskCount === 0) {
			recs.push("No task history yet. Cost optimization recommendations will appear after tasks complete.");
			return recs;
		}

		// Check for underperforming expensive models
		const sorted = [...modelStats].sort((a, b) => b.avgCostPerTask - a.avgCostPerTask);
		const mostExpensive = sorted[0];
		const cheapest = sorted[sorted.length - 1];

		if (mostExpensive && cheapest && mostExpensive.model !== cheapest.model) {
			const ratio = mostExpensive.avgCostPerTask / Math.max(cheapest.avgCostPerTask, 0.0001);
			if (ratio > 3) {
				recs.push(
					`${mostExpensive.model} costs ${ratio.toFixed(1)}x more per task than ${cheapest.model}. ` +
					`Consider routing simpler tasks to ${cheapest.model}.`,
				);
			}
		}

		// Check for models with low success rate
		const lowQuality = modelStats.filter(
			(s) => s.taskCount >= MIN_SAMPLE_SIZE && s.successRate < 0.6,
		);
		for (const s of lowQuality) {
			recs.push(
				`${s.model} has a low success rate (${Math.round(s.successRate * 100)}%). ` +
				`Consider upgrading to a higher-capability model for complex tasks.`,
			);
		}

		// High average cost alert
		const avgCostPerTask = taskCount > 0 ? totalCostUsd / taskCount : 0;
		if (avgCostPerTask > 0.5) {
			recs.push(
				`Average cost per task is $${avgCostPerTask.toFixed(4)}. ` +
				`Enable caching and prefer Haiku/Sonnet for S/M complexity tasks to reduce spend.`,
			);
		}

		// No recommendations needed
		if (recs.length === 0) {
			recs.push("Model selection looks optimal based on current usage patterns.");
		}

		return recs;
	}

	/** Expose outcomes list for testing purposes */
	get _outcomeCount(): number {
		return this._outcomes.length;
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const costOptimizer = new CostOptimizer();
