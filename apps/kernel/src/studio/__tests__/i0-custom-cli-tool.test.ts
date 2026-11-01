// ---------------------------------------------------------------------------
// I0 item 1 / scenario 1 — `cliTool: "custom"` is removed everywhere.
//   * every route that accepts a cliTool answers 400 for "custom" (and for unknown tools);
//   * the marker bypass (`## Engineering Principles (shared)` skips the behavioural prefix, so the raw systemPrompt
//     used to be run as a command) cannot execute anything any more — proven with a canary file;
//   * the schema carries a CHECK constraint and `schema apply` migrates existing 'custom' rows to 'claude-code'.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runApplySchema } from "./helpers/apply-schema.js";
import {
	call,
	cleanup,
	mkUser,
	registerCleanup,
	seedAgentConfig,
	seedProject,
	seedProjectAgent,
	useAuthEnabledEnv,
} from "./helpers/f2r3-fixtures.js";
import { freshTmp } from "./helpers/i0-fakes.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, withMigrator } from "./helpers/tenancy.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// startAgent reads the project's repo_path through the shared db barrel; resolve it to the temp repo so a vulnerable
// build can only ever litter that directory (never the kernel's cwd).
vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	const realQueryOne = actual.queryOne as (sql: string, params?: unknown[]) => Promise<unknown>;
	return {
		...actual,
		queryOne: (sql: string, params?: unknown[]) =>
			sql.includes("repo_path") && process.env.I0_REPO
				? Promise.resolve({ repo_path: process.env.I0_REPO })
				: realQueryOne(sql, params),
	};
});

useAuthEnabledEnv();
registerCleanup();
void cleanup;

const MARKER_PROMPT = "## Engineering Principles (shared)";
let owner: SeededUser;
let admin: SeededUser;
let projectId: string;
let work: string;

beforeAll(async () => {
	owner = await mkUser({ tenantId: TENANT_A });
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
	projectId = await seedProject(TENANT_A);
	work = freshTmp("oscx-i0-custom-");
});
afterAll(() => {
	Reflect.deleteProperty(process.env, "I0_REPO");
	rmSync(work, { recursive: true, force: true });
});

describe("routes reject cliTool 'custom' (scenario 1)", () => {
	it("POST /agents → 400", async () => {
		const res = await call(owner, "POST", "/agents", { name: "x", role: "coder", cliTool: "custom" });
		expect(res.status).toBe(400);
	});

	it("POST /agents with an unknown tool → 400, a supported tool is still accepted", async () => {
		const bad = await call(owner, "POST", "/agents", { name: "x", role: "coder", cliTool: "rm -rf" });
		expect(bad.status).toBe(400);
		const ok = await call(owner, "POST", "/agents", { name: "i0-ok", role: "coder", cliTool: "claude-code" });
		expect(ok.status).toBe(201);
		cleanup.agentConfigs.push(((await ok.json()) as { id: string }).id);
	});

	it("POST /agents (platform admin, preset) → 400", async () => {
		const res = await call(admin, "POST", "/agents", { name: "x", role: "coder", cliTool: "custom", isPreset: true });
		expect(res.status).toBe(400);
	});

	it("PUT /agents/:id → 400 and the stored tool is unchanged", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_A, createdBy: owner.id });
		const res = await call(owner, "PUT", `/agents/${id}`, { cliTool: "custom", systemPrompt: MARKER_PROMPT });
		expect(res.status).toBe(400);
		const rows = await withMigrator((c) => c.query("SELECT cli_tool FROM agent_configs WHERE id = $1", [id]));
		expect(rows.rows[0].cli_tool).not.toBe("custom");
	});

	it("POST /projects/:id/team (no source agent) → 400", async () => {
		const res = await call(owner, "POST", `/projects/${projectId}/team`, {
			name: "x",
			role: "coder",
			cliTool: "custom",
			systemPrompt: `touch /tmp/oscx-i0-never ${MARKER_PROMPT}`,
		});
		expect(res.status).toBe(400);
	});

	it("POST /projects/:id/team (copy of a preset with cliTool override) → 400", async () => {
		const preset = await seedAgentConfig({ tenantId: null, createdBy: null, preset: true });
		const res = await call(owner, "POST", `/projects/${projectId}/team`, { sourceAgentId: preset, cliTool: "custom" });
		expect(res.status).toBe(400);
	});

	it("PUT /projects/:id/team/:agentId → 400 and the stored tool is unchanged", async () => {
		const agentId = await seedProjectAgent(projectId);
		const res = await call(owner, "PUT", `/projects/${projectId}/team/${agentId}`, { cliTool: "custom" });
		expect(res.status).toBe(400);
		const rows = await withMigrator((c) => c.query("SELECT cli_tool FROM project_agents WHERE id = $1", [agentId]));
		expect(rows.rows[0].cli_tool).not.toBe("custom");
	});

	it("PUT /projects/:id/team/:agentId rejects unknown fields (strict body), a normal update still works", async () => {
		const agentId = await seedProjectAgent(projectId);
		const bad = await call(owner, "PUT", `/projects/${projectId}/team/${agentId}`, { tenantId: "x", projectId: "y" });
		expect(bad.status).toBe(400);
		const ok = await call(owner, "PUT", `/projects/${projectId}/team/${agentId}`, { name: "renamed" });
		expect(ok.status).toBe(200);
	});
});

