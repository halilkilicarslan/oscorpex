// ---------------------------------------------------------------------------
// Runtime Routes — App Runner, Preview Proxy, Runtime Config
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { join } from "node:path";
import { Hono } from "hono";
import { getAppStatus, getResolvedConfig, startApp, stopApp, switchPreviewService } from "../app-runner.js";
import { containerPool } from "../container-pool.js";
import { getDbStatus, parseCloudUrl, provisionDatabase, stopAllDatabases, stopDatabase } from "../db-provisioner.js";
import type { DbProvisionMethod } from "../db-provisioner.js";
import { getProject } from "../db.js";
import { eventBus } from "../event-bus.js";
import { analyzeProject, writeEnvFile } from "../runtime-analyzer.js";
import type { DatabaseType } from "../runtime-analyzer.js";
import { ensureProjectTeamInitialized } from "./team-init-guard.js";
import { createLogger } from "../logger.js";
const log = createLogger("runtime-routes");

export const runtimeRoutes = new Hono();

// ---- Container Pool -------------------------------------------------------

runtimeRoutes.get("/pool/status", (c) => {
	const status = containerPool.getStatus();
	return c.json(status);
});

// ---- App Runner -----------------------------------------------------------

runtimeRoutes.post("/projects/:id/app/start", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	const teamGuard = await ensureProjectTeamInitialized(c, projectId);
	if (teamGuard) return teamGuard;

	try {
		const result = await startApp(projectId, project.repoPath, (msg) => {
			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				payload: { output: msg },
			});
		});
		return c.json({ ok: true, ...result });
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : "App başlatılamadı" }, 500);
	}
});

runtimeRoutes.post("/projects/:id/app/stop", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	await stopApp(projectId);
	return c.json({ ok: true });
});

runtimeRoutes.get("/projects/:id/app/status", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	return c.json(getAppStatus(projectId));
});

runtimeRoutes.get("/projects/:id/app/config", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const config = getResolvedConfig(project.repoPath);
	return c.json(config ?? { services: [], preview: "" });
});

runtimeRoutes.post("/projects/:id/app/switch-preview", async (c) => {
	const projectId = c.req.param("id");
	const { service } = await c.req.json();
	const ok = switchPreviewService(projectId, service);
	if (!ok) return c.json({ error: "Service not found or app not running" }, 400);
	return c.json({ ok: true });
});

// ---- App Preview Proxy ----------------------------------------------------

