// ---------------------------------------------------------------------------
// Terminal Routes — Restricted CLI terminal for project repo directories
// P0 Hardening: allowlist-only commands, disabled in production,
// requires explicit OSCORPEX_ENABLE_TERMINAL_EXEC=true opt-in.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Hono } from "hono";
import { getProject } from "../db.js";
import { NO_SUBMODULES, gitSafeEnv } from "../git/git-safe-config.js";
import { createLogger } from "../logger.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";

const log = createLogger("terminal-routes");

export const terminalRoutes = new Hono();

// ---------------------------------------------------------------------------
// Allowlisted commands — never pass raw user strings to shell
// ---------------------------------------------------------------------------
const ALLOWED_COMMANDS: Record<string, { bin: string; args: string[] }> = {
	// hooks/fsmonitor/pager/drivers are neutralised by gitSafeEnv below
	git_status: { bin: "git", args: ["status", NO_SUBMODULES] },
	git_diff: { bin: "git", args: ["diff", "--no-ext-diff", "--no-textconv", NO_SUBMODULES] },
	git_log: {
		bin: "git",
		args: ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "log", "--oneline", "-20"],
	},
	pnpm_typecheck: { bin: "pnpm", args: ["typecheck"] },
	pnpm_test: { bin: "pnpm", args: ["test"] },
	pnpm_build: { bin: "pnpm", args: ["build"] },
	pnpm_lint: { bin: "pnpm", args: ["lint"] },
	ls_files: { bin: "ls", args: ["-la"] },
	node_version: { bin: "node", args: ["--version"] },
};

export type AllowedTerminalCommand = keyof typeof ALLOWED_COMMANDS;

/**
 * P0 gate: terminal exec is disabled unless explicitly enabled AND not in production.
 */
export function isTerminalExecEnabled(): boolean {
	if (process.env.NODE_ENV === "production") return false;
	return process.env.OSCORPEX_ENABLE_TERMINAL_EXEC === "true";
}

// POST /projects/:id/terminal/exec — execute an allowlisted command in the project repo directory
terminalRoutes.post("/projects/:id/terminal/exec", async (c) => {
	// P0: hard block in production, require explicit opt-in otherwise
	if (!isTerminalExecEnabled()) {
		return c.json(
			{ error: "Terminal execution is disabled. Set OSCORPEX_ENABLE_TERMINAL_EXEC=true in non-production." },
			403,
		);
	}

	const projectId = c.req.param("id");

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	let body: { command?: string; args?: string[] };
	try {
		body = await c.req.json<{ command?: string; args?: string[] }>();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const commandName = body.command?.trim();
	if (!commandName) return c.json({ error: "Command name required" }, 400);

	// P0: strict allowlist — reject anything not in the registry
	const allowed = ALLOWED_COMMANDS[commandName];
	if (!allowed) {
		log.warn({ projectId, commandName }, "[terminal] rejected unknown command");
		return c.json(
			{ error: `Unknown command: '${commandName}'. Allowed: ${Object.keys(ALLOWED_COMMANDS).join(", ")}` },
			400,
		);
	}

	const cwd = project.repoPath;
	if (!cwd || !existsSync(cwd)) {
		return c.json({ output: `Working directory not found: ${cwd || "(unset)"}`, exitCode: 1 });
	}

	log.info({ projectId, cwd, commandName }, "[terminal] executing allowlisted command");

	try {
		const baseEnv = buildSafeChildEnv({ profile: "build_tool", extra: { FORCE_COLOR: "0", NO_COLOR: "1" } });
		// git runs in a tenant repo: repo pre-flight + hardened env (throws, and so refuses, for an unsafe repo)
		const childEnv = allowed.bin === "git" ? gitSafeEnv(baseEnv, cwd) : baseEnv;
		// P0: use execFileSync with array args — no shell interpolation
		const output = execFileSync(allowed.bin, allowed.args, {
			cwd,
			timeout: 30_000,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			env: childEnv,
		});
		return c.json({ output: output.slice(0, 10_000), exitCode: 0 });
	} catch (err: unknown) {
		const execErr = err as { stderr?: string; stdout?: string; status?: number; message?: string };
		const combined = ((execErr.stdout ?? "") + (execErr.stderr ?? "")).trim() || execErr.message || String(err);
		log.warn({ projectId, commandName, exitCode: execErr.status }, "[terminal] command failed");
		return c.json({ output: combined.slice(0, 10_000), exitCode: execErr.status ?? 1 });
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
