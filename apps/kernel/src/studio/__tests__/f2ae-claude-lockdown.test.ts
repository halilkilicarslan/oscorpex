// ---------------------------------------------------------------------------
// F2 round 3 (final items), A — the team-architect Claude CLI runs with NO MCP servers and NO user/project/local
// settings: --strict-mcp-config + an empty --mcp-config, every MCP tool disallowed (mcp__*), and
// --setting-sources set to an empty list. Existing lockdown guarantees (plan mode, tools off, no bypass) stay.
// The CLI spawn is mocked; assertions are made on the spawned args only.
// Flags verified against `claude --help`: --strict-mcp-config, --mcp-config <configs...>,
// --disallowedTools/--disallowed-tools <tools...>, --setting-sources <sources> (comma-separated: user,project,local).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface SpawnCall {
	bin: string;
	args: string[];
}
const cli = vi.hoisted(() => ({ runs: [] as SpawnCall[] }));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const { EventEmitter } = await import("node:events");
	const fakeSpawn = (bin: string, args: string[] = []) => {
		const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & Record<string, unknown>;
		const stdout = new EventEmitter();
		proc.stdout = stdout;
		proc.stderr = new EventEmitter();
		proc.stdin = { write: () => true, end: () => undefined, on: () => undefined };
		proc.kill = () => true;
		proc.pid = 4243;
		const isProbe = args.includes("--version");
		if (!isProbe) cli.runs.push({ bin, args: [...args] });
		setTimeout(
			() => {
				stdout.emit("data", Buffer.from(isProbe ? "9.9.9\n" : '{"type":"result","result":"ok"}\n'));
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
import { TENANT_A } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

let owner: SeededUser;
beforeAll(async () => {
	owner = await seedUser({ tenantId: TENANT_A, id: `f2ae-lock-${randomUUID().slice(0, 8)}` });
	cleanup.users.push(owner.id);
});
beforeEach(() => {
	cli.runs.length = 0;
});

async function claudeArgs(): Promise<string[]> {
	await runOutsideScope(async () =>
		studioRoutes.request("/team-architect/chat", {
			method: "POST",
			headers: { Authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
			body: JSON.stringify({
				messages: [{ role: "user", content: "recommend a team" }],
				intake: { name: "proj" },
				provider: "claude-code",
			}),
		}),
	);
	const run = cli.runs.find((r) => basename(r.bin) === "claude");
	expect(run, "claude planner CLI must have been spawned").toBeDefined();
	return run?.args ?? [];
}

const valueAfter = (args: string[], flag: string) => {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
};

describe("team-architect claude CLI loads no MCP servers and no settings", () => {
	it("passes --strict-mcp-config", async () => {
		expect(await claudeArgs()).toContain("--strict-mcp-config");
	});

	it('passes an EMPTY --mcp-config ({"mcpServers":{}})', async () => {
		const args = await claudeArgs();
		const cfg = valueAfter(args, "--mcp-config");
		expect(cfg).toBeDefined();
		expect(JSON.parse(cfg as string)).toEqual({ mcpServers: {} });
	});

	it("disallows every MCP tool (mcp__*)", async () => {
		const args = await claudeArgs();
		const i = args.findIndex((a) => /^--disallowed-?tools$/i.test(a));
		expect(i).toBeGreaterThanOrEqual(0);
		// value(s) are comma/space separated until the next flag
		const rules: string[] = [];
		for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) rules.push(...args[j].split(/[\s,]+/));
		expect(rules).toContain("mcp__*");
	});

	it("disables settings sources (--setting-sources with an empty list: no user/project/local)", async () => {
		const args = await claudeArgs();
		const v = valueAfter(args, "--setting-sources");
		expect(v).toBeDefined();
		expect(v).not.toMatch(/user|project|local/);
	});

	it("existing lockdown still holds: plan mode, tools off, no bypassPermissions", async () => {
		const args = await claudeArgs();
		expect(valueAfter(args, "--permission-mode")).toBe("plan");
		expect(valueAfter(args, "--tools")).toBe("");
		expect(args.join(" ")).not.toContain("bypassPermissions");
	});
});
