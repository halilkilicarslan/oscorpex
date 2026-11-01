// ---------------------------------------------------------------------------
// Agent Routes — Agent Management, Runs, Messaging, Inbox
// ---------------------------------------------------------------------------

import { type Context, Hono } from "hono";
import { chatWithAgent } from "../agent-chat.js";
import { loadAgentLog } from "../agent-log-store.js";
import {
	archiveMessage,
	broadcastToTeam,
	getAllUnreadCounts,
	getInbox,
	getThread,
	getUnreadCount,
	listProjectMessages,
	listProjectMessagesPaginated,
	markAsRead,
	notifyNextInPipeline,
	sendMessage,
} from "../agent-messaging.js";
import { agentRuntime } from "../agent-runtime.js";
import { callerTenantId, callerUserId, isPlatformAdminRequest } from "../auth/request-identity.js";
import { AVATARS, FEMALE_AVATARS, MALE_AVATARS } from "../avatars.js";
import {
	createAgentConfig,
	deleteAgentConfig,
	getAgentConfig,
	getProject,
	getProjectForTenant,
	getVisibleAgentConfig,
	listAgentRuns,
	listChatMessages,
	listPresetAgents,
	listProjectAgents,
	listProjectTasks,
	listVisibleAgentConfigs,
	updateAgentConfig,
} from "../db.js";
import { createLogger } from "../logger.js";
import type { MessageStatus, MessageType } from "../types.js";
import { CreateAgentSchema, UpdateAgentConfigSchema, parseBody } from "./validation-schemas.js";
const log = createLogger("agent-routes");

function matchesTaskFilter(line: string, taskId?: string): boolean {
	if (!taskId) return true;
	const shortId = taskId.slice(0, 8);
	const normalized = line.trimStart();
	return normalized.startsWith(`[task:${shortId}]`) || normalized.includes(taskId);
}

export const agentRoutes = new Hono();

// ---- Agent Configs --------------------------------------------------------

/** Presets + the caller's own configs (tenant AND creator); platform admins see everything. */
const agentViewer = (c: Context) => ({
	tenantId: callerTenantId(c),
	userId: callerUserId(c),
	isPlatformAdmin: isPlatformAdminRequest(c),
});

agentRoutes.get("/agents", async (c) => {
	return c.json(await listVisibleAgentConfigs(agentViewer(c)));
});

agentRoutes.get("/agents/presets", async (c) => {
	return c.json(await listPresetAgents());
});

// Avatar listesi — gender'a göre filtrelenebilir
agentRoutes.get("/avatars", (c) => {
	const gender = c.req.query("gender");
	if (gender === "female") return c.json(FEMALE_AVATARS);
	if (gender === "male") return c.json(MALE_AVATARS);
	return c.json(AVATARS);
});

/** A non-admin may not even mention isPreset (any value), so the check runs on the raw body before validation. */
function mentionsPreset(body: unknown): boolean {
	return typeof body === "object" && body !== null && Object.hasOwn(body, "isPreset");
}

agentRoutes.post("/agents", async (c) => {
	const rawBody = await c.req.json().catch(() => undefined);
	if (mentionsPreset(rawBody) && !isPlatformAdminRequest(c)) {
		return c.json({ error: "Only platform admins can create preset agents" }, 403);
	}
	// P1-6: Validate with Zod — rejects unknown fields (strict mode) and enforces size limits
	const parsed = parseBody(CreateAgentSchema, rawBody);
	if (!parsed.success) return c.json({ error: parsed.error }, 400);
	const wantsPreset = parsed.data.isPreset === true;
	// P1-6: Only pass validated data — prevents mass assignment of tenant_id, etc.
	// biome-ignore lint/suspicious/noExplicitAny: createAgentConfig accepts flexible Omit<AgentConfig,"id">
	const agent = await createAgentConfig({ ...parsed.data, isPreset: wantsPreset } as any, callerUserId(c));
	return c.json(agent, 201);
});

agentRoutes.get("/agents/:id", async (c) => {
	const agent = await getVisibleAgentConfig(c.req.param("id"), agentViewer(c));
	if (!agent) return c.json({ error: "Agent not found" }, 404);
	return c.json(agent);
});

/**
 * Presets are platform data (admin only). Any other config may be changed only by its creator (or a platform
 * admin); everybody else gets a 404 so existence is not revealed.
 */
