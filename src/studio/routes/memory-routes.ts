// ---------------------------------------------------------------------------
// Oscorpex — Memory Routes (v3.4)
// Working memory snapshot + project memory facts CRUD.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	deleteMemoryFact,
	getContextSnapshot,
	getMemoryFacts,
	getProject,
	upsertMemoryFact,
} from "../db.js";
import { getProjectContext, updateWorkingMemory } from "../memory-manager.js";

export const memoryRoutes = new Hono();

// ---- Working memory ------------------------------------------------------

memoryRoutes.get("/projects/:id/memory/context", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const text = await getProjectContext(projectId);
	return c.json({ projectId, text });
});

memoryRoutes.get("/projects/:id/memory/snapshot", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const snapshot = await getContextSnapshot(projectId, "working_summary");
	if (!snapshot) {
		return c.json({ projectId, snapshot: null });
	}
	return c.json({
		projectId,
		snapshot: {
			kind: snapshot.kind,
			summary: snapshot.summaryJson,
			sourceVersion: snapshot.sourceVersion,
			updatedAt: snapshot.updatedAt,
		},
	});
});

memoryRoutes.post("/projects/:id/memory/refresh", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	await updateWorkingMemory(projectId);
	const snapshot = await getContextSnapshot(projectId, "working_summary");
	return c.json({
		projectId,
		refreshedAt: new Date().toISOString(),
		snapshot: snapshot
			? {
					kind: snapshot.kind,
					summary: snapshot.summaryJson,
					sourceVersion: snapshot.sourceVersion,
					updatedAt: snapshot.updatedAt,
				}
			: null,
	});
});

// ---- Memory facts ---------------------------------------------------------

memoryRoutes.get("/projects/:id/memory/facts", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const scope = c.req.query("scope") ?? undefined;
	const facts = await getMemoryFacts(projectId, scope);
	return c.json({ projectId, facts });
});

memoryRoutes.post("/projects/:id/memory/facts", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		scope?: string;
		key?: string;
		value?: string;
		confidence?: number;
		source?: string;
	};

	const scope = body.scope?.trim();
	const key = body.key?.trim();
	const value = body.value?.trim() ?? "";
	if (!scope || !key) {
		return c.json({ error: "scope and key are required" }, 400);
	}

	const confidence = typeof body.confidence === "number" ? body.confidence : 1.0;
	const source = body.source?.trim() || "user";

	const fact = await upsertMemoryFact(projectId, scope, key, value, confidence, source);
	return c.json(fact, 200);
});

memoryRoutes.delete("/projects/:id/memory/facts", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const scope = c.req.query("scope");
	const key = c.req.query("key");
	if (!scope || !key) {
		return c.json({ error: "scope and key query params are required" }, 400);
	}

	await deleteMemoryFact(projectId, scope, key);
	return c.json({ ok: true, projectId, scope, key });
});