describe("marker bypass cannot execute anything (scenario 1)", () => {
	it("a custom agent whose systemPrompt carries the marker never spawns, even straight through startAgent", async () => {
		const canary = join(work, "canary-ran");
		const repo = join(work, "repo");
		const { mkdirSync } = await import("node:fs");
		mkdirSync(repo, { recursive: true });
		// the project's cwd is the empty temp repo so a vulnerable build only ever litters that directory
		process.env.I0_REPO = repo;

		const { startAgent } = await import("../agent-runtime.js");
		const { runOutsideScope } = await import("../tenancy/tenant-scope.js");
		let record: { status: string; pid?: number } | undefined;
		try {
			record = await runOutsideScope(() =>
				startAgent(
					projectId,
					{
						id: "i0-custom-agent",
						name: "evil",
						cliTool: "custom",
						systemPrompt: `/usr/bin/touch ${canary} ${MARKER_PROMPT}`,
					},
					"go",
				),
			);
		} catch {
			// refusing with an explicit error is just as good as returning an idle record
		}
		await new Promise((r) => setTimeout(r, 1000));
		expect(existsSync(canary)).toBe(false);
		expect(readdirSync(repo)).toEqual([]);
		if (record) {
			expect(record.pid).toBeUndefined();
			expect(record.status).not.toBe("running");
		}
	});

	it("the behavioural prefix marker no longer changes anything about how a prompt is executed", async () => {
		const src = await import("node:fs").then((fs) =>
			fs.readFileSync(join(import.meta.dirname, "..", "agent-runtime.ts"), "utf8"),
		);
		expect(src).not.toMatch(/case\s+["']custom["']/);
		expect(src).not.toMatch(/systemPrompt[^\n]*\.split\(/);
	});
});

async function expectCheckViolation(
	c: { query: (sql: string, p: unknown[]) => Promise<unknown> },
	sql: string,
	params: unknown[],
) {
	let code: string | undefined;
	try {
		await c.query(sql, params);
	} catch (err) {
		code = (err as { code?: string }).code;
	}
	expect(code, "INSERT of cli_tool='custom' must fail with check_violation").toBe("23514");
}

describe("database constraint + migration (scenario 1)", () => {
	it("schema apply migrates existing 'custom' rows to 'claude-code' and installs a CHECK that rejects new ones", async () => {
		const acId = `i0-ac-${Date.now()}`;
		const paId = `i0-pa-${Date.now()}`;
		cleanup.agentConfigs.push(acId);
		cleanup.projectAgents.push(paId);

		// emulate a pre-I0 database: no CHECK on cli_tool, legacy 'custom' rows present
		await withMigrator(async (c) => {
			await c.query(`DO $$ DECLARE r record; BEGIN
				FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
					WHERE contype = 'c' AND conrelid IN ('agent_configs'::regclass, 'project_agents'::regclass)
					AND pg_get_constraintdef(oid) ILIKE '%cli_tool%'
				LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname); END LOOP; END $$`);
			await c.query(
				"INSERT INTO agent_configs (id, name, role, cli_tool) VALUES ($1, 'i0-legacy', 'coder', 'custom')",
				[acId],
			);
			await c.query(
				"INSERT INTO project_agents (id, project_id, name, role, cli_tool, created_at) VALUES ($1, $2, 'i0-legacy', 'coder', 'custom', now())",
				[paId, projectId],
			);
		});

		await runApplySchema({ force: true });

		const after = await withMigrator(async (c) => ({
			ac: await c.query("SELECT cli_tool FROM agent_configs WHERE id = $1", [acId]),
			pa: await c.query("SELECT cli_tool FROM project_agents WHERE id = $1", [paId]),
		}));
		expect(after.ac.rows[0].cli_tool).toBe("claude-code");
		expect(after.pa.rows[0].cli_tool).toBe("claude-code");

		await withMigrator(async (c) => {
			await expectCheckViolation(
				c,
				"INSERT INTO agent_configs (id, name, role, cli_tool) VALUES ($1, 'x', 'coder', 'custom')",
				[`${acId}-2`],
			);
			await expectCheckViolation(
				c,
				"INSERT INTO project_agents (id, project_id, name, role, cli_tool, created_at) VALUES ($1, $2, 'x', 'coder', 'custom', now())",
				[`${paId}-2`, projectId],
			);
			// supported tools are still insertable
			await c.query("INSERT INTO agent_configs (id, name, role, cli_tool) VALUES ($1, 'ok', 'coder', 'codex')", [
				`${acId}-3`,
			]);
		});
		cleanup.agentConfigs.push(`${acId}-3`);
	});
});
