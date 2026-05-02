// ---------------------------------------------------------------------------
// Tests — Benchmark Report Generator (EPIC 7)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

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
		const avgLatency =
			successes.length > 0 ? Math.round(successes.reduce((s, r) => s + r.latencyMs, 0) / successes.length) : 0;
		const avgCost = successes.length > 0 ? successes.reduce((s, r) => s + r.costUsd, 0) / successes.length : 0;

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

describe("generateReport", () => {
	it("generates markdown with provider sections", () => {
		const results: BenchmarkResult[] = [
			{
				provider: "claude-code",
				model: "sonnet",
				promptName: "small",
				repeat: 1,
				success: true,
				latencyMs: 1200,
				inputTokens: 10,
				outputTokens: 5,
				costUsd: 0.0001,
			},
			{
				provider: "claude-code",
				model: "sonnet",
				promptName: "small",
				repeat: 2,
				success: true,
				latencyMs: 1300,
				inputTokens: 10,
				outputTokens: 5,
				costUsd: 0.0001,
			},
			{
				provider: "gemini",
				model: "flash",
				promptName: "small",
				repeat: 1,
				success: true,
				latencyMs: 800,
				inputTokens: 10,
				outputTokens: 5,
				costUsd: 0.00001,
			},
		];

		const report = generateReport(results);
		expect(report).toContain("# Provider Benchmark Report");
		expect(report).toContain("## claude-code");
		expect(report).toContain("## gemini");
		expect(report).toContain("Total runs | 2");
		expect(report).toContain("Avg latency | 1250ms");
	});

	it("includes failure section for failed runs", () => {
		const results: BenchmarkResult[] = [
			{
				provider: "codex",
				model: "gpt-4o",
				promptName: "large",
				repeat: 1,
				success: false,
				latencyMs: 5000,
				inputTokens: 0,
				outputTokens: 0,
				costUsd: 0,
				error: "timeout",
			},
		];

		const report = generateReport(results);
		expect(report).toContain("### Failures");
		expect(report).toContain("timeout");
		expect(report).toContain("Failure rate | 100.0%");
	});

	it("handles zero successes gracefully", () => {
		const results: BenchmarkResult[] = [
			{
				provider: "ollama",
				model: "llama3.2",
				promptName: "small",
				repeat: 1,
				success: false,
				latencyMs: 100,
				inputTokens: 0,
				outputTokens: 0,
				costUsd: 0,
				error: "unavailable",
			},
		];

		const report = generateReport(results);
		expect(report).toContain("Avg latency | 0ms");
		expect(report).toContain("Avg cost | $0.000000");
	});
});
