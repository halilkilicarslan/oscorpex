// ---------------------------------------------------------------------------
// Project Plan Routes — Intake Questions, Scope, Team Recommendation, Plans
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { requirePermission } from "../auth/rbac.js";
import {
	answerIntakeQuestion,
	getIntakeQuestion,
	getLatestPlan,
	getProject,
	getProjectSettingsMap,
	listCustomTeamTemplates,
	listIntakeQuestions,
	listProjectAgents,
	listTeamTemplates,
	setProjectSettings,
	skipIntakeQuestion,
	updatePlanStatus,
} from "../db.js";
import { eventBus } from "../event-bus.js";
import { kernel } from "../kernel/index.js";
import { createLogger } from "../logger.js";
import { estimatePlanCost } from "../pm-agent.js";
import { ensureProjectTeamInitialized } from "./team-init-guard.js";

const log = createLogger("project-plan-routes");

export const projectPlanRoutes = new Hono();

type ScopeStatus = "draft" | "ready_for_review" | "approved" | "superseded";

interface ScopeContract {
	problemStatement: string;
	goals: string[];
	nonGoals: string[];
	constraints: string[];
	risks: string[];
	acceptanceCriteria: string[];
	validationPlan: string[];
	requiredCapabilities: string[];
	recommendedTeamRoles: string[];
	status: ScopeStatus;
	approvedAt?: string;
	approvedBy?: string;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item).trim()).filter(Boolean);
}

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

function readScopeContract(settingsMap: Record<string, Record<string, string>>): ScopeContract | null {
	const scope = settingsMap.scope;
	if (!scope) return null;
	const statusRaw = scope.status as ScopeStatus | undefined;
	const status: ScopeStatus =
		statusRaw === "ready_for_review" || statusRaw === "approved" || statusRaw === "superseded" ? statusRaw : "draft";
	return {
		problemStatement: scope.problemStatement ?? "",
		goals: parseStoredStringList(scope.goals),
		nonGoals: parseStoredStringList(scope.nonGoals),
		constraints: parseStoredStringList(scope.constraints),
		risks: parseStoredStringList(scope.risks),
		acceptanceCriteria: parseStoredStringList(scope.acceptanceCriteria),
		validationPlan: parseStoredStringList(scope.validationPlan),
		requiredCapabilities: parseStoredStringList(scope.requiredCapabilities),
		recommendedTeamRoles: parseStoredStringList(scope.recommendedTeamRoles),
		status,
		approvedAt: scope.approvedAt,
		approvedBy: scope.approvedBy,
	};
}

function toScopeSettingsPayload(scope: Partial<ScopeContract>): Record<string, string> {
	const payload: Record<string, string> = {};
	if (scope.problemStatement !== undefined) payload.problemStatement = scope.problemStatement;
	if (scope.goals !== undefined) payload.goals = JSON.stringify(scope.goals);
	if (scope.nonGoals !== undefined) payload.nonGoals = JSON.stringify(scope.nonGoals);
	if (scope.constraints !== undefined) payload.constraints = JSON.stringify(scope.constraints);
	if (scope.risks !== undefined) payload.risks = JSON.stringify(scope.risks);
	if (scope.acceptanceCriteria !== undefined) payload.acceptanceCriteria = JSON.stringify(scope.acceptanceCriteria);
	if (scope.validationPlan !== undefined) payload.validationPlan = JSON.stringify(scope.validationPlan);
	if (scope.requiredCapabilities !== undefined)
		payload.requiredCapabilities = JSON.stringify(scope.requiredCapabilities);
	if (scope.recommendedTeamRoles !== undefined)
		payload.recommendedTeamRoles = JSON.stringify(scope.recommendedTeamRoles);
	if (scope.status !== undefined) payload.status = scope.status;
	if (scope.approvedAt !== undefined) payload.approvedAt = scope.approvedAt;
	if (scope.approvedBy !== undefined) payload.approvedBy = scope.approvedBy;
	return payload;
}

// ---- Intake Questions (v3.0 B1 — Interactive Planner) --------------------

