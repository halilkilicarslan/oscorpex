// ---------------------------------------------------------------------------
// Oscorpex — Review Dispatcher
// Handles code review task execution: prompt building, CLI adapter call,
// review result parsing, and revision restart on rejection.
// Extracted from execution-engine.ts for single-responsibility.
// ---------------------------------------------------------------------------

import { persistAgentLog } from "./agent-log-store.js";
import { composeSystemPrompt } from "./behavioral-prompt.js";
import { resolveAllowedTools } from "./capability-resolver.js";
import { getAdapter } from "./cli-adapter.js";
import { getAgentConfig, getTask, listAgentConfigs, listProjectAgents, recordTokenUsage } from "./db.js";
import { type ExecutionWorkspace, resolveWorkspace } from "./execution-workspace.js";
import { createLogger } from "./logger.js";
import { defaultSystemPrompt } from "./prompt-builder.js";
import { canonicalizeAgentRole, roleMatches } from "./roles.js";
import { taskEngine } from "./task-engine.js";
import type { AgentConfig, Project, Task } from "./types.js";
const log = createLogger("review-dispatcher");

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Agent resolution (extracted from ExecutionEngine class)
// ---------------------------------------------------------------------------

export async function resolveAgent(projectId: string, assignment: string): Promise<AgentConfig | undefined> {
	if (!assignment) return undefined;
	const normalizedAssignment = canonicalizeAgentRole(assignment);

	const projectAgents = await listProjectAgents(projectId);
	const pById = projectAgents.find((a) => a.id === assignment);
	if (pById) return pById as unknown as AgentConfig;

	const pByRole = projectAgents.find((a) => roleMatches(a.role, normalizedAssignment));
	if (pByRole) return pByRole as unknown as AgentConfig;

	const pByName = projectAgents.find((a) => a.name.toLowerCase() === assignment.toLowerCase());
	if (pByName) return pByName as unknown as AgentConfig;

	const aLower = normalizedAssignment.toLowerCase();
	const categoryMap: Record<string, string[]> = {
		backend: ["backend-dev", "backend-developer"],
		frontend: ["frontend-dev", "frontend-developer"],
		qa: ["backend-qa", "frontend-qa", "qa-engineer"],
		design: ["design-lead", "ui-designer"],
	};
	const candidates = categoryMap[aLower];
	if (candidates) {
		const pByCategory = projectAgents.find((a) => candidates.includes(a.role.toLowerCase()));
		if (pByCategory) return pByCategory as unknown as AgentConfig;
	}

	const pByPartialRole = projectAgents.find(
		(a) => a.role.toLowerCase().startsWith(aLower + "-") || a.role.toLowerCase().endsWith("-" + aLower),
	);
	if (pByPartialRole) return pByPartialRole as unknown as AgentConfig;

	const byId = await getAgentConfig(assignment);
	if (byId) return byId;

	const all = await listAgentConfigs();
	const byRole = all.find((a) => roleMatches(a.role, normalizedAssignment));
	if (byRole) return byRole;

	const byName = all.find((a) => a.name.toLowerCase() === assignment.toLowerCase());
	return byName;
}

// ---------------------------------------------------------------------------
// Review task execution
// ---------------------------------------------------------------------------

