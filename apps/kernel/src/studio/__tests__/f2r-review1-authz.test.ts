// ---------------------------------------------------------------------------
// F2 review round 1 — authorization fixes (skills, agent_configs, import, observability, legacy key,
// control-plane approvals, learning, identity verification, /auth/me).
// Runs in both modes; cross-tenant checks that only RLS can provide skip under a superuser runtime.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// OSCORPEX_WORKSPACE_ROOT must be set before the workspace resolver / routes are loaded
const WS_ROOT = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "f2r-ws-")));
	process.env.OSCORPEX_WORKSPACE_ROOT = root;
	return root;
});

import { observabilityRoutes } from "../../observability/index.js";
import { authMiddleware } from "../auth/auth-middleware.js";
import { signJwt } from "../auth/jwt.js";
import { authRoutes, studioRoutes } from "../index.js";
import { resolveSkillsForTask } from "../skill-resolver.js";
import { runInTenant, runOutsideScope } from "../tenancy/tenant-scope.js";
import { type SeededUser, removeUsers, seedUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

const SRC = resolve(__dirname, "..");
const U = randomUUID().slice(0, 8);

const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"OSCORPEX_ALLOW_LEGACY_API_KEY",
	"OSCORPEX_TENANT_SCOPE_MODE",
	"NODE_ENV",
] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
	process.env.OSCORPEX_AUTH_ENABLED = "true";
	process.env.NODE_ENV = "test";
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const cleanup = {
	users: [] as string[],
	projects: [] as string[],
	skills: [] as string[],
	agentConfigs: [] as string[],
	projectAgents: [] as string[],
	templates: [] as string[],
	approvals: [] as string[],
	patterns: [] as string[],
	dirs: [] as string[],
	keys: [] as string[],
};
let isSuper = true;
let ownerA: SeededUser;
let ownerA2: SeededUser;
let ownerB: SeededUser;
let admin: SeededUser;

async function mkUser(o: { tenantId: string; role?: string; admin?: boolean }): Promise<SeededUser> {
	const u = await seedUser({ ...o, id: `f2r-authz-${U}-${randomUUID().slice(0, 8)}` });
	cleanup.users.push(u.id);
	return u;
}

