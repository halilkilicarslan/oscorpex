// ---------------------------------------------------------------------------
// Integration Routes — GitHub, API Explorer, Webhooks
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { discoverApi, loadCollection, saveCollection } from "../api-discovery.js";
import type { SavedRequest } from "../api-discovery.js";
import { getAppStatus } from "../app-runner.js";
import {
	type Webhook,
	createWebhook,
	deleteWebhook,
	getProject,
	getProjectSetting,
	getWebhook,
	listWebhooks,
	setProjectSetting,
	updateWebhook,
} from "../db.js";
import { GitHubIntegration } from "../github-integration.js";
import { decrypt, encrypt, isEncrypted } from "../secret-vault.js";
import { sendWebhookNotification } from "../webhook-sender.js";
import { createLogger } from "../logger.js";
const log = createLogger("integration-routes");

export const integrationRoutes = new Hono();

// ---------------------------------------------------------------------------
// GitHub Integration
// ---------------------------------------------------------------------------

integrationRoutes.post("/projects/:id/github/configure", async (c) => {
	const { id } = c.req.param();
	const project = await getProject(id);
	if (!project) return c.json({ error: "Not found" }, 404);

	const body = await c.req.json();
	const { token, autoPR } = body;

	if (token) {
		const encryptedToken = encrypt(token);
		await setProjectSetting(id, "github", "token", encryptedToken);
	}

	if (autoPR !== undefined) {
		await setProjectSetting(id, "github", "auto_pr", String(autoPR));
	}

	return c.json({ ok: true });
});

integrationRoutes.post("/projects/:id/github/create-pr", async (c) => {
	const { id } = c.req.param();
	const project = await getProject(id);
	if (!project) return c.json({ error: "Not found" }, 404);

	const tokenEncrypted = await getProjectSetting(id, "github", "token");
	if (!tokenEncrypted) return c.json({ error: "GitHub not configured" }, 400);

	const token = isEncrypted(tokenEncrypted) ? decrypt(tokenEncrypted) : tokenEncrypted;

	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);
	const repoInfo = GitHubIntegration.getRepoInfo(project.repoPath);
	if (!repoInfo) return c.json({ error: "Could not determine GitHub repo from remote" }, 400);

	const body = await c.req.json();
	const { head, base = "main", title, prBody } = body;

	if (!head || !title) return c.json({ error: "head and title are required" }, 400);

	const gh = new GitHubIntegration(token);
	const pr = await gh.createPR({
		owner: repoInfo.owner,
		repo: repoInfo.repo,
		head,
		base,
		title,
		body: prBody || "",
	});

	return c.json(pr);
});

integrationRoutes.get("/projects/:id/github/status", async (c) => {
	const { id } = c.req.param();
	const project = await getProject(id);
	if (!project) return c.json({ error: "Not found" }, 404);

	const tokenEncrypted = await getProjectSetting(id, "github", "token");
	const autoPR = await getProjectSetting(id, "github", "auto_pr");

	const repoInfo = project.repoPath ? GitHubIntegration.getRepoInfo(project.repoPath) : null;

	return c.json({
		configured: !!tokenEncrypted,
		autoPR: autoPR === "true",
		repo: repoInfo,
	});
});

// ---------------------------------------------------------------------------
// API Discovery & Collection
// ---------------------------------------------------------------------------

integrationRoutes.get("/projects/:id/api/discover", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const status = getAppStatus(projectId);
	const appUrl = status.running ? status.previewUrl || undefined : undefined;
	const result = await discoverApi(project.repoPath, appUrl);
	return c.json(result);
});

integrationRoutes.get("/projects/:id/api/collection", async (c) => {
	const projectId = c.req.param("id");
	const collection = await loadCollection(projectId);
	return c.json(collection);
});