runtimeRoutes.all("/projects/:id/app/proxy/*", async (c) => {
	const projectId = c.req.param("id");
	const status = getAppStatus(projectId);
	if (!status.running || !status.previewUrl) {
		return c.json({ error: "App is not running" }, 502);
	}

	try {
		const targetBase = new URL(status.previewUrl);
		const proxyMarker = "/app/proxy";
		const rawUrl = c.req.url;
		const markerIdx = rawUrl.indexOf(proxyMarker);
		const subPath = markerIdx >= 0 ? rawUrl.slice(markerIdx + proxyMarker.length).split("?")[0] || "/" : "/";
		const qs = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
		const targetUrl = `http://${targetBase.hostname}:${targetBase.port || 80}${subPath}${qs}`;

		const reqHeaders: Record<string, string> = {};
		c.req.raw.headers.forEach((val, key) => {
			if (["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) return;
			reqHeaders[key] = val;
		});
		reqHeaders.host = `${targetBase.hostname}:${targetBase.port || 80}`;

		const proxyRes = await fetch(targetUrl, {
			method: c.req.method,
			headers: reqHeaders,
			body: c.req.method !== "GET" && c.req.method !== "HEAD" ? await c.req.raw.arrayBuffer() : undefined,
		});

		const resHeaders = new Headers();
		const blockedHeaders = new Set([
			"x-frame-options",
			"content-security-policy",
			"cross-origin-opener-policy",
			"cross-origin-resource-policy",
		]);
		proxyRes.headers.forEach((val, key) => {
			if (!blockedHeaders.has(key.toLowerCase())) {
				resHeaders.set(key, val);
			}
		});

		if (subPath === "/" && proxyRes.status === 404) {
			const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh}
  .c{text-align:center;max-width:420px}
  h2{color:#22c55e;margin-bottom:8px;font-size:20px}
  p{color:#737373;font-size:13px;line-height:1.6}
  .badge{display:inline-block;background:#22c55e20;color:#22c55e;padding:4px 12px;border-radius:999px;font-size:12px;margin-bottom:16px}
  a{color:#3b82f6;text-decoration:none}
  code{background:#1a1a1a;padding:2px 6px;border-radius:4px;font-size:12px}
</style></head><body><div class="c">
  <div class="badge">API Running</div>
  <h2>API-Only Application</h2>
  <p>Bu uygulama bir API servisi — HTML arayüzü yok.<br/>
  API endpoint'lerine doğrudan erişebilirsiniz:</p>
  <p><code>GET <a href="${targetUrl.replace(/\/$/, "")}/api/v1/health" target="_blank">${status.previewUrl}/api/v1/health</a></code></p>
  <p style="margin-top:20px;font-size:11px;color:#525252">
    Yeni sekmede açmak için toolbar'daki ↗ butonunu kullanın
  </p>
</div></body></html>`;
			return new Response(html, {
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		const ct = proxyRes.headers.get("content-type") || "";
		if (ct.includes("text/html")) {
			let html = await proxyRes.text();
			const baseTag = `<base href="${status.previewUrl?.replace(/\/$/, "")}/">`;
			if (!html.includes("<base ")) {
				html = html.replace("<head>", `<head>${baseTag}`);
			}
			resHeaders.set("content-type", ct);
			return new Response(html, {
				status: proxyRes.status,
				headers: resHeaders,
			});
		}

		return new Response(proxyRes.body, {
			status: proxyRes.status,
			headers: resHeaders,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: `Proxy error: ${msg}` }, 502);
	}
});

// ---- Runtime & Environment ------------------------------------------------

runtimeRoutes.get("/projects/:id/runtime/analyze", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const analysis = analyzeProject(project.repoPath);
	const dbStatuses = getDbStatus(projectId);

	return c.json({ ...analysis, dbStatuses });
});

runtimeRoutes.post("/projects/:id/runtime/env", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = await c.req.json<{ values: Record<string, string> }>();
	if (!body.values || typeof body.values !== "object") {
		return c.json({ error: "values objesi gerekli" }, 400);
	}

	try {
		writeEnvFile(project.repoPath, body.values);
		return c.json({ ok: true, message: ".env dosyası güncellendi" });
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : ".env yazılamadı" }, 500);
	}
});

runtimeRoutes.post("/projects/:id/runtime/db/provision", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = await c.req.json<{
		type: DatabaseType;
		method: DbProvisionMethod;
		cloudUrl?: string;
		port?: number;
	}>();

	const onLog = (msg: string) => {
		eventBus.emitTransient({
			projectId,
			type: "agent:output",
			payload: { output: msg },
		});
	};

	try {
		if (body.method === "cloud" && body.cloudUrl) {
			const envVars = parseCloudUrl(body.type, body.cloudUrl);
			writeEnvFile(project.repoPath, envVars);
			return c.json({
				ok: true,
				envVars,
				message: `${body.type} cloud URL env'ye yazıldı`,
			});
		}

		if (body.method === "docker") {
			const result = await provisionDatabase(
				projectId,
				{
					type: body.type,
					image:
						body.type === "postgresql"
							? "postgres:16-alpine"
							: body.type === "mysql"
								? "mysql:8"
								: body.type === "mongodb"
									? "mongo:7"
									: "redis:7-alpine",
					port:
						body.port ||
						(body.type === "postgresql" ? 5432 : body.type === "mysql" ? 3306 : body.type === "mongodb" ? 27017 : 6379),
					envVars: [],
					fromCompose: false,
				},
				onLog,
			);

			writeEnvFile(project.repoPath, result.envVars);

			return c.json({
				ok: true,
				status: result.status,
				envVars: result.envVars,
			});
		}

		return c.json({
			ok: true,
			message: "Local DB kullanılıyor, env var'ları manuel ayarlayın",
		});
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : "DB başlatılamadı" }, 500);
	}
});

runtimeRoutes.post("/projects/:id/runtime/db/stop", async (c) => {
	const projectId = c.req.param("id");
	const body = await c.req.json<{ type?: DatabaseType }>();

	if (body.type) {
		await stopDatabase(projectId, body.type);
	} else {
		await stopAllDatabases(projectId);
	}

	return c.json({ ok: true });
});

runtimeRoutes.get("/projects/:id/runtime/db/status", async (c) => {
	const projectId = c.req.param("id");
	return c.json(getDbStatus(projectId));
});

runtimeRoutes.post("/projects/:id/runtime/install", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = await c.req.json<{ serviceName?: string }>();
	const analysis = analyzeProject(project.repoPath);
	const services = body.serviceName ? analysis.services.filter((s) => s.name === body.serviceName) : analysis.services;

	const results: { name: string; success: boolean; error?: string }[] = [];

	for (const svc of services) {
		if (!svc.installCommand) {
			results.push({ name: svc.name, success: true });
			continue;
		}
		const svcPath = svc.path === "." ? project.repoPath : join(project.repoPath, svc.path);
		try {
			execSync(svc.installCommand, {
				cwd: svcPath,
				encoding: "utf-8",
				timeout: 120000,
				stdio: "pipe",
			});
			results.push({ name: svc.name, success: true });
		} catch (err) {
			results.push({
				name: svc.name,
				success: false,
				error: err instanceof Error ? err.message.slice(0, 200) : String(err),
			});
		}
	}

	return c.json({ ok: true, results });
});
