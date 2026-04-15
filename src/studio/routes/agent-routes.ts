// ---------------------------------------------------------------------------
// Agent Routes — Agent Management, Runs, Messaging, Inbox
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { loadAgentLog } from "../agent-log-store.js";
import {
	getMessage as _getMessage,
	archiveMessage,
	broadcastToTeam,
	getInbox,
	getThread,
	getUnreadCount,
	listProjectMessages,
	markAsRead,
	notifyNextInPipeline,
	sendMessage,
} from "../agent-messaging.js";
import { agentRuntime } from "../agent-runtime.js";
import { chatWithAgent } from "../agent-chat.js";
import { AVATARS, FEMALE_AVATARS, MALE_AVATARS } from "../avatars.js";
import { containerManager } from "../container-manager.js";
import {
	createAgentConfig,
	deleteAgentConfig,
	getAgentConfig,
	getProject,
	listAgentConfigs,
	listAgentRuns,
	listChatMessages,
	listPresetAgents,
	listProjectAgents,
	listProjectTasks,
	updateAgentConfig,
} from "../db.js";

export const agentRoutes = new Hono();

// ---- Agent Configs --------------------------------------------------------

agentRoutes.get("/agents", async (c) => {
	return c.json(await listAgentConfigs());
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

agentRoutes.post("/agents", async (c) => {
	const body = await c.req.json();
	const agent = await createAgentConfig({ ...body, isPreset: false });
	return c.json(agent, 201);
});

agentRoutes.get("/agents/:id", async (c) => {
	const agent = await getAgentConfig(c.req.param("id"));
	if (!agent) return c.json({ error: "Agent not found" }, 404);
	return c.json(agent);
});

agentRoutes.put("/agents/:id", async (c) => {
	const body = await c.req.json();
	const agent = await updateAgentConfig(c.req.param("id"), body);
	if (!agent) return c.json({ error: "Agent not found" }, 404);
	return c.json(agent);
});

agentRoutes.delete("/agents/:id", async (c) => {
	const ok = await deleteAgentConfig(c.req.param("id"));
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

	const msg = sendMessage(
		projectId,
		body.fromAgentId,
		body.toAgentId,
		body.type as any,
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
	const status = c.req.query("status") as any;

	return c.json(await listProjectMessages(projectId, agentId, status));
});

// Takıma toplu yayın mesajı gönder
agentRoutes.post("/projects/:id/messages/broadcast", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		fromAgentId: string;
		subject: string;
		content: string;
		metadata?: Record<string, any>;
	};

	if (!body.fromAgentId || !body.subject || !body.content) {
		return c.json({ error: "fromAgentId, subject and content are required" }, 400);
	}

	const sent = await broadcastToTeam(projectId, body.fromAgentId, body.subject, body.content, body.metadata);
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

	const msg = markAsRead(c.req.param("messageId"));
	if (!msg) return c.json({ error: "Message not found" }, 404);

	return c.json(msg);
});

// Mesajı arşivle
agentRoutes.put("/projects/:id/messages/:messageId/archive", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const msg = archiveMessage(c.req.param("messageId"));
	if (!msg) return c.json({ error: "Message not found" }, 404);

	return c.json(msg);
});

// Ajanın gelen kutusunu getir
agentRoutes.get("/projects/:id/agents/:agentId/inbox", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);

	const status = c.req.query("status") as any;
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

// ---- Container / Runtime --------------------------------------------------

agentRoutes.post("/projects/:id/agents/:agentId/start", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	const project = await getProject(projectId);
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
			console.warn("[routes] Yerel süreç başlatılamadı, Docker deneniyor:", localErr);
		}
	}

	const agentConfig = await getAgentConfig(agentId);
	if (agentConfig) {
		try {
			const containerId = await containerManager.createContainer(agentConfig, project);
			return c.json({
				success: true,
				mode: "docker",
				containerId: containerId.slice(0, 12),
			});
		} catch (dockerErr) {
			const msg = dockerErr instanceof Error ? dockerErr.message : "Container başlatılamadı";
			return c.json({ error: msg }, 500);
		}
	}

	return c.json(
		{
			error: "Agent başlatılamadı: CLI aracı yapılandırılmamış ve Docker da mevcut değil",
		},
		500,
	);
});

agentRoutes.post("/projects/:id/agents/:agentId/stop", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	const record = agentRuntime.getAgentProcess(projectId, agentId);
	if (record?.process) {
		agentRuntime.stopAgent(projectId, agentId);
		return c.json({ success: true, mode: "local" });
	}

	try {
		await containerManager.stopContainer(projectId, agentId);
		return c.json({ success: true, mode: "docker" });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Durdurulamadı";
		return c.json({ error: msg }, 500);
	}
});

agentRoutes.get("/projects/:id/agents/:agentId/status", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	const localRecord = agentRuntime.getAgentProcess(projectId, agentId);
	if (localRecord) {
		const { process: _proc, ...safeRecord } = localRecord;
		return c.json({ mode: "local", ...safeRecord });
	}

	const dockerRuntime = containerManager.getRuntime(projectId, agentId);
	if (dockerRuntime) {
		return c.json({ mode: "docker", ...dockerRuntime });
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

	return c.json({ projectId, agentId, lines, total: lines.length });
});

agentRoutes.get("/projects/:id/agents/:agentId/stream", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");

	let readable = agentRuntime.streamAgentOutput(projectId, agentId);
	if (!readable) {
		const agent = (await listProjectAgents(projectId)).find((a) => a.id === agentId);
		if (agent) {
			agentRuntime.ensureVirtualProcess(projectId, agentId, agent.name);
			readable = agentRuntime.streamAgentOutput(projectId, agentId);
		}
	}

	if (!readable) {
		return c.json({ error: "Agent bulunamadı" }, 404);
	}

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
});

agentRoutes.get("/projects/:id/runtimes", (c) => {
	const projectId = c.req.param("id");

	const localProcesses = agentRuntime.listProjectProcesses(projectId).map((r) => {
		const { process: _proc, ...safe } = r;
		return { mode: "local", ...safe };
	});

	const dockerRuntimes = containerManager.getAllRuntimes(projectId).map((r) => ({
		mode: "docker",
		...r,
	}));

	return c.json([...localProcesses, ...dockerRuntimes]);
});

agentRoutes.get("/projects/:id/agents/:agentId/runs", async (c) => {
	const projectId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const limit = Number(c.req.query("limit") ?? 50);
	const runs = await listAgentRuns(projectId, agentId, limit);
	return c.json(runs);
});

agentRoutes.post("/projects/:id/agents/:agentId/exec", async (c) => {
	const body = (await c.req.json()) as { command: string[] };
	try {
		const result = await containerManager.execCommand(c.req.param("id"), c.req.param("agentId"), body.command);
		return c.json(result);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Exec failed";
		return c.json({ error: msg }, 500);
	}
});

agentRoutes.get("/docker/status", async (c) => {
	const available = await containerManager.isDockerAvailable();
	const hasImage = available ? await containerManager.hasCoderImage() : false;
	return c.json({ docker: available, coderImage: hasImage });
});

// ---- Agent Chat (v3.8) ----------------------------------------------------

agentRoutes.get("/projects/:id/agents/:agentId/chat", async (c) => {
	const projectId = c.req.param("id");
	const messages = await listChatMessages(projectId);
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
		console.error("[agent-routes] chat failed:", err);
		return c.json({ error: msg }, 500);
	}
});
