// ---------------------------------------------------------------------------
// Project Routes — Project CRUD, Chat (SSE), Plans, Execution
// ---------------------------------------------------------------------------

import { access, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createAgentFiles } from "../agent-files.js";
import {
	answerIntakeQuestion,
	copyAgentsToProject,
	createIntakeQuestions,
	createProject,
	deleteProject,
	getAgentConfig,
	getCustomTeamTemplate,
	getIntakeQuestion,
	getLatestPlan,
	getProject,
	getProjectSetting,
	getProjectSettingsMap,
	getTeamTemplate,
	insertChatMessage,
	listAgentDependencies,
	listChatMessages,
	listIntakeQuestions,
	listProjectAgents,
	listProjects,
	listTeamTemplates,
	query,
	queryOne,
	setProjectSettings,
	skipIntakeQuestion,
	updatePlanStatus,
	updateProject,
} from "../db.js";
import type { IntakeQuestionCategory } from "../types.js";
import { eventBus } from "../event-bus.js";
import { executionEngine } from "../execution-engine.js";
import { gitManager } from "../git-manager.js";
import { initLintConfig } from "../lint-runner.js";
import { recordChatToMemory } from "../memory-bridge.js";
import { pipelineEngine } from "../pipeline-engine.js";
import {
	listPlannerCLIProviders,
	streamPlannerWithCLI,
	type PlannerCLIProvider,
	type PlannerReasoningEffort,
} from "../planner-cli.js";
import { PM_SYSTEM_PROMPT, buildPlan, estimatePlanCost } from "../pm-agent.js";
import { getProjectTemplate, listProjectTemplates, scaffoldFromTemplate } from "../project-templates.js";
import { initSonarConfig, isSonarEnabled } from "../sonar-runner.js";
import { taskEngine } from "../task-engine.js";

export const projectRoutes = new Hono();

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item).trim()).filter(Boolean);
}