export async function executeReviewTask(
	projectId: string,
	project: Project,
	reviewTask: Task,
	agentRuntime: {
		ensureVirtualProcess: (pid: string, aid: string, name: string) => void;
		appendVirtualOutput: (pid: string, aid: string, msg: string) => void;
		getAgentOutput: (pid: string, aid: string) => string[];
		markVirtualStopped: (pid: string, aid: string) => void;
	},
): Promise<void> {
	const originalTaskId = reviewTask.dependsOn?.[0];
	const originalTask = originalTaskId ? await getTask(originalTaskId) : null;

	if (!originalTask) {
		await taskEngine.assignTask(reviewTask.id, reviewTask.assignedAgent);
		await taskEngine.startTask(reviewTask.id);
		await taskEngine.completeTask(reviewTask.id, {
			filesCreated: [],
			filesModified: [],
			logs: ["Orijinal task bulunamadı — review atlandı"],
		});
		return;
	}

	const reviewer = await resolveAgent(projectId, reviewTask.assignedAgent);
	if (!reviewer) {
		await taskEngine.assignTask(reviewTask.id, reviewTask.assignedAgent);
		await taskEngine.startTask(reviewTask.id);
		await taskEngine.failTask(reviewTask.id, "Reviewer agent bulunamadı");
		await taskEngine.submitReview(originalTaskId!, false, "Reviewer bulunamadı — eskalasyon gerekli");
		return;
	}

	await taskEngine.assignTask(reviewTask.id, reviewer.id);
	await taskEngine.startTask(reviewTask.id);

	agentRuntime.ensureVirtualProcess(projectId, reviewer.id, reviewer.name);
	const termLog = (msg: string) => agentRuntime.appendVirtualOutput(projectId, reviewer.id, msg);

	// Gather files to review
	const allFiles = [...(originalTask.output?.filesCreated ?? []), ...(originalTask.output?.filesModified ?? [])];

	// Zero-file decision detection
	const isZeroFileDecision = allFiles.length <= 1 && allFiles.some((f) => f.endsWith("decision.md"));

	let decisionContent = "";
	if (isZeroFileDecision && originalTask.output?.logs) {
		const logs = originalTask.output.logs;
		let capture = false;
		const lines: string[] = [];
		for (const line of logs) {
			if (line.includes("--- DECISION ---")) {
				capture = true;
				continue;
			}
			if (line.includes("--- /DECISION ---")) {
				capture = false;
				continue;
			}
			if (capture) lines.push(line);
		}
		decisionContent = lines.join("\n");
	}

	let reviewPrompt: string;
	let reviewWorkspace: ExecutionWorkspace | undefined;

	if (isZeroFileDecision) {
		termLog(`[review] "${originalTask.title}" — zero-file decision inceleniyor...`);
		reviewPrompt = buildZeroFileReviewPrompt(project, originalTask, allFiles, decisionContent);
	} else if (allFiles.length === 0) {
		await taskEngine.completeTask(reviewTask.id, {
			filesCreated: [],
			filesModified: [],
			logs: ["İncelenecek dosya yok — orijinal task dosya değişikliği üretmedi"],
		});
		await taskEngine.submitReview(
			originalTaskId!,
			false,
			"İncelenecek dosya yok — orijinal task dosya değişikliği üretmedi",
		);
		return;
	} else {
		termLog(`[review] "${originalTask.title}" inceleniyor — ${allFiles.length} dosya...`);
		reviewPrompt = buildCodeReviewPrompt(project, originalTask, allFiles);
	}

	try {
		const reviewTools = await resolveAllowedTools(projectId, reviewer.id, reviewer.role);
		const reviewAdapter = await getAdapter(reviewer.cliTool ?? "claude-code");
		reviewWorkspace = await resolveWorkspace(project.repoPath, reviewTask.id, {
			id: "review-workspace",
			projectId,
			isolationLevel: "workspace",
			allowedTools: [],
			deniedTools: [],
			filesystemScope: [],
			networkPolicy: "project_only",
			maxExecutionTimeMs: reviewer.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS,
			maxOutputSizeBytes: 10_485_760,
			elevatedCapabilities: [],
			enforcementMode: "hard",
		});

		const cliResult = await reviewAdapter.execute({
			projectId,
			taskId: reviewTask.id,
			agentId: reviewer.id,
			agentName: reviewer.name,
			repoPath: reviewWorkspace.repoPath,
			prompt: reviewPrompt,
			systemPrompt: reviewer.systemPrompt ? composeSystemPrompt(reviewer.systemPrompt) : defaultSystemPrompt(reviewer),
			timeoutMs: reviewer.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS,
			model: "sonnet",
			allowedTools: reviewTools,
		});

		if (reviewWorkspace.isolated) {
			await reviewWorkspace.writeBack(cliResult.filesModified ?? []);
		}

		if (cliResult.inputTokens || cliResult.outputTokens) {
			const totalTokens = cliResult.inputTokens + cliResult.outputTokens;
			await recordTokenUsage({
				projectId,
				taskId: reviewTask.id,
				agentId: reviewer.id,
				model: cliResult.model || "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: cliResult.inputTokens,
				outputTokens: cliResult.outputTokens,
				totalTokens,
				costUsd: cliResult.totalCostUsd,
				cacheCreationTokens: cliResult.cacheCreationTokens,
				cacheReadTokens: cliResult.cacheReadTokens,
			});
			termLog(`[review-cost] ${cliResult.model}: ${totalTokens} tokens ($${cliResult.totalCostUsd.toFixed(4)})`);
		}

		const approved = /APPROVED|FIXED/i.test(cliResult.text);
		const feedback = cliResult.text.slice(0, 2000);
		termLog(`[review] Sonuç: ${approved ? "APPROVED" : "NEEDS FIXES"}`);

		const reviewOutputLines = agentRuntime.getAgentOutput(projectId, reviewer.id);
		if (reviewOutputLines.length > 0) {
			persistAgentLog(projectId, reviewer.id, reviewOutputLines).catch((err) =>
				log.warn("[review-dispatcher] Non-blocking operation failed:", err?.message ?? err),
			);
		}

		await taskEngine.completeTask(reviewTask.id, {
			filesCreated: [],
			filesModified: cliResult.filesModified ?? [],
			logs: [feedback],
		});
		await taskEngine.submitReview(originalTaskId!, approved, feedback);
		agentRuntime.markVirtualStopped(projectId, reviewer.id);
		await reviewWorkspace
			.cleanup()
			.catch((err) => log.warn("[review-dispatcher] Non-blocking operation failed:", err?.message ?? err));

		if (!approved) {
			const revisedTask = await getTask(originalTaskId!);
			if (revisedTask?.status === "revision") {
				log.info(`[review-dispatcher] Review rejected — restarting "${revisedTask.title}" for revision`);
				await taskEngine.restartRevision(originalTaskId!);
			}
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		termLog(`[review] Hata: ${msg.slice(0, 200)}`);
		agentRuntime.markVirtualStopped(projectId, reviewer.id);
		if (reviewWorkspace?.isolated) {
			await reviewWorkspace
				.cleanup()
				.catch((e) => log.warn("[review-dispatcher] Non-blocking operation failed:", e?.message ?? e));
		}
		await taskEngine.failTask(reviewTask.id, msg);
		try {
			await taskEngine.submitReview(originalTaskId!, false, `Review başarısız: ${msg.slice(0, 200)} — insan incelemesi gerekli`);
		} catch {
			/* failsafe */
		}
	}
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildZeroFileReviewPrompt(
	project: Project,
	originalTask: Task,
	allFiles: string[],
	decisionContent: string,
): string {
	return [
		`# Zero-File Decision Review: ${originalTask.title}`,
		"",
		`## Context`,
		`- Project: ${project.name}`,
		`- Original task: ${originalTask.title}`,
		`- Description: ${originalTask.description}`,
		"",
		`## Durum`,
		"Orijinal task hiçbir dosya oluşturmadı veya değiştirmedi.",
		"",
		...(allFiles.length > 0 ? [`## Decision Dosyası`, `- \`${allFiles[0]}\``, ""] : []),
		...(decisionContent ? ["## Decision İçeriği (inline)", decisionContent, ""] : []),
		`## Reviewer Talimatları`,
		...(allFiles.length > 0 ? ["1. readFile ile decision.md dosyasını oku"] : ["1. Yukarıdaki decision içeriğini oku"]),
		"2. Orijinal task açıklamasını dikkatlice incele",
		"3. Task'ın dosya değişikliği gerektirip gerektirmediğini değerlendir:",
		"   - Eğer task gerçekten dosya değişikliği gerektirmiyorsa (analiz, araştırma vb.) → APPROVED",
		"   - Eğer agent hatalı çalıştıysa ve dosya üretmeliydi → REJECTED",
		"4. Kararını net gerekçeyle açıkla",
		"",
		"## Output Format",
		'"APPROVED" — task dosya değişikliği gerektirmiyor, kabul edildi',
		'"REJECTED" — task dosya üretmeliydi ama üretmedi, revizyon gerekli',
	].join("\n");
}

function buildCodeReviewPrompt(project: Project, originalTask: Task, allFiles: string[]): string {
	return [
		`# Code Review: ${originalTask.title}`,
		"",
		`## Context`,
		`- Project: ${project.name}`,
		`- Original task: ${originalTask.title}`,
		`- Description: ${originalTask.description}`,
		"",
		`## Files to Review`,
		...allFiles.map((f) => `- \`${f}\``),
		"",
		`## Instructions`,
		"Review the code for each file:",
		"1. Use readFile to read the file contents",
		"2. Check for bugs, security issues, code style problems, and missing edge cases",
		"3. If you find issues, use writeFile to fix them directly",
		"4. If the code is good, just note it as approved",
		"",
		"## Output Format",
		"Provide a brief review summary. Start with either:",
		'- "APPROVED" if the code is good',
		'- "FIXED" if you made corrections',
		"",
		"Then list what you found and any changes you made.",
	].join("\n");
}