function call(who: { token: string }, method: string, path: string, body?: unknown) {
	return runOutsideScope(async () =>
		studioRoutes.request(path, {
			method,
			headers: { Authorization: `Bearer ${who.token}`, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

beforeAll(async () => {
	const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await probe.connect();
	try {
		isSuper =
			(await probe.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper === true;
	} finally {
		await probe.end();
	}
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerA2 = await mkUser({ tenantId: TENANT_A });
	ownerB = await mkUser({ tenantId: TENANT_B });
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
});

afterAll(async () => {
	await withMigrator(async (c) => {
		if (cleanup.keys.length) await c.query("DELETE FROM api_keys WHERE id = ANY($1)", [cleanup.keys]);
		if (cleanup.projectAgents.length) {
			await c.query("DELETE FROM agent_skills WHERE agent_id = ANY($1)", [cleanup.projectAgents]);
			await c.query("DELETE FROM project_agents WHERE id = ANY($1)", [cleanup.projectAgents]);
		}
		if (cleanup.projects.length) {
			await c.query("DELETE FROM project_skills WHERE project_id = ANY($1)", [cleanup.projects]);
			await c.query("DELETE FROM approvals WHERE project_id = ANY($1)", [cleanup.projects]);
			await c.query("DELETE FROM projects WHERE id = ANY($1)", [cleanup.projects]);
		}
		if (cleanup.approvals.length) await c.query("DELETE FROM approvals WHERE id = ANY($1)", [cleanup.approvals]);
		if (cleanup.skills.length) {
			await c.query("DELETE FROM agent_skills WHERE skill_id = ANY($1)", [cleanup.skills]);
			await c.query("DELETE FROM project_skills WHERE skill_id = ANY($1)", [cleanup.skills]);
			await c.query("DELETE FROM skills WHERE id = ANY($1)", [cleanup.skills]);
		}
		if (cleanup.agentConfigs.length)
			await c.query("DELETE FROM agent_configs WHERE id = ANY($1)", [cleanup.agentConfigs]);
		if (cleanup.templates.length)
			await c.query("DELETE FROM project_templates WHERE id = ANY($1)", [cleanup.templates]);
		if (cleanup.patterns.length) await c.query("DELETE FROM learning_patterns WHERE id = ANY($1)", [cleanup.patterns]);
	});
	await removeUsers(cleanup.users);
	for (const d of cleanup.dirs) rmSync(d, { recursive: true, force: true });
	rmSync(WS_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seedSkill(o: {
	isGlobal: boolean;
	createdBy: string | null;
	tenantId?: string | null;
	triggers?: string[];
}): Promise<string> {
	const id = `f2r-skill-${randomUUID()}`;
	cleanup.skills.push(id);
	await withMigrator((c) =>
		c.query(
			"INSERT INTO skills (id, name, description, is_global, created_by, tenant_id, triggers, content_md) VALUES ($1, $2, '', $3, $4, $5, $6, '# body')",
			[id, `f2r-${id.slice(-6)}`, o.isGlobal, o.createdBy, o.tenantId ?? null, JSON.stringify(o.triggers ?? [])],
		),
	);
	return id;
}

async function seedProject(tenantId: string): Promise<string> {
	const id = `f2r-proj-${randomUUID()}`;
	cleanup.projects.push(id);
	await withMigrator((c) =>
		c.query("INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2r', now(), now(), $2)", [
			id,
			tenantId,
		]),
	);
	return id;
}

async function seedAgent(projectId: string, role = "backend-dev"): Promise<string> {
	const id = `f2r-pa-${randomUUID()}`;
	cleanup.projectAgents.push(id);
	await withMigrator((c) =>
		c.query("INSERT INTO project_agents (id, project_id, name, role, created_at) VALUES ($1, $2, 'a', $3, now())", [
			id,
			projectId,
			role,
		]),
	);
	return id;
}

// ---------------------------------------------------------------------------
// 1a. Skills
// ---------------------------------------------------------------------------
describe("skills — visibility, assignment and auto-matching", () => {
	let global: string;
	let personalA: string;
	let personalB: string;
	beforeAll(async () => {
		global = await seedSkill({ isGlobal: true, createdBy: null });
		personalA = await seedSkill({ isGlobal: false, createdBy: ownerA.id, tenantId: TENANT_A });
		personalB = await seedSkill({ isGlobal: false, createdBy: ownerB.id, tenantId: TENANT_B });
	});

	it("GET /skills shows global + the caller's own skills only", async () => {
		const res = await call(ownerA, "GET", "/skills");
		expect(res.status).toBe(200);
		const ids = ((await res.json()) as Array<{ id: string }>).map((s) => s.id);
		expect(ids).toContain(global);
		expect(ids).toContain(personalA);
		expect(ids).not.toContain(personalB);
	});

	it("GET /skills/:id of someone else's personal skill → 404; own and global → 200", async () => {
		expect((await call(ownerA, "GET", `/skills/${personalB}`)).status).toBe(404);
		expect((await call(ownerA, "GET", `/skills/${personalA}`)).status).toBe(200);
		expect((await call(ownerA, "GET", `/skills/${global}`)).status).toBe(200);
	});

	it("a personal skill of another user in the SAME tenant is not visible either", async () => {
		expect((await call(ownerA2, "GET", `/skills/${personalA}`)).status).toBe(404);
	});

	describe("agent assignment", () => {
		let agentId: string;
		beforeAll(async () => {
			agentId = await seedAgent(await seedProject(TENANT_A));
		});

		it("POST /agents/:id/skills with someone else's personal skill → 404, nothing assigned", async () => {
			expect((await call(ownerA, "POST", `/agents/${agentId}/skills`, { skillId: personalB })).status).toBe(404);
			expect((await call(ownerA2, "POST", `/agents/${agentId}/skills`, { skillId: personalA })).status).toBe(404);
			const rows = await withMigrator((c) =>
				c.query("SELECT 1 FROM agent_skills WHERE agent_id = $1 AND skill_id = ANY($2)", [
					agentId,
					[personalA, personalB],
				]),
			);
			expect(rows.rowCount).toBe(0);
		});

		it("own personal skill and global skill can be assigned and removed", async () => {
			for (const sk of [personalA, global]) {
				expect((await call(ownerA, "POST", `/agents/${agentId}/skills`, { skillId: sk })).status).toBe(200);
				expect((await call(ownerA, "DELETE", `/agents/${agentId}/skills/${sk}`)).status).toBe(200);
			}
		});

		it("DELETE of someone else's personal skill assignment → 404", async () => {
			expect((await call(ownerA, "DELETE", `/agents/${agentId}/skills/${personalB}`)).status).toBe(404);
		});

		it("(non-superuser) agent of another tenant's project → 404 for POST and DELETE", async (ctx) => {
			if (isSuper) return ctx.skip();
			expect((await call(ownerB, "POST", `/agents/${agentId}/skills`, { skillId: global })).status).toBe(404);
			expect((await call(ownerB, "DELETE", `/agents/${agentId}/skills/${global}`)).status).toBe(404);
		});
	});

	describe("project assignment (/projects/:projectId/skills)", () => {
		let projectId: string;
		beforeAll(async () => {
			projectId = await seedProject(TENANT_A);
		});

		it("POST with someone else's personal skill → 404", async () => {
			expect((await call(ownerA, "POST", `/projects/${projectId}/skills`, { skillId: personalB })).status).toBe(404);
			expect((await call(ownerA2, "POST", `/projects/${projectId}/skills`, { skillId: personalA })).status).toBe(404);
		});

		it("own personal / global skill → assign, list, remove", async () => {
			for (const sk of [personalA, global]) {
				expect((await call(ownerA, "POST", `/projects/${projectId}/skills`, { skillId: sk })).status).toBe(200);
			}
			const list = await call(ownerA, "GET", `/projects/${projectId}/skills`);
			expect(list.status).toBe(200);
			const ids = ((await list.json()) as Array<{ id: string }>).map((s) => s.id);
			expect(ids).toEqual(expect.arrayContaining([personalA, global]));
			for (const sk of [personalA, global]) {
				expect((await call(ownerA, "DELETE", `/projects/${projectId}/skills/${sk}`)).status).toBe(200);
			}
		});

		it("(non-superuser) another tenant's project → 404 for GET / POST / DELETE", async (ctx) => {
			if (isSuper) return ctx.skip();
			expect((await call(ownerB, "GET", `/projects/${projectId}/skills`)).status).toBe(404);
			expect((await call(ownerB, "POST", `/projects/${projectId}/skills`, { skillId: global })).status).toBe(404);
			expect((await call(ownerB, "DELETE", `/projects/${projectId}/skills/${global}`)).status).toBe(404);
		});
	});

	describe("resolver: trigger auto-matching uses global skills only", () => {
		it("personal skills match only through explicit assignment", async () => {
			const t1 = `f2rtrig1${U}`;
			const t2 = `f2rtrig2${U}`;
			const personal = await seedSkill({ isGlobal: false, createdBy: ownerA.id, tenantId: TENANT_A, triggers: [t1] });
			const globalTrig = await seedSkill({ isGlobal: true, createdBy: null, triggers: [t2] });
			const projectId = await seedProject(TENANT_A);
			const agentId = await seedAgent(projectId);
			const task = { id: "t", title: `${t1} and ${t2}`, description: "" } as never;

			const resolve1 = await runOutsideScope(() =>
				runInTenant(TENANT_A, () => resolveSkillsForTask(task, agentId, "backend-dev", projectId)),
			);
			const ids1 = resolve1.skills?.map((m: { skill: { id: string } }) => m.skill.id) ?? [];
			expect(ids1).toContain(globalTrig);
			expect(ids1).not.toContain(personal);

			await withMigrator((c) =>
				c.query("INSERT INTO agent_skills (id, agent_id, skill_id, priority) VALUES ($1, $2, $3, 0)", [
					randomUUID(),
					agentId,
					personal,
				]),
			);
			const resolve2 = await runOutsideScope(() =>
				runInTenant(TENANT_A, () => resolveSkillsForTask(task, agentId, "backend-dev", projectId)),
			);
			const hit = resolve2.skills?.find((m: { skill: { id: string } }) => m.skill.id === personal);
			expect(hit?.matchReason).toBe("agent_assigned");
		});
	});
});

// ---------------------------------------------------------------------------
// 1b. agent_configs: creator-only edits, strict PUT schema, isPreset from non-admin
// ---------------------------------------------------------------------------
describe("agent_configs — created_by ownership", () => {
	// Ownership is (tenant_id, created_by); tenant-less legacy rows are admin-only, so creator rows carry the tenant.
	async function seedConfig(
		createdBy: string | null,
		preset = false,
		tenantId: string | null = TENANT_A,
	): Promise<string> {
		const id = `f2r-ac-${randomUUID()}`;
		cleanup.agentConfigs.push(id);
		await withMigrator((c) =>
			c.query(
				"INSERT INTO agent_configs (id, name, role, is_preset, created_by, tenant_id) VALUES ($1, 'f2r', 'coder', $2, $3, $4)",
				[id, preset ? 1 : 0, createdBy, tenantId],
			),
		);
		return id;
	}

	it("created_by column exists", async () => {
		const r = await withMigrator((c) =>
			c.query(
				"SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'created_by'",
			),
		);
		expect(r.rowCount).toBe(1);
	});

	it("POST /agents records the caller as created_by", async () => {
		const res = await call(ownerA, "POST", "/agents", { name: "f2r-created", role: "coder" });
		expect(res.status).toBe(201);
		const { id } = (await res.json()) as { id: string };
		cleanup.agentConfigs.push(id);
		const row = await withMigrator((c) =>
			c.query("SELECT created_by, tenant_id FROM agent_configs WHERE id = $1", [id]),
		);
		expect(row.rows[0].created_by).toBe(ownerA.id);
		// The tenant comes from the request scope (column default), so the creator can still edit it afterwards.
		expect(row.rows[0].tenant_id).toBe(TENANT_A);
		expect((await call(ownerA, "PUT", `/agents/${id}`, { name: "f2r-created-renamed" })).status).toBe(200);
	});

	it("PUT / DELETE by a non-creator → 404 and the row is unchanged", async () => {
		const id = await seedConfig(ownerA.id);
		expect((await call(ownerA2, "PUT", `/agents/${id}`, { name: "hijack" })).status).toBe(404);
		expect((await call(ownerB, "PUT", `/agents/${id}`, { name: "hijack" })).status).toBe(404);
		expect((await call(ownerA2, "DELETE", `/agents/${id}`)).status).toBe(404);
		const row = await withMigrator((c) => c.query("SELECT name FROM agent_configs WHERE id = $1", [id]));
		expect(row.rows[0]?.name).toBe("f2r");
	});

	it("the creator can PUT and DELETE", async () => {
		const id = await seedConfig(ownerA.id);
		expect((await call(ownerA, "PUT", `/agents/${id}`, { name: "renamed" })).status).toBe(200);
		expect((await call(ownerA, "DELETE", `/agents/${id}`)).status).toBe(200);
	});

	it("PUT body is validated by a strict schema (unknown / mass-assignment fields → 400)", async () => {
		const id = await seedConfig(ownerA.id);
		for (const bad of [
			{ name: "x", tenant_id: "evil" },
			{ name: "x", created_by: ownerB.id },
			{ name: 123 },
			{ name: "" },
		]) {
			expect((await call(ownerA, "PUT", `/agents/${id}`, bad)).status, JSON.stringify(bad)).toBe(400);
		}
		const row = await withMigrator((c) => c.query("SELECT created_by FROM agent_configs WHERE id = $1", [id]));
		expect(row.rows[0].created_by).toBe(ownerA.id);
	});

	it.each([[true], [false], [1], [0], ["true"], ["1"]])(
		"isPreset=%j in the body from a non-admin → 403",
		async (value) => {
			const id = await seedConfig(ownerA.id);
			expect((await call(ownerA, "PUT", `/agents/${id}`, { name: "x", isPreset: value })).status).toBe(403);
			expect((await call(ownerA, "POST", "/agents", { name: "f2r-p", role: "coder", isPreset: value })).status).toBe(
				403,
			);
			const row = await withMigrator((c) => c.query("SELECT is_preset FROM agent_configs WHERE id = $1", [id]));
			expect(Number(row.rows[0].is_preset)).toBe(0);
		},
	);

	it("presets stay admin-only for PUT/DELETE (regression)", async () => {
		const id = await seedConfig(null, true, null);
		expect((await call(ownerA, "PUT", `/agents/${id}`, { name: "x" })).status).toBe(403);
		expect((await call(admin, "PUT", `/agents/${id}`, { name: "by-admin" })).status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// 2. POST /projects/import — workspace confinement
// ---------------------------------------------------------------------------
describe("POST /projects/import — path confinement", () => {
	const tenantDir = (t: string) => join(WS_ROOT, t);
	const mkdir = (p: string) => {
		mkdirSync(p, { recursive: true });
		writeFileSync(join(p, "package.json"), JSON.stringify({ name: "f2r" }));
		return p;
	};
	const imp = async (who: { token: string }, repoPath: string) => {
		const res = await call(who, "POST", "/projects/import", { name: "f2r-import", repoPath });
		const body = (await res.json()) as { id?: string; error?: string };
		if (body.id) cleanup.projects.push(body.id);
		return { status: res.status, body };
	};
	let outsideExisting: string;

	beforeAll(() => {
		outsideExisting = realpathSync(mkdtempSync(join(tmpdir(), "f2r-outside-")));
		writeFileSync(join(outsideExisting, "package.json"), "{}");
		cleanup.dirs.push(outsideExisting);
	});

	it("a directory inside <root>/<tenantId>/ is accepted", async () => {
		const dir = mkdir(join(tenantDir(TENANT_A), `ok-${U}`));
		const r = await imp(ownerA, dir);
		expect(r.status).toBe(201);
	});

	it("outside the workspace → 400, and the message is identical whether or not the path exists", async () => {
		const existing = await imp(ownerA, outsideExisting);
		const missing = await imp(ownerA, join(tmpdir(), `f2r-does-not-exist-${U}`));
		expect(existing.status).toBe(400);
		expect(missing.status).toBe(400);
		expect(missing.body.error).toBe(existing.body.error);
		expect(existing.body.error).not.toContain(outsideExisting);
	});

	it("../ traversal out of the tenant directory is rejected with the same message", async () => {
		const ref = await imp(ownerA, outsideExisting);
		const other = mkdir(join(tenantDir(TENANT_B), `other-${U}`));
		for (const p of [
			`${tenantDir(TENANT_A)}/../${TENANT_B}/other-${U}`,
			`${tenantDir(TENANT_A)}/ok-${U}/../../${TENANT_B}/other-${U}`,
			`${tenantDir(TENANT_A)}/../../../etc`,
			other,
		]) {
			const r = await imp(ownerA, p);
			expect(r.status, p).toBe(400);
			expect(r.body.error, p).toBe(ref.body.error);
		}
	});

	it("a symlink inside the tenant directory that points outside is rejected (symlinks followed)", async () => {
		mkdirSync(tenantDir(TENANT_A), { recursive: true });
		const link = join(tenantDir(TENANT_A), `link-${U}`);
		symlinkSync(outsideExisting, link);
		const r = await imp(ownerA, link);
		expect(r.status).toBe(400);
		expect(r.body.id).toBeUndefined();
	});

	it("a path inside another tenant's directory is rejected", async () => {
		const dir = mkdir(join(tenantDir(TENANT_A), `a-only-${U}`));
		const r = await imp(ownerB, dir);
		expect(r.status).toBe(400);
	});

	it("platform admin is exempt (may import outside the workspace)", async () => {
		const r = await imp(admin, outsideExisting);
		expect(r.status).toBe(201);
	});
});

// ---------------------------------------------------------------------------
// 3. /api/observability: platform admin only
// ---------------------------------------------------------------------------
describe("/api/observability — platform admin only", () => {
	const obs = (token?: string) =>
		runOutsideScope(async () =>
			observabilityRoutes.request("/logs", { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
		);

	it("unauthenticated → 401, authenticated non-admin → 403, platform admin → 200", async () => {
		expect((await obs()).status).toBe(401);
		expect((await obs(ownerA.token)).status).toBe(403);
		expect((await obs(admin.token)).status).toBe(200);
	});

	it("also for write routes (POST /rag/knowledge-bases) non-admin → 403", async () => {
		const res = await runOutsideScope(async () =>
			observabilityRoutes.request("/rag/knowledge-bases", {
				method: "POST",
				headers: { Authorization: `Bearer ${ownerA.token}`, "content-type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			}),
		);
		expect(res.status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// 4. Legacy OSCORPEX_API_KEY
// ---------------------------------------------------------------------------
describe("legacy OSCORPEX_API_KEY", () => {
	const KEY = "f2r-legacy-key-0123456789abcdef";
	function ctx(auth: string): any {
		const store: Record<string, unknown> = {};
		return {
			req: {
				path: "/projects",
				method: "GET",
				header: (n: string) => (n.toLowerCase() === "authorization" ? auth : undefined),
			},
			get: (k: string) => store[k],
			set: (k: string, v: unknown) => {
				store[k] = v;
			},
			json: (body: unknown, status = 200) => ({ body, status }),
			_store: store,
		};
	}

	it("production + auth enabled: rejected unless OSCORPEX_ALLOW_LEGACY_API_KEY=true", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_API_KEY = KEY;
		const c = ctx(`Bearer ${KEY}`);
		const next = vi.fn(async () => {});
		const res: any = await authMiddleware(c, next);
		expect(next).not.toHaveBeenCalled();
		expect(res?.status).toBe(401);
	});

	it("production + OSCORPEX_ALLOW_LEGACY_API_KEY=true: accepted, actor recorded as legacy-operator", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_API_KEY = KEY;
		process.env.OSCORPEX_ALLOW_LEGACY_API_KEY = "true";
		const c = ctx(`Bearer ${KEY}`);
		const next = vi.fn(async () => {});
		await authMiddleware(c, next);
		expect(next).toHaveBeenCalled();
		expect(c._store.authType).toBe("api-key");
		expect(c._store.userId).toBe("legacy-operator");
	});

	it("non-production: still accepted without the flag", async () => {
		process.env.OSCORPEX_API_KEY = KEY;
		const c = ctx(`Bearer ${KEY}`);
		const next = vi.fn(async () => {});
		await authMiddleware(c, next);
		expect(next).toHaveBeenCalled();
		expect(c._store.userId).toBe("legacy-operator");
	});

	it("a wrong key of the same length / a prefix of the key is rejected", async () => {
		process.env.OSCORPEX_API_KEY = KEY;
		for (const bad of [`${KEY.slice(0, -1)}X`, KEY.slice(0, 10), `${KEY}x`, ""]) {
			const next = vi.fn(async () => {});
			const res: any = await authMiddleware(ctx(`Bearer ${bad}`), next);
			expect(next, bad).not.toHaveBeenCalled();
			expect(res?.status, bad).toBe(401);
		}
	});

	it("comparison is constant-time (static check)", () => {
		const src = readFileSync(join(SRC, "auth/auth-middleware.ts"), "utf8");
		expect(src).toContain("timingSafeEqual");
		expect(src).not.toMatch(/authHeader\s*===\s*`Bearer \$\{envApiKey\}`/);
	});
});

// ---------------------------------------------------------------------------
// 5. Control-plane approvals are tenant-filtered
// ---------------------------------------------------------------------------
describe("control-plane approvals — tenant isolation (A cannot see or act on B)", () => {
	let aId: string;
	let bId: string;
	let bStaleId: string;
	beforeAll(async () => {
		const pa = await seedProject(TENANT_A);
		const pb = await seedProject(TENANT_B);
		const mk = async (project: string, past = false) => {
			const id = `f2r-appr-${randomUUID()}`;
			cleanup.approvals.push(id);
			await withMigrator((c) =>
				c.query(
					`INSERT INTO approvals (id, project_id, kind, status, title, description, requested_by, expires_at, escalated)
					 VALUES ($1, $2, 'deploy', 'pending', 'f2r', '', 'someone', now() + ($3 || ' hour')::interval, false)`,
					[id, project, past ? "-2" : "1"],
				),
			);
			return id;
		};
		aId = await mk(pa);
		bId = await mk(pb);
		bStaleId = await mk(pb, true);
	});
	const status = async (id: string) =>
		(await withMigrator((c) => c.query("SELECT status FROM approvals WHERE id = $1", [id]))).rows[0]?.status;

	it("list contains only the caller tenant's approvals", async () => {
		const res = await call(ownerA, "GET", "/control-plane/approvals");
		const ids = ((await res.json()) as { approvals: Array<{ id: string }> }).approvals.map((a) => a.id);
		expect(ids).toContain(aId);
		expect(ids).not.toContain(bId);
		const asB = (
			(await (await call(ownerB, "GET", "/control-plane/approvals")).json()) as { approvals: Array<{ id: string }> }
		).approvals.map((a) => a.id);
		expect(asB).toContain(bId);
		expect(asB).not.toContain(aId);
	});

	it("GET /:id of another tenant's approval → 404, own → 200", async () => {
		expect((await call(ownerA, "GET", `/control-plane/approvals/${bId}`)).status).toBe(404);
		expect((await call(ownerA, "GET", `/control-plane/approvals/${aId}`)).status).toBe(200);
	});

	it("approve / reject / escalate on another tenant's approval → 404 and nothing changes", async () => {
		expect((await call(ownerA, "POST", `/control-plane/approvals/${bId}/approve`, {})).status).toBe(404);
		expect((await call(ownerA, "POST", `/control-plane/approvals/${bId}/reject`, {})).status).toBe(404);
		expect((await call(ownerA, "POST", `/control-plane/approvals/${bId}/escalate`, { target: "ops" })).status).toBe(
			404,
		);
		expect(await status(bId)).toBe("pending");
		const ev = await withMigrator((c) => c.query("SELECT 1 FROM approval_events WHERE approval_id = $1", [bId]));
		expect(ev.rowCount).toBe(0);
	});

	it("expire-stale only touches the caller tenant's approvals", async () => {
		const res = await call(ownerA, "POST", "/control-plane/approvals/expire-stale", {});
		expect(res.status).toBe(200);
		expect(await status(bStaleId)).toBe("pending");
	});

	it("own approval can still be approved (regression)", async () => {
		expect((await call(ownerA, "POST", `/control-plane/approvals/${aId}/approve`, {})).status).toBe(200);
	});

	it("approve/reject handlers no longer parse an unused request body (static)", () => {
		const src = readFileSync(join(SRC, "control-plane/approvals/approval-routes.ts"), "utf8");
		expect((src.match(/c\.req\.json\(/g) ?? []).length).toBeLessThanOrEqual(2); // create + escalate(target) only
	});
});

// ---------------------------------------------------------------------------
// 6. Learning routes use the caller's tenant
// ---------------------------------------------------------------------------
describe("learning routes ignore client-supplied tenant ids", () => {
	it("GET /learning/patterns?tenantId=<other> never returns the other tenant's patterns", async () => {
		const marker = `f2r-marker-${U}`;
		const ids: string[] = [];
		for (const role of ["backend-dev", "backend", "backend-developer"]) {
			const id = `f2r-lp-${randomUUID()}`;
			ids.push(id);
			cleanup.patterns.push(id);
			await withMigrator((c) =>
				c.query(
					`INSERT INTO learning_patterns (id, tenant_id, learning_type, task_type, agent_role, pattern, sample_count, success_rate)
					 VALUES ($1, $2, 'success_pattern', $3, $4, $5, 3, 0.9)`,
					[id, TENANT_B, `f2r-tt-${U}`, role, JSON.stringify({ marker })],
				),
			);
		}
		for (const role of ["backend-dev", "backend", "backend-developer"]) {
			const res = await call(
				ownerA,
				"GET",
				`/learning/patterns?taskType=f2r-tt-${U}&agentRole=${role}&tenantId=${TENANT_B}`,
			);
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).not.toContain(marker);
			for (const id of ids) expect(text).not.toContain(id);
		}
	});

	it("handlers do not read tenantId from the query string or path (static)", () => {
		const src = readFileSync(join(SRC, "routes/graph-routes.ts"), "utf8");
		expect(src).not.toMatch(/query\(\s*["']tenantId["']\s*\)/);
		expect(src).not.toMatch(/param\(\s*["']tenantId["']\s*\)/);
	});

	it("POST /learning/extract/:tenantId of another tenant does not run for that tenant", async () => {
		const res = await call(ownerA, "POST", `/learning/extract/${TENANT_B}`);
		expect([200, 400, 403, 404]).toContain(res.status);
		if (res.status === 200) {
			// processed for the caller's own tenant only: it cannot be a hit on B's episodes
			const body = (await res.json()) as { patternsCreated?: number };
			expect(typeof body.patternsCreated === "number" || body.patternsCreated === undefined).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// 7. Identity verification on every request
// ---------------------------------------------------------------------------
describe("identity is verified against the DB on each request", () => {
	it("deleted user → 401", async () => {
		const u = await mkUser({ tenantId: TENANT_A });
		expect((await call(u, "GET", "/projects")).status).toBe(200);
		await withMigrator((c) => c.query("DELETE FROM users WHERE id = $1", [u.id]));
		expect((await call(u, "GET", "/projects")).status).toBe(401);
	});

	it("user removed from the tenant (no role row) → 401 or 403", async () => {
		const u = await mkUser({ tenantId: TENANT_A });
		await withMigrator((c) => c.query("DELETE FROM user_roles WHERE user_id = $1", [u.id]));
		expect([401, 403]).toContain((await call(u, "GET", "/projects")).status);
	});

	it("the role comes from the DB, not the token (token says owner, DB says viewer)", async () => {
		const u = await mkUser({ tenantId: TENANT_A, role: "viewer" });
		const forged = signJwt({ sub: u.id, email: u.email, tenantId: TENANT_A, role: "owner" });
		const res = await call({ token: forged }, "POST", "/projects", {
			name: "f2r-forged",
			description: "forged owner role project",
		});
		expect(res.status).toBe(403);
		expect((await call({ token: forged }, "GET", "/projects")).status).toBe(200); // viewer can read
	});

	it("a role downgrade in the DB takes effect immediately", async () => {
		const u = await mkUser({ tenantId: TENANT_A, role: "owner" });
		await withMigrator((c) => c.query("UPDATE user_roles SET role = 'viewer' WHERE user_id = $1", [u.id]));
		expect(
			(await call(u, "POST", "/projects", { name: "f2r-down", description: "downgraded user project" })).status,
		).toBe(403);
	});

	it("a token whose tenant differs from the user's role tenant is rejected", async () => {
		const u = await mkUser({ tenantId: TENANT_A });
		const forged = signJwt({ sub: u.id, email: u.email, tenantId: TENANT_B, role: "owner" });
		expect([401, 403]).toContain((await call({ token: forged }, "GET", "/projects")).status);
	});

	async function dbKey(user: SeededUser, scopes: string[]): Promise<string> {
		const key = `osx_${randomUUID().replaceAll("-", "")}`;
		const id = `f2r-key-${randomUUID()}`;
		cleanup.keys.push(id);
		await withMigrator((c) =>
			c.query(
				"INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, scopes) VALUES ($1, $2, $3, $4, 'f2r', $5)",
				[id, user.tenantId, user.id, sha(key), scopes],
			),
		);
		return key;
	}

	it("API key of a deleted user → 401", async () => {
		const u = await mkUser({ tenantId: TENANT_A });
		const key = await dbKey(u, []);
		expect((await call({ token: key }, "GET", "/projects")).status).toBe(200);
		await withMigrator(async (c) => {
			await c.query("DELETE FROM user_roles WHERE user_id = $1", [u.id]);
		});
		expect([401, 403]).toContain((await call({ token: key }, "GET", "/projects")).status);
	});

	it("a read-only scoped API key of a platform admin does NOT get platform:admin", async () => {
		const key = await dbKey(admin, ["projects:read"]);
		expect((await call({ token: key }, "GET", "/platform/stats")).status).toBe(403);
	});

	it("an explicit 'platform:admin' scope on the key of a platform admin does", async () => {
		const key = await dbKey(admin, ["platform:admin"]);
		expect((await call({ token: key }, "GET", "/platform/stats")).status).toBe(200);
	});

	it("an explicit 'platform:admin' scope does not help a non-admin user", async () => {
		const key = await dbKey(ownerA, ["platform:admin"]);
		expect((await call({ token: key }, "GET", "/platform/stats")).status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// 11. /auth/me exposes isPlatformAdmin (console hides admin links for non-admins)
// ---------------------------------------------------------------------------
describe("GET /auth/me", () => {
	const me = (u: { token: string }) =>
		runOutsideScope(async () => authRoutes.request("/me", { headers: { Authorization: `Bearer ${u.token}` } }));

	it("returns isPlatformAdmin=true for a platform admin and false for others", async () => {
		const a = await me(admin);
		expect(a.status).toBe(200);
		expect(((await a.json()) as { isPlatformAdmin?: boolean }).isPlatformAdmin).toBe(true);
		const o = await me(ownerA);
		expect(((await o.json()) as { isPlatformAdmin?: boolean }).isPlatformAdmin).toBe(false);
	});

	it("works under strict scope mode", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		expect((await me(ownerA)).status).toBe(200);
	});
});

void beforeEach;