function parseStoredStringList(value?: string): string[] {
	if (!value) return [];
	try {
		return normalizeStringList(JSON.parse(value));
	} catch {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
}

async function saveProjectIntake(
	projectId: string,
	data: {
		previewEnabled?: boolean;
		projectType?: string;
		techPreference?: string[];
	},
): Promise<void> {
	await setProjectSettings(projectId, "runtime", {
		previewEnabled: data.previewEnabled === false ? "false" : "true",
	});

	const intakeEntries: Record<string, string> = {};
	if (data.projectType?.trim()) {
		intakeEntries.projectType = data.projectType.trim();
	}
	if (data.techPreference && data.techPreference.length > 0) {
		intakeEntries.techPreference = JSON.stringify(data.techPreference);
	}
	if (Object.keys(intakeEntries).length > 0) {
		await setProjectSettings(projectId, "intake", intakeEntries);
	}
}

// ---- Platform Overview Dashboard ------------------------------------------

projectRoutes.get("/platform/stats", async (c) => {
	try {
		const [projectStats, taskStats, costStats, recentProjects, recentTasks] = await Promise.all([
			queryOne<any>(`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE status = 'active' OR status = 'planning' OR status = 'executing') AS active,
					COUNT(*) FILTER (WHERE status = 'completed') AS completed,
					COUNT(*) FILTER (WHERE status = 'failed') AS failed
				FROM projects
			`),
			queryOne<any>(`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE status = 'done') AS done,
					COUNT(*) FILTER (WHERE status = 'running') AS running,
					COUNT(*) FILTER (WHERE status = 'failed') AS failed,
					COUNT(*) FILTER (WHERE status = 'queued' OR status = 'assigned') AS queued
				FROM tasks
			`),
			queryOne<any>(`
				SELECT
					COALESCE(SUM(cost_usd), 0) AS total_cost,
					COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) AS total_tokens,
					COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
					COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation,
					COUNT(DISTINCT agent_id) AS active_agents
				FROM token_usage
			`),
			query<any>(`
				SELECT id, name, status, description, created_at, updated_at
				FROM projects ORDER BY updated_at DESC LIMIT 5
			`),
			query<any>(`
				SELECT t.id, t.title, t.status, t.assigned_agent, t.complexity, t.completed_at, p.name AS project_name
				FROM tasks t
				JOIN phases ph ON ph.id = t.phase_id
				JOIN project_plans pp ON pp.id = ph.plan_id
				JOIN projects p ON p.id = pp.project_id
				WHERE t.status = 'done'
				ORDER BY t.completed_at DESC NULLS LAST LIMIT 8
			`),
		]);

		const totalTokens = Number(costStats?.total_tokens ?? 0);
		const cacheRead = Number(costStats?.cache_read ?? 0);
		const cacheRate = totalTokens > 0 ? cacheRead / totalTokens : 0;

		return c.json({
			projects: {
				total: Number(projectStats?.total ?? 0),
				active: Number(projectStats?.active ?? 0),
				completed: Number(projectStats?.completed ?? 0),
				failed: Number(projectStats?.failed ?? 0),
			},
			tasks: {
				total: Number(taskStats?.total ?? 0),
				done: Number(taskStats?.done ?? 0),
				running: Number(taskStats?.running ?? 0),
				failed: Number(taskStats?.failed ?? 0),
				queued: Number(taskStats?.queued ?? 0),
			},
			cost: {
				totalUsd: Math.round(Number(costStats?.total_cost ?? 0) * 100) / 100,
				totalTokens,
				cacheReadTokens: cacheRead,
				cacheCreationTokens: Number(costStats?.cache_creation ?? 0),
				cacheRate: Math.round(cacheRate * 1000) / 10,
				activeAgents: Number(costStats?.active_agents ?? 0),
			},
			recentProjects: recentProjects.map((r: any) => ({
				id: r.id,
				name: r.name,
				status: r.status,
				description: r.description,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			})),
			recentTasks: recentTasks.map((r: any) => ({
				id: r.id,
				title: r.title,
				status: r.status,
				assignedAgent: r.assigned_agent,
				complexity: r.complexity,
				completedAt: r.completed_at,
				projectName: r.project_name,
			})),
		});
	} catch (err) {
		console.error("[project-routes] platform stats failed:", err);
		return c.json({ error: "Failed to get platform stats" }, 500);
	}
});

// ---- Projects CRUD --------------------------------------------------------

projectRoutes.get("/projects", async (c) => {
	try {
		return c.json(await listProjects());
	} catch (err) {
		console.error("[project-routes] list projects failed:", err);
		return c.json({ error: "Failed to list projects" }, 500);
	}
});

projectRoutes.post("/projects", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		techStack?: string[];
		techPreference?: string[];
		projectType?: string;
		teamTemplateId?: string;
		plannerAgentId?: string;
		previewEnabled?: boolean;
	};
	const project = await createProject({
		name: body.name,
		description: body.description ?? "",
		techStack: body.techStack ?? [],
		repoPath: "",
	});
	await saveProjectIntake(project.id, {
		previewEnabled: body.previewEnabled,
		projectType: body.projectType,
		techPreference: normalizeStringList(body.techPreference),
	});

	// Proje oluşturulduktan sonra takım şablonundan agentları kopyala
	const templateId = body.teamTemplateId;
	if (templateId) {
		const presetTemplate = await getTeamTemplate(templateId);
		const customTemplate = !presetTemplate ? await getCustomTeamTemplate(templateId) : undefined;
		const roles = presetTemplate?.roles ?? customTemplate?.roles;
		if (roles) {
			const copiedAgents = await copyAgentsToProject(project.id, roles, {
				plannerSourceAgentId: body.plannerAgentId,
			});
			for (const agent of copiedAgents) {
				createAgentFiles(project.id, agent.name, {
					skills: agent.skills,
					systemPrompt: agent.systemPrompt,
					personality: agent.personality,
					role: agent.role,
					model: agent.model,
				}).catch((err) => console.error("Failed to create agent files:", err));
			}
		}
	} else {
		// Varsayılan: Full Stack Team
		const templates = await listTeamTemplates();
		const fullStack = templates.find((t) => t.name === "Full Stack Team");
		if (fullStack) {
			const copiedAgents = await copyAgentsToProject(project.id, fullStack.roles, {
				plannerSourceAgentId: body.plannerAgentId,
			});
			for (const agent of copiedAgents) {
				createAgentFiles(project.id, agent.name, {
					skills: agent.skills,
					systemPrompt: agent.systemPrompt,
					personality: agent.personality,
					role: agent.role,
					model: agent.model,
				}).catch((err) => console.error("Failed to create agent files:", err));
			}
		}
	}

	try {
		const repoPath = join(resolve(".voltagent/repos"), project.id);
		await mkdir(repoPath, { recursive: true });
		await gitManager.initRepo(repoPath);
		await gitManager.initDocs(repoPath);
		await initLintConfig(repoPath);
		if (await isSonarEnabled()) {
			await initSonarConfig(repoPath, `studio-${project.id}`, project.name);
		}
		await updateProject(project.id, { repoPath });
		return c.json({ ...project, repoPath }, 201);
	} catch {
		return c.json(project, 201);
	}
});

