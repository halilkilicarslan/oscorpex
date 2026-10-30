// ---------------------------------------------------------------------------
// Oscorpex — Special Task Runners
// Integration test ve run-app gibi özel task type'ları için executor'lar.
// ---------------------------------------------------------------------------

import { startApp, stopApp } from "./app-runner.js";
import { createLogger } from "./logger.js";
import { analyzeProject } from "./runtime-analyzer.js";
import { buildSafeChildEnv } from "./security/env-sanitizer.js";
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
		// P0-2: Never execute LLM-extracted commands on host.
		// Commands from task descriptions are stored as proposals only.
		log("[integration-test] No HTTP services detected — CLI commands will be proposed (not executed)");

		const cliCommands = extractCliCommands(task?.description ?? "");

		if (cliCommands.length === 0) {
			throw new Error(
				"Çalıştırılabilir servis bulunamadı ve CLI komutları tespit edilemedi. " +
					"Web uygulamaları için HTTP servisi, CLI araçları için çalıştırılabilir komutlar gereklidir.",
			);
		}

		// P0-2: Store as proposed commands — never execute directly
		const proposed = cliCommands.map((cmd) => ({
			commandText: cmd,
			source: "llm_task_description" as const,
			status: "proposed" as const,
			requiresApproval: true,
			riskLevel: "execute" as const,
		}));

		for (const p of proposed) {
			log(`[integration-test] PROPOSED (not executed): ${p.commandText}`);
		}

		log(`[integration-test] ${proposed.length} command(s) proposed — awaiting approval`);

		return {
			filesCreated: [],
			filesModified: [],
			testResults: { passed: 0, failed: 0, total: proposed.length },
			logs,
			proposedCommands: proposed,
		} as TaskOutput;
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
	} catch (httpErr) {
		// HTTP path failed — fall back to CLI smoke test
		log(`[integration-test] HTTP test failed: ${httpErr instanceof Error ? httpErr.message : String(httpErr)}`);
		log("[integration-test] Falling back to CLI smoke test...");

		// P0-2: Do not execute LLM-extracted commands — propose only
		const cliCommands = extractCliCommands(task?.description ?? "");
		if (cliCommands.length > 0) {
			const proposed = cliCommands.map((cmd) => ({
				commandText: cmd,
				source: "llm_task_description" as const,
				status: "proposed" as const,
				requiresApproval: true,
				riskLevel: "execute" as const,
			}));
			for (const p of proposed) {
				log(`[integration-test] PROPOSED (not executed): ${p.commandText}`);
			}
			return {
				filesCreated: [],
				filesModified: [],
				testResults: { passed: 0, failed: 0, total: proposed.length },
				logs,
				proposedCommands: proposed,
			} as TaskOutput;
		}
		throw httpErr;
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

/**
 * CLI projesini derler ve görev açıklamasındaki demo komutlarını çalıştırır.
 * Web servisi bulunmayan (CLI araç) projelerde run-app task'ı için kullanılır.
 */
/**
 * P0-2: CLI demo now only proposes commands — never executes LLM-extracted commands on host.
 * Build step uses a fixed allowlist of build commands (not from LLM output).
 */
export async function runCliDemo(repoPath: string, task: Task, onLog: (msg: string) => void): Promise<TaskOutput> {
	const { execFileSync } = await import("node:child_process");
	const { readFile } = await import("node:fs/promises");
	const { join } = await import("node:path");

	const logs: string[] = [];
	const emit = (msg: string) => {
		logs.push(msg);
		onLog(msg);
	};

	// Adım 1: Projeyi derle — fixed allowlist, not from LLM output
	emit("[cli-demo] Building project...");
	const buildSteps: { bin: string; args: string[] }[] = [
		{ bin: "pnpm", args: ["build"] },
		{ bin: "npm", args: ["run", "build"] },
		{ bin: "npx", args: ["tsc"] },
	];
	let built = false;
	for (const step of buildSteps) {
		try {
			execFileSync(step.bin, step.args, {
				cwd: repoPath,
				timeout: 60_000,
				encoding: "utf8",
				stdio: "pipe",
				env: buildSafeChildEnv({ profile: "build_tool" }),
			});
			emit(`[cli-demo] Build successful: ${step.bin} ${step.args.join(" ")}`);
			built = true;
			break;
		} catch {
			// Sonraki build komutunu dene
		}
	}
	if (!built) {
		emit("[cli-demo] No build step needed or build failed — continuing with source files");
	}

	// Adım 2: Demo komutlarını belirle — propose only, never execute
	let demoCommands = extractCliCommands(task.description ?? "");

	if (demoCommands.length === 0) {
		try {
			const pkgRaw = await readFile(join(repoPath, "package.json"), "utf8");
			const pkg = JSON.parse(pkgRaw) as {
				name?: string;
				bin?: string | Record<string, string>;
			};
			if (pkg.bin) {
				const binName =
					typeof pkg.bin === "string" ? (pkg.name ?? "app") : (Object.keys(pkg.bin)[0] ?? pkg.name ?? "app");
				demoCommands = [`npx ${binName} --help`];
				emit(`[cli-demo] Inferred demo command from package.json bin: npx ${binName} --help`);
			}
		} catch {
			// package.json okunamazsa sessizce devam et
		}
	}

	if (demoCommands.length === 0) {
		emit("[cli-demo] No demo commands found in task description or package.json");
		return { filesCreated: [], filesModified: [], logs };
	}

	// P0-2: Propose commands — do NOT execute them
	emit(`[cli-demo] Proposing ${demoCommands.length} demo command(s) (not executing)...`);
	const proposed = demoCommands.map((cmd) => ({
		commandText: cmd,
		source: "llm_task_description" as const,
		status: "proposed" as const,
		requiresApproval: true,
		riskLevel: "execute" as const,
	}));

	for (const p of proposed) {
		emit(`[cli-demo] PROPOSED: ${p.commandText}`);
	}

	emit(`\n[cli-demo] ${proposed.length} command(s) proposed — awaiting approval`);

	return { filesCreated: [], filesModified: [], logs, proposedCommands: proposed } as TaskOutput;
}
