// ---------------------------------------------------------------------------
// F2 round 3, item 2 — POST /team-architect/chat: the planner CLI runs tool-less in plan mode (no
// bypassPermissions); a provider that cannot guarantee "no file access" is never selected (fail-closed);
// the prompt only contains the caller tenant's custom teams.
// The CLI spawn is mocked; assertions are made on the spawned binary, args and the prompt written to stdin.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface SpawnCall {
	bin: string;
	args: string[];
	stdin: string;
}
const cli = vi.hoisted(() => ({
	runs: [] as SpawnCall[],
	/** binaries whose `--version` probe succeeds */
	available: new Set<string>(["claude", "codex", "gemini"]),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const { EventEmitter } = await import("node:events");
	const fakeSpawn = (bin: string, args: string[] = []) => {
		const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & Record<string, unknown>;
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		let stdin = "";
		const call: SpawnCall = { bin, args: [...args], stdin: "" };
		proc.stdout = stdout;
		proc.stderr = stderr;
		proc.stdin = {
			write: (s: string) => {
				stdin += String(s);
				call.stdin = stdin;
				return true;
			},
			end: (s?: string) => {
				if (s !== undefined) {
					stdin += String(s);
					call.stdin = stdin;
				}
			},
			on: () => undefined,
		};
		proc.kill = () => true;
		proc.pid = 4242;
		const name = basename(bin);
		const isProbe = args.includes("--version");
		if (!isProbe) cli.runs.push(call);
		setTimeout(
			() => {
				if (isProbe) {
					if (cli.available.has(name)) {
						stdout.emit("data", Buffer.from("9.9.9\n"));
						proc.emit("close", 0);
					} else {
						proc.emit("close", 1);
					}
					return;
				}
				stdout.emit("data", Buffer.from('{"type":"result","result":"ok"}\n'));
				proc.emit("close", 0);
			},
			isProbe ? 0 : 20,
		);
		return proc;
	};
	return { ...actual, spawn: fakeSpawn, default: { ...actual, spawn: fakeSpawn } };
});

import { studioRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { cleanup, registerCleanup, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import { type SeededUser, seedUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

const U = randomUUID().slice(0, 8);
let ownerA: SeededUser;
const teamA = { id: `f2r3-team-a-${U}`, name: `AlphaTeam${U}`, role: `alpharole${U}` };
const teamB = { id: `f2r3-team-b-${U}`, name: `BetaTeam${U}`, role: `betarole${U}` };

beforeAll(async () => {
	ownerA = await seedUser({ tenantId: TENANT_A, id: `f2r3-ta-owner-${U}` });
	cleanup.users.push(ownerA.id);
});

beforeEach(() => {
	cli.runs.length = 0;
	cli.available = new Set(["claude", "codex", "gemini"]);
});

async function chat(provider?: string): Promise<{ status: number; text: string }> {
	const res = await runOutsideScope(async () =>
		studioRoutes.request("/team-architect/chat", {
			method: "POST",
			headers: { Authorization: `Bearer ${ownerA.token}`, "content-type": "application/json" },
			body: JSON.stringify({
				messages: [{ role: "user", content: "recommend a team" }],
				intake: { name: "proj" },
				provider,
			}),
		}),
	);
	return { status: res.status, text: await res.text() };
}

const bin = (r: SpawnCall) => basename(r.bin);
const claudeRuns = () => cli.runs.filter((r) => bin(r) === "claude");
const toolsDisabled = (args: string[]) => {
	const i = args.indexOf("--tools");
	if (i >= 0 && args[i + 1] === "") return true;
	return args.some((a) => /^--disallowed-?tools$/i.test(a));
};

describe("claude planner CLI is locked down", () => {
	it("never passes bypassPermissions", async () => {
		await chat("claude-code");
		expect(claudeRuns().length).toBeGreaterThan(0);
		for (const r of claudeRuns()) expect(r.args.join(" ")).not.toContain("bypassPermissions");
	});

	it("runs in plan mode", async () => {
		await chat("claude-code");
		const r = claudeRuns()[0];
		const i = r.args.indexOf("--permission-mode");
		expect(i).toBeGreaterThanOrEqual(0);
		expect(r.args[i + 1]).toBe("plan");
	});

	it('disables all tools (--tools "" or a disallow-all list)', async () => {
		await chat("claude-code");
		expect(toolsDisabled(claudeRuns()[0].args)).toBe(true);
	});
});

describe("fail-closed provider selection", () => {
	const runsOfUnsafe = () => cli.runs.filter((r) => bin(r) !== "claude");
	const isFailure = (r: { status: number; text: string }) => r.status >= 400 || /event: error/.test(r.text);

	it("requesting codex (sandbox read-only still allows reading files) does not spawn codex", async () => {
		const res = await chat("codex");
		expect(runsOfUnsafe().map(bin)).not.toContain("codex");
		// either an explicit error, or a fall back to the locked-down claude run
		if (claudeRuns().length === 0) expect(isFailure(res)).toBe(true);
		else expect(toolsDisabled(claudeRuns()[0].args)).toBe(true);
	});

	it("requesting gemini does not spawn gemini", async () => {
		const res = await chat("gemini");
		expect(runsOfUnsafe().map(bin)).not.toContain("gemini");
		if (claudeRuns().length === 0) expect(isFailure(res)).toBe(true);
		else expect(toolsDisabled(claudeRuns()[0].args)).toBe(true);
	});

	it("only codex/gemini installed (claude missing) → error, nothing is spawned", async () => {
		cli.available = new Set(["codex", "gemini"]);
		const res = await chat();
		expect(cli.runs).toEqual([]);
		expect(isFailure(res)).toBe(true);
	});

	it("no provider requested with everything installed → the locked-down claude run", async () => {
		await chat();
		expect(runsOfUnsafe()).toEqual([]);
		expect(claudeRuns().length).toBe(1);
		expect(toolsDisabled(claudeRuns()[0].args)).toBe(true);
	});
});

describe("prompt content is tenant-scoped", () => {
	// custom_team_templates gets a tenant_id column in this round (assumed contract); seeded here so the
	// lock-down tests above stay independent of it.
	beforeAll(async () => {
		await withMigrator(async (c) => {
			await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [TENANT_B]);
			for (const [t, tenant] of [
				[teamA, TENANT_A],
				[teamB, TENANT_B],
			] as const) {
				cleanup.teams.push(t.id);
				await c.query(
					`INSERT INTO custom_team_templates (id, name, description, roles, dependencies, created_at, tenant_id)
					 VALUES ($1, $2, 'desc', $3, '[]', $4, $5)`,
					[t.id, t.name, JSON.stringify([t.role]), new Date().toISOString(), tenant],
				);
			}
		});
	});

	it("includes the caller tenant's custom team and not another tenant's", async () => {
		await chat("claude-code");
		const r = claudeRuns()[0];
		const prompt = `${r.stdin}\n${r.args.join("\n")}`;
		expect(prompt).toContain(teamA.name);
		expect(prompt).toContain(teamA.role);
		expect(prompt).not.toContain(teamB.name);
		expect(prompt).not.toContain(teamB.role);
	});
});
