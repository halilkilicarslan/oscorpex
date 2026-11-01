// ---------------------------------------------------------------------------
// I0 item 5 / scenario 5 — the legacy container pool is gone and `isolationLevel: "container"` never falls back
// to running on the host.
//   * behavioural: resolveWorkspace refuses "container" with an explicit error and copies nothing;
//   * static: the pool/manager modules, the coder-agent image, the pool compose file and the compose `agents`
//     profile no longer exist, and nothing imports them.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { freshTmp } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 30_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL_SRC = join(HERE, "..", "..");
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "dist") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

describe("isolationLevel 'container' (scenario 5)", () => {
	it("is rejected with an explicit error instead of silently running on the host", async () => {
		const { resolveWorkspace } = await import("../execution-workspace.js");
		const repo = freshTmp("oscx-i0-ctr-");
		const taskId = `i0-ctr-${Date.now()}`;
		await expect(resolveWorkspace(repo, taskId, { isolationLevel: "container" } as never)).rejects.toThrow(
			/container/i,
		);
		// nothing was copied into a fallback workspace
		expect(readdirSync(tmpdir()).filter((f) => f.startsWith(`oscorpex-task-${taskId}-`))).toEqual([]);
	});

	it("'workspace' and 'none' keep working", async () => {
		const { resolveWorkspace } = await import("../execution-workspace.js");
		const repo = freshTmp("oscx-i0-ctr-ok-");
		const local = await resolveWorkspace(repo, "i0-none", { isolationLevel: "none" } as never);
		expect(local.type).toBe("local");
		const iso = await resolveWorkspace(repo, `i0-ws-${Date.now()}`, { isolationLevel: "workspace" } as never);
		try {
			expect(iso.type).toBe("isolated");
			expect(iso.repoPath).not.toBe(repo);
		} finally {
			await iso.cleanup();
		}
	});
});

describe("legacy container pool is removed (static)", () => {
	const gone = [
		"apps/kernel/src/studio/container-pool.ts",
		"apps/kernel/src/studio/container-manager.ts",
		"apps/kernel/src/boot-phases/container-pool-phase.ts",
		"docker/coder-agent",
		"docker-compose.pool.yml",
	];
	for (const rel of gone) {
		it(`${rel} no longer exists`, () => {
			expect(existsSync(join(REPO_ROOT, rel))).toBe(false);
		});
	}

	it("no kernel source imports the removed modules", () => {
		const offenders: string[] = [];
		for (const file of walk(KERNEL_SRC)) {
			if (file === fileURLToPath(import.meta.url)) continue;
			const src = readFileSync(file, "utf8");
			if (/(container-pool|container-manager|container-pool-phase)(\.js)?["']/.test(src)) {
				offenders.push(relative(KERNEL_SRC, file));
			}
		}
		expect(offenders).toEqual([]);
	});

	it("execution-workspace has no container branch (no dynamic pool import, no write-back regex)", () => {
		const src = readFileSync(join(KERNEL_SRC, "studio", "execution-workspace.ts"), "utf8");
		expect(src).not.toMatch(/containerPool|execInContainer|bindWorkspace/);
		expect(src).not.toMatch(/a-zA-Z0-9\._\\-\//);
	});

	it("docker-compose.yml has no `agents` profile service and no coder-agent reference", () => {
		const compose = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
		expect(compose).not.toMatch(/profiles:\s*\[\s*["']agents["']\s*\]/);
		expect(compose).not.toMatch(/coder-agent/);
		expect(compose).not.toMatch(/--profile agents/);
	});

	it("no compose/script file still references the pool compose file or the coder-agent image", () => {
		const files = [
			"docker-compose.yml",
			"docker-compose.dev.yml",
			"scripts/docker/check-context.sh",
			"scripts/docker/smoke-compose.sh",
		];
		for (const rel of files) {
			const p = join(REPO_ROOT, rel);
			if (!existsSync(p)) continue;
			const text = readFileSync(p, "utf8");
			expect(text, rel).not.toMatch(/docker-compose\.pool|coder-agent/);
		}
	});
});

describe("workspace write-back path check is resolve + sep based", () => {
	it("a file whose name only prefix-matches the source repo is never written outside it", async () => {
		const { prepareIsolatedWorkspace } = await import("../isolated-workspace.js");
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const parent = freshTmp("oscx-i0-wb-");
		const repo = join(parent, "repo");
		const sibling = join(parent, "repo-evil");
		mkdirSync(repo);
		mkdirSync(sibling);
		writeFileSync(join(repo, "a.txt"), "a");
		const ws = await prepareIsolatedWorkspace(repo, `i0-wb-${Date.now()}`, { isolationLevel: "workspace" } as never);
		try {
			writeFileSync(join(ws.repoPath, "ok.txt"), "ok");
			const synced = await ws.writeBack(["ok.txt", "../repo-evil/pwned.txt", "../../etc/passwd", "/etc/passwd"]);
			expect(synced).toEqual(["ok.txt"]);
			expect(existsSync(join(sibling, "pwned.txt"))).toBe(false);
			expect(readFileSync(join(repo, "ok.txt"), "utf8")).toBe("ok");
		} finally {
			await ws.cleanup();
		}
	});
});