projectPlanRoutes.get("/projects/:id/intake-questions", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const status = c.req.query("status");
	const filter = status === "pending" || status === "answered" || status === "skipped" ? status : undefined;
	return c.json(await listIntakeQuestions(projectId, filter));
});

projectPlanRoutes.post("/projects/:id/intake-questions/:qid/answer", async (c) => {
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

projectPlanRoutes.post("/projects/:id/intake-questions/:qid/skip", async (c) => {
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

// ---- Scope ----------------------------------------------------------------

projectPlanRoutes.get("/projects/:id/scope", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	const settingsMap = await getProjectSettingsMap(projectId);
	const scope = readScopeContract(settingsMap);
	if (!scope) return c.json({ ok: true, data: null });
	return c.json({ ok: true, data: scope });
});

projectPlanRoutes.post("/projects/:id/scope/draft", requirePermission("projects:update"), async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	const body = (await c.req.json().catch(() => ({}))) as Partial<ScopeContract>;
	const settingsPayload = toScopeSettingsPayload({
		problemStatement: body.problemStatement ?? "",
		goals: normalizeStringList(body.goals),
		nonGoals: normalizeStringList(body.nonGoals),
		constraints: normalizeStringList(body.constraints),
		risks: normalizeStringList(body.risks),
		acceptanceCriteria: normalizeStringList(body.acceptanceCriteria),
		validationPlan: normalizeStringList(body.validationPlan),
		requiredCapabilities: normalizeStringList(body.requiredCapabilities),
		recommendedTeamRoles: normalizeStringList(body.recommendedTeamRoles),
		status: (body.status as ScopeStatus | undefined) ?? "draft",
	});
	await setProjectSettings(projectId, "scope", settingsPayload);
	const updated = readScopeContract(await getProjectSettingsMap(projectId));
	return c.json({ ok: true, data: updated });
});

projectPlanRoutes.post("/projects/:id/scope/approve", requirePermission("projects:update"), async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	const settingsMap = await getProjectSettingsMap(projectId);
	const existing = readScopeContract(settingsMap);
	if (!existing || !existing.problemStatement.trim()) {
		return c.json({ error: "scope draft is required before approval" }, 422);
	}
	const actor = (c as any).get("userId") as string | undefined;
	await setProjectSettings(
		projectId,
		"scope",
		toScopeSettingsPayload({
			status: "approved",
			approvedAt: new Date().toISOString(),
			approvedBy: actor ?? "system",
		}),
	);
	const updated = readScopeContract(await getProjectSettingsMap(projectId));
	return c.json({ ok: true, data: updated });
});

// ---- Team Recommendation --------------------------------------------------

projectPlanRoutes.post("/projects/:id/team/recommend", requirePermission("projects:update"), async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const settingsMap = await getProjectSettingsMap(projectId);
	const scope = readScopeContract(settingsMap);
	if (!scope || scope.status !== "approved") {
		return c.json({ error: "approved scope contract is required" }, 422);
	}

	const templates = await listTeamTemplates();
	const customTemplates = await listCustomTeamTemplates();
	const allTemplates = [
		...templates.map((t) => ({
			id: t.id,
			name: t.name,
			source: "preset" as const,
			roles: t.roles,
			description: t.description,
		})),
		...customTemplates.map((t) => ({
			id: t.id,
			name: t.name,
			source: "custom" as const,
			roles: t.roles,
			description: t.description,
		})),
	];

	const neededRoles = new Set(scope.recommendedTeamRoles);
	for (const capability of scope.requiredCapabilities) {
		const lower = capability.toLowerCase();
		if (lower.includes("frontend")) neededRoles.add("frontend-developer");
		if (lower.includes("backend")) neededRoles.add("backend-developer");
		if (lower.includes("database")) neededRoles.add("database-administrator");
		if (lower.includes("devops")) neededRoles.add("devops-engineer");
		if (lower.includes("qa") || lower.includes("test")) neededRoles.add("qa-expert");
	}
	if (neededRoles.size === 0) {
		neededRoles.add("fullstack-developer");
		neededRoles.add("product-manager");
	}

	const scored = allTemplates.map((tpl) => {
		const overlap = tpl.roles.filter((role) => neededRoles.has(role));
		return {
			template: tpl,
			score: overlap.length,
			overlapRoles: overlap,
		};
	});
	scored.sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name));
	const top = scored[0];

	if (!top || top.score === 0) {
		return c.json({
			ok: true,
			data: {
				decision: "need-more-info",
				reasoning: "Scope contract insufficient for a confident team recommendation.",
				requiredCapabilities: scope.requiredCapabilities,
				recommendedTeamRoles: scope.recommendedTeamRoles,
			},
		});
	}

	return c.json({
		ok: true,
		data: {
			decision: "recommend-existing",
			teamTemplateId: top.template.id,
			templateSource: top.template.source,
			templateName: top.template.name,
			reasoning: `Matched ${top.overlapRoles.length} scope roles/capabilities with template roles.`,
			matchedRoles: top.overlapRoles,
			requiredCapabilities: scope.requiredCapabilities,
			recommendedTeamRoles: scope.recommendedTeamRoles,
		},
	});
});