async function authorizeConfigWrite(c: Context, id: string): Promise<Response | undefined> {
	const existing = await getAgentConfig(id);
	if (!existing) return c.json({ error: "Agent not found" }, 404);
	if (isPlatformAdminRequest(c)) return undefined;
	if (existing.isPreset) return c.json({ error: "Only platform admins can modify preset agents" }, 403);
	// Ownership is (tenant_id, created_by): the same user id in another tenant gets a 404 as well.
	if (!(await getVisibleAgentConfig(id, agentViewer(c)))) return c.json({ error: "Agent not found" }, 404);
	return undefined;
}

agentRoutes.put("/agents/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => undefined);
	if (mentionsPreset(body) && !isPlatformAdminRequest(c)) {
		return c.json({ error: "Only platform admins can modify preset agents" }, 403);
	}
	const denied = await authorizeConfigWrite(c, id);
	if (denied) return denied;
	const parsed = parseBody(UpdateAgentConfigSchema, body);
	if (!parsed.success) return c.json({ error: parsed.error }, 400);
	// biome-ignore lint/suspicious/noExplicitAny: validated partial of AgentConfig (capabilities is ignored by the repo)
	const agent = await updateAgentConfig(id, parsed.data as any);
	if (!agent) return c.json({ error: "Agent not found" }, 404);
	return c.json(agent);
});

agentRoutes.delete("/agents/:id", async (c) => {
	const id = c.req.param("id");
	const denied = await authorizeConfigWrite(c, id);
	if (denied) return denied;
	const ok = await deleteAgentConfig(id);
	if (!ok) return c.json({ error: "Agent not found or is a preset" }, 404);
	return c.json({ success: true });
});

// ---- Agent Messaging -------------------------------------------------------

// Projeye yeni mesaj gönder
agentRoutes.post("/projects/:id/messages", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		fromAgentId: string;
		toAgentId: string;
		type: string;
		subject: string;
		content: string;
		metadata?: Record<string, any>;
		parentMessageId?: string;
	};

	if (!body.fromAgentId || !body.toAgentId || !body.type || !body.subject || !body.content) {
		return c.json(
			{
				error: "fromAgentId, toAgentId, type, subject and content are required",
			},
			400,
		);
	}

	const msg = await sendMessage(
		projectId,
		body.fromAgentId,
		body.toAgentId,
		body.type as MessageType,
		body.subject,
		body.content,
		body.metadata,
		body.parentMessageId,
	);

	return c.json(msg, 201);
});

// Projedeki tüm mesajları listele
agentRoutes.get("/projects/:id/messages", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const agentId = c.req.query("agentId");
	const status = c.req.query("status") as MessageStatus | undefined;
	const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
	const offset = Number(c.req.query("offset") ?? 0);

	const [messages, total] = await listProjectMessagesPaginated(projectId, agentId, status, limit, offset);
	c.header("X-Total-Count", String(total));
	return c.json(messages);
});

// Takıma toplu yayın mesajı gönder
agentRoutes.post("/projects/:id/messages/broadcast", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		fromAgentId: string;
		type?: string;
		subject: string;
		content: string;
		metadata?: Record<string, any>;
	};

	if (!body.fromAgentId || !body.subject || !body.content) {
		return c.json({ error: "fromAgentId, subject and content are required" }, 400);
	}

	const sent = await broadcastToTeam(
		projectId,
		body.fromAgentId,
		body.subject,
		body.content,
		body.metadata,
		body.type as MessageType | undefined,
	);
	return c.json({ sent: sent.length, messages: sent }, 201);
});

// Pipeline'daki bir sonraki aşamayı bilgilendir
agentRoutes.post("/projects/:id/messages/pipeline-notify", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		fromAgentId: string;
		taskId: string;
		message: string;
	};

	if (!body.fromAgentId || !body.taskId || !body.message) {
		return c.json({ error: "fromAgentId, taskId and message are required" }, 400);
	}

	const sent = await notifyNextInPipeline(projectId, body.fromAgentId, body.taskId, body.message);

	if (sent.length === 0) {
		return c.json({ error: "No next pipeline stage found or agent not found" }, 404);
	}

	return c.json({ sent: sent.length, messages: sent }, 201);
});

// Belirli bir mesajın thread zincirini getir
agentRoutes.get("/projects/:id/messages/:messageId/thread", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const thread = await getThread(c.req.param("messageId"));
	if (thread.length === 0) return c.json({ error: "Message not found" }, 404);

	return c.json(thread);
});

