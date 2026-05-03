// ---------------------------------------------------------------------------
// Project Chat Routes — Planner Chat SSE + Chat History
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
	getIntakeQuestion as _getIntakeQuestion,
	createIntakeQuestions,
	getLatestPlan,
	getProject,
	getProjectSetting,
	getProjectSettingsMap,
	insertChatMessage,
	listAgentDependencies,
	listChatMessages,
	listIntakeQuestions,
	listProjectAgents,
	setProjectSettings,
	updatePlanStatus,
	updateProject,
} from "../db.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { recordChatToMemory } from "../memory-bridge.js";
import {
	type PlannerCLIProvider,
	type PlannerReasoningEffort,
	listPlannerCLIProviders,
	streamPlannerWithCLI,
} from "../planner-cli.js";
import { PM_SYSTEM_PROMPT, estimatePlanCost as _estimatePlanCost, buildPlan } from "../pm-agent.js";
import type { IntakeQuestionCategory } from "../types.js";
import { ensureProjectTeamInitialized } from "./team-init-guard.js";

const log = createLogger("project-chat-routes");

export const projectChatRoutes = new Hono();

function parseStoredStringList(value?: string): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.map((item) => String(item).trim()).filter(Boolean);
	} catch {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item).trim()).filter(Boolean);
}

// ---- Planner Chat (SSE streaming) -----------------------------------------

projectChatRoutes.post("/projects/:id/chat", async (c) => {
	const plannerProviders = await listPlannerCLIProviders();
	const availableProviders = plannerProviders.filter((provider) => provider.available);
	if (availableProviders.length === 0) {
		return c.json(
			{
				error:
					"No supported planner CLI is available. Install Claude CLI, Codex CLI, or Gemini CLI to use the Planner.",
			},
			503,
		);
	}

	const projectId = c.req.param("id");
	const mode = c.req.query("mode");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (mode !== "intake") {
		const teamGuard = await ensureProjectTeamInitialized(c, projectId);
		if (teamGuard) return teamGuard;
	}

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
	const selectedProvider =
		availableProviders.find((provider) => provider.id === body.provider)?.id ?? availableProviders[0].id;
	const selectedProviderInfo =
		availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0];
	const plannerModel =
		body.model && selectedProviderInfo.models.includes(body.model) ? body.model : selectedProviderInfo.defaultModel;
	const plannerEffort =
		body.effort && selectedProviderInfo.efforts.includes(body.effort)
			? body.effort
			: selectedProviderInfo.defaultEffort;

	await insertChatMessage({ projectId, role: "user", content: userMessage });
	recordChatToMemory(projectId, project.name, "user", userMessage).catch((err) =>
		log.warn("[project-chat-routes] Non-blocking operation failed:", err?.message ?? err),
	);

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
	const deps = mode === "intake" ? [] : await listAgentDependencies(projectId);
	const reviewTargetIds = new Set(deps.filter((d) => d.type === "review").map((d) => d.toAgentId));
	const plannerAgents = agents.filter((a) => a.role === "product-owner" || a.role === "pm");
	if (plannerAgents.length === 0 && mode !== "intake") {
		return c.json({ error: "Project has no planner agent configured." }, 400);
	}
	const pmAgentIds = new Set(plannerAgents.map((a) => a.id));
	const plannerAgent = plannerAgents[0] ?? { name: "PM Assistant", role: "product-owner", personality: "Friendly project manager", skills: [], systemPrompt: "" };

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
							...answeredIntake.map((q) => `- [${q.category}] Q: ${q.question}\n  A: ${q.answer ?? "(no answer)"}`),
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
}${
	mode === "intake"
		? "\n\n## INTAKE MODE\nYou are in intake/discovery mode. Your ONLY job is to understand the project through conversation. Do NOT create a plan yet. Do NOT use createProjectPlan tool. Ask questions, understand scope, and when ready output a scope-json block:\n```scope-json\n{\"problemStatement\": \"...\", \"goals\": [\"...\"], \"features\": [\"...\"], \"constraints\": [\"...\"], \"techPreferences\": [\"...\"]}\n```"
		: ""
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
													? q.options.map((o: unknown) => String(o).trim()).filter((o: string) => o.length > 0)
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
											log.info(`[Planner] Registered ${created.length} intake questions for project ${projectId}`);
										}
									} catch (parseErr) {
										log.error("[Planner] Failed to parse askuser-json:" + " " + String(parseErr));
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
											log.info(`[Planner] Plan created for project ${projectId} (${planData.phases.length} phases)`);
										}
									} catch (parseErr) {
										log.error("[Planner] Failed to parse plan-json:" + " " + String(parseErr));
									}
								}

								if (fullText) {
									await insertChatMessage({
										projectId,
										role: "assistant",
										content: fullText,
									});
									recordChatToMemory(projectId, project?.name, "assistant", fullText).catch((err) =>
										log.warn("[project-chat-routes] Non-blocking operation failed:", err?.message ?? err),
									);
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
			log.error(
				"[Planner Error] " +
					JSON.stringify({
						projectId,
						provider: selectedProvider,
						model: plannerModel,
						effort: plannerEffort ?? null,
						error: errorMsg,
					}),
			);
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({ error: errorMsg }),
			});
		}
	});
});

projectChatRoutes.get("/projects/:id/chat/history", async (c) => {
	try {
		const projectId = c.req.param("id");
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);
		return c.json(await listChatMessages(projectId));
	} catch (err) {
		log.error("[project-chat-routes] chat history failed:" + " " + String(err));
		return c.json({ error: "Failed to get chat history" }, 500);
	}
});