// ---- Plans ----------------------------------------------------------------

projectPlanRoutes.get("/projects/:id/plan", async (c) => {
	try {
		const plan = await getLatestPlan(c.req.param("id"));
		if (!plan) return c.json(null, 200);
		return c.json(plan);
	} catch (err) {
		log.error("[project-plan-routes] get plan failed:" + " " + String(err));
		return c.json({ error: "Failed to get plan" }, 500);
	}
});

projectPlanRoutes.post("/projects/:id/plan/approve", async (c) => {
	const projectId = c.req.param("id");

	const teamGuard = await ensureProjectTeamInitialized(c, projectId);
	if (teamGuard) return teamGuard;

	const plan = await getLatestPlan(projectId);
	if (!plan) return c.json({ error: "No plan found" }, 404);
	if (plan.status !== "draft") return c.json({ error: "Plan is not in draft status" }, 400);

	await updatePlanStatus(plan.id, "approved");

	eventBus.emit({
		projectId,
		type: "plan:approved",
		payload: { planId: plan.id },
	});

	kernel.startProjectExecution(projectId).catch((err) => {
		log.error("[kernel] startProjectExecution failed:" + " " + String(err));
	});

	let pipelineStarted = false;
	let pipelineWarning: string | undefined;

	try {
		const agents = await listProjectAgents(projectId);
		if (agents.length === 0) {
			pipelineWarning = "Projeye atanmış agent bulunamadı; pipeline stage koordinasyonu devre dışı.";
			log.warn(`[kernel] ${pipelineWarning} (proje=${projectId})`);
		} else {
			await kernel.startPipeline(projectId);
			pipelineStarted = true;
			log.info(`[kernel] Plan onayı ile pipeline otomatik başlatıldı (proje=${projectId})`);
		}
	} catch (err) {
		pipelineWarning = err instanceof Error ? err.message : String(err);
		log.error("[kernel] auto-start hatası (execution devam ediyor):" + " " + String(err));
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

projectPlanRoutes.post("/projects/:id/plan/reject", async (c) => {
	const plan = await getLatestPlan(c.req.param("id"));
	if (!plan) return c.json({ error: "No plan found" }, 404);
	if (plan.status !== "draft") return c.json({ error: "Plan is not in draft status" }, 400);

	const body = (await c.req.json()) as { feedback?: string };
	await updatePlanStatus(plan.id, "rejected");

	return c.json({ success: true, planId: plan.id, feedback: body.feedback });
});

// GET /projects/:id/plans/:planId/cost-estimate
projectPlanRoutes.get("/projects/:id/plans/:planId/cost-estimate", async (c) => {
	const projectId = c.req.param("id");
	const planId = c.req.param("planId");

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		const estimate = await estimatePlanCost(projectId, planId);
		return c.json(estimate);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Maliyet tahmini hesaplanamadı";
		return c.json({ error: message }, 500);
	}
});
