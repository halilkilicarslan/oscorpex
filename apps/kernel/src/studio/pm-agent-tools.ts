// ---------------------------------------------------------------------------
// Oscorpex — AI Planner — Tool definitions (AI SDK) + plan builder
// ---------------------------------------------------------------------------

import { tool } from "ai";
import { z } from "zod";
import {
	createPhase,
	createPlan,
	createTask,
	getDefaultProvider,
	getLatestPlan,
	getProject,
	getProjectAgentsWithSkills,
	listProjectAgents,
	listProjectTasks,
	queryOne,
	updatePhaseDependencies,
	updatePlanStatus,
	updateTask,
	updateTaskDependencies,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { gitManager } from "./git-manager.js";
import { ensureGoalForTask } from "./goal-engine.js";
import {
	appendPhaseToPlan as incAppendPhase,
	appendTaskToPhase as incAppendTask,
	replanUnfinishedTasks as incReplan,
} from "./incremental-planner.js";
import { createLogger } from "./logger.js";
import { getModelPricing } from "./providers/model-pricing.js";
import { canonicalizeAgentRole, roleMatches } from "./roles.js";
import type { TaskComplexity } from "./types.js";

const log = createLogger("pm-agent-tools");

// ---------------------------------------------------------------------------
// Maliyet tahmini — token sabitleri
// ---------------------------------------------------------------------------

/** Her task için varsayılan token tahminleri. */
export const AVG_INPUT_TOKENS_PER_TASK = 2000;
export const AVG_OUTPUT_TOKENS_PER_TASK = 1000;

export interface PlanCostEstimate {
	estimatedTokens: number;
	estimatedCost: number;
	currency: "USD";
	taskCount: number;
	avgTokensPerTask: number;
	model: string;
	breakdown: { inputTokens: number; outputTokens: number; inputCost: number; outputCost: number };
}

/**
 * Bir plan için tahmini maliyet hesaplar.
 * Task başına ortalama 2000 input + 1000 output token varsayar.
 * Model fiyatı: default provider'ın model ayarından alınır.
 */
export async function estimatePlanCost(projectId: string, planId: string): Promise<PlanCostEstimate> {
	const taskCountRow = await queryOne<{ cnt: string }>(
		`SELECT COUNT(*) AS cnt
     FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id
     JOIN project_plans pp ON pp.id = ph.plan_id
     WHERE pp.id = $1 AND pp.project_id = $2`,
		[planId, projectId],
	);

	const taskCount = taskCountRow ? Number.parseInt(taskCountRow.cnt, 10) : 0;

	const defaultProvider = await getDefaultProvider();
	const model = defaultProvider?.model || "claude-sonnet-4-6";
	const pricing = getModelPricing(model);

	const totalInputTokens = taskCount * AVG_INPUT_TOKENS_PER_TASK;
	const totalOutputTokens = taskCount * AVG_OUTPUT_TOKENS_PER_TASK;
	const totalTokens = totalInputTokens + totalOutputTokens;

	const inputCost = (totalInputTokens / 1_000_000) * pricing.inputPer1M;
	const outputCost = (totalOutputTokens / 1_000_000) * pricing.outputPer1M;
	const totalCost = inputCost + outputCost;

	return {
		estimatedTokens: totalTokens,
		estimatedCost: Math.round(totalCost * 10000) / 10000,
		currency: "USD",
		taskCount,
		avgTokensPerTask: AVG_INPUT_TOKENS_PER_TASK + AVG_OUTPUT_TOKENS_PER_TASK,
		model,
		breakdown: {
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			inputCost: Math.round(inputCost * 10000) / 10000,
			outputCost: Math.round(outputCost * 10000) / 10000,
		},
	};
}

// ---------------------------------------------------------------------------
// Shared schema — phase + task structure used across multiple tools
// ---------------------------------------------------------------------------

export const phaseSchema = z.object({
	name: z.string().describe('Phase name, e.g. "Foundation", "Core Features"'),
	order: z.number().int().describe("Execution order (1-based)"),
	dependsOnPhaseOrders: z.array(z.number().int()).default([]).describe("Orders of phases this depends on"),
	tasks: z.array(
		z.object({
			title: z.string().describe("Short task title"),
			description: z.string().describe("Detailed instructions for the coder agent"),
			assignedRole: z
				.enum(["architect", "frontend", "backend", "qa", "reviewer", "devops", "coder"])
				.describe("Which agent role should handle this"),
			complexity: z
				.enum(["S", "M", "L", "XL"])
				.describe("S=small, M=medium, L=large, XL=extra-large (requires human approval)"),
			dependsOnTaskTitles: z
				.array(z.string())
				.default([])
				.describe("Titles of tasks this depends on (within same plan)"),
			branch: z.string().describe('Git branch name, e.g. "feat/auth-api"'),
			taskType: z
				.enum(["ai", "integration-test", "run-app"])
				.default("ai")
				.describe(
					'Task type: "ai" for normal AI coding, "integration-test" for automated smoke tests, "run-app" to start the application',
				),
			testExpectation: z
				.enum(["none", "optional", "required"])
				.default("required")
				.describe('Test expectation: "none" (no test gate), "optional" (warn only), "required" (must pass).'),
			// v3.0: Micro-task decomposition fields
			targetFiles: z
				.array(z.string())
				.default([])
				.describe(
					"Target files this task will create or modify (e.g. ['src/auth/login.ts', 'src/auth/login.test.ts'])",
				),
			estimatedLines: z
				.number()
				.int()
				.optional()
				.describe("Estimated lines of code to change (S: 1-20, M: 20-80, L: 80-200)"),
			constraints: z
				.array(z.string())
				.default([])
				.describe("Optional execution constraints for goal-driven validation"),
			successCriteria: z
				.array(z.string())
				.default([])
				.describe("Optional success criteria. When provided, an execution goal is created for this task."),
		}),
	),
});

export type PhaseInput = z.infer<typeof phaseSchema>;

// ---------------------------------------------------------------------------
// Helper: build plan from phases
// ---------------------------------------------------------------------------

export async function buildPlan(projectId: string, phases: PhaseInput[]) {
	const project = await getProject(projectId);
	if (!project) throw new Error(`Project ${projectId} not found`);

	const plan = await createPlan(projectId);
	const titleToId = new Map<string, string>();

	// First pass: create all phases (dependsOn initially empty)
	const createdPhases = await Promise.all(
		phases.map(async (p) => {
			const phase = await createPhase({
				planId: plan.id,
				name: p.name,
				order: p.order,
				dependsOn: [],
			});
			return { input: p, created: phase };
		}),
	);

	// Second pass: resolve phase-level dependencies (order → id)
	const orderToPhaseId = new Map<number, string>();
	for (const { input, created } of createdPhases) {
		orderToPhaseId.set(input.order, created.id);
	}
	for (const { input, created } of createdPhases) {
		const depIds = (input.dependsOnPhaseOrders ?? [])
			.map((order: number) => orderToPhaseId.get(order))
			.filter((id: string | undefined): id is string => !!id);
		if (depIds.length > 0) {
			await updatePhaseDependencies(created.id, depIds);
		}
	}

	// --- PM Planning Task: create auto-completed task for the PM agent ---
	const agents = await listProjectAgents(projectId);
	const resolveAssignedAgentId = (assignment: string): string | undefined =>
		agents.find(
			(agent) =>
				agent.id === assignment ||
				roleMatches(agent.role, assignment) ||
				agent.name.toLowerCase() === assignment.toLowerCase(),
		)?.id;
	const minOrder = Math.min(...agents.map((a) => a.pipelineOrder ?? 99));
	const pmAgent = agents.find((a) => (a.pipelineOrder ?? 99) === minOrder);
	if (pmAgent && createdPhases.length > 0) {
		const firstPhase = createdPhases[0].created;
		const planningCompletedAt = new Date().toISOString();
		const pmTask = await createTask({
			phaseId: firstPhase.id,
			title: "Proje Planlama ve Görev Dağılımı",
			description: `Proje gereksinimlerinin analizi, ${phases.length} fazlı plan oluşturulması ve takım üyelerine görev dağıtımı yapıldı.`,
			assignedAgent: pmAgent.id,
			complexity: "S" as TaskComplexity,
			dependsOn: [],
			branch: "main",
		});
		// Mark as done immediately — planning is already complete
		await updateTask(pmTask.id, {
			status: "done",
			startedAt: planningCompletedAt,
			completedAt: planningCompletedAt,
			output: {
				filesCreated: ["docs/PLAN.md"],
				filesModified: [],
				logs: [`Plan oluşturuldu: ${phases.length} faz, ${phases.reduce((s, p) => s + p.tasks.length, 0)} görev`],
			},
		});
	}

	for (const { input, created } of createdPhases) {
		for (const t of input.tasks) {
			// Human-in-the-Loop: XL complexity veya kritik keyword içeren task'lar onay gerektirir
			const APPROVAL_KEYWORDS = [
				"deploy",
				"database migration",
				"delete",
				"drop",
				"truncate",
				"migration",
				"seed",
				"production",
			];
			const searchText = `${t.title} ${t.description}`.toLowerCase();
			const autoRequiresApproval = t.complexity === "XL" || APPROVAL_KEYWORDS.some((kw) => searchText.includes(kw));

			const task = await createTask({
				phaseId: created.id,
				title: t.title,
				description: t.description,
				assignedAgent: canonicalizeAgentRole(t.assignedRole),
				assignedAgentId: resolveAssignedAgentId(t.assignedRole),
				complexity: t.complexity as TaskComplexity,
				dependsOn: [],
				branch: t.branch,
				taskType: t.taskType as any,
				testExpectation: t.testExpectation as any,
				requiresApproval: autoRequiresApproval,
				targetFiles: t.targetFiles ?? [],
				estimatedLines: t.estimatedLines,
			});
			if (t.successCriteria && t.successCriteria.length > 0) {
				await ensureGoalForTask({
					projectId,
					taskId: task.id,
					definition: {
						goal: t.title,
						constraints: t.constraints ?? [],
						successCriteria: t.successCriteria,
					},
				});
			}
			titleToId.set(t.title, task.id);
		}
	}

	// Resolve task dependencies
	for (const { input } of createdPhases) {
		for (const t of input.tasks) {
			const taskId = titleToId.get(t.title);
			if (!taskId) continue;
			const depIds = t.dependsOnTaskTitles
				.map((title: string) => titleToId.get(title))
				.filter((id: string | undefined): id is string => !!id);
			if (depIds.length > 0) {
				await updateTaskDependencies(taskId, depIds);
			}
		}
	}

	// Export plan as markdown to docs/PLAN.md
	if (project.repoPath) {
		try {
			const lines: string[] = [`# Project Plan — ${project.name}`, "", `**Version:** ${plan.version}`, ""];
			for (const { input } of createdPhases) {
				const depOrders =
					(input.dependsOnPhaseOrders ?? []).length > 0
						? ` (depends on phase ${input.dependsOnPhaseOrders.join(", ")})`
						: "";
				lines.push(`## Phase ${input.order}: ${input.name}${depOrders}`, "");
				for (const t of input.tasks) {
					const deps = t.dependsOnTaskTitles.length > 0 ? ` (depends on: ${t.dependsOnTaskTitles.join(", ")})` : "";
					lines.push(`- **[${t.complexity}] ${t.title}** — ${t.assignedRole}${deps}`);
					if (t.description) lines.push(`  ${t.description}`);
				}
				lines.push("");
			}
			await gitManager.writeFileContent(project.repoPath, "docs/PLAN.md", lines.join("\n"));
		} catch {
			// Non-critical: don't fail plan creation if docs export fails
		}
	}

	eventBus.emit({
		projectId,
		type: "plan:created",
		payload: { planId: plan.id, version: plan.version, phaseCount: phases.length },
	});

	return {
		planId: plan.id,
		version: plan.version,
		phaseCount: phases.length,
		taskCount: phases.reduce((sum: number, p: PhaseInput) => sum + p.tasks.length, 0),
	};
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const pmToolkit = {
	createProjectPlan: tool({
		description: `Create a structured project plan with phases and tasks. The plan will be presented to the user for approval before execution begins.`,
		inputSchema: z.object({
			projectId: z.string().describe("The project ID to create the plan for"),
			phases: z.array(phaseSchema).describe("Ordered list of project phases"),
		}),
		execute: async ({ projectId, phases }) => {
			const result = await buildPlan(projectId, phases);
			return { ...result, message: "Plan created successfully. Waiting for user approval." };
		},
	}),

	getProjectStatus: tool({
		description: "Get the current status of a project including plan status and task progress.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID to check"),
		}),
		execute: async ({ projectId }) => {
			const project = await getProject(projectId);
			if (!project) throw new Error(`Project ${projectId} not found`);

			const plan = await getLatestPlan(projectId);
			const tasks = await listProjectTasks(projectId);

			return {
				project: {
					id: project.id,
					name: project.name,
					status: project.status,
					techStack: project.techStack,
				},
				plan: plan ? { id: plan.id, version: plan.version, status: plan.status, phaseCount: plan.phases.length } : null,
				tasks: {
					total: tasks.length,
					queued: tasks.filter((t) => t.status === "queued").length,
					assigned: tasks.filter((t) => t.status === "assigned").length,
					running: tasks.filter((t) => t.status === "running").length,
					review: tasks.filter((t) => t.status === "review").length,
					done: tasks.filter((t) => t.status === "done").length,
					failed: tasks.filter((t) => t.status === "failed").length,
				},
			};
		},
	}),

	updateProjectPlan: tool({
		description: "Create a new version of the project plan after user feedback.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID"),
			phases: z.array(phaseSchema).describe("Updated phases for the new plan version"),
		}),
		execute: async ({ projectId, phases }) => {
			const oldPlan = await getLatestPlan(projectId);
			if (oldPlan && oldPlan.status === "draft") {
				await updatePlanStatus(oldPlan.id, "rejected");
			}
			const result = await buildPlan(projectId, phases);
			return { ...result, message: "Updated plan created. Waiting for user approval." };
		},
	}),

	askUser: tool({
		description: "Ask the user a clarifying question when you need more information to proceed.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID"),
			question: z.string().describe("The question to ask the user"),
			options: z.array(z.string()).optional().describe("Optional suggested answers"),
		}),
		execute: async ({ projectId, question, options }) => {
			eventBus.emit({
				projectId,
				type: "escalation:user",
				payload: { question, options },
			});
			return { message: question, options: options ?? [], note: "Question sent to user." };
		},
	}),

	smartAssignTask: tool({
		description: `Analyze a task description and recommend the best agent(s) based on skill matching.
Returns ranked candidates with confidence scores and reasoning so you can explain the assignment decision to the user.
Use this whenever the user asks "who should do X?" or before assigning tasks in a plan.`,
		inputSchema: z.object({
			projectId: z.string().describe("The project ID to look up team members"),
			taskTitle: z.string().describe("Short title of the task"),
			taskDescription: z.string().describe("Detailed description of what needs to be done"),
			requiredSkills: z
				.array(z.string())
				.optional()
				.describe('Specific skills or technologies needed (e.g. ["react", "typescript", "testing"])'),
		}),
		execute: async ({ projectId, taskTitle, taskDescription, requiredSkills }) => {
			let candidates = await getProjectAgentsWithSkills(projectId);

			const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
				pm: ["project management", "planning", "coordination", "team leadership"],
				designer: [
					"ui design",
					"ux design",
					"wireframes",
					"prototypes",
					"design systems",
					"user research",
					"figma",
					"accessibility",
				],
				architect: [
					"system design",
					"api design",
					"database schema",
					"infrastructure",
					"architecture",
					"documentation",
				],
				frontend: [
					"react",
					"typescript",
					"css",
					"ui components",
					"responsive design",
					"accessibility",
					"tailwindcss",
					"javascript",
				],
				backend: [
					"api development",
					"database",
					"server logic",
					"authentication",
					"rest api",
					"node.js",
					"postgresql",
					"sql",
				],
				coder: ["general coding", "implementation", "algorithms", "full-stack", "typescript", "javascript", "python"],
				qa: [
					"testing",
					"test automation",
					"e2e tests",
					"quality assurance",
					"bug reporting",
					"unit tests",
					"integration tests",
				],
				reviewer: ["code review", "best practices", "security review", "standards", "performance", "refactoring"],
				devops: ["ci/cd", "deployment", "docker", "kubernetes", "infrastructure", "monitoring", "aws", "automation"],
			};

			if (candidates.length === 0) {
				candidates = Object.entries(DEFAULT_ROLE_SKILLS).map(([role, skills]) => ({
					id: role,
					name: role.charAt(0).toUpperCase() + role.slice(1),
					role,
					skills,
				}));
			}

			const assignableCandidates = candidates.filter((c) => c.role !== "pm");

			const taskText = `${taskTitle} ${taskDescription}`.toLowerCase();
			const explicitSkills = (requiredSkills ?? []).map((s) => s.toLowerCase());

			const scored = assignableCandidates.map((agent) => {
				const agentSkills = agent.skills.map((s: string) => s.toLowerCase());

				let score = 0;
				const matchedSkills: string[] = [];
				const matchedReasons: string[] = [];

				// 1. Explicit required skills (high weight)
				for (const skill of explicitSkills) {
					for (const agentSkill of agentSkills) {
						if (agentSkill.includes(skill) || skill.includes(agentSkill)) {
							score += 25;
							if (!matchedSkills.includes(agentSkill)) {
								matchedSkills.push(agentSkill);
								matchedReasons.push(`Explicit skill match: "${skill}" ↔ "${agentSkill}"`);
							}
							break;
						}
					}
				}

				// 2. Task text vs agent skills (medium weight)
				for (const agentSkill of agentSkills) {
					if (taskText.includes(agentSkill)) {
						score += 15;
						if (!matchedSkills.includes(agentSkill)) {
							matchedSkills.push(agentSkill);
							matchedReasons.push(`Task mentions "${agentSkill}"`);
						}
					}
				}

				// 3. Role keyword in task text (low weight)
				if (taskText.includes(agent.role)) {
					score += 10;
					matchedReasons.push(`Task references role "${agent.role}"`);
				}

				// 4. Category→role keyword bonus
				const ROLE_KEYWORD_BONUS: Record<string, string[]> = {
					frontend: [
						"ui",
						"component",
						"page",
						"view",
						"form",
						"modal",
						"button",
						"layout",
						"css",
						"style",
						"react",
						"frontend",
						"client",
					],
					backend: [
						"api",
						"endpoint",
						"route",
						"controller",
						"service",
						"model",
						"database",
						"migration",
						"auth",
						"server",
						"backend",
					],
					architect: ["design", "schema", "architecture", "structure", "diagram", "contract", "spec", "interface"],
					qa: ["test", "testing", "spec", "coverage", "qa", "quality", "e2e", "unit", "integration", "bug"],
					reviewer: ["review", "audit", "check", "lint", "refactor", "standard", "best practice"],
					devops: ["deploy", "pipeline", "ci", "cd", "docker", "container", "infra", "monitor", "build"],
					designer: ["design", "wireframe", "mockup", "ux", "prototype", "figma", "style guide", "color", "font"],
					coder: ["algorithm", "utility", "helper", "script", "general", "implement"],
				};

				const bonusKeywords = ROLE_KEYWORD_BONUS[agent.role] ?? [];
				for (const kw of bonusKeywords) {
					if (taskText.includes(kw)) {
						score += 8;
						matchedReasons.push(`Keyword "${kw}" suggests ${agent.role} role`);
						break;
					}
				}

				const maxPossibleScore = explicitSkills.length * 25 + agentSkills.length * 15 + 10 + 8;
				const confidence = Math.min(100, Math.round((score / Math.max(maxPossibleScore, 30)) * 100));

				return {
					agentId: agent.id,
					agentName: agent.name,
					role: agent.role,
					confidence,
					matchedSkills,
					reasoning: matchedReasons.slice(0, 4),
					score,
				};
			});

			const topCandidates = scored
				.filter((c) => c.score > 0 || assignableCandidates.length <= 3)
				.sort((a, b) => b.score - a.score)
				.slice(0, 3);

			if (topCandidates.length === 0 && assignableCandidates.length > 0) {
				const fallback = scored.sort((a, b) => b.score - a.score)[0];
				topCandidates.push(fallback);
			}

			const best = topCandidates[0];

			return {
				taskTitle,
				recommendation: best
					? {
							agentId: best.agentId,
							agentName: best.agentName,
							role: best.role,
							confidence: best.confidence,
							matchedSkills: best.matchedSkills,
							reasoning: best.reasoning,
						}
					: null,
				alternatives: topCandidates.slice(1).map((c) => ({
					agentId: c.agentId,
					agentName: c.agentName,
					role: c.role,
					confidence: c.confidence,
					matchedSkills: c.matchedSkills,
				})),
				note: best
					? `Best match: ${best.agentName} (${best.role}) with ${best.confidence}% confidence.`
					: "No strong skill match found. Consider assigning to a coder or architect.",
			};
		},
	}),

	// v3.2: Work Item → Plan conversion tool
	convertWorkItemsToPlan: tool({
		description:
			"Convert backlog work items into planned tasks attached to the project's latest plan. Each work item becomes a task under a 'Backlog' phase with an agent/complexity picked from its type and priority.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID"),
			workItemIds: z.array(z.string()).describe("IDs of work items to convert into tasks"),
		}),
		execute: async ({ projectId, workItemIds }) => {
			const { planWorkItem } = await import("./work-item-planner.js");
			const planned: Array<{ workItemId: string; taskId: string; title: string }> = [];
			const failed: Array<{ workItemId: string; error: string }> = [];

			for (const itemId of workItemIds) {
				try {
					const result = await planWorkItem(itemId);
					planned.push({ workItemId: itemId, taskId: result.task.id, title: result.task.title });
				} catch (err) {
					failed.push({ workItemId: itemId, error: err instanceof Error ? err.message : String(err) });
				}
			}

			return {
				projectId,
				message: `${planned.length}/${workItemIds.length} work items converted to tasks.`,
				planned,
				failed,
			};
		},
	}),

	// v3.3: Incremental planning tools — mutate the live plan in-place
	addPhaseToPlan: tool({
		description:
			"Append a new phase (optionally with tasks) to the end of the live plan without creating a new plan version.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID"),
			phase: z
				.object({
					name: z.string().describe("Phase name"),
					dependsOnPhaseNames: z
						.array(z.string())
						.default([])
						.describe("Names of existing phases this new phase depends on"),
					tasks: z
						.array(
							z.object({
								title: z.string(),
								description: z.string(),
								assignedRole: z.string(),
								complexity: z.enum(["S", "M", "L", "XL"]),
								branch: z.string(),
								taskType: z.enum(["ai", "integration-test", "run-app"]).default("ai"),
								testExpectation: z.enum(["none", "optional", "required"]).default("required"),
								targetFiles: z.array(z.string()).default([]),
								estimatedLines: z.number().int().optional(),
								dependsOnTaskTitles: z.array(z.string()).default([]),
								requiresApproval: z.boolean().default(false),
								constraints: z.array(z.string()).default([]),
								successCriteria: z.array(z.string()).default([]),
							}),
						)
						.default([])
						.describe("Tasks to add to the new phase"),
				})
				.describe("The new phase definition"),
		}),
		execute: async ({ projectId, phase }) => {
			const plan = await getLatestPlan(projectId);
			if (!plan) throw new Error(`No plan found for project ${projectId}`);

			const dependsOnPhaseIds = (phase.dependsOnPhaseNames ?? [])
				.map((n) => plan.phases.find((p) => p.name === n)?.id)
				.filter((id): id is string => Boolean(id));

			const { phase: createdPhase } = await incAppendPhase(projectId, {
				name: phase.name,
				dependsOnPhaseIds,
			});

			const createdTasks: { id: string; title: string }[] = [];
			const titleToId = new Map<string, string>();

			for (const t of phase.tasks ?? []) {
				const dependsOnTaskIds = (t.dependsOnTaskTitles ?? [])
					.map((title) => titleToId.get(title))
					.filter((id): id is string => Boolean(id));

				const created = await incAppendTask(projectId, createdPhase.id, {
					title: t.title,
					description: t.description,
					assignedRole: t.assignedRole,
					complexity: t.complexity as TaskComplexity,
					branch: t.branch,
					taskType: t.taskType,
					testExpectation: t.testExpectation,
					targetFiles: t.targetFiles,
					estimatedLines: t.estimatedLines,
					dependsOnTaskIds,
					requiresApproval: t.requiresApproval,
					goalDefinition:
						t.successCriteria && t.successCriteria.length > 0
							? {
									goal: t.title,
									constraints: t.constraints ?? [],
									successCriteria: t.successCriteria,
								}
							: undefined,
				});
				createdTasks.push({ id: created.id, title: created.title });
				titleToId.set(t.title, created.id);
			}

			return {
				message: `Phase "${createdPhase.name}" (order ${createdPhase.order}) added with ${createdTasks.length} task(s).`,
				phaseId: createdPhase.id,
				phaseOrder: createdPhase.order,
				createdTasks,
			};
		},
	}),

	addTaskToPhase: tool({
		description: "Append a new task to an existing phase of the live plan.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID"),
			phaseName: z.string().describe("Name of the target phase"),
			task: z.object({
				title: z.string(),
				description: z.string(),
				assignedRole: z.string(),
				complexity: z.enum(["S", "M", "L", "XL"]),
				branch: z.string(),
				taskType: z.enum(["ai", "integration-test", "run-app"]).default("ai"),
				testExpectation: z.enum(["none", "optional", "required"]).default("required"),
				targetFiles: z.array(z.string()).default([]),
				estimatedLines: z.number().int().optional(),
				dependsOnTaskTitles: z.array(z.string()).default([]),
				requiresApproval: z.boolean().default(false),
				constraints: z.array(z.string()).default([]),
				successCriteria: z.array(z.string()).default([]),
			}),
		}),
		execute: async ({ projectId, phaseName, task }) => {
			const plan = await getLatestPlan(projectId);
			if (!plan) throw new Error(`No plan found for project ${projectId}`);

			const phase = plan.phases.find((p) => p.name === phaseName);
			if (!phase) throw new Error(`Phase "${phaseName}" not found in plan`);

			const dependsOnTaskIds = (task.dependsOnTaskTitles ?? [])
				.map((title) => phase.tasks.find((t) => t.title === title)?.id)
				.filter((id): id is string => Boolean(id));

			const created = await incAppendTask(projectId, phase.id, {
				title: task.title,
				description: task.description,
				assignedRole: task.assignedRole,
				complexity: task.complexity as TaskComplexity,
				branch: task.branch,
				taskType: task.taskType,
				testExpectation: task.testExpectation,
				targetFiles: task.targetFiles,
				estimatedLines: task.estimatedLines,
				dependsOnTaskIds,
				requiresApproval: task.requiresApproval,
				goalDefinition:
					task.successCriteria && task.successCriteria.length > 0
						? {
								goal: task.title,
								constraints: task.constraints ?? [],
								successCriteria: task.successCriteria,
							}
						: undefined,
			});

			return {
				message: `Task "${created.title}" added to phase "${phaseName}".`,
				taskId: created.id,
				phaseId: phase.id,
			};
		},
	}),

	replanUnfinishedTasks: tool({
		description:
			"Cancel all unfinished tasks (queued/assigned/failed) on the live plan while preserving completed work. Follow up with addPhaseToPlan / addTaskToPhase to lay down the replanned work.",
		inputSchema: z.object({
			projectId: z.string().describe("The project ID"),
			reason: z.string().describe("Why re-planning is needed"),
		}),
		execute: async ({ projectId, reason }) => {
			const result = await incReplan(projectId, reason);
			return {
				message: `Re-plan complete: ${result.cancelledCount} task(s) cancelled, ${result.keptCompletedCount} completed task(s) preserved.`,
				reason,
				...result,
				note: "Use addPhaseToPlan or addTaskToPhase to add the refreshed work.",
			};
		},
	}),
};

// Suppress unused import warning — log is available for future debugging in this module
void log;
