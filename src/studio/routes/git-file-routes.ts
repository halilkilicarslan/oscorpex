// ---------------------------------------------------------------------------
// Git & File Routes — File CRUD + Git Operations
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getProject } from "../db.js";
import { gitManager } from "../git-manager.js";

export const gitFileRoutes = new Hono();

/** Validate file path — reject directory traversal attempts */
function validateFilePath(filePath: string): string | null {
	if (!filePath) return "File path required";
	if (filePath.includes("..")) return "Invalid file path: directory traversal not allowed";
	if (filePath.startsWith("/")) return "Invalid file path: absolute paths not allowed";
	return null;
}

// ---- Files & Git ----------------------------------------------------------

gitFileRoutes.get("/projects/:id/files", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	try {
		const tree = await gitManager.getFileTree(project.repoPath);
		return c.json(tree);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to read files";
		return c.json({ error: msg }, 500);
	}
});

gitFileRoutes.get("/projects/:id/files/*", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const prefix = `/api/studio/projects/${c.req.param("id")}/files/`;
	const filePath = decodeURIComponent(
		c.req.path.startsWith(prefix)
			? c.req.path.slice(prefix.length)
			: c.req.path.replace(/^.*\/files\//, ""),
	);
	const pathErr = validateFilePath(filePath);
	if (pathErr) return c.json({ error: pathErr }, 400);

	try {
		const content = await gitManager.getFileContent(project.repoPath, filePath);
		return c.json({ path: filePath, content });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to read file";
		return c.json({ error: msg }, 404);
	}
});

gitFileRoutes.put("/projects/:id/files/*", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const prefix = `/api/studio/projects/${c.req.param("id")}/files/`;
	const filePath = decodeURIComponent(
		c.req.path.startsWith(prefix)
			? c.req.path.slice(prefix.length)
			: c.req.path.replace(/^.*\/files\//, ""),
	);
	const pathErr = validateFilePath(filePath);
	if (pathErr) return c.json({ error: pathErr }, 400);

	const body = (await c.req.json()) as { content: string };
	if (typeof body.content !== "string") return c.json({ error: "Content required" }, 400);

	try {
		await gitManager.writeFileContent(project.repoPath, filePath, body.content);
		return c.json({ path: filePath, saved: true });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to save file";
		return c.json({ error: msg }, 500);
	}
});

gitFileRoutes.post("/projects/:id/files", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const body = (await c.req.json()) as { path?: string; content?: string };
	if (!body.path || typeof body.path !== "string") return c.json({ error: "File path is required" }, 400);
	if (body.path.includes("..")) return c.json({ error: "Invalid file path: directory traversal not allowed" }, 400);

	try {
		await gitManager.createFile(project.repoPath, body.path, body.content ?? "");
		return c.json({ path: body.path, created: true }, 201);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to create file";
		return c.json({ error: msg }, msg.includes("already exists") ? 409 : 500);
	}
});

gitFileRoutes.delete("/projects/:id/files", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const body = (await c.req.json()) as { path?: string };
	if (!body.path || typeof body.path !== "string") return c.json({ error: "File path is required" }, 400);
	if (body.path.includes("..")) return c.json({ error: "Invalid file path: directory traversal not allowed" }, 400);

	try {
		await gitManager.deleteFile(project.repoPath, body.path);
		return c.json({ path: body.path, deleted: true });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to delete file";
		return c.json({ error: msg }, msg.includes("ENOENT") ? 404 : 500);
	}
});

// ---- Git Operations --------------------------------------------------------

gitFileRoutes.get("/projects/:id/git/log", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const limit = Number(c.req.query("limit") ?? 50);
	try {
		const log = await gitManager.getLog(project.repoPath, limit);
		return c.json(log);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to get log";
		return c.json({ error: msg }, 500);
	}
});

gitFileRoutes.get("/projects/:id/git/diff", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const ref = c.req.query("ref");
	try {
		const diff = await gitManager.getDiff(project.repoPath, ref);
		return c.json({ diff });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to get diff";
		return c.json({ error: msg }, 500);
	}
});

gitFileRoutes.get("/projects/:id/git/branches", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	try {
		const branches = await gitManager.listBranches(project.repoPath);
		const current = await gitManager.getCurrentBranch(project.repoPath);
		return c.json({ branches, current });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to list branches";
		return c.json({ error: msg }, 500);
	}
});

gitFileRoutes.get("/projects/:id/git/status", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	try {
		const gitStatus = await gitManager.getStatus(project.repoPath);
		return c.json(gitStatus);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to get git status";
		return c.json({ error: msg }, 500);
	}
});

// POST /projects/:id/git/revert
gitFileRoutes.post("/projects/:id/git/revert", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const body = (await c.req.json()) as { commitHash?: string };
	if (!body.commitHash || typeof body.commitHash !== "string") {
		return c.json({ error: "commitHash is required" }, 400);
	}

	try {
		const revertHash = await gitManager.revertCommit(project.repoPath, body.commitHash);
		return c.json({
			success: true,
			revertCommit: revertHash,
			originalCommit: body.commitHash,
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Revert başarısız oldu";
		return c.json({ error: msg }, 500);
	}
});

// POST /projects/:id/git/merge
gitFileRoutes.post("/projects/:id/git/merge", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const body = (await c.req.json()) as { source?: string; target?: string };
	if (!body.source || typeof body.source !== "string") {
		return c.json({ error: "source branch is required" }, 400);
	}
	if (!body.target || typeof body.target !== "string") {
		return c.json({ error: "target branch is required" }, 400);
	}

	try {
		const result = await gitManager.mergeBranch(project.repoPath, body.source, body.target);
		if (!result.success) {
			return c.json({ success: false, conflicts: result.conflicts ?? [] }, 409);
		}
		return c.json({ success: true, source: body.source, target: body.target });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Merge başarısız oldu";
		return c.json({ error: msg }, 500);
	}
});

gitFileRoutes.post("/projects/:id/git/commit", async (c) => {
	const project = await getProject(c.req.param("id"));
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const body = (await c.req.json()) as { message?: string; files?: string[] };
	if (!body.message || typeof body.message !== "string" || body.message.trim() === "") {
		return c.json({ error: "Commit message is required" }, 400);
	}
	if (Array.isArray(body.files)) {
		for (const f of body.files) {
			if (typeof f !== "string" || f.includes("..")) return c.json({ error: `Invalid file path: ${f}` }, 400);
		}
	}

	try {
		const commitHash = await gitManager.commitChanges(
			project.repoPath,
			body.message.trim(),
			body.files && body.files.length > 0 ? body.files : undefined,
		);
		return c.json({ commit: commitHash, message: body.message.trim() });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to commit changes";
		return c.json({ error: msg }, msg.includes("Nothing to commit") ? 422 : 500);
	}
});
