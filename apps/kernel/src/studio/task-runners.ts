// ---------------------------------------------------------------------------
// Oscorpex — Special Task Runners
// Integration test ve run-app gibi özel task type'ları için executor'lar.
// ---------------------------------------------------------------------------

import { startApp, stopApp } from "./app-runner.js";
import { createLogger } from "./logger.js";
import { analyzeProject } from "./runtime-analyzer.js";
import type { Task, TaskOutput } from "./types.js";
const log = createLogger("task-runners");

async function httpCheck(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; body: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		const body = await res.text();
		return { ok: true, status: res.status, body: body.slice(0, 500) };
	} catch (err) {
		return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
	} finally {
		clearTimeout(timer);
	}
}

export interface IntegrationTestResult {
	output: TaskOutput;
	logs: string[];
}

/**
 * Uygulamayı app-runner ile ayağa kaldırır ve runtime-analyzer'ın bulduğu
 * servisleri smoke test eder. Böylece run-app ile integration-test aynı
 * detection/startup mantığını kullanır.
 */
export async function runIntegrationTest(
	projectId: string,
	repoPath: string,
	onLog: (msg: string) => void,
	task?: Task,
): Promise<TaskOutput> {
	const logs: string[] = [];
	const log = (msg: string) => {
		logs.push(msg);
		onLog(msg);
	};

	log("[integration-test] Starting integration tests...");

	const analysis = analyzeProject(repoPath);
	if (analysis.services.length === 0) {
		// CLI fallback: task açıklamasındaki komutları çalıştır
		log("[integration-test] No HTTP services detected — attempting CLI smoke test");

		const { execSync } = await import("node:child_process");
		const cliCommands = extractCliCommands(task?.description ?? "");

		if (cliCommands.length === 0) {
			throw new Error(
				"Çalıştırılabilir servis bulunamadı ve CLI komutları tespit edilemedi. " +
					"Web uygulamaları için HTTP servisi, CLI araçları için çalıştırılabilir komutlar gereklidir.",
			);
		}

		const cliResults: { cmd: string; passed: boolean; detail: string }[] = [];
		for (const cmd of cliCommands) {
			try {
				const output = execSync(cmd, { cwd: repoPath, timeout: 30000, encoding: "utf8" });
				cliResults.push({ cmd, passed: true, detail: output.slice(0, 200) });
				log(`[integration-test] CLI: ${cmd} → PASS`);
			} catch (err) {
				const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
				cliResults.push({ cmd, passed: false, detail: msg });
				log(`[integration-test] CLI: ${cmd} → FAIL: ${msg}`);
			}
		}

		const passed = cliResults.filter((r) => r.passed).length;
		const failed = cliResults.filter((r) => !r.passed).length;
		log(`[integration-test] CLI Results: ${passed}/${cliResults.length} passed`);

		if (failed > 0) {
			throw new Error(`CLI smoke tests failed: ${failed}/${cliResults.length}`);
		}

		return {
			filesCreated: [],
			filesModified: [],
			testResults: { passed, failed, total: cliResults.length },
			logs,
		};
	}

	const results: { name: string; passed: boolean; detail: string }[] = [];

	try {
		const started = await startApp(projectId, repoPath, (msg) => log(msg));
		if (started.services.length === 0) {
			throw new Error("App runner hiçbir servis başlatamadı.");
		}

		await new Promise((resolve) => setTimeout(resolve, 1500));

		for (const service of started.services) {
			const probe = await httpCheck(service.url);
			results.push({
				name: `Service ${service.name}`,
				passed: probe.ok,
				detail: probe.ok ? `HTTP ${probe.status}` : probe.body,
			});
			log(`[integration-test] ${service.name}: ${probe.ok ? "PASS" : "FAIL"} (${probe.status || "no-response"})`);
		}

		if (started.previewUrl) {
			const previewProbe = await httpCheck(started.previewUrl);
			results.push({
				name: "Preview URL",
				passed: previewProbe.ok,
				detail: previewProbe.ok ? `HTTP ${previewProbe.status}` : previewProbe.body,
			});
			log(`[integration-test] preview: ${previewProbe.ok ? "PASS" : "FAIL"} (${previewProbe.status || "no-response"})`);
		}

		const passed = results.filter((r) => r.passed).length;
		const failed = results.filter((r) => !r.passed).length;
		const total = results.length;

		log(`[integration-test] Results: ${passed}/${total} passed, ${failed} failed`);
		for (const r of results) {
			log(`  ${r.passed ? "✓" : "✗"} ${r.name}: ${r.detail}`);
		}

		if (total === 0) {
			throw new Error(
				"Integration tests did not execute any checks. App runner servisleri başlatsa da smoke target bulunamadı.",
			);
		}
		if (failed > 0) {
			throw new Error(`Integration tests failed: ${failed}/${total} checks failed`);
		}

		return {
			filesCreated: [],
			filesModified: [],
			testResults: { passed, failed, total },
			logs,
		};
	} finally {
		await stopApp(projectId, log).catch((err) =>
			log(`[task-runners] Non-blocking operation failed: ${err?.message ?? String(err)}`),
		);
	}
}

/**
 * Görev açıklamasındaki backtick'li ifadelerden shell komutlarını çıkarır.
 * Yalnızca bilinen komut öntakıları ile başlayan satırları kabul eder.
 */
function extractCliCommands(description: string): string[] {
	const commands: string[] = [];
	const backtickMatches = description.matchAll(/`([^`]+)`/g);
	for (const m of backtickMatches) {
		const cmd = m[1].trim();
		if (
			cmd.startsWith("node ") ||
			cmd.startsWith("npx ") ||
			cmd.startsWith("tsx ") ||
			cmd.startsWith("python ") ||
			cmd.startsWith("python3 ") ||
			cmd.startsWith("./") ||
			cmd.startsWith("pnpm ") ||
			cmd.startsWith("npm ")
		) {
			commands.push(cmd);
		}
	}
	return commands;
}