// POST /projects/import — import an existing local repository as a project
projectRoutes.post("/projects/import", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		repoPath: string;
		description?: string;
		techStack?: string[];
		teamTemplateId?: string;
		plannerAgentId?: string;
		previewEnabled?: boolean;
	};

	if (!body.repoPath) return c.json({ error: "repoPath is required" }, 400);

	try {
		await access(body.repoPath);
	} catch {
		return c.json({ error: `Path does not exist: ${body.repoPath}` }, 400);
	}

	let description = body.description ?? "";
	let techStack = body.techStack ?? [];
	try {
		const pkgRaw = await readFile(join(body.repoPath, "package.json"), "utf-8");
		const pkg = JSON.parse(pkgRaw);
		if (!description && pkg.description) description = pkg.description;
		if (techStack.length === 0) {
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			const known = [
				"react",
				"vue",
				"angular",
				"next",
				"express",
				"hono",
				"fastify",
				"nestjs",
				"typescript",
				"tailwindcss",
				"prisma",
				"drizzle",
			];
			techStack = known.filter((k) => deps[k] || deps[`@${k}/core`]);
		}
	} catch {
		// No package.json or parse error — fine
	}

	const project = await createProject({
		name: body.name,
		description,
		techStack,
		repoPath: body.repoPath,
	});
	await saveProjectIntake(project.id, {
		previewEnabled: body.previewEnabled,
	});

	const templateId = body.teamTemplateId;
	if (templateId) {
		const template = await getTeamTemplate(templateId);
		if (template) {
			const copiedAgents = await copyAgentsToProject(project.id, template.roles, {
				plannerSourceAgentId: body.plannerAgentId,
			});
			for (const agent of copiedAgents) {
				createAgentFiles(project.id, agent.name, {
					skills: agent.skills,
					systemPrompt: agent.systemPrompt,
					personality: agent.personality,
					role: agent.role,
					model: agent.model,
				}).catch((err) => console.error("Failed to create agent files:", err));
			}
		}
	} else {
		const templates = await listTeamTemplates();
		const fullStack = templates.find((t) => t.name === "Full Stack Team");
		if (fullStack) {
			const copiedAgents = await copyAgentsToProject(project.id, fullStack.roles, {
				plannerSourceAgentId: body.plannerAgentId,
			});
			for (const agent of copiedAgents) {
				createAgentFiles(project.id, agent.name, {
					skills: agent.skills,
					systemPrompt: agent.systemPrompt,
					personality: agent.personality,
					role: agent.role,
					model: agent.model,
				}).catch((err) => console.error("Failed to create agent files:", err));
			}
		}
	}

	try {
		await initLintConfig(body.repoPath);
		if (await isSonarEnabled()) {
			await initSonarConfig(body.repoPath, `studio-${project.id}`, project.name);
		}
	} catch {
		// Non-blocking
	}

	return c.json(project, 201);
});

projectRoutes.get("/projects/:id", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(project);
});

projectRoutes.patch("/projects/:id", async (c) => {
	const body = await c.req.json();
	const project = await updateProject(c.req.param("id"), body);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(project);
});