integrationRoutes.post("/projects/:id/api/collection", async (c) => {
	const projectId = c.req.param("id");
	const body = await c.req.json<{ request: SavedRequest }>();
	const collection = await loadCollection(projectId);

	const idx = collection.requests.findIndex((r) => r.id === body.request.id);
	if (idx >= 0) {
		collection.requests[idx] = body.request;
	} else {
		collection.requests.push(body.request);
	}
	await saveCollection(collection);
	return c.json({ ok: true });
});

integrationRoutes.delete("/projects/:id/api/collection/:requestId", async (c) => {
	const projectId = c.req.param("id");
	const requestId = c.req.param("requestId");
	const collection = await loadCollection(projectId);
	collection.requests = collection.requests.filter((r) => r.id !== requestId);
	await saveCollection(collection);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

integrationRoutes.get("/projects/:id/webhooks", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await listWebhooks(projectId));
});

integrationRoutes.post("/projects/:id/webhooks", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		name?: string;
		url?: string;
		type?: string;
		events?: string[];
	};

	if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
	if (!body.url?.trim()) return c.json({ error: "url is required" }, 400);

	const url = body.url.trim();
	if (!url.startsWith("https://") && !url.startsWith("http://")) {
		return c.json({ error: "url must start with https:// (or http:// for local dev)" }, 400);
	}

	const validTypes: Webhook["type"][] = ["slack", "discord", "generic"];
	const type = (body.type ?? "generic") as Webhook["type"];
	if (!validTypes.includes(type)) {
		return c.json({ error: `type must be one of: ${validTypes.join(", ")}` }, 400);
	}

	const webhook = await createWebhook({
		projectId,
		name: body.name.trim(),
		url,
		type,
		events: Array.isArray(body.events) ? body.events : [],
	});

	return c.json(webhook, 201);
});

integrationRoutes.put("/projects/:id/webhooks/:webhookId", async (c) => {
	const projectId = c.req.param("id");
	const webhookId = c.req.param("webhookId");

	const existing = await getWebhook(webhookId);
	if (!existing || existing.projectId !== projectId) {
		return c.json({ error: "Webhook not found" }, 404);
	}

	const body = (await c.req.json()) as {
		name?: string;
		url?: string;
		type?: string;
		events?: string[];
		active?: boolean;
	};

	if (body.url !== undefined) {
		const url = body.url.trim();
		if (!url.startsWith("https://") && !url.startsWith("http://")) {
			return c.json({ error: "url must start with https:// (or http:// for local dev)" }, 400);
		}
	}

	const updated = await updateWebhook(webhookId, {
		name: body.name?.trim(),
		url: body.url?.trim(),
		type: body.type as Webhook["type"] | undefined,
		events: body.events,
		active: body.active,
	});

	return c.json(updated);
});

integrationRoutes.delete("/projects/:id/webhooks/:webhookId", async (c) => {
	const projectId = c.req.param("id");
	const webhookId = c.req.param("webhookId");

	const existing = await getWebhook(webhookId);
	if (!existing || existing.projectId !== projectId) {
		return c.json({ error: "Webhook not found" }, 404);
	}

	const ok = await deleteWebhook(webhookId);
	if (!ok) return c.json({ error: "Webhook could not be deleted" }, 500);
	return c.json({ success: true });
});

integrationRoutes.post("/projects/:id/webhooks/:webhookId/test", async (c) => {
	const projectId = c.req.param("id");
	const webhookId = c.req.param("webhookId");

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const webhook = await getWebhook(webhookId);
	if (!webhook || webhook.projectId !== projectId) {
		return c.json({ error: "Webhook not found" }, 404);
	}

	try {
		await sendWebhookNotification(projectId, "test", {
			message: "Bu bir test bildirimidir — Oscorpex",
			projectName: project.name,
			webhookName: webhook.name,
			webhookType: webhook.type,
		});
		return c.json({ success: true, message: "Test bildirimi gonderildi" });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Test bildirimi gonderilemedi";
		return c.json({ error: msg }, 500);
	}
});
