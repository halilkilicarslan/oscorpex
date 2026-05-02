// @oscorpex/kernel — MemoryProvider adapter
// Implements the MemoryProvider contract from @oscorpex/core.
// Delegates context packet building to @oscorpex/memory-kit; DB fetch stays here.

import { randomUUID } from "node:crypto";
import type { ContextPacket, ContextPacketOptions, MemoryProvider } from "@oscorpex/core";
import {
	SECTION_BUDGETS,
	assemblePlannerPrompt,
	assembleTeamArchitectPrompt,
	buildSection,
	estimateTokens,
} from "@oscorpex/memory-kit";

class KernelMemoryProvider implements MemoryProvider {
	async buildContextPacket(options: ContextPacketOptions): Promise<ContextPacket> {
		const { projectId, mode, maxTokens = 40_000 } = options;

		const { getProject, listProjectAgents, getLatestPlan, listPhases, listProjectTasks } = await import("../db.js");
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);

		const agents = await listProjectAgents(projectId);
		const plan = await getLatestPlan(projectId);
		const phases = plan ? await listPhases(plan.id) : [];

		let prompt = "";
		const sections: Record<string, number> = {};

		switch (mode) {
			case "planner": {
				const data = {
					project: { name: project.name, description: project.description, techStack: project.techStack },
					plan: plan
						? {
								version: plan.version,
								status: plan.status,
								phases: phases.map((ph: any) => ({
									order: ph.order,
									name: ph.name,
									status: ph.status,
									tasks: (ph.tasks ?? []).map((t: any) => ({
										title: t.title,
										status: t.status,
										assignedAgent: t.assignedAgent,
									})),
								})),
							}
						: undefined,
				};
				const result = assemblePlannerPrompt(data, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			case "team_architect": {
				const data = {
					project: { name: project.name, description: project.description, techStack: project.techStack },
					agents: agents.map((a: any) => ({
						id: a.id,
						name: a.name,
						role: a.role,
						skills: a.skills,
						reportsTo: a.reportsTo,
					})),
				};
				const result = assembleTeamArchitectPrompt(data, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			case "execution": {
				if (!options.taskId) throw new Error("taskId is required for execution mode");
				const result = await this.assembleExecutionContext(
					projectId,
					options.taskId,
					options.agentId,
					project,
					agents,
					maxTokens,
				);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			case "review": {
				if (!options.taskId) throw new Error("taskId is required for review mode");
				const result = await this.assembleReviewContext(projectId, options.taskId, project, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			case "recovery": {
				if (!options.taskId) throw new Error("taskId is required for recovery mode");
				const result = await this.assembleRecoveryContext(projectId, options.taskId, project, agents, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			case "verification": {
				if (!options.taskId) throw new Error("taskId is required for verification mode");
				const result = await this.assembleVerificationContext(projectId, options.taskId, project, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			default: {
				const _exhaustive: never = mode;
				throw new Error(`MemoryProvider mode "${_exhaustive}" not implemented`);
			}
		}

		return {
			id: randomUUID(),
			taskId: options.taskId ?? "",
			mode,
			text: prompt,
			tokenEstimate: estimateTokens(prompt),
			sections,
			refs: [],
		};
	}

	private async assembleExecutionContext(
		projectId: string,
		taskId: string,
		agentId: string | undefined,
		project: any,
		agents: any[],
		maxTokens: number,
	): Promise<{ sections: Record<string, number>; prompt: string }> {
		const sections: Record<string, number> = {};
		const parts: string[] = [];

		const systemSection = buildSection(
			"System",
			"You are an expert software engineer. Implement the task described below with precision. Follow project conventions and produce clean, tested code.",
			500,
		);
		parts.push(systemSection.text);
		sections["system"] = systemSection.tokens;

		if (agentId) {
			const agent = agents.find((a) => a.id === agentId);
			if (agent) {
				const profileLines = [
					`**Name:** ${agent.name}`,
					`**Role:** ${agent.role}`,
					`**Skills:** ${agent.skills.join(", ") || "general"}`,
					agent.personality ? `**Personality:** ${agent.personality}` : "",
				]
					.filter(Boolean)
					.join("\n");
				const profileSection = buildSection("Agent Profile", profileLines, SECTION_BUDGETS.agentProfile);
				parts.push(profileSection.text);
				sections["agentProfile"] = profileSection.tokens;
			}
		}

		const { listProjectTasks } = await import("../db.js");
		const allTasks = await listProjectTasks(projectId);
		const task = allTasks.find((t: any) => t.id === taskId);
		if (!task) throw new Error(`Task not found: ${taskId}`);

		const taskLines = [
			`**Title:** ${task.title}`,
			`**Complexity:** ${task.complexity}`,
			`**Status:** ${task.status}`,
			"",
			"**Description:**",
			task.description,
		];
		const taskSection = buildSection("Task", taskLines.join("\n"), SECTION_BUDGETS.taskDescription);
		parts.push(taskSection.text);
		sections["task"] = taskSection.tokens;

		if (task.targetFiles && task.targetFiles.length > 0) {
			const filesSection = buildSection(
				"Target Files",
				task.targetFiles.map((f: string) => `- \`${f}\``).join("\n"),
				SECTION_BUDGETS.targetFiles,
			);
			parts.push(filesSection.text);
			sections["targetFiles"] = filesSection.tokens;
		}

		const completed = allTasks.filter((t: any) => t.id !== taskId && t.status === "done").slice(-10);
		if (completed.length > 0) {
			const completedSection = buildSection(
				"Recently Completed Tasks",
				completed.map((t: any) => `- ${t.title} (${t.status})`).join("\n"),
				SECTION_BUDGETS.completedTasks,
			);
			parts.push(completedSection.text);
			sections["completedTasks"] = completedSection.tokens;
		}

		const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
		if (criteriaMatch) {
			const criteriaSection = buildSection("Acceptance Criteria", criteriaMatch[1].trim(), 2_000);
			parts.push(criteriaSection.text);
			sections["acceptanceCriteria"] = criteriaSection.tokens;
		}

		return { sections, prompt: parts.join("\n\n---\n\n") };
	}

	private async assembleReviewContext(
		projectId: string,
		taskId: string,
		project: any,
		maxTokens: number,
	): Promise<{ sections: Record<string, number>; prompt: string }> {
		const sections: Record<string, number> = {};
		const parts: string[] = [];

		const systemSection = buildSection(
			"System",
			"You are a senior code reviewer. Review the changes against the acceptance criteria and task description. Be concise and objective.",
			400,
		);
		parts.push(systemSection.text);
		sections["system"] = systemSection.tokens;

		const { listProjectTasks } = await import("../db.js");
		const allTasks = await listProjectTasks(projectId);
		const task = allTasks.find((t: any) => t.id === taskId);
		if (!task) throw new Error(`Task not found: ${taskId}`);

		const taskSection = buildSection(
			"Original Task",
			`**${task.title}**\n\n${task.description}`,
			SECTION_BUDGETS.taskDescription,
		);
		parts.push(taskSection.text);
		sections["originalTask"] = taskSection.tokens;

		const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
		if (criteriaMatch) {
			const criteriaSection = buildSection("Acceptance Criteria", criteriaMatch[1].trim(), 2_000);
			parts.push(criteriaSection.text);
			sections["acceptanceCriteria"] = criteriaSection.tokens;
		}

		if (task.output) {
			const changedFiles = [
				...task.output.filesCreated.map((f: string) => `+ ${f} (created)`),
				...task.output.filesModified.map((f: string) => `~ ${f} (modified)`),
			];
			if (changedFiles.length > 0) {
				const changedSection = buildSection("Changed Files", changedFiles.join("\n"), 2_000);
				parts.push(changedSection.text);
				sections["changedFiles"] = changedSection.tokens;
			}
		}

		return { sections, prompt: parts.join("\n\n---\n\n") };
	}

	private async assembleRecoveryContext(
		projectId: string,
		taskId: string,
		project: any,
		agents: any[],
		maxTokens: number,
	): Promise<{ sections: Record<string, number>; prompt: string }> {
		const sections: Record<string, number> = {};
		const parts: string[] = [];

		const systemSection = buildSection(
			"System",
			"You are recovering from a previous execution failure. Analyze the error, identify the root cause, and produce a corrected implementation. Focus on fixing the specific issue without introducing new changes.",
			500,
		);
		parts.push(systemSection.text);
		sections["system"] = systemSection.tokens;

		const { listProjectTasks } = await import("../db.js");
		const allTasks = await listProjectTasks(projectId);
		const task = allTasks.find((t: any) => t.id === taskId);
		if (!task) throw new Error(`Task not found: ${taskId}`);

		const taskLines = [
			`**Title:** ${task.title}`,
			`**Complexity:** ${task.complexity}`,
			`**Status:** ${task.status}`,
			`**Retry Count:** ${task.retryCount ?? 0}`,
			"",
			"**Description:**",
			task.description,
		];
		const taskSection = buildSection("Task", taskLines.join("\n"), SECTION_BUDGETS.taskDescription);
		parts.push(taskSection.text);
		sections["task"] = taskSection.tokens;

		if (task.error) {
			const errorSection = buildSection("Previous Error", task.error, 2_000);
			parts.push(errorSection.text);
			sections["previousError"] = errorSection.tokens;
		}

		if (task.output) {
			const outputSection = buildSection(
				"Previous Output",
				[
					`Files created: ${task.output.filesCreated?.join(", ") || "none"}`,
					`Files modified: ${task.output.filesModified?.join(", ") || "none"}`,
					`Logs: ${task.output.logs?.slice(-20).join("\n") || "none"}`,
				].join("\n"),
				2_000,
			);
			parts.push(outputSection.text);
			sections["previousOutput"] = outputSection.tokens;
		}

		const completed = allTasks.filter((t: any) => t.id !== taskId && t.status === "done").slice(-5);
		if (completed.length > 0) {
			const completedSection = buildSection(
				"Recently Completed Tasks",
				completed.map((t: any) => `- ${t.title} (${t.status})`).join("\n"),
				SECTION_BUDGETS.completedTasks,
			);
			parts.push(completedSection.text);
			sections["completedTasks"] = completedSection.tokens;
		}

		return { sections, prompt: parts.join("\n\n---\n\n") };
	}

	private async assembleVerificationContext(
		projectId: string,
		taskId: string,
		project: any,
		maxTokens: number,
	): Promise<{ sections: Record<string, number>; prompt: string }> {
		const sections: Record<string, number> = {};
		const parts: string[] = [];

		const systemSection = buildSection(
			"System",
			"You are verifying execution results against acceptance criteria. Check that all files exist, tests pass, and the implementation meets requirements. Report any discrepancies clearly.",
			400,
		);
		parts.push(systemSection.text);
		sections["system"] = systemSection.tokens;

		const { listProjectTasks, query } = await import("../db.js");
		const allTasks = await listProjectTasks(projectId);
		const task = allTasks.find((t: any) => t.id === taskId);
		if (!task) throw new Error(`Task not found: ${taskId}`);

		const taskSection = buildSection(
			"Task",
			`**${task.title}**\n\n${task.description}`,
			SECTION_BUDGETS.taskDescription,
		);
		parts.push(taskSection.text);
		sections["task"] = taskSection.tokens;

		if (task.output) {
			const changedFiles = [
				...task.output.filesCreated.map((f: string) => `+ ${f} (created)`),
				...task.output.filesModified.map((f: string) => `~ ${f} (modified)`),
			];
			if (changedFiles.length > 0) {
				const changedSection = buildSection("Changed Files", changedFiles.join("\n"), 2_000);
				parts.push(changedSection.text);
				sections["changedFiles"] = changedSection.tokens;
			}

			if (task.output.testResults) {
				const testSection = buildSection(
					"Test Results",
					`Passed: ${task.output.testResults.passed}\nFailed: ${task.output.testResults.failed}\nTotal: ${task.output.testResults.total}`,
					1_000,
				);
				parts.push(testSection.text);
				sections["testResults"] = testSection.tokens;
			}
		}

		// Fetch verification results from DB
		let verificationRows: any[] = [];
		try {
			verificationRows = await query(
				`SELECT verification_type, status, details FROM verification_results WHERE task_id = $1 ORDER BY created_at DESC`,
				[taskId],
			);
		} catch {
			// table may not exist
		}
		if (verificationRows.length > 0) {
			const verifyLines = verificationRows.map((r: any) => `- ${r.verification_type}: ${r.status}`);
			const verifySection = buildSection("Verification Results", verifyLines.join("\n"), 1_500);
			parts.push(verifySection.text);
			sections["verificationResults"] = verifySection.tokens;
		}

		const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
		if (criteriaMatch) {
			const criteriaSection = buildSection("Acceptance Criteria", criteriaMatch[1].trim(), 2_000);
			parts.push(criteriaSection.text);
			sections["acceptanceCriteria"] = criteriaSection.tokens;
		}

		return { sections, prompt: parts.join("\n\n---\n\n") };
	}
}

export const memoryProvider = new KernelMemoryProvider();
