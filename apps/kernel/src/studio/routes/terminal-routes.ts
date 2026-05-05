// ---------------------------------------------------------------------------
// Terminal Routes — Interactive CLI terminal for project repo directories
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Hono } from "hono";
import { getProject } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("terminal-routes");

export const terminalRoutes = new Hono();

// Security: block commands that could cause irreversible system damage
const BLOCKED_PATTERNS = [
	"rm -rf /",
	"rm -rf ~",
	"rm -rf $HOME",
	"sudo ",
	"chmod 777 /",
	"> /dev/",
	"mkfs",
	"dd if=",
	":(){ :|:& };:", // fork bomb
	"curl | sh",
	"curl | bash",
	"wget | sh",
	"wget | bash",
];

function isCommandBlocked(command: string): boolean {
	const lower = command.toLowerCase();
	return BLOCKED_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

// POST /projects/:id/terminal/exec — execute a command in the project repo directory
terminalRoutes.post("/projects/:id/terminal/exec", async (c) => {
	const projectId = c.req.param("id");

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	let body: { command?: string };
	try {
		body = await c.req.json<{ command?: string }>();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const command = body.command?.trim();
	if (!command) return c.json({ error: "Command required" }, 400);

	if (isCommandBlocked(command)) {
		log.warn({ projectId, command }, "[terminal] blocked dangerous command");
		return c.json({ output: "Command blocked for safety.", exitCode: 1 });
	}

	const cwd = project.repoPath;
	if (!cwd || !existsSync(cwd)) {
		return c.json({ output: `Working directory not found: ${cwd || "(unset)"}`, exitCode: 1 });
	}

	log.info({ projectId, cwd, command }, "[terminal] executing command");

	try {
		const output = execSync(command, {
			cwd,
			timeout: 30_000,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		});
		return c.json({ output: output.slice(0, 10_000), exitCode: 0 });
	} catch (err: any) {
		const stderr: string = err.stderr ?? "";
		const stdout: string = err.stdout ?? "";
		const combined = (stdout + stderr).trim() || err.message || String(err);
		log.warn({ projectId, command, exitCode: err.status }, "[terminal] command failed");
		return c.json({ output: combined.slice(0, 10_000), exitCode: err.status ?? 1 });
	}
});

// GET /projects/:id/terminal/info — return working directory metadata
terminalRoutes.get("/projects/:id/terminal/info", async (c) => {
	const projectId = c.req.param("id");

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const cwd = project.repoPath ?? "";
	return c.json({
		cwd,
		exists: Boolean(cwd) && existsSync(cwd),
		projectName: project.name,
	});
});
