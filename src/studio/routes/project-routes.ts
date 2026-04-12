// ---------------------------------------------------------------------------
// Project Routes — Project CRUD, Chat (SSE), Plans, Execution
// ---------------------------------------------------------------------------

import { access, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createAgentFiles } from "../agent-files.js";
import { isClaudeCliAvailable, streamWithCLI } from "../cli-runtime.js";
import {
	buildPlan,
	estimatePlanCost,
	PM_SYSTEM_PROMPT,
} from "../pm-agent.js";
import { recordChatToMemory } from "../memory-bridge.js";
import { eventBus } from "../event-bus.js";
import { executionEngine } from "../execution-engine.js";
import { pipelineEngine } from "../pipeline-engine.js";
import { taskEngine } from "../task-engine.js";
import { gitManager } from "../git-manager.js";
import { initLintConfig } from "../lint-runner.js";
import {
	isSonarEnabled,
	initSonarConfig,
} from "../sonar-runner.js";
import { getProjectTemplate, listProjectTemplates, scaffoldFromTemplate } from "../project-templates.js";
import {
	copyAgentsToProject,
	createProject,
	deleteProject,
	getAgentConfig,
	getCustomTeamTemplate,
	getLatestPlan,
	getProject,
	getTeamTemplate,
	insertChatMessage,
	listAgentDependencies,
	listChatMessages,
	listProjectAgents,
	listProjects,
	listTeamTemplates,
	updatePlanStatus,
	updateProject,
} from "../db.js";

export const projectRoutes = new Hono();

// ---- Projects CRUD --------------------------------------------------------

projectRoutes.get("/projects", async (c) => {
	return c.json(await listProjects());
});

projectRoutes.post("/projects", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		techStack?: string[];
		teamTemplateId?: string;
	};
	const project = await createProject({
		name: body.name,
		description: body.description ?? "",
		techStack: body.techStack ?? [],
		repoPath: "",
	});

	// Proje oluşturulduktan sonra takım şablonundan agentları kopyala
	const templateId = body.teamTemplateId;
	if (templateId) {
		const presetTemplate = await getTeamTemplate(templateId);
		const customTemplate = !presetTemplate ? await getCustomTeamTemplate(templateId) : undefined;
		const roles = presetTemplate?.roles ?? customTemplate?.roles;
		if (roles) {
			const copiedAgents = await copyAgentsToProject(project.id, roles);
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
			const copiedAgents = await copyAgentsToProject(project.id, fullStack.roles);
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

	const templateId = body.teamTemplateId;
	if (templateId) {
		const template = await getTeamTemplate(templateId);
		if (template) {
			const copiedAgents = await copyAgentsToProject(project.id, template.roles);
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
			const copiedAgents = await copyAgentsToProject(project.id, fullStack.roles);
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
	const cliReady = await isClaudeCliAvailable();
	if (!cliReady) {
		return c.json(
			{
				error: "Claude CLI is not available. Install Claude Code CLI to use the Planner.",
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

	const body = (await c.req.json()) as { message: string };
	const userMessage = body.message;

	await insertChatMessage({ projectId, role: "user", content: userMessage });
	recordChatToMemory(projectId, project.name, "user", userMessage).catch(() => {});

	const history = await listChatMessages(projectId);

	const agents = await listProjectAgents(projectId);
	const deps = await listAgentDependencies(projectId);
	const reviewTargetIds = new Set(deps.filter((d) => d.type === "review").map((d) => d.toAgentId));
	const pmOrder = Math.min(...agents.map((a) => a.pipelineOrder ?? 99));
	const pmAgentIds = new Set(agents.filter((a) => (a.pipelineOrder ?? 99) === pmOrder).map((a) => a.id));

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

	const systemPrompt = `${PM_SYSTEM_PROMPT}

[Current Project Context]
Project ID: ${projectId}
Project Name: ${project.name}
Status: ${project.status}
Tech Stack: ${project.techStack.join(", ") || "Not decided yet"}
Description: ${project.description || "No description yet"}

[Your Team — ${agents.length} agents]
${teamInfo}

[Assignable Roles for Tasks]
Use ONLY these exact values for assignedRole: ${assignableRoles}
Every assignable agent MUST get at least one task.`;

	const conversationContext = history
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");

	const prompt = conversationContext
		? `Previous conversation:\n${conversationContext}\n\nUser: ${userMessage}`
		: userMessage;

	return streamSSE(c, async (stream) => {
		try {
			await new Promise<void>((resolveStream, rejectStream) => {
				const cancel = streamWithCLI(
					{
						repoPath: project.repoPath!,
						prompt,
						systemPrompt,
						model: "sonnet",
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
								const planMatch = fullText.match(/```plan-json\s*\n([\s\S]*?)\n```/);
								if (planMatch) {
									try {
										const planData = JSON.parse(planMatch[1]);
										if (planData.phases && Array.isArray(planData.phases)) {
											const oldPlan = await getLatestPlan(projectId);
											if (oldPlan && oldPlan.status === "draft") {
												await updatePlanStatus(oldPlan.id, "rejected");
											}
											await buildPlan(projectId, planData.phases);
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
			console.error("[Planner Error]", errorMsg);
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({ error: errorMsg }),
			});
		}
	});
});

projectRoutes.get("/projects/:id/chat/history", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await listChatMessages(projectId));
});

// ---- Plans ----------------------------------------------------------------

projectRoutes.get("/projects/:id/plan", async (c) => {
	const plan = await getLatestPlan(c.req.param("id"));
	if (!plan) return c.json({ error: "No plan found" }, 404);
	return c.json(plan);
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
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(executionEngine.getExecutionStatus(projectId));
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
	};

	const template = getProjectTemplate(body.templateId);
	if (!template) return c.json({ error: "Template not found" }, 400);

	const project = await createProject({
		name: body.name,
		description: body.description ?? template.description,
		techStack: template.techStack,
		repoPath: "",
	});

	const templates = await listTeamTemplates();
	const teamTpl = templates.find((t) => t.name === template.teamTemplate) ?? templates[0];
	if (teamTpl) {
		const copiedAgents = await copyAgentsToProject(project.id, teamTpl.roles);
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