// Mesajı okundu olarak işaretle
agentRoutes.put("/projects/:id/messages/:messageId/read", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const msg = await markAsRead(c.req.param("messageId"));
	if (!msg) return c.json({ error: "Message not found" }, 404);

	return c.json(msg);
});

// Mesajı arşivle
agentRoutes.put("/projects/:id/messages/:messageId/archive", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const msg = await archiveMessage(c.req.param("messageId"));
	if (!msg) return c.json({ error: "Message not found" }, 404);

	return c.json(msg);
});

// Tüm ajanların okunmamış mesaj sayılarını tek istekte getir (batch)
agentRoutes.get("/projects/:id/agents/unread-counts", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const counts = await getAllUnreadCounts(c.req.param("id"));
	return c.json(counts);
});

// Ajanın gelen kutusunu getir
agentRoutes.get("/projects/:id/agents/:agentId/inbox", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const status = c.req.query("status") as MessageStatus | undefined;
	const messages = getInbox(c.req.param("id"), c.req.param("agentId"), status);

	return c.json(messages);
});

// Ajanın okunmamış mesaj sayısını getir
agentRoutes.get("/projects/:id/agents/:agentId/inbox/count", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const count = getUnreadCount(c.req.param("id"), c.req.param("agentId"));
	return c.json({ agentId: c.req.param("agentId"), unreadCount: count });
});

// ---- Runtime --------------------------------------------------

agentRoutes.post("/projects/:id/agents/:agentId/start", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	// Explicit tenant check (superuser mode bypasses RLS): another tenant's project is a 404.
	const callerTenant = callerTenantId(c);
	const project = callerTenant ? await getProjectForTenant(projectId, callerTenant) : undefined;
	if (!project) return c.json({ error: "Proje bulunamadı" }, 404);

	const { getProjectAgent } = await import("../db.js");
	const projectAgent = await getProjectAgent(agentId);
	if (!projectAgent || projectAgent.projectId !== projectId) {
		return c.json({ error: "Agent bulunamadı" }, 404);
	}

	const body = (await c.req.json().catch(() => ({}))) as {
		taskPrompt?: string;
	};

	if (projectAgent.cliTool && projectAgent.cliTool !== "none") {
		try {
			const record = await agentRuntime.startAgent(
				projectId,
				{
					id: projectAgent.id,
					name: projectAgent.name,
					cliTool: projectAgent.cliTool,
					systemPrompt: projectAgent.systemPrompt,
				},
				body.taskPrompt,
			);
			return c.json({
				success: true,
				mode: "local",
				agentId: record.agentId,
				pid: record.pid,
				status: record.status,
				cliTool: record.cliTool,
			});
		} catch (localErr) {
			const msg = localErr instanceof Error ? localErr.message : "Agent başlatılamadı";
			log.warn(`[routes] Yerel süreç başlatılamadı: ${String(localErr)}`);
			return c.json({ error: msg }, 500);
		}
	}

	return c.json({ error: "Agent başlatılamadı: CLI aracı yapılandırılmamış" }, 409);
});

agentRoutes.post("/projects/:id/agents/:agentId/stop", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	const record = agentRuntime.getAgentProcess(projectId, agentId);
	if (record?.process) {
		agentRuntime.stopAgent(projectId, agentId);
		return c.json({ success: true, mode: "local" });
	}

	return c.json({ error: "Çalışan süreç bulunamadı" }, 404);
});

agentRoutes.get("/projects/:id/agents/:agentId/status", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	const localRecord = agentRuntime.getAgentProcess(projectId, agentId);
	if (localRecord) {
		const { process: _proc, ...safeRecord } = localRecord;
		return c.json({ mode: "local", ...safeRecord });
	}

	const agent = (await listProjectAgents(projectId)).find((a) => a.id === agentId);
	if (agent) {
		return c.json({
			mode: "virtual",
			status: "idle",
			agentId,
			agentName: agent.name,
		});
	}

	return c.json({ error: "Çalışan süreç bulunamadı" }, 404);
});

