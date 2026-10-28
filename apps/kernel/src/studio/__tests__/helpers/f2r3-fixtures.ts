// ---------------------------------------------------------------------------
// F2 round 3 — shared fixtures for the f2r3-*.test.ts suites: env handling, identity, seed + cleanup.
// All seeding goes through withMigrator (owner rights, bypasses RLS) so it works in both test modes.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach } from "vitest";
import { studioRoutes } from "../../index.js";
import { runOutsideScope } from "../../tenancy/tenant-scope.js";
import { type SeededUser, removeUsers, seedUser } from "./identity.js";
import { withMigrator } from "./tenancy.js";

export const U = randomUUID().slice(0, 8);
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"OSCORPEX_ALLOW_LEGACY_API_KEY",
	"OSCORPEX_TENANT_SCOPE_MODE",
	"NODE_ENV",
] as const;

/** Registers beforeEach/afterEach hooks: AUTH_ENABLED=true, other auth env cleared, restored afterwards. */
export function useAuthEnabledEnv(): void {
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
}

export const cleanup = {
	users: [] as string[],
	projects: [] as string[],
	skills: [] as string[],
	agentConfigs: [] as string[],
	projectAgents: [] as string[],
	teams: [] as string[],
	keys: [] as string[],
};

/** Call once per suite: removes everything seeded through these helpers. */
export function registerCleanup(): void {
	afterAll(async () => {
		await withMigrator(async (c) => {
			if (cleanup.keys.length) await c.query("DELETE FROM api_keys WHERE id = ANY($1)", [cleanup.keys]);
			if (cleanup.projectAgents.length) {
				await c.query("DELETE FROM agent_skills WHERE agent_id = ANY($1)", [cleanup.projectAgents]);
			}
			if (cleanup.projects.length) {
				await c.query("DELETE FROM project_skills WHERE project_id = ANY($1)", [cleanup.projects]);
				await c.query(
					"DELETE FROM agent_skills WHERE agent_id IN (SELECT id FROM project_agents WHERE project_id = ANY($1))",
					[cleanup.projects],
				);
				await c.query("DELETE FROM project_agents WHERE project_id = ANY($1)", [cleanup.projects]);
			}
			if (cleanup.skills.length) {
				await c.query("DELETE FROM agent_skills WHERE skill_id = ANY($1)", [cleanup.skills]);
				await c.query("DELETE FROM project_skills WHERE skill_id = ANY($1)", [cleanup.skills]);
				await c.query("DELETE FROM skills WHERE id = ANY($1)", [cleanup.skills]);
			}
			if (cleanup.projectAgents.length) {
				await c.query("DELETE FROM project_agents WHERE id = ANY($1)", [cleanup.projectAgents]);
			}
			if (cleanup.projects.length) {
				await c.query("DELETE FROM tasks WHERE project_id = ANY($1)", [cleanup.projects]).catch(() => undefined);
				await c.query("DELETE FROM projects WHERE id = ANY($1)", [cleanup.projects]);
			}
			if (cleanup.agentConfigs.length) {
				await c.query("DELETE FROM agent_configs WHERE id = ANY($1)", [cleanup.agentConfigs]);
			}
			if (cleanup.teams.length) await c.query("DELETE FROM custom_team_templates WHERE id = ANY($1)", [cleanup.teams]);
		});
		await removeUsers(cleanup.users);
	});
}

export async function mkUser(o: { tenantId: string; role?: string; admin?: boolean }): Promise<SeededUser> {
	const u = await seedUser({ ...o, id: `f2r3-${U}-${randomUUID().slice(0, 8)}` });
	cleanup.users.push(u.id);
	return u;
}

export function call(who: { token: string }, method: string, path: string, body?: unknown) {
	return runOutsideScope(async () =>
		studioRoutes.request(path, {
			method,
			headers: { Authorization: `Bearer ${who.token}`, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

export async function seedProject(
	tenantId: string,
	o: { description?: string; techStack?: string[]; name?: string } = {},
): Promise<string> {
	const id = `f2r3-proj-${randomUUID()}`;
	cleanup.projects.push(id);
	await withMigrator((c) =>
		c.query(
			"INSERT INTO projects (id, name, description, tech_stack, created_at, updated_at, tenant_id) VALUES ($1, $2, $3, $4, now(), now(), $5)",
			[id, o.name ?? "f2r3", o.description ?? "", JSON.stringify(o.techStack ?? []), tenantId],
		),
	);
	return id;
}

export async function seedProjectAgent(projectId: string, role = "backend-dev"): Promise<string> {
	const id = `f2r3-pa-${randomUUID()}`;
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

/** Skills carry (tenant_id, created_by) ownership since F2 round 3 — the column is added by the implementation. */
export async function seedSkill(o: {
	tenantId: string | null;
	createdBy: string | null;
	isGlobal?: boolean;
	triggers?: string[];
	name?: string;
}): Promise<string> {
	const id = `f2r3-skill-${randomUUID()}`;
	cleanup.skills.push(id);
	await withMigrator((c) =>
		c.query(
			`INSERT INTO skills (id, name, description, is_global, created_by, tenant_id, triggers, content_md)
			 VALUES ($1, $2, '', $3, $4, $5, $6, '# body')`,
			[
				id,
				o.name ?? `f2r3-${id.slice(-8)}`,
				o.isGlobal === true,
				o.createdBy,
				o.tenantId,
				JSON.stringify(o.triggers ?? []),
			],
		),
	);
	return id;
}

export async function seedAgentConfig(o: {
	tenantId: string | null;
	createdBy: string | null;
	role?: string;
	name?: string;
	systemPrompt?: string;
	preset?: boolean;
}): Promise<string> {
	const id = `f2r3-ac-${randomUUID()}`;
	cleanup.agentConfigs.push(id);
	await withMigrator((c) =>
		c.query(
			`INSERT INTO agent_configs (id, name, role, system_prompt, is_preset, created_by, tenant_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				id,
				o.name ?? `f2r3-${id.slice(-8)}`,
				o.role ?? "coder",
				o.systemPrompt ?? "",
				o.preset ? 1 : 0,
				o.createdBy,
				o.tenantId,
			],
		),
	);
	return id;
}

export async function seedDbKey(user: SeededUser, scopes: string[], tenantId = user.tenantId): Promise<string> {
	const key = `osx_${randomUUID().replaceAll("-", "")}`;
	const id = `f2r3-key-${randomUUID()}`;
	cleanup.keys.push(id);
	await withMigrator((c) =>
		c.query(
			"INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, scopes) VALUES ($1, $2, $3, $4, 'f2r3', $5)",
			[id, tenantId, user.id, sha(key), scopes],
		),
	);
	return key;
}
