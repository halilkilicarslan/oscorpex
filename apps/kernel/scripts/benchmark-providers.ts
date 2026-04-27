#!/usr/bin/env node
// @oscorpex/kernel — Provider Benchmark Harness (EPIC 7)
// Usage: node scripts/benchmark-providers.js [--provider <id>] [--count <n>] [--prompts <file>]

import { ProviderRegistry } from "../dist/studio/kernel/provider-registry.js";
import { createProviderAdapter } from "../dist/studio/kernel/provider-registry.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_PROMPTS = [
	{ name: "small", prompt: "Write a one-line hello world in Python." },
	{ name: "medium", prompt: "Implement a function that validates an email address using regex, including unit tests." },
	{ name: "large", prompt: "Design and implement a minimal JWT authentication middleware for an Express.js API. Include token generation, verification, refresh logic, and error handling. Write comprehensive tests." },
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
	const args = process.argv.slice(2);
	const result = { provider: undefined as string | undefined, count: 3, prompts: undefined as string | undefined };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--provider" && args[i + 1]) result.provider = args[i + 1];
		if (args[i] === "--count" && args[i + 1]) result.count = parseInt(args[i + 1], 10);
		if (args[i] === "--prompts" && args[i + 1]) result.prompts = args[i + 1];
	}
	return result;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
	provider: string;
	model: string;
	promptName: string;
	repeat: number;
	success: boolean;
	latencyMs: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	error?: string;
}

async function runBenchmark(
	providerId: string,
	prompt: { name: string; prompt: string },
	repeat: number,
): Promise<BenchmarkResult[]> {
	const registry = new ProviderRegistry();
	registry.registerDefaultProviders();

	const adapter = registry.get(providerId);
	if (!adapter) {
		throw new Error(`Provider "${providerId}" not found`);
	}

	const results: BenchmarkResult[] = [];
	for (let i = 0; i < repeat; i++) {
		const start = Date.now();
		try {
			const result = await registry.execute(providerId, {
				runId: `bench-${providerId}-${prompt.name}-${i}`,
				taskId: `bench-${i}`,
				provider: providerId,
				repoPath: "/tmp/bench",
				prompt: prompt.prompt,
				systemPrompt: "You are a helpful coding assistant.",
				timeoutMs: 300_000,
			});
			results.push({
				provider: providerId,
				model: result.model ?? "unknown",
				promptName: prompt.name,
				repeat: i + 1,
				success: true,
				latencyMs: Date.now() - start,
				inputTokens: result.usage?.inputTokens ?? 0,
				outputTokens: result.usage?.outputTokens ?? 0,
				costUsd: result.usage?.billedCostUsd ?? 0,
			});
		} catch (err) {
			results.push({
				provider: providerId,
				model: "unknown",
				promptName: prompt.name,
				repeat: i + 1,
				success: false,
				latencyMs: Date.now() - start,
				inputTokens: 0,
				outputTokens: 0,
				costUsd: 0,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// Report generator
// ---------------------------------------------------------------------------

function generateReport(results: BenchmarkResult[]): string {
	const byProvider = new Map<string, BenchmarkResult[]>();
	for (const r of results) {
		const list = byProvider.get(r.provider) ?? [];
		list.push(r);
		byProvider.set(r.provider, list);
	}

	let md = "# Provider Benchmark Report\n\n";
	md += `**Date**: ${new Date().toISOString()}\n\n`;

	for (const [provider, prs] of byProvider) {
		md += `## ${provider}\n\n`;
		const successes = prs.filter((r) => r.success);
		const failures = prs.filter((r) => !r.success);
		const avgLatency = successes.length > 0
			? Math.round(successes.reduce((s, r) => s + r.latencyMs, 0) / successes.length)
			: 0;
		const avgCost = successes.length > 0
			? successes.reduce((s, r) => s + r.costUsd, 0) / successes.length
			: 0;

		md += `| Metric | Value |\n`;
		md += `|--------|-------|\n`;
		md += `| Total runs | ${prs.length} |\n`;
		md += `| Success | ${successes.length} |\n`;
		md += `| Failure | ${failures.length} |\n`;
		md += `| Avg latency | ${avgLatency}ms |\n`;
		md += `| Avg cost | $${avgCost.toFixed(6)} |\n`;
		md += `| Failure rate | ${((failures.length / prs.length) * 100).toFixed(1)}% |\n\n`;

		if (failures.length > 0) {
			md += "### Failures\n\n";
			for (const f of failures) {
				md += `- ${f.promptName} (#${f.repeat}): ${f.error}\n`;
			}
			md += "\n";
		}
	}

	return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const args = parseArgs();
	const prompts = args.prompts
		? JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(args.prompts!, "utf-8")))
		: DEFAULT_PROMPTS;

	const registry = new ProviderRegistry();
	registry.registerDefaultProviders();
	const providers = args.provider
		? [args.provider]
		: registry.list().map((p) => p.id);

	console.log(`Benchmarking ${providers.length} provider(s) with ${prompts.length} prompt(s), ${args.count} repeat(s) each...\n`);

	const allResults: BenchmarkResult[] = [];
	for (const providerId of providers) {
		for (const prompt of prompts) {
			process.stdout.write(`${providerId} / ${prompt.name} ... `);
			try {
				const results = await runBenchmark(providerId, prompt, args.count);
				allResults.push(...results);
				const successCount = results.filter((r) => r.success).length;
				console.log(`${successCount}/${args.count} OK`);
			} catch (err) {
				console.log(`SKIP (${err instanceof Error ? err.message : String(err)})`);
			}
		}
	}

	const report = generateReport(allResults);
	const outFile = `benchmark-report-${Date.now()}.md`;
	await import("node:fs").then((fs) => fs.writeFileSync(outFile, report));
	console.log(`\nReport written to ${outFile}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