projectRoutes.delete("/projects/:id", async (c) => {
	const ok = await deleteProject(c.req.param("id"));
	if (!ok) return c.json({ error: "Project not found" }, 404);
	return c.json({ success: true });
});

// ---- Planner Chat (SSE streaming) -----------------------------------------

projectRoutes.post("/projects/:id/chat", async (c) => {
	const plannerProviders = await listPlannerCLIProviders();
	const availableProviders = plannerProviders.filter((provider) => provider.available);
	if (availableProviders.length === 0) {
		return c.json(
			{
				error: "No supported planner CLI is available. Install Claude CLI, Codex CLI, or Gemini CLI to use the Planner.",
			},
			503,
		);
	}

	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	if (!project.repoPath) {
		return c.json({ error: "Project has no repoPath configured." }, 400);
	}

	const body = (await c.req.json()) as {
		message: string;
		model?: string;
		provider?: PlannerCLIProvider;
		effort?: PlannerReasoningEffort;
	};
	const userMessage = body.message;
	const selectedProvider = availableProviders.find((provider) => provider.id === body.provider)?.id ?? availableProviders[0].id;
	const selectedProviderInfo =
		availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0];
	const plannerModel =
		body.model && selectedProviderInfo.models.includes(body.model)
			? body.model
			: selectedProviderInfo.defaultModel;
	const plannerEffort =
		body.effort && selectedProviderInfo.efforts.includes(body.effort)
			? body.effort
			: selectedProviderInfo.defaultEffort;

	await insertChatMessage({ projectId, role: "user", content: userMessage });
	recordChatToMemory(projectId, project.name, "user", userMessage).catch(() => {});

	const history = await listChatMessages(projectId);
	const settingsMap = await getProjectSettingsMap(projectId);
	const previewEnabled = (await getProjectSetting(projectId, "runtime", "previewEnabled")) !== "false";
	const intakeSettings = settingsMap.intake || {};
	const projectType = intakeSettings.projectType || "Not specified";
	const techPreference = parseStoredStringList(intakeSettings.techPreference);
	const resolvedTechStack = parseStoredStringList(intakeSettings.resolvedTechStack);
	const allIntakeQuestions = await listIntakeQuestions(projectId);
	const answeredIntake = allIntakeQuestions.filter((q) => q.status === "answered");
	const pendingIntake = allIntakeQuestions.filter((q) => q.status === "pending");

	const agents = await listProjectAgents(projectId);
	const deps = await listAgentDependencies(projectId);
	const reviewTargetIds = new Set(deps.filter((d) => d.type === "review").map((d) => d.toAgentId));
	const plannerAgents = agents.filter((a) => a.role === "product-owner" || a.role === "pm");
	if (plannerAgents.length === 0) {
		return c.json({ error: "Project has no planner agent configured." }, 400);
	}
	const pmAgentIds = new Set(plannerAgents.map((a) => a.id));
	const plannerAgent = plannerAgents[0];

	const teamInfo = agents
		.map((a) => {
			const isReviewer = reviewTargetIds.has(a.id);
			const isPM = pmAgentIds.has(a.id);
			const tag = isReviewer
				? " [AUTO-REVIEW — do not assign tasks]"
				: isPM
					? " [PM — planning only]"
					: " [ASSIGNABLE]";
			return `- **${a.name}** (role: "${a.role}")${tag} — ${a.personality}. Skills: ${a.skills.join(", ")}`;
		})
		.join("\n");

	const assignableRoles = agents
		.filter((a) => !reviewTargetIds.has(a.id) && !pmAgentIds.has(a.id))
		.map((a) => `"${a.role}"`)
		.join(", ");

	const plannerProfile = [
		`Name: ${plannerAgent.name}`,
		`Role: ${plannerAgent.role}`,
		`Personality: ${plannerAgent.personality || "Not specified"}`,
		`Skills: ${plannerAgent.skills.join(", ") || "Not specified"}`,
		plannerAgent.systemPrompt ? `Agent Guidance: ${plannerAgent.systemPrompt}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const systemPrompt = `${PM_SYSTEM_PROMPT}

[Planner Agent Profile]
Follow the selected planner agent profile below unless it conflicts with explicit planning rules.
${plannerProfile}

[Current Project Context]
Project ID: ${projectId}
Project Name: ${project.name}
Status: ${project.status}
Resolved Tech Stack: ${resolvedTechStack.join(", ") || project.techStack.join(", ") || "Not decided yet"}
Description: ${project.description || "No description yet"}
In-studio Preview Required: ${previewEnabled ? "yes" : "no"}

[User Intake]
Project Type Preference: ${projectType}
Technology Preference: ${techPreference.join(", ") || "Planner should recommend"}

[Runtime Expectations]
${
	previewEnabled
		? "Include a final run-app phase when a runnable application is expected."
		: "Do NOT include run-app tasks unless the user explicitly asks for an in-studio preview. Only use integration-test if runnable services are expected."
}

[Your Team — ${agents.length} agents]
${teamInfo}

[Assignable Roles for Tasks]
Use ONLY these exact values for assignedRole: ${assignableRoles}
Every assignable agent MUST get at least one task.

[Intake Q&A]
${
	answeredIntake.length === 0 && pendingIntake.length === 0
		? "No clarifying questions have been asked yet. If you need information, emit an askuser-json block (see system prompt)."
		: [
				...(answeredIntake.length > 0
					? [
							"Answered questions (settled — do NOT re-ask):",
							...answeredIntake.map(
								(q) => `- [${q.category}] Q: ${q.question}\n  A: ${q.answer ?? "(no answer)"}`,
							),
						]
					: []),
				...(pendingIntake.length > 0
					? [
							"",
							"Still-pending questions (user has not answered yet — do NOT produce a plan until resolved):",
							...pendingIntake.map((q) => `- [${q.category}] ${q.question}`),
						]
					: []),
			].join("\n")
}`;

	const conversationContext = history
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");

	const prompt = conversationContext
		? `Previous conversation:\n${conversationContext}\n\nUser: ${userMessage}`
		: userMessage;

	return streamSSE(c, async (stream) => {
		try {
			await new Promise<void>((resolveStream, rejectStream) => {
				const cancel = streamPlannerWithCLI(
					{
						repoPath: project.repoPath!,
						prompt,
						systemPrompt,
						provider: selectedProvider,
						model: plannerModel,
						effort: plannerEffort,
						timeoutMs: 120_000,
					},
					{
						onTextDelta: (text) => {
							stream
								.writeSSE({
									event: "text-delta",
									data: JSON.stringify({ text }),
								})
								.catch(() => {
									/* stream closed */
								});
						},
						onDone: async (fullText) => {
							try {
								// v3.0 B1: Detect askuser-json blocks and persist questions for the UI
								const askMatch = fullText.match(/```askuser-json\s*\n([\s\S]*?)\n```/);
								if (askMatch) {
									try {
										const askData = JSON.parse(askMatch[1]);
										const rawQuestions = Array.isArray(askData?.questions) ? askData.questions : [];
										const VALID_CATEGORIES: IntakeQuestionCategory[] = [
											"scope",
											"functional",
											"nonfunctional",
											"priority",
											"technical",
											"general",
										];
										const normalized = rawQuestions
											.map((q: any) => {
												if (!q || typeof q.question !== "string") return null;
												const text = q.question.trim();
												if (!text) return null;
												const rawCat = typeof q.category === "string" ? q.category.toLowerCase() : "general";
												const category: IntakeQuestionCategory = VALID_CATEGORIES.includes(
													rawCat as IntakeQuestionCategory,
												)
													? (rawCat as IntakeQuestionCategory)
													: "general";
												const options = Array.isArray(q.options)
													? q.options
															.map((o: unknown) => String(o).trim())
															.filter((o: string) => o.length > 0)
													: [];
												return { question: text, category, options };
											})
											.filter(Boolean) as Array<{
											question: string;
											category: IntakeQuestionCategory;
											options: string[];
										}>;
										if (normalized.length > 0) {
											const latestPlan = await getLatestPlan(projectId);
											const created = await createIntakeQuestions(
												projectId,
												normalized.map((q) => ({ ...q, planVersion: latestPlan?.version })),
											);
											eventBus.emit({
												projectId,
												type: "escalation:user",
												payload: {
													questions: created.map((q) => ({
														id: q.id,
														question: q.question,
														category: q.category,
														options: q.options,
													})),
												},
											});
											console.log(`[Planner] Registered ${created.length} intake questions for project ${projectId}`);
										}
									} catch (parseErr) {
										console.error("[Planner] Failed to parse askuser-json:", parseErr);
									}
								}

								const planMatch = fullText.match(/```plan-json\s*\n([\s\S]*?)\n```/);
								if (planMatch) {
									try {
										const planData = JSON.parse(planMatch[1]);
										if (planData.phases && Array.isArray(planData.phases)) {
											const oldPlan = await getLatestPlan(projectId);
											if (oldPlan && oldPlan.status === "draft") {
												await updatePlanStatus(oldPlan.id, "rejected");
											}
											const recommendedTechStack = normalizeStringList(planData.techStack);
											await buildPlan(projectId, planData.phases);
											if (recommendedTechStack.length > 0) {
												await updateProject(projectId, { techStack: recommendedTechStack });
												await setProjectSettings(projectId, "intake", {
													resolvedTechStack: JSON.stringify(recommendedTechStack),
												});
											}
											console.log(`[Planner] Plan created for project ${projectId} (${planData.phases.length} phases)`);
										}
									} catch (parseErr) {
										console.error("[Planner] Failed to parse plan-json:", parseErr);
									}
								}

								if (fullText) {
									await insertChatMessage({
										projectId,
										role: "assistant",
										content: fullText,
									});
									recordChatToMemory(projectId, project?.name, "assistant", fullText).catch(() => {});
								}

								await stream.writeSSE({
									event: "done",
									data: JSON.stringify({ message: "Stream completed" }),
								});
								resolveStream();
							} catch (err) {
								rejectStream(err);
							}
						},
						onError: (error) => {
							rejectStream(error);
						},
					},
				);

				stream.onAbort(() => {
					cancel();
				});
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : "Unknown error";
			console.error("[Planner Error]", {
				projectId,
				provider: selectedProvider,
				model: plannerModel,
				effort: plannerEffort ?? null,
				error: errorMsg,
			});
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({ error: errorMsg }),
			});
		}
	});
});

projectRoutes.get("/projects/:id/chat/history", async (c) => {
	try {
		const projectId = c.req.param("id");
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);
		return c.json(await listChatMessages(projectId));
	} catch (err) {
		console.error("[project-routes] chat history failed:", err);
		return c.json({ error: "Failed to get chat history" }, 500);
	}
});

// ---- Intake Questions (v3.0 B1 — Interactive Planner) --------------------

projectRoutes.get("/projects/:id/intake-questions", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const status = c.req.query("status");
	const filter = status === "pending" || status === "answered" || status === "skipped" ? status : undefined;
	return c.json(await listIntakeQuestions(projectId, filter));
});

projectRoutes.post("/projects/:id/intake-questions/:qid/answer", async (c) => {
	const projectId = c.req.param("id");
	const qid = c.req.param("qid");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const question = await getIntakeQuestion(qid);
	if (!question || question.projectId !== projectId) {
		return c.json({ error: "Question not found" }, 404);
	}

	const body = (await c.req.json().catch(() => ({}))) as { answer?: unknown };
	const answer = typeof body.answer === "string" ? body.answer.trim() : "";
	if (!answer) return c.json({ error: "Answer must be a non-empty string" }, 400);

	const updated = await answerIntakeQuestion(qid, answer);

	eventBus.emit({
		projectId,
		type: "escalation:user",
		payload: { answered: { id: qid, answer } },
	});

	return c.json(updated);
});

projectRoutes.post("/projects/:id/intake-questions/:qid/skip", async (c) => {
	const projectId = c.req.param("id");
	const qid = c.req.param("qid");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const question = await getIntakeQuestion(qid);
	if (!question || question.projectId !== projectId) {
		return c.json({ error: "Question not found" }, 404);
	}

	const updated = await skipIntakeQuestion(qid);
	return c.json(updated);
});

// ---- Plans ----------------------------------------------------------------

projectRoutes.get("/projects/:id/plan", async (c) => {
	try {
		const plan = await getLatestPlan(c.req.param("id"));
		if (!plan) return c.json({ error: "No plan found" }, 404);
		return c.json(plan);
	} catch (err) {
		console.error("[project-routes] get plan failed:", err);
		return c.json({ error: "Failed to get plan" }, 500);
	}
});

projectRoutes.post("/projects/:id/plan/approve", async (c) => {
	const projectId = c.req.param("id");
	const plan = await getLatestPlan(projectId);
	if (!plan) return c.json({ error: "No plan found" }, 404);
	if (plan.status !== "draft") return c.json({ error: "Plan is not in draft status" }, 400);

	await updatePlanStatus(plan.id, "approved");

	eventBus.emit({
		projectId,
		type: "plan:approved",
		payload: { planId: plan.id },
	});

	executionEngine.startProjectExecution(projectId).catch((err) => {
		console.error("[execution-engine] startProjectExecution failed:", err);
	});

	let pipelineStarted = false;
	let pipelineWarning: string | undefined;

	try {
		const agents = await listProjectAgents(projectId);
		if (agents.length === 0) {
			pipelineWarning = "Projeye atanmış agent bulunamadı; pipeline stage koordinasyonu devre dışı.";
			console.warn(`[pipeline-engine] ${pipelineWarning} (proje=${projectId})`);
		} else {
			pipelineEngine.startPipeline(projectId);
			pipelineStarted = true;
			console.log(`[pipeline-engine] Plan onayı ile pipeline otomatik başlatıldı (proje=${projectId})`);
		}
	} catch (err) {
		pipelineWarning = err instanceof Error ? err.message : String(err);
		console.error("[pipeline-engine] auto-start hatası (execution devam ediyor):", err);
	}

	return c.json({
		success: true,
		planId: plan.id,
		execution: { started: true },
		pipeline: {
			started: pipelineStarted,
			warning: pipelineWarning,
		},
	});
});

// Pipeline auto-start durumunu sorgula
projectRoutes.get("/projects/:id/pipeline/auto-start-status", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const plan = await getLatestPlan(projectId);
	const planApproved = plan?.status === "approved";

	const enriched = await pipelineEngine.getEnrichedPipelineStatus(projectId);
	const pipelineState = enriched.pipelineState;

	return c.json({
		projectId,
		planApproved,
		autoStartEnabled: true,
		pipeline: pipelineState
			? {
					status: pipelineState.status,
					currentStage: pipelineState.currentStage,
					totalStages: pipelineState.stages.length,
					startedAt: pipelineState.startedAt,
				}
			: null,
		effectiveStatus: enriched.derivedStatus,
		taskProgress: enriched.taskProgress.overall,
		warning: enriched.warning,
	});
});

projectRoutes.post("/projects/:id/plan/reject", async (c) => {
	const plan = await getLatestPlan(c.req.param("id"));
	if (!plan) return c.json({ error: "No plan found" }, 404);
	if (plan.status !== "draft") return c.json({ error: "Plan is not in draft status" }, 400);

	const body = (await c.req.json()) as { feedback?: string };
	await updatePlanStatus(plan.id, "rejected");

	return c.json({ success: true, planId: plan.id, feedback: body.feedback });
});

// GET /projects/:id/plans/:planId/cost-estimate
projectRoutes.get("/projects/:id/plans/:planId/cost-estimate", async (c) => {
	const projectId = c.req.param("id");
	const planId = c.req.param("planId");

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		const estimate = estimatePlanCost(projectId, planId);
		return c.json(estimate);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Maliyet tahmini hesaplanamadı";
		return c.json({ error: message }, 500);
	}
});

// ---- Execution ------------------------------------------------------------

projectRoutes.post("/projects/:id/execute", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	executionEngine.startProjectExecution(projectId).catch((err) => {
		console.error("[execution-engine] manual execute failed:", err);
	});

	return c.json({ success: true, message: "Execution started" });
});

projectRoutes.get("/projects/:id/execution/status", async (c) => {
	try {
		const projectId = c.req.param("id");
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);
		return c.json(executionEngine.getExecutionStatus(projectId));
	} catch (err) {
		console.error("[project-routes] execution status failed:", err);
		return c.json({ error: "Failed to get execution status" }, 500);
	}
});

projectRoutes.get("/projects/:id/progress", (c) => {
	return c.json(taskEngine.getProgress(c.req.param("id")));
});

// ---- Project Templates (scaffold) -----------------------------------------

projectRoutes.get("/project-templates", (c) => {
	return c.json(listProjectTemplates());
});

projectRoutes.get("/project-templates/:id", (c) => {
	const template = getProjectTemplate(c.req.param("id"));
	if (!template) return c.json({ error: "Template not found" }, 404);
	const { files: _f, ...rest } = template;
	return c.json({ ...rest, fileCount: Object.keys(template.files).length });
});

// POST /projects/from-template — create project + scaffold files
projectRoutes.post("/projects/from-template", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		templateId: string;
		description?: string;
		plannerAgentId?: string;
		previewEnabled?: boolean;
	};

	const template = getProjectTemplate(body.templateId);
	if (!template) return c.json({ error: "Template not found" }, 400);

	const project = await createProject({
		name: body.name,
		description: body.description ?? template.description,
		techStack: template.techStack,
		repoPath: "",
	});
	await saveProjectIntake(project.id, {
		previewEnabled: body.previewEnabled,
	});

	const templates = await listTeamTemplates();
	const teamTpl = templates.find((t) => t.name === template.teamTemplate) ?? templates[0];
	if (teamTpl) {
		const copiedAgents = await copyAgentsToProject(project.id, teamTpl.roles, {
			plannerSourceAgentId: body.plannerAgentId,
		});
		for (const agent of copiedAgents) {
			createAgentFiles(project.id, agent.name, {
				skills: agent.skills,
				systemPrompt: agent.systemPrompt,
				personality: agent.personality,
				role: agent.role,
				model: agent.model,
			}).catch((err) => console.error("Failed to create agent files:", err));
		}
	}

	try {
		const repoPath = join(resolve(".voltagent/repos"), project.id);
		await mkdir(repoPath, { recursive: true });
		await gitManager.initRepo(repoPath);

		const { filesCreated } = await scaffoldFromTemplate(repoPath, body.templateId);

		await gitManager.initDocs(repoPath);
		await initLintConfig(repoPath);

		if (filesCreated.length > 0) {
			try {
				await gitManager.commitFiles(repoPath, filesCreated, `chore: scaffold from ${template.name} template`);
			} catch {
				/* commit might fail if no changes */
			}
		}

		await updateProject(project.id, { repoPath });
		return c.json({ ...project, repoPath, filesCreated }, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Scaffold failed";
		return c.json({ ...project, error: msg }, 201);
	}
});

// ---- Event Stream (SSE) ---------------------------------------------------

projectRoutes.get("/projects/:id/events", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const { listEvents } = await import("../db.js");

	return streamSSE(c, async (stream) => {
		const recent = await listEvents(projectId, 20);
		for (const event of recent.reverse()) {
			await stream.writeSSE({
				event: event.type,
				data: JSON.stringify(event),
				id: event.id,
			});
		}

		const unsubscribe = eventBus.onProject(projectId, async (event) => {
			try {
				await stream.writeSSE({
					event: event.type,
					data: JSON.stringify(event),
					id: event.id,
				});
			} catch {
				unsubscribe();
			}
		});

		stream.onAbort(() => {
			unsubscribe();
		});
	});
});

// ---- Recent events (REST) -------------------------------------------------

projectRoutes.get("/projects/:id/events/recent", async (c) => {
	const { listEvents } = await import("../db.js");
	const limit = Number(c.req.query("limit") ?? 50);
	return c.json(await listEvents(c.req.param("id"), limit));
});
