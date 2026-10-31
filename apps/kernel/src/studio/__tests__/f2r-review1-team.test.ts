// ---------------------------------------------------------------------------
// F2 review round 1 — team architect CLI runs in an isolated empty temp directory,
// never in the kernel's working directory.
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const planner = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("../planner-cli.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		// The route requires an installed Claude CLI; report it available so the test doesn't depend on the host.
		listPlannerCLIProviders: async () =>
			(await (actual.listPlannerCLIProviders as () => Promise<Array<{ id: string }>>)()).map((p) =>
				p.id === "claude-code" ? { ...p, available: true } : p,
			),
		streamPlannerWithCLI: (opts: Record<string, unknown>, cb: { onDone: (t: string) => void }) => {
			planner.calls.push(opts);
			setTimeout(() => cb.onDone("ok"), 0);
			return () => {};
		},
	};
});

import { studioRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { type SeededUser, removeUsers, seedUser } from "./helpers/identity.js";
import { TENANT_A } from "./helpers/tenancy.js";

let user: SeededUser;
beforeAll(async () => {
	user = await seedUser({ tenantId: TENANT_A, id: `f2r-team-owner-${Date.now()}` });
});
afterAll(async () => {
	await removeUsers([user.id]);
});
beforeEach(() => {
	planner.calls.length = 0;
	process.env.OSCORPEX_AUTH_ENABLED = "true";
});

describe("POST /team-architect/chat", () => {
	it("passes an isolated, empty temp directory as repoPath (not process.cwd(), outside the repo)", async () => {
		const res = await runOutsideScope(async () =>
			studioRoutes.request("/team-architect/chat", {
				method: "POST",
				headers: { Authorization: `Bearer ${user.token}`, "content-type": "application/json" },
				body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], intake: { name: "x" } }),
			}),
		);
		await res.text(); // drain the SSE stream
		expect(planner.calls.length).toBe(1);
		const repoPath = String(planner.calls[0].repoPath);
		const cwd = process.cwd();
		expect(repoPath).not.toBe(cwd);
		expect(resolve(repoPath)).not.toBe(resolve("."));
		expect(resolve(repoPath).startsWith(resolve(cwd) + sep)).toBe(false);
		expect(resolve(cwd).startsWith(resolve(repoPath) + sep)).toBe(false);
		// the directory is empty (nothing of the kernel's working tree is exposed)
		let entries: string[] = [];
		try {
			entries = readdirSync(repoPath);
		} catch {
			/* removed after the stream completed — also fine */
		}
		expect(entries).toEqual([]);
	});

	it("each request gets its own directory", async () => {
		const post = () =>
			runOutsideScope(async () =>
				studioRoutes.request("/team-architect/chat", {
					method: "POST",
					headers: { Authorization: `Bearer ${user.token}`, "content-type": "application/json" },
					body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
				}),
			);
		await (await post()).text();
		await (await post()).text();
		expect(planner.calls.length).toBe(2);
		expect(planner.calls[0].repoPath).not.toBe(planner.calls[1].repoPath);
	});
});