agentRoutes.get("/projects/:id/agents/:agentId/output", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const sinceParam = c.req.query("since");
	const taskId = c.req.query("taskId");
	const since = sinceParam !== undefined ? Number.parseInt(sinceParam, 10) : undefined;

	let lines = agentRuntime.getAgentOutput(projectId, agentId, since);

	if (lines.length === 0 && (since === undefined || since === 0)) {
		lines = await loadAgentLog(projectId, agentId);
		if (lines.length === 0) {
			try {
				const tasks = await listProjectTasks(projectId);
				const agentTasks = tasks.filter((t) => t.assignedAgent === agentId || t.assignedAgentId === agentId);
				for (const t of agentTasks) {
					if (t.output?.logs && t.output.logs.length > 0) {
						lines.push(`--- ${t.title} ---`);
						lines.push(...t.output.logs);
					}
				}
			} catch {
				/* sessizce devam */
			}
		}
	}

	const filteredLines = taskId ? lines.filter((line) => matchesTaskFilter(line, taskId)) : lines;
	return c.json({ projectId, agentId, taskId: taskId ?? null, lines: filteredLines, total: filteredLines.length });
});

agentRoutes.get("/projects/:id/agents/:agentId/stream", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const taskId = c.req.query("taskId");

	let readable = agentRuntime.streamAgentOutput(projectId, agentId);
	if (!readable) {
		const agent = (await listProjectAgents(projectId)).find((a) => a.id === agentId);
		if (!agent) return c.json({ error: "Agent bulunamadı" }, 404);
		agentRuntime.ensureVirtualProcess(projectId, agentId, agent.name);
		readable = agentRuntime.streamAgentOutput(projectId, agentId);
	}

	if (!readable) {
		return c.json({ error: "Agent bulunamadı" }, 404);
	}

	if (!taskId) {
		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
				"x-correlation-id": c.req.header("x-correlation-id") ?? "",
			},
		});
	}

	let buffer = "";
	const filteredReadable = new ReadableStream<string>({
		async start(controller) {
			const reader = readable.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += typeof value === "string" ? value : new TextDecoder().decode(value);
					const chunks = buffer.split("\n");
					buffer = chunks.pop() ?? "";

					for (const chunk of chunks) {
						const line = chunk.trim();
						if (!line.startsWith("data: ")) continue;
						const payload = line.slice(6);
						if (!payload || payload === "[DONE]") continue;
						try {
							const parsed = JSON.parse(payload) as { line?: string; index?: number };
							if (typeof parsed.line !== "string" || typeof parsed.index !== "number") continue;
							if (!matchesTaskFilter(parsed.line, taskId)) continue;
							controller.enqueue(`data: ${JSON.stringify(parsed)}\n\n`);
						} catch {
							// Ignore malformed stream rows
						}
					}
				}
			} finally {
				reader.releaseLock();
				controller.close();
			}
		},
	});

	return new Response(filteredReadable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
			"x-correlation-id": c.req.header("x-correlation-id") ?? "",
		},
	});
});

agentRoutes.get("/projects/:id/runtimes", (c) => {
	const projectId = c.req.param("id");

	const localProcesses = agentRuntime.listProjectProcesses(projectId).map((r) => {
		const { process: _proc, ...safe } = r;
		return { mode: "local", ...safe };
	});

	return c.json(localProcesses);
});

agentRoutes.get("/projects/:id/agents/:agentId/runs", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const limit = Number(c.req.query("limit") ?? 50);
	const runs = await listAgentRuns(projectId, agentId, limit);
	return c.json(runs);
});

// The Docker coder-agent runtime was removed (I0); kept as a static answer for older consoles.
agentRoutes.get("/docker/status", (c) => {
	return c.json({ docker: false, coderImage: false });
});

// ---- Agent Chat (v3.8) ----------------------------------------------------

agentRoutes.get("/projects/:id/agents/:agentId/chat", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const messages = await listChatMessages(projectId, agentId);
	return c.json({ messages });
});

agentRoutes.post("/projects/:id/agents/:agentId/chat", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const body = (await c.req.json().catch(() => ({}))) as { message?: string };
	const message = typeof body?.message === "string" ? body.message.trim() : "";

	if (!message) {
		return c.json({ error: "message is required" }, 400);
	}

	try {
		const reply = await chatWithAgent(projectId, agentId, message);
		return c.json({ reply });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found") || msg.includes("does not belong")) {
			return c.json({ error: msg }, 404);
		}
		log.error(`[agent-routes] chat failed: ${String(err)}`);
		return c.json({ error: msg }, 500);
	}
});
