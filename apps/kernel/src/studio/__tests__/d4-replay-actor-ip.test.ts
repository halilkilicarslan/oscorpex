// ---------------------------------------------------------------------------
// D4 review — the restore audit IP uses the same trusted client-IP resolution as the rate limiter:
// right-most X-Forwarded-For entry only when OSCORPEX_TRUSTED_PROXY=true, else the socket address.
// Without a socket (app.request) and without a trusted proxy the spoofed header must not be recorded.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../replay-store.js", () => ({
	replayStore: {
		getSnapshot: vi.fn(async () => ({ id: "s1", projectId: "p1", checkpoint: "c", createdAt: "now", tasks: [] })),
	},
	restoreFromSnapshot: vi.fn(async () => ({ restored: 0 })),
}));
vi.mock("../event-bus.js", async (orig) => {
	const real = await orig<typeof import("../event-bus.js")>();
	return { ...real, eventBus: { ...real.eventBus, emitTransient: vi.fn() } };
});

import { eventBus } from "../event-bus.js";
import { replayRoutes } from "../routes/replay-routes.js";

let saved: string | undefined;
beforeEach(() => {
	saved = process.env.OSCORPEX_TRUSTED_PROXY;
	Reflect.deleteProperty(process.env, "OSCORPEX_TRUSTED_PROXY");
	vi.mocked(eventBus.emitTransient).mockClear();
});
afterEach(() => {
	if (saved === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_TRUSTED_PROXY");
	else process.env.OSCORPEX_TRUSTED_PROXY = saved;
});

async function restoreIp(): Promise<{ body: string; audit: string }> {
	const res = await replayRoutes.request("/runs/r1/restore", {
		method: "POST",
		headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6, 1.2.3.4" },
		body: JSON.stringify({ dryRun: true }),
	});
	const json = (await res.json()) as { actor: { ip: string } };
	const call = vi.mocked(eventBus.emitTransient).mock.calls[0]?.[0] as unknown as
		| { payload: { actor: { ip: string } } }
		| undefined;
	return { body: json.actor.ip, audit: call?.payload.actor.ip ?? "" };
}

describe("replay restore audit IP", () => {
	it("spoofed X-Forwarded-For without a trusted proxy is not recorded", async () => {
		const { body, audit } = await restoreIp();
		expect(body).not.toContain("6.6.6.6");
		expect(audit).not.toContain("6.6.6.6");
		expect(body).not.toContain("1.2.3.4");
	});

	it("with OSCORPEX_TRUSTED_PROXY=true the right-most entry is recorded", async () => {
		process.env.OSCORPEX_TRUSTED_PROXY = "true";
		const { body, audit } = await restoreIp();
		expect(body).toBe("1.2.3.4");
		expect(audit).toBe("1.2.3.4");
	});
});
