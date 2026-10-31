import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gitSafeEnv } from "../git/git-safe-config.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";
import { assertInsideWorkspace, resolveWorkspacePath } from "../security/workspace-resolver.js";
import type { McpToolHandler, McpToolInvocation } from "./types.js";

function getWorkspacePath(inv: McpToolInvocation, relPath?: string): string {
	return resolveWorkspacePath(
		{ tenantId: inv.tenantId, projectId: inv.projectId },
		typeof relPath === "string" ? relPath : undefined,
	);
}

export const repoListFiles: McpToolHandler = async (inv) => {
	try {
		const dir = getWorkspacePath(inv, inv.args.path as string | undefined);
		const entries = readdirSync(dir, { withFileTypes: true }).slice(0, 200);
		return {
			ok: true,
			data: entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
		};
	} catch (err) {
		return { ok: false, error: { code: "LIST_FAILED", message: err instanceof Error ? err.message : String(err) } };
	}
};

export const repoReadFile: McpToolHandler = async (inv) => {
	try {
		const filePath = getWorkspacePath(inv, inv.args.path as string);
		assertInsideWorkspace({ tenantId: inv.tenantId, projectId: inv.projectId }, filePath);
		const content = readFileSync(filePath, "utf8");
		return { ok: true, data: { content: content.slice(0, 50_000), truncated: content.length > 50_000 } };
	} catch (err) {
		return { ok: false, error: { code: "READ_FAILED", message: err instanceof Error ? err.message : String(err) } };
	}
};

export const repoSearch: McpToolHandler = async (inv) => {
	try {
		const dir = getWorkspacePath(inv);
		const query = String(inv.args.query ?? "");
		if (!query) return { ok: false, error: { code: "INVALID_QUERY", message: "query is required" } };

		const results: { file: string; line: number; text: string }[] = [];

		function searchDir(d: string, depth: number) {
			if (depth > 5 || results.length >= 50) return;
			try {
				for (const entry of readdirSync(d, { withFileTypes: true })) {
					if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
					const full = join(d, entry.name);
					if (entry.isDirectory()) {
						searchDir(full, depth + 1);
						continue;
					}
					if (!entry.name.match(/\.(ts|js|tsx|jsx|json|md|yml|yaml)$/)) continue;
					try {
						const content = readFileSync(full, "utf8");
						content.split("\n").forEach((line, i) => {
							if (results.length < 50 && line.includes(query)) {
								results.push({ file: full.replace(dir + "/", ""), line: i + 1, text: line.trim().slice(0, 200) });
							}
						});
					} catch {
						/* skip unreadable */
					}
				}
			} catch {
				/* skip inaccessible */
			}
		}

		searchDir(dir, 0);
		return { ok: true, data: results };
	} catch (err) {
		return { ok: false, error: { code: "SEARCH_FAILED", message: err instanceof Error ? err.message : String(err) } };
	}
};

export const gitStatus: McpToolHandler = async (inv) => {
	try {
		const { execFileSync } = await import("node:child_process");
		const dir = getWorkspacePath(inv);
		const output = execFileSync("git", ["status", "--porcelain"], {
			cwd: dir,
			encoding: "utf8",
			timeout: 10_000,
			env: gitSafeEnv(buildSafeChildEnv({ profile: "build_tool" })),
		});
		return { ok: true, data: { status: output.trim() } };
	} catch (err) {
		return {
			ok: false,
			error: { code: "GIT_STATUS_FAILED", message: err instanceof Error ? err.message : String(err) },
		};
	}
};

export const gitDiff: McpToolHandler = async (inv) => {
	try {
		const { execFileSync } = await import("node:child_process");
		const dir = getWorkspacePath(inv);
		const output = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--stat"], {
			cwd: dir,
			encoding: "utf8",
			timeout: 10_000,
			env: gitSafeEnv(buildSafeChildEnv({ profile: "build_tool" })),
		});
		return { ok: true, data: { diff: output.slice(0, 50_000) } };
	} catch (err) {
		return { ok: false, error: { code: "GIT_DIFF_FAILED", message: err instanceof Error ? err.message : String(err) } };
	}
};
